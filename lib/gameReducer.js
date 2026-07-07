// 로컬 모드/온라인 모드가 공유하는 게임 상태 리듀서
// 순수 함수라서 온라인 모드에서는 Supabase에 저장할 "다음 상태"를 계산하는 용도로도 그대로 재사용 가능

import {
  createEmptyBoard,
  checkWin,
  isForbiddenMove,
  checkTerritoryWin,
  findCaptures,
  AUGMENTS,
  pickRandom,
} from "./gomokuEngine";

export function initialGameState() {
  return {
    board: createEmptyBoard(),
    currentPlayer: 1,
    gameOver: false,
    winMessage: "",
    stonesPlaced: { 1: 0, 2: 0 },
    ownedAugments: { 1: [], 2: [] },
    usedAugmentIds: { 1: [], 2: [] }, // 그 플레이어에게 이미 보여준(선택 안 했어도) 증강체 id들 - 다시 안 나오게 제외용
    forbiddenMessage: "",
    forbiddenToken: 0,
    draft: null, // { player, choices: [augment,...], rerolledSlots: [bool,...] }

    oneTimeUsed: { 1: {}, 2: {} }, // { removeStone:true, undo:true, selfUndo:true, doubleMove:true, revive:true }
    lastMove: { 1: null, 2: null }, // 각 플레이어가 마지막으로 놓은 좌표 {x,y}
    blockedCells: { 1: [], 2: [] }, // 이 플레이어가 못 놓는 칸: [{x,y,turnsLeft}] (금지구역)
    permaBlockedCells: { 1: [], 2: [] }, // 이 플레이어가 영원히 못 놓는 칸: [{x,y}] (영구봉쇄)
    doubleMoveActive: { 1: false, 2: false }, // 양수겹침 사용 중 - 이번 한 수는 턴이 안 넘어감
    rushSecondStone: { 1: false, 2: false }, // 질풍노도 보유 시, 이번 턴에 2번째 돌을 아직 안 놨는지
    peekedCard: { 1: null, 2: null }, // 먼저 보기로 예약해 둔 다음 드래프트 확정 카드
    doubleChoicePending: { 1: false, 2: false }, // 더블 초이스 - 다음 드래프트만 4장
    pendingTarget: null, // { player, kind: 'banZone'|'permaBlock'|'removeStone', need, selected: [], keepTurn }
  };
}

// hardExcludeIds: 무슨 일이 있어도 절대 뽑히면 안 되는 것(이미 보유 중 / 지금 같이 보이는 다른 카드)
// softExcludeIds: "이미 봤던 것"이라 되도록 피하고 싶지만, 풀이 모자라면 리셋해도 되는 것
function drawFromPool(hardExcludeIds, softExcludeIds, count) {
  let pool = AUGMENTS.filter((a) => !hardExcludeIds.includes(a.id) && !softExcludeIds.includes(a.id));
  if (pool.length < count) {
    // 한 바퀴 다 돌았으면 "봤던 것" 제한만 리셋. 보유 중/지금 보이는 카드는 항상 제외 유지
    pool = AUGMENTS.filter((a) => !hardExcludeIds.includes(a.id));
  }
  return pickRandom(pool, count);
}

function markUsed(state, player, ability) {
  return { ...state.oneTimeUsed, [player]: { ...state.oneTimeUsed[player], [ability]: true } };
}

function otherPlayer(player) {
  return player === 1 ? 2 : 1;
}

// 4턴 달성 시 새 드래프트 카드 뽑기 (먼저 보기로 예약된 카드/더블 초이스 반영)
function buildDraft(state, player) {
  const ownedIds = state.ownedAugments[player].map((a) => a.id);
  const seenIds = state.usedAugmentIds[player];
  const drawCount = state.doubleChoicePending[player] ? 4 : 3;
  const peeked = state.peekedCard[player];

  let choices;
  if (peeked) {
    const rest = drawFromPool([...ownedIds, peeked.id], seenIds, drawCount - 1);
    choices = [peeked, ...rest];
  } else {
    choices = drawFromPool(ownedIds, seenIds, drawCount);
  }

  return {
    choices,
    usedAugmentIds: [...new Set([...seenIds, ...choices.map((c) => c.id)])],
  };
}

export function gameReducer(state, action) {
  switch (action.type) {
    case "CLICK_CELL": {
      const { x, y } = action;
      if (state.gameOver || state.draft || state.pendingTarget || state.board[y][x] !== 0) return state;

      const { currentPlayer } = state;
      const opponent = otherPlayer(currentPlayer);

      const isBlocked =
        state.blockedCells[currentPlayer].some((c) => c.x === x && c.y === y) ||
        state.permaBlockedCells[currentPlayer].some((c) => c.x === x && c.y === y);
      if (isBlocked) {
        return {
          ...state,
          forbiddenMessage: "여기는 상대가 막아둔 자리라 놓을 수 없어요",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      const ownedIds = state.ownedAugments[currentPlayer].map((a) => a.id);
      const prevMove = state.lastMove[currentPlayer];

      // 렌주룰 금수 판정 (흑돌만 적용, 렌주룰 자체는 증강체와 무관)
      if (currentPlayer === 1) {
        const forbiddenReason = isForbiddenMove(state.board, x, y, ownedIds, prevMove);
        if (forbiddenReason) {
          return {
            ...state,
            forbiddenMessage: "여기는 렌주룰 금수 자리예요 (" + forbiddenReason + ")",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
      }

      const newBoard = state.board.map((row) => row.slice());
      newBoard[y][x] = currentPlayer;

      // 포위 제거: 상대가 철옹성이 아니면 "나-상대-나" 모양이 된 상대 돌 제거
      if (ownedIds.includes("capture")) {
        const opponentOwnedIds = state.ownedAugments[opponent].map((a) => a.id);
        if (!opponentOwnedIds.includes("fortress")) {
          for (const c of findCaptures(newBoard, x, y, currentPlayer)) {
            newBoard[c.y][c.x] = 0;
          }
        }
      }

      const isLineWin = checkWin(newBoard, x, y, currentPlayer, ownedIds, prevMove);
      const isTerritoryWin = ownedIds.includes("territory") && checkTerritoryWin(newBoard, currentPlayer);

      if (isLineWin || isTerritoryWin) {
        const opponentOwnedIds = state.ownedAugments[opponent].map((a) => a.id);
        if (opponentOwnedIds.includes("revive") && !state.oneTimeUsed[opponent]?.revive) {
          const revivedBoard = newBoard.map((row) => row.slice());
          revivedBoard[y][x] = 0;
          return {
            ...state,
            board: revivedBoard,
            forbiddenMessage: "상대가 '부활'을 사용해서 방금 수가 무효화됐어요!",
            forbiddenToken: state.forbiddenToken + 1,
            oneTimeUsed: markUsed(state, opponent, "revive"),
          };
        }
        return {
          ...state,
          board: newBoard,
          forbiddenMessage: "",
          gameOver: true,
          winMessage: (currentPlayer === 1 ? "흑돌" : "백돌") + (isTerritoryWin && !isLineWin ? " 영역 점령 승리!" : " 승리!"),
        };
      }

      // 양수겹침 사용 중이면 이번 수는 턴을 넘기지 않고 한 번 더 놓게 함
      if (state.doubleMoveActive[currentPlayer]) {
        return {
          ...state,
          board: newBoard,
          lastMove: { ...state.lastMove, [currentPlayer]: { x, y } },
          doubleMoveActive: { ...state.doubleMoveActive, [currentPlayer]: false },
          forbiddenMessage: "",
        };
      }

      // 금지구역 카운트다운 (내가 한 수 뒀으니 1턴 소진, 0 되면 해제)
      const decayedBlocked = state.blockedCells[currentPlayer]
        .map((c) => ({ ...c, turnsLeft: c.turnsLeft - 1 }))
        .filter((c) => c.turnsLeft > 0);

      // 질풍노도: 영구히 매 턴 2개씩 놓음. 이번이 그 2번째 돌이었으면 갚고 넘어가고, 1번째면 한 번 더 놓게 함
      const hasRush = ownedIds.includes("rush");
      const owedSecondStone = state.rushSecondStone[currentPlayer];
      const stayForSecondStone = hasRush && !owedSecondStone;
      const newRushSecondStone = hasRush
        ? { ...state.rushSecondStone, [currentPlayer]: !owedSecondStone }
        : state.rushSecondStone;

      const newStonesPlaced = { ...state.stonesPlaced, [currentPlayer]: state.stonesPlaced[currentPlayer] + 1 };
      const baseState = {
        ...state,
        board: newBoard,
        stonesPlaced: newStonesPlaced,
        lastMove: { ...state.lastMove, [currentPlayer]: { x, y } },
        blockedCells: { ...state.blockedCells, [currentPlayer]: decayedBlocked },
        rushSecondStone: newRushSecondStone,
        forbiddenMessage: "",
      };

      if (newStonesPlaced[currentPlayer] % 4 === 0) {
        const { choices, usedAugmentIds } = buildDraft(state, currentPlayer);
        return {
          ...baseState,
          usedAugmentIds: { ...state.usedAugmentIds, [currentPlayer]: usedAugmentIds },
          peekedCard: { ...state.peekedCard, [currentPlayer]: null },
          doubleChoicePending: { ...state.doubleChoicePending, [currentPlayer]: false },
          draft: { player: currentPlayer, choices, rerolledSlots: choices.map(() => false) },
          // currentPlayer는 그대로 둠 - 드래프트를 다 고른 뒤(PICK_AUGMENT)에 turn 처리
        };
      }

      return { ...baseState, currentPlayer: stayForSecondStone ? currentPlayer : opponent };
    }

    case "PICK_AUGMENT": {
      if (!state.draft) return state;
      const player = state.draft.player;
      const augment = action.augment;
      const newOwned = { ...state.ownedAugments, [player]: [...state.ownedAugments[player], augment] };
      // 질풍노도로 이번 턴 2번째 돌을 아직 안 놨으면, 드래프트 고른 뒤에도 내 턴이 이어져야 함
      const keepTurn = state.rushSecondStone[player];

      // 금지 구역 / 영구 봉쇄는 고르자마자 칸을 지정해야 해서 턴을 바로 안 넘김
      if (augment.id === "banZone") {
        return { ...state, ownedAugments: newOwned, draft: null, pendingTarget: { player, kind: "banZone", need: 3, selected: [], keepTurn } };
      }
      if (augment.id === "permaBlock") {
        return { ...state, ownedAugments: newOwned, draft: null, pendingTarget: { player, kind: "permaBlock", need: 1, selected: [], keepTurn } };
      }

      let patch = {};
      if (augment.id === "peek") {
        const seenIds = state.usedAugmentIds[player];
        const ownedIdsAfter = newOwned[player].map((a) => a.id);
        const [guaranteed] = drawFromPool(ownedIdsAfter, seenIds, 1);
        if (guaranteed) {
          patch.peekedCard = { ...state.peekedCard, [player]: guaranteed };
          patch.usedAugmentIds = { ...state.usedAugmentIds, [player]: [...seenIds, guaranteed.id] };
        }
      }
      if (augment.id === "doubleChoice") {
        patch.doubleChoicePending = { ...state.doubleChoicePending, [player]: true };
      }

      return {
        ...state,
        ...patch,
        ownedAugments: newOwned,
        currentPlayer: keepTurn ? player : otherPlayer(player),
        draft: null,
      };
    }

    case "REROLL_SLOT": {
      const { index } = action;
      if (!state.draft || state.draft.rerolledSlots[index]) return state;

      const player = state.draft.player;
      const otherShownIds = state.draft.choices.filter((_, i) => i !== index).map((c) => c.id);
      const ownedIds = state.ownedAugments[player].map((a) => a.id);
      const seenIds = state.usedAugmentIds[player];

      const [newCard] = drawFromPool([...otherShownIds, ...ownedIds], seenIds, 1);
      if (!newCard) return state;

      const newChoices = state.draft.choices.slice();
      newChoices[index] = newCard;
      const newRerolledSlots = state.draft.rerolledSlots.slice();
      newRerolledSlots[index] = true;

      return {
        ...state,
        usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, newCard.id])] },
        draft: { ...state.draft, choices: newChoices, rerolledSlots: newRerolledSlots },
      };
    }

    // 즉시 타겟팅이 필요 없는 증강체를 원할 때 사용 (양수겹침/직전 무르기/되돌리기/돌 제거)
    case "USE_ABILITY": {
      const { player, ability } = action;
      if (state.gameOver || state.draft || state.pendingTarget) return state;
      if (player !== state.currentPlayer) return state;
      const ownedIds = state.ownedAugments[player].map((a) => a.id);
      if (!ownedIds.includes(ability)) return state;
      if (state.oneTimeUsed[player]?.[ability]) return state;

      if (ability === "removeStone") {
        return { ...state, pendingTarget: { player, kind: "removeStone", need: 1, selected: [] } };
      }

      if (ability === "doubleMove") {
        return {
          ...state,
          doubleMoveActive: { ...state.doubleMoveActive, [player]: true },
          oneTimeUsed: markUsed(state, player, "doubleMove"),
        };
      }

      if (ability === "selfUndo") {
        const last = state.lastMove[player];
        if (!last) return state;
        const newBoard = state.board.map((row) => row.slice());
        newBoard[last.y][last.x] = 0;
        return {
          ...state,
          board: newBoard,
          stonesPlaced: { ...state.stonesPlaced, [player]: state.stonesPlaced[player] - 1 },
          lastMove: { ...state.lastMove, [player]: null },
          oneTimeUsed: markUsed(state, player, "selfUndo"),
        };
      }

      if (ability === "undo") {
        const opponent = otherPlayer(player);
        const last = state.lastMove[opponent];
        if (!last) return state;

        const opponentOwnedIds = state.ownedAugments[opponent].map((a) => a.id);
        if (opponentOwnedIds.includes("fortress")) {
          // 철옹성에 막히면 카드만 소모되고 내 턴은 그대로 유지 (돌은 정상적으로 놓을 수 있음)
          return {
            ...state,
            oneTimeUsed: markUsed(state, player, "undo"),
            forbiddenMessage: "상대가 철옹성이라 효과가 통하지 않았어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }

        const newBoard = state.board.map((row) => row.slice());
        newBoard[last.y][last.x] = 0;
        return {
          ...state,
          board: newBoard,
          stonesPlaced: { ...state.stonesPlaced, [opponent]: state.stonesPlaced[opponent] - 1 },
          lastMove: { ...state.lastMove, [opponent]: null },
          oneTimeUsed: markUsed(state, player, "undo"),
          currentPlayer: opponent,
        };
      }

      return state;
    }

    // 금지 구역 / 영구 봉쇄 / 돌 제거의 칸(또는 상대 돌) 선택
    case "TARGET_CELL": {
      const { x, y } = action;
      if (!state.pendingTarget) return state;
      const { player, kind, need, selected } = state.pendingTarget;
      const opponent = otherPlayer(player);
      const opponentOwnedIds = state.ownedAugments[opponent].map((a) => a.id);
      const isFortressImmune = opponentOwnedIds.includes("fortress");

      if (kind === "removeStone") {
        if (state.board[y][x] !== opponent) return state;
        const fizzled = isFortressImmune;
        const newBoard = state.board.map((row) => row.slice());
        if (!fizzled) newBoard[y][x] = 0;
        return {
          ...state,
          board: newBoard,
          pendingTarget: null,
          oneTimeUsed: markUsed(state, player, "removeStone"),
          forbiddenMessage: fizzled ? "상대가 철옹성이라 효과가 통하지 않았어요" : "",
          forbiddenToken: fizzled ? state.forbiddenToken + 1 : state.forbiddenToken,
          // 철옹성에 막히면 카드만 소모되고 내 턴은 유지 (돌은 정상적으로 놓을 수 있음)
          currentPlayer: fizzled ? player : opponent,
        };
      }

      if (kind === "banZone" || kind === "permaBlock") {
        if (state.board[y][x] !== 0) return state;
        if (selected.some((c) => c.x === x && c.y === y)) return state;
        const newSelected = [...selected, { x, y }];

        if (newSelected.length < need) {
          return { ...state, pendingTarget: { ...state.pendingTarget, selected: newSelected } };
        }

        const nextPlayer = state.pendingTarget.keepTurn ? player : opponent;

        if (isFortressImmune) {
          // 철옹성에 막히면 카드만 소모되고 내 턴은 유지 (돌은 정상적으로 놓을 수 있음)
          return {
            ...state,
            pendingTarget: null,
            forbiddenMessage: "상대가 철옹성이라 효과가 통하지 않았어요",
            forbiddenToken: state.forbiddenToken + 1,
            currentPlayer: player,
          };
        }

        if (kind === "banZone") {
          const additions = newSelected.map((c) => ({ ...c, turnsLeft: 5 }));
          return {
            ...state,
            pendingTarget: null,
            blockedCells: { ...state.blockedCells, [opponent]: [...state.blockedCells[opponent], ...additions] },
            currentPlayer: nextPlayer,
          };
        }

        return {
          ...state,
          pendingTarget: null,
          permaBlockedCells: { ...state.permaBlockedCells, [opponent]: [...state.permaBlockedCells[opponent], ...newSelected] },
          currentPlayer: nextPlayer,
        };
      }

      return state;
    }

    case "CLEAR_FORBIDDEN":
      return { ...state, forbiddenMessage: "" };
    case "RESTART":
      return initialGameState();
    default:
      return state;
  }
}
