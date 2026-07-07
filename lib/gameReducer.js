// 로컬 모드/온라인 모드가 공유하는 게임 상태 리듀서
// 순수 함수라서 온라인 모드에서는 Supabase에 저장할 "다음 상태"를 계산하는 용도로도 그대로 재사용 가능

import {
  createEmptyBoard,
  checkWin,
  isForbiddenMove,
  checkTerritoryWin,
  checkFrameWin,
  isBoardFull,
  countStones,
  getEffectiveAugmentIds,
  findCaptures,
  AUGMENTS,
  ONE_TIME_ABILITY_IDS,
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
    draft: null, // { player, choices: [augment,...], rerolledSlots: [bool,...], differentiated }

    oneTimeUsed: { 1: {}, 2: {} }, // { removeStone:true, undo:true, selfUndo:true, doubleMove:true, revive:true, ... }
    lastMove: { 1: null, 2: null }, // 각 플레이어가 마지막으로 놓은 좌표 {x,y}
    blockedCells: { 1: [], 2: [] }, // 이 플레이어가 못 놓는 칸: [{x,y,turnsLeft}] (금지구역)
    permaBlockedCells: { 1: [], 2: [] }, // 이 플레이어가 영원히 못 놓는 칸: [{x,y}] (영구봉쇄)
    doubleMoveActive: { 1: false, 2: false }, // 양수겹침 사용 중 - 이번 한 수는 턴이 안 넘어감
    rushSecondStone: { 1: false, 2: false }, // 질풍노도 보유 시, 이번 턴에 2번째 돌을 아직 안 놨는지
    peekedCard: { 1: null, 2: null }, // 먼저 보기로 예약해 둔 다음 드래프트 확정 카드
    doubleChoicePending: { 1: false, 2: false }, // 더블 초이스 - 다음 드래프트만 4장
    pendingTarget: null, // { player, kind: 'banZone'|'permaBlock'|'removeStone'|'watchtower'|'ultimatum', need, selected: [], keepTurn }
    skipNextDraft: { 1: false, 2: false }, // 동전 던지기 실패 - 다음 드래프트 발생 시 카드 안 보여주고 그냥 넘어감
    bindSkip: { 1: false, 2: false }, // 속박 - 이 플레이어의 다음 턴을 통째로 건너뜀
    stingyDraft: { 1: false, 2: false }, // 인색 - 이 플레이어의 다음 드래프트 선택지를 1장 줄임
    differentiatedDraftPending: { 1: false, 2: false }, // 저울질 - 다음 드래프트에서 상대가 가진 증강체 제외
    watchtowerCells: { 1: [], 2: [] }, // 이 플레이어에게 세워진 감시탑: [{x,y,turnsLeft}] (둘 다 볼 수 있음)
    ultimatumCell: { 1: null, 2: null }, // 그 플레이어가 선언한 최후통첩 칸 {x,y}
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

// 4턴 달성 시 새 드래프트 카드 뽑기 (먼저 보기/더블 초이스/인색/저울질 반영)
function buildDraft(state, player) {
  const ownedIds = state.ownedAugments[player].map((a) => a.id);
  const opponentOwnedIds = state.ownedAugments[otherPlayer(player)].map((a) => a.id);
  const seenIds = state.usedAugmentIds[player];
  let drawCount = state.doubleChoicePending[player] ? 4 : 3;
  if (state.stingyDraft[player]) drawCount = Math.max(1, drawCount - 1);
  const peeked = state.peekedCard[player];
  const differentiated = state.differentiatedDraftPending[player];
  const extraExclude = differentiated ? opponentOwnedIds : [];

  let choices;
  if (peeked) {
    const rest = drawFromPool([...ownedIds, ...extraExclude, peeked.id], seenIds, drawCount - 1);
    choices = [peeked, ...rest];
  } else {
    choices = drawFromPool([...ownedIds, ...extraExclude], seenIds, drawCount);
  }

  return {
    choices,
    usedAugmentIds: [...new Set([...seenIds, ...choices.map((c) => c.id)])],
    differentiated,
  };
}

export function gameReducer(state, action) {
  switch (action.type) {
    case "CLICK_CELL": {
      const { x, y } = action;
      if (state.gameOver || state.draft || state.pendingTarget || state.board[y][x] !== 0) return state;

      const { currentPlayer } = state;
      const opponent = otherPlayer(currentPlayer);

      // 속박: 내 턴이 통째로 건너뛰어졌으면, 뭘 클릭했든 그냥 턴만 넘어감
      if (state.bindSkip[currentPlayer]) {
        return {
          ...state,
          bindSkip: { ...state.bindSkip, [currentPlayer]: false },
          forbiddenMessage: "상대의 '속박'에 걸려서 이번 턴을 통째로 건너뜁니다",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

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
      const totalStonesPlaced = state.stonesPlaced[1] + state.stonesPlaced[2];
      const effectiveOwnedIds = getEffectiveAugmentIds(ownedIds, totalStonesPlaced);
      const prevMove = state.lastMove[currentPlayer];

      // 최후통첩: 내가 선언해 둔 칸에 지금 두는 거면, 이번 수만 다리 놓기+연속 배치 효과를 같이 받음
      const ultimatumCell = state.ultimatumCell[currentPlayer];
      const ultimatumFulfilled = !!ultimatumCell && ultimatumCell.x === x && ultimatumCell.y === y;
      const finalOwnedIds = ultimatumFulfilled ? [...effectiveOwnedIds, "bridge", "adjacentLink"] : effectiveOwnedIds;

      // 렌주룰 금수 판정 (흑돌만 적용, 렌주룰 자체는 증강체와 무관)
      if (currentPlayer === 1) {
        const forbiddenReason = isForbiddenMove(state.board, x, y, finalOwnedIds, prevMove);
        if (forbiddenReason) {
          return {
            ...state,
            forbiddenMessage: "여기는 렌주룰 금수 자리예요 (" + forbiddenReason + ")",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
      }

      // 감시탑: 상대가 세워둔 감시탑 칸에 두면 이번 수는 통째로 무효화되고 감시탑도 소모됨
      const watchHit = state.watchtowerCells[currentPlayer].find((c) => c.x === x && c.y === y);
      if (watchHit) {
        const remainingWatchtower = state.watchtowerCells[currentPlayer]
          .filter((c) => c !== watchHit)
          .map((c) => ({ ...c, turnsLeft: c.turnsLeft - 1 }))
          .filter((c) => c.turnsLeft > 0);
        return {
          ...state,
          watchtowerCells: { ...state.watchtowerCells, [currentPlayer]: remainingWatchtower },
          forbiddenMessage: "상대가 세워둔 감시탑에 걸려서 이번 수가 사라졌어요!",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
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

      const isLineWin = checkWin(newBoard, x, y, currentPlayer, finalOwnedIds, prevMove);
      const isTerritoryWin = ownedIds.includes("territory") && checkTerritoryWin(newBoard, currentPlayer);
      const isFrameWin = ownedIds.includes("squareFrame") && checkFrameWin(newBoard, x, y, currentPlayer);

      if (isLineWin || isTerritoryWin || isFrameWin) {
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
        let winSuffix = " 승리!";
        if (!isLineWin && isTerritoryWin) winSuffix = " 영역 점령 승리!";
        else if (!isLineWin && !isTerritoryWin && isFrameWin) winSuffix = " 네모 완성 승리!";
        return {
          ...state,
          board: newBoard,
          forbiddenMessage: "",
          gameOver: true,
          winMessage: (currentPlayer === 1 ? "흑돌" : "백돌") + winSuffix,
        };
      }

      // 물량전: 아무도 안 이겼는데 보드가 다 찼으면, 물량전 소유자가 돌이 더 많을 때 승리 처리 (아니면 무승부)
      if (isBoardFull(newBoard)) {
        const p1Count = countStones(newBoard, 1);
        const p2Count = countStones(newBoard, 2);
        const p1Attrition = state.ownedAugments[1].some((a) => a.id === "attrition") && p1Count > p2Count;
        const p2Attrition = state.ownedAugments[2].some((a) => a.id === "attrition") && p2Count > p1Count;
        return {
          ...state,
          board: newBoard,
          forbiddenMessage: "",
          gameOver: true,
          winMessage: p1Attrition
            ? "흑돌 물량전 승리! (보드를 다 채웠고 돌이 더 많음)"
            : p2Attrition
            ? "백돌 물량전 승리! (보드를 다 채웠고 돌이 더 많음)"
            : "무승부! (보드가 가득 찼어요)",
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

      // 감시탑도 마찬가지로, 안 걸렸어도 내가 한 수 뒀으니 1턴 소진
      const decayedWatchtower = state.watchtowerCells[currentPlayer]
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
        watchtowerCells: { ...state.watchtowerCells, [currentPlayer]: decayedWatchtower },
        rushSecondStone: newRushSecondStone,
        forbiddenMessage: "",
      };

      if (newStonesPlaced[currentPlayer] % 4 === 0) {
        // 동전 던지기 실패로 예약된 스킵이면, 카드 없이 이번 드래프트 타이밍만 넘기고 정상적으로 턴 진행
        if (state.skipNextDraft[currentPlayer]) {
          return {
            ...baseState,
            skipNextDraft: { ...state.skipNextDraft, [currentPlayer]: false },
            currentPlayer: stayForSecondStone ? currentPlayer : opponent,
          };
        }
        const { choices, usedAugmentIds, differentiated } = buildDraft(state, currentPlayer);
        return {
          ...baseState,
          usedAugmentIds: { ...state.usedAugmentIds, [currentPlayer]: usedAugmentIds },
          peekedCard: { ...state.peekedCard, [currentPlayer]: null },
          doubleChoicePending: { ...state.doubleChoicePending, [currentPlayer]: false },
          stingyDraft: { ...state.stingyDraft, [currentPlayer]: false },
          differentiatedDraftPending: { ...state.differentiatedDraftPending, [currentPlayer]: false },
          draft: { player: currentPlayer, choices, rerolledSlots: choices.map(() => false), differentiated },
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
      // 저울질로 상대 카드를 제외한 드래프트였으면, 리롤도 같은 제한을 유지
      const opponentOwnedIds = state.draft.differentiated
        ? state.ownedAugments[otherPlayer(player)].map((a) => a.id)
        : [];
      const seenIds = state.usedAugmentIds[player];

      const [newCard] = drawFromPool([...otherShownIds, ...ownedIds, ...opponentOwnedIds], seenIds, 1);
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

    // 즉시 타겟팅이 필요 없는 증강체를 원할 때 사용 (양수겹침/직전 무르기/되돌리기/돌 제거/동전 던지기/속박/인색/거래/저울질)
    case "USE_ABILITY": {
      const { player, ability } = action;
      if (state.gameOver || state.draft || state.pendingTarget) return state;
      if (player !== state.currentPlayer) return state;

      // 속박: 내 턴이 통째로 건너뛰어졌으면, 어떤 능력을 눌러도 그냥 턴만 넘어감
      if (state.bindSkip[player]) {
        return {
          ...state,
          bindSkip: { ...state.bindSkip, [player]: false },
          forbiddenMessage: "상대의 '속박'에 걸려서 이번 턴을 통째로 건너뜁니다",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: otherPlayer(player),
        };
      }

      const ownedIds = state.ownedAugments[player].map((a) => a.id);
      if (!ownedIds.includes(ability)) return state;
      if (state.oneTimeUsed[player]?.[ability]) return state;

      if (ability === "removeStone") {
        return { ...state, pendingTarget: { player, kind: "removeStone", need: 1, selected: [] } };
      }

      if (ability === "watchtower") {
        return { ...state, pendingTarget: { player, kind: "watchtower", need: 1, selected: [] } };
      }

      if (ability === "ultimatum") {
        return { ...state, pendingTarget: { player, kind: "ultimatum", need: 1, selected: [] } };
      }

      if (ability === "bind") {
        const opp = otherPlayer(player);
        return {
          ...state,
          bindSkip: { ...state.bindSkip, [opp]: true },
          oneTimeUsed: markUsed(state, player, "bind"),
        };
      }

      if (ability === "stinginess") {
        const opp = otherPlayer(player);
        return {
          ...state,
          stingyDraft: { ...state.stingyDraft, [opp]: true },
          oneTimeUsed: markUsed(state, player, "stinginess"),
        };
      }

      if (ability === "leverage") {
        const opp = otherPlayer(player);
        if (state.ownedAugments[player].length >= state.ownedAugments[opp].length) {
          return {
            ...state,
            forbiddenMessage: "저울질은 내 증강체 수가 상대보다 적을 때만 쓸 수 있어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return {
          ...state,
          differentiatedDraftPending: { ...state.differentiatedDraftPending, [player]: true },
          oneTimeUsed: markUsed(state, player, "leverage"),
        };
      }

      if (ability === "barter") {
        const usedPatch = { ...state.oneTimeUsed[player] };
        for (const owned of state.ownedAugments[player]) {
          if (ONE_TIME_ABILITY_IDS.includes(owned.id)) usedPatch[owned.id] = true;
        }
        const prismPool = AUGMENTS.filter(
          (a) => a.tier === "prism" && !state.ownedAugments[player].some((o) => o.id === a.id)
        );
        if (prismPool.length === 0) {
          return {
            ...state,
            oneTimeUsed: { ...state.oneTimeUsed, [player]: usedPatch },
            forbiddenMessage: "거래: 이미 프리즘 증강체를 전부 가지고 있어서 아무 일도 일어나지 않았어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const [bonus] = pickRandom(prismPool, 1);
        return {
          ...state,
          ownedAugments: { ...state.ownedAugments, [player]: [...state.ownedAugments[player], bonus] },
          usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...state.usedAugmentIds[player], bonus.id])] },
          oneTimeUsed: { ...state.oneTimeUsed, [player]: usedPatch },
          forbiddenMessage: "거래 완료! 남은 1회용 카드를 전부 넘기고 '" + bonus.name + "' 획득!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "coinFlip") {
        const used = markUsed(state, player, "coinFlip");
        if (Math.random() < 0.5) {
          const ownedIdsAfter = state.ownedAugments[player].map((a) => a.id);
          const seenIds = state.usedAugmentIds[player];
          const [bonus] = drawFromPool(ownedIdsAfter, seenIds, 1);
          if (!bonus) {
            return {
              ...state,
              oneTimeUsed: used,
              forbiddenMessage: "동전 던지기: 뽑을 카드가 남지 않아서 아무 일도 일어나지 않았어요",
              forbiddenToken: state.forbiddenToken + 1,
            };
          }
          return {
            ...state,
            ownedAugments: { ...state.ownedAugments, [player]: [...state.ownedAugments[player], bonus] },
            usedAugmentIds: { ...state.usedAugmentIds, [player]: [...seenIds, bonus.id] },
            oneTimeUsed: used,
            forbiddenMessage: "동전 던지기 성공! '" + bonus.name + "' 획득!",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return {
          ...state,
          skipNextDraft: { ...state.skipNextDraft, [player]: true },
          oneTimeUsed: used,
          forbiddenMessage: "동전 던지기 실패... 다음 드래프트를 건너뛰게 됐어요",
          forbiddenToken: state.forbiddenToken + 1,
        };
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

    // 금지 구역 / 영구 봉쇄 / 돌 제거 / 감시탑 / 최후통첩의 칸(또는 상대 돌) 선택
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

      if (kind === "watchtower") {
        if (state.board[y][x] !== 0) return state;
        const fizzled = isFortressImmune;
        return {
          ...state,
          pendingTarget: null,
          watchtowerCells: fizzled
            ? state.watchtowerCells
            : { ...state.watchtowerCells, [opponent]: [...state.watchtowerCells[opponent], { x, y, turnsLeft: 4 }] },
          oneTimeUsed: markUsed(state, player, "watchtower"),
          forbiddenMessage: fizzled ? "상대가 철옹성이라 효과가 통하지 않았어요" : "",
          forbiddenToken: fizzled ? state.forbiddenToken + 1 : state.forbiddenToken,
          currentPlayer: fizzled ? player : opponent,
        };
      }

      if (kind === "ultimatum") {
        if (state.board[y][x] !== 0) return state;
        return {
          ...state,
          pendingTarget: null,
          ultimatumCell: { ...state.ultimatumCell, [player]: { x, y } },
          oneTimeUsed: markUsed(state, player, "ultimatum"),
          currentPlayer: opponent,
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
