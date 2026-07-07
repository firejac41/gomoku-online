// 로컬 모드/온라인 모드가 공유하는 게임 상태 리듀서
// 순수 함수라서 온라인 모드에서는 Supabase에 저장할 "다음 상태"를 계산하는 용도로도 그대로 재사용 가능

import {
  createEmptyBoard,
  checkWin,
  isForbiddenMove,
  checkTerritoryWin,
  checkShapeWin,
  findCaptures,
  AUGMENTS,
  GAMBLE_OPTIONS,
  FRAME_SHAPE,
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
    augmentSelect: null, // { player, choices: [augment,...], rerolledSlots: [bool,...], isGamble? }
    draftTierPlan: [], // 증강 선택 회차별 등급 조합 (양쪽 플레이어가 같은 회차엔 같은 조합을 받도록 공유)

    oneTimeUsed: { 1: {}, 2: {} }, // { removeStone:true, undo:true, selfUndo:true, doubleMove:true, revive:true, bind:true, colorSwap:true, talismanConsumed:true }
    lastMove: { 1: null, 2: null }, // 각 플레이어가 마지막으로 놓은 좌표 {x,y}
    blockedCells: { 1: [], 2: [] }, // 이 플레이어가 못 놓는 칸: [{x,y,turnsLeft}] (금지구역)
    permaBlockedCells: { 1: [], 2: [] }, // 이 플레이어가 영원히 못 놓는 칸: [{x,y}] (영구봉쇄)
    watchtowers: { 1: [], 2: [] }, // 이 플레이어가 여기 두면 무효화되는 칸: [{x,y,turnsLeft}] (감시탑, 양쪽에 다 보임)
    doubleMoveActive: { 1: false, 2: false }, // 양수겹침 사용 중 - 이번 한 수는 턴이 안 넘어감
    rushSecondStone: { 1: false, 2: false }, // 질풍노도 보유 시, 지금이 "부스트 턴"의 2번째 돌을 아직 안 놨는지
    rushBoosted: { 1: false, 2: false }, // 질풍노도 보유 시, 다음(또는 지금) 턴이 2개 놓는 "부스트 턴"인지 - 2턴에 1번만 true
    peekedCard: { 1: null, 2: null }, // 먼저 보기로 예약해 둔 다음 증강 선택 확정 카드
    doubleChoicePending: { 1: false, 2: false }, // 더블 초이스 - 다음 증강 선택만 4장
    skipNextDrafts: { 1: 0, 2: 0 }, // 도박 증강으로 인해 건너뛸 남은 증강 선택 횟수
    pendingTarget: null, // { player, kind: 'banZone'|'permaBlock'|'removeStone'|'watchtower', need, selected: [], keepTurn }
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

// 특정 등급 1장만 뽑기 (등급 동기화용 - 리롤도 같은 등급끼리만 바뀌게 하는 데 사용)
function drawOneOfTier(tier, hardExcludeIds, softExcludeIds) {
  let pool = AUGMENTS.filter((a) => a.tier === tier && !hardExcludeIds.includes(a.id) && !softExcludeIds.includes(a.id));
  if (pool.length === 0) pool = AUGMENTS.filter((a) => a.tier === tier && !hardExcludeIds.includes(a.id));
  if (pool.length === 0) pool = AUGMENTS.filter((a) => !hardExcludeIds.includes(a.id) && !softExcludeIds.includes(a.id));
  if (pool.length === 0) pool = AUGMENTS.filter((a) => !hardExcludeIds.includes(a.id));
  return pickRandom(pool, 1)[0];
}

// 특정 등급 여러 장 뽑기 (도박 증강용)
function drawSeveralOfTier(tier, count, hardExcludeIds, softExcludeIds) {
  let pool = AUGMENTS.filter((a) => a.tier === tier && !hardExcludeIds.includes(a.id) && !softExcludeIds.includes(a.id));
  if (pool.length < count) pool = AUGMENTS.filter((a) => a.tier === tier && !hardExcludeIds.includes(a.id));
  return pickRandom(pool, count);
}

// 이 수까지는 프리즘 뽑기에 대각선강화/일자진이 등장할 수 있음 - 초반에만 나오게 해서 중후반 스노우볼을 막음
const EARLY_GAME_STONE_LIMIT = 8;
const LATE_GAME_HIDDEN_IDS = ["diagBoost", "straightBoost"];
function getStageExcludeIds(state, player) {
  return state.stonesPlaced[player] > EARLY_GAME_STONE_LIMIT ? LATE_GAME_HIDDEN_IDS : [];
}

// 증강 선택 3장의 등급 조합 후보 - 두 플레이어가 같은 회차엔 같은 조합을 받아서 등급운을 동일하게 맞춤
const TIER_COMBOS = [
  ["silver", "silver", "silver"],
  ["silver", "silver", "gold"],
  ["silver", "gold", "gold"],
  ["gold", "gold", "gold"],
  ["silver", "silver", "prism"],
  ["silver", "gold", "prism"],
  ["gold", "gold", "prism"],
];

function markUsed(state, player, ability) {
  return { ...state.oneTimeUsed, [player]: { ...state.oneTimeUsed[player], [ability]: true } };
}

function otherPlayer(player) {
  return player === 1 ? 2 : 1;
}

// 대상(targetPlayer)이 제거/봉쇄/무르기 계열 효과에 면역인지 (철옹성은 무한, 부적은 1회성)
function checkImmunity(state, targetPlayer) {
  const targetOwnedIds = state.ownedAugments[targetPlayer].map((a) => a.id);
  if (targetOwnedIds.includes("fortress")) return { immune: true, reason: "fortress" };
  if (targetOwnedIds.includes("talisman") && !state.oneTimeUsed[targetPlayer]?.talismanConsumed) {
    return { immune: true, reason: "talisman" };
  }
  return { immune: false, reason: null };
}

function immunityMessage(reason) {
  return reason === "talisman" ? "상대가 '부적'으로 효과를 막았어요" : "상대가 철옹성이라 효과가 통하지 않았어요";
}

// 면역 판정 결과를 oneTimeUsed에 반영 (부적이면 그 자리에서 소모 처리)
function applyImmunityConsumption(oneTimeUsed, targetPlayer, reason) {
  if (reason !== "talisman") return oneTimeUsed;
  return { ...oneTimeUsed, [targetPlayer]: { ...oneTimeUsed[targetPlayer], talismanConsumed: true } };
}

// 4턴 달성 시 새 증강 선택 카드 뽑기 (먼저 보기로 예약된 카드/더블 초이스 반영, 등급 조합은 draftTierPlan에서 공유)
function buildAugmentChoices(state, player, roundIndex) {
  const ownedIds = state.ownedAugments[player].map((a) => a.id);
  const seenIds = state.usedAugmentIds[player];
  const stageExcludeIds = getStageExcludeIds(state, player);
  const peeked = state.peekedCard[player];

  let combo = state.draftTierPlan[roundIndex];
  let newTierPlan = state.draftTierPlan;
  if (!combo) {
    combo = pickRandom(TIER_COMBOS, 1)[0];
    newTierPlan = state.draftTierPlan.slice();
    newTierPlan[roundIndex] = combo;
  }
  if (state.doubleChoicePending[player]) {
    combo = [...combo, pickRandom(["silver", "gold"], 1)[0]];
  }

  const hardExclude = [...ownedIds, ...stageExcludeIds];
  const drawn = [];
  let remainingCombo = combo;

  if (peeked) {
    drawn.push(peeked);
    remainingCombo = combo.slice(1); // 먼저 보기로 예약된 카드가 한 자리를 차지
  }

  for (const tier of remainingCombo) {
    const usedSoFarIds = drawn.map((c) => c.id);
    const card = drawOneOfTier(tier, [...hardExclude, ...usedSoFarIds], seenIds);
    if (card) drawn.push(card);
  }

  return {
    choices: drawn,
    usedAugmentIds: [...new Set([...seenIds, ...drawn.map((c) => c.id)])],
    draftTierPlan: newTierPlan,
  };
}

export function gameReducer(state, action) {
  switch (action.type) {
    case "CLICK_CELL": {
      const { x, y } = action;
      if (state.gameOver || state.augmentSelect || state.pendingTarget || state.board[y][x] !== 0) return state;

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

      // 감시탑: 상대가 지정해둔 칸에 뒀으면 이 수는 무효화됨 (양쪽에 표시되는 칸이라 놓기 전에 이미 알 수 있음)
      const myWatchtowers = state.watchtowers[currentPlayer] || [];
      const watchtowerHitIndex = myWatchtowers.findIndex((w) => w.x === x && w.y === y);
      const watchtowerTriggered = watchtowerHitIndex !== -1;
      if (watchtowerTriggered) {
        newBoard[y][x] = 0;
      }

      if (!watchtowerTriggered) {
        const opponentOwnedIds = state.ownedAugments[opponent].map((a) => a.id);

        // 포위 제거 / 오델로: 상대가 철옹성이 아니면 "나-상대-나" 모양이 된 상대 돌을 제거하거나 내 색으로 뒤집음
        if (!opponentOwnedIds.includes("fortress")) {
          if (ownedIds.includes("capture")) {
            for (const c of findCaptures(newBoard, x, y, currentPlayer)) {
              newBoard[c.y][c.x] = 0;
            }
          }
          if (ownedIds.includes("othello")) {
            for (const c of findCaptures(newBoard, x, y, currentPlayer)) {
              newBoard[c.y][c.x] = currentPlayer;
            }
          }
        }

        const isLineWin = checkWin(newBoard, x, y, currentPlayer, ownedIds, prevMove);
        const isTerritoryWin = ownedIds.includes("territory") && checkTerritoryWin(newBoard, currentPlayer);
        const isFrameWin = ownedIds.includes("frameWin") && checkShapeWin(newBoard, currentPlayer, FRAME_SHAPE);

        if (isLineWin || isTerritoryWin || isFrameWin) {
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
          const winKind = isLineWin
            ? " 승리!"
            : isTerritoryWin
            ? " 영역 점령 승리!"
            : " 액자 완성 승리!";
          return {
            ...state,
            board: newBoard,
            forbiddenMessage: "",
            gameOver: true,
            winMessage: (currentPlayer === 1 ? "흑돌" : "백돌") + winKind,
          };
        }
      }

      // 양수겹침 사용 중이면 이번 수는 턴을 넘기지 않고 한 번 더 놓게 함
      if (!watchtowerTriggered && state.doubleMoveActive[currentPlayer]) {
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

      // 감시탑 카운트다운 (이번에 걸렸으면 소모, 아니면 1턴씩 소진되다가 0 되면 해제)
      const decayedWatchtowers = watchtowerTriggered
        ? myWatchtowers.filter((_, i) => i !== watchtowerHitIndex)
        : myWatchtowers.map((w) => ({ ...w, turnsLeft: w.turnsLeft - 1 })).filter((w) => w.turnsLeft > 0);

      // 질풍노도: 2턴에 1번만 그 턴에 돌 2개 놓음
      const hasRush = ownedIds.includes("rush");
      const owedSecondStone = state.rushSecondStone[currentPlayer];
      let stayForSecondStone = false;
      let newRushSecondStone = state.rushSecondStone;
      let newRushBoosted = state.rushBoosted;
      if (hasRush) {
        if (owedSecondStone) {
          // 부스트 턴의 2번째 돌이었음 -> 턴 넘기고, 다음 턴은 부스트 아님
          newRushSecondStone = { ...state.rushSecondStone, [currentPlayer]: false };
          newRushBoosted = { ...state.rushBoosted, [currentPlayer]: false };
        } else if (state.rushBoosted[currentPlayer]) {
          // 이번 턴이 부스트 턴 -> 한 번 더 놓게 함
          stayForSecondStone = true;
          newRushSecondStone = { ...state.rushSecondStone, [currentPlayer]: true };
        } else {
          // 이번 턴은 평범한 턴 -> 다음 턴을 부스트로 예약
          newRushBoosted = { ...state.rushBoosted, [currentPlayer]: true };
        }
      }

      const newStonesPlaced = { ...state.stonesPlaced, [currentPlayer]: state.stonesPlaced[currentPlayer] + 1 };
      const baseState = {
        ...state,
        board: newBoard,
        stonesPlaced: newStonesPlaced,
        lastMove: watchtowerTriggered ? state.lastMove : { ...state.lastMove, [currentPlayer]: { x, y } },
        blockedCells: { ...state.blockedCells, [currentPlayer]: decayedBlocked },
        watchtowers: { ...state.watchtowers, [currentPlayer]: decayedWatchtowers },
        rushSecondStone: newRushSecondStone,
        rushBoosted: newRushBoosted,
        forbiddenMessage: watchtowerTriggered ? "상대의 감시탑에 걸려서 이 수가 무효화됐어요!" : "",
        forbiddenToken: watchtowerTriggered ? state.forbiddenToken + 1 : state.forbiddenToken,
      };

      if (newStonesPlaced[currentPlayer] % 4 === 0) {
        if (state.skipNextDrafts[currentPlayer] > 0) {
          const remaining = state.skipNextDrafts[currentPlayer] - 1;
          return {
            ...baseState,
            skipNextDrafts: { ...state.skipNextDrafts, [currentPlayer]: remaining },
            currentPlayer: stayForSecondStone ? currentPlayer : opponent,
            forbiddenMessage: "도박 효과로 이번 증강 선택을 건너뛰었어요! (남은 스킵 " + remaining + "회)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }

        const roundIndex = newStonesPlaced[currentPlayer] / 4 - 1;
        const stateForDraft = { ...state, stonesPlaced: newStonesPlaced };
        const { choices, usedAugmentIds, draftTierPlan } = buildAugmentChoices(stateForDraft, currentPlayer, roundIndex);
        return {
          ...baseState,
          usedAugmentIds: { ...state.usedAugmentIds, [currentPlayer]: usedAugmentIds },
          draftTierPlan,
          peekedCard: { ...state.peekedCard, [currentPlayer]: null },
          doubleChoicePending: { ...state.doubleChoicePending, [currentPlayer]: false },
          augmentSelect: { player: currentPlayer, choices, rerolledSlots: choices.map(() => false) },
          // currentPlayer는 그대로 둠 - 증강 선택을 다 고른 뒤(PICK_AUGMENT)에 turn 처리
        };
      }

      return { ...baseState, currentPlayer: stayForSecondStone ? currentPlayer : opponent };
    }

    case "PICK_AUGMENT": {
      if (!state.augmentSelect) return state;
      const player = state.augmentSelect.player;
      const augment = action.augment;
      // 질풍노도로 이번 턴 2번째 돌을 아직 안 놨으면, 증강 선택 고른 뒤에도 내 턴이 이어져야 함
      const keepTurn = state.rushSecondStone[player];

      // 도박: 고르는 순간 실버3/프리즘1 양자택일 화면이 다시 뜸 (아직 턴은 안 넘김)
      if (augment.id === "gamble") {
        const newOwned = { ...state.ownedAugments, [player]: [...state.ownedAugments[player], augment] };
        return {
          ...state,
          ownedAugments: newOwned,
          augmentSelect: { player, choices: GAMBLE_OPTIONS, rerolledSlots: [true, true], isGamble: true },
        };
      }

      if (augment.id === "gambleSilver3" || augment.id === "gamblePrism1") {
        const tier = augment.id === "gambleSilver3" ? "silver" : "prism";
        const count = augment.id === "gambleSilver3" ? 3 : 1;
        const ownedIds = state.ownedAugments[player].map((a) => a.id);
        const seenIds = state.usedAugmentIds[player];
        const won = drawSeveralOfTier(tier, count, [...ownedIds, "gamble"], seenIds);
        const newOwned = { ...state.ownedAugments, [player]: [...state.ownedAugments[player], ...won] };
        return {
          ...state,
          ownedAugments: newOwned,
          usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, ...won.map((a) => a.id)])] },
          skipNextDrafts: { ...state.skipNextDrafts, [player]: state.skipNextDrafts[player] + 2 },
          augmentSelect: null,
          currentPlayer: keepTurn ? player : otherPlayer(player),
          forbiddenMessage:
            (player === 1 ? "흑돌" : "백돌") +
            "이 도박으로 " +
            (won.map((a) => a.name).join(", ") || "아무것도") +
            " 얻었어요! (다음 증강 선택 2번 스킵)",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      const newOwned = { ...state.ownedAugments, [player]: [...state.ownedAugments[player], augment] };

      // 금지 구역 / 영구 봉쇄는 고르자마자 칸을 지정해야 해서 턴을 바로 안 넘김
      if (augment.id === "banZone") {
        return { ...state, ownedAugments: newOwned, augmentSelect: null, pendingTarget: { player, kind: "banZone", need: 3, selected: [], keepTurn } };
      }
      if (augment.id === "permaBlock") {
        return { ...state, ownedAugments: newOwned, augmentSelect: null, pendingTarget: { player, kind: "permaBlock", need: 1, selected: [], keepTurn } };
      }

      let patch = {};
      if (augment.id === "peek") {
        const seenIds = state.usedAugmentIds[player];
        const ownedIdsAfter = newOwned[player].map((a) => a.id);
        const stageExcludeIds = getStageExcludeIds(state, player);
        const [guaranteed] = drawFromPool([...ownedIdsAfter, ...stageExcludeIds], seenIds, 1);
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
        augmentSelect: null,
      };
    }

    case "REROLL_SLOT": {
      const { index } = action;
      if (!state.augmentSelect || state.augmentSelect.isGamble || state.augmentSelect.rerolledSlots[index]) return state;

      const player = state.augmentSelect.player;
      const currentCard = state.augmentSelect.choices[index];
      const otherShownIds = state.augmentSelect.choices.filter((_, i) => i !== index).map((c) => c.id);
      const ownedIds = state.ownedAugments[player].map((a) => a.id);
      const seenIds = state.usedAugmentIds[player];
      const stageExcludeIds = getStageExcludeIds(state, player);

      // 리롤은 같은 등급 안에서만 다른 카드로 바뀜 (등급 조합 자체는 그대로 유지)
      const newCard = drawOneOfTier(currentCard.tier, [...otherShownIds, ...ownedIds, ...stageExcludeIds, currentCard.id], seenIds);
      if (!newCard) return state;

      const newChoices = state.augmentSelect.choices.slice();
      newChoices[index] = newCard;
      const newRerolledSlots = state.augmentSelect.rerolledSlots.slice();
      newRerolledSlots[index] = true;

      return {
        ...state,
        usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, newCard.id])] },
        augmentSelect: { ...state.augmentSelect, choices: newChoices, rerolledSlots: newRerolledSlots },
      };
    }

    // 즉시 타겟팅이 필요 없는 증강체를 원할 때 사용 (양수겹침/직전 무르기/되돌리기/돌 제거/속박/무위전변)
    case "USE_ABILITY": {
      const { player, ability } = action;
      if (state.gameOver || state.augmentSelect || state.pendingTarget) return state;
      if (player !== state.currentPlayer) return state;
      const ownedIds = state.ownedAugments[player].map((a) => a.id);
      if (!ownedIds.includes(ability)) return state;
      if (state.oneTimeUsed[player]?.[ability]) return state;

      const opponent = otherPlayer(player);

      if (ability === "removeStone") {
        return { ...state, pendingTarget: { player, kind: "removeStone", need: 1, selected: [] } };
      }

      if (ability === "watchtower") {
        return { ...state, pendingTarget: { player, kind: "watchtower", need: 1, selected: [] } };
      }

      if (ability === "bind") {
        // 상대 턴을 통째로 건너뜀 - currentPlayer를 그대로 두는 것으로 "상대 턴이 사라짐"을 표현
        return {
          ...state,
          oneTimeUsed: markUsed(state, player, "bind"),
          forbiddenMessage: (player === 1 ? "흑돌" : "백돌") + "이 '속박'을 사용해서 상대의 다음 턴을 통째로 건너뛰게 했어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "colorSwap") {
        const newBoard = state.board.map((row) => row.map((cell) => (cell === 1 ? 2 : cell === 2 ? 1 : 0)));
        return {
          ...state,
          board: newBoard,
          lastMove: { 1: state.lastMove[2], 2: state.lastMove[1] },
          oneTimeUsed: markUsed(state, player, "colorSwap"),
          forbiddenMessage: (player === 1 ? "흑돌" : "백돌") + "이 '무위전변'을 사용해서 돌 색이 전부 뒤집혔어요!",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
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
        const last = state.lastMove[opponent];
        if (!last) return state;

        const immunity = checkImmunity(state, opponent);
        if (immunity.immune) {
          return {
            ...state,
            // 부적/철옹성에 막히면 카드만 소모되고 내 턴은 그대로 유지 (돌은 정상적으로 놓을 수 있음)
            oneTimeUsed: applyImmunityConsumption(markUsed(state, player, "undo"), opponent, immunity.reason),
            forbiddenMessage: immunityMessage(immunity.reason),
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

    // 금지 구역 / 영구 봉쇄 / 돌 제거 / 감시탑의 칸(또는 상대 돌) 선택
    case "TARGET_CELL": {
      const { x, y } = action;
      if (!state.pendingTarget) return state;
      const { player, kind, need, selected } = state.pendingTarget;
      const opponent = otherPlayer(player);
      const immunity = checkImmunity(state, opponent);

      if (kind === "removeStone") {
        if (state.board[y][x] !== opponent) return state;
        const newBoard = state.board.map((row) => row.slice());
        if (!immunity.immune) newBoard[y][x] = 0;
        return {
          ...state,
          board: newBoard,
          pendingTarget: null,
          oneTimeUsed: applyImmunityConsumption(markUsed(state, player, "removeStone"), opponent, immunity.reason),
          forbiddenMessage: immunity.immune ? immunityMessage(immunity.reason) : "",
          forbiddenToken: immunity.immune ? state.forbiddenToken + 1 : state.forbiddenToken,
          // 면역에 막히면 카드만 소모되고 내 턴은 유지 (돌은 정상적으로 놓을 수 있음)
          currentPlayer: immunity.immune ? player : opponent,
        };
      }

      if (kind === "banZone" || kind === "permaBlock" || kind === "watchtower") {
        if (state.board[y][x] !== 0) return state;
        if (selected.some((c) => c.x === x && c.y === y)) return state;
        const newSelected = [...selected, { x, y }];

        if (newSelected.length < need) {
          return { ...state, pendingTarget: { ...state.pendingTarget, selected: newSelected } };
        }

        const nextPlayer = state.pendingTarget.keepTurn ? player : opponent;

        if (immunity.immune) {
          // 면역에 막히면 카드만 소모되고 내 턴은 유지 (돌은 정상적으로 놓을 수 있음)
          return {
            ...state,
            pendingTarget: null,
            oneTimeUsed: applyImmunityConsumption(state.oneTimeUsed, opponent, immunity.reason),
            forbiddenMessage: immunityMessage(immunity.reason),
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

        if (kind === "permaBlock") {
          return {
            ...state,
            pendingTarget: null,
            permaBlockedCells: { ...state.permaBlockedCells, [opponent]: [...state.permaBlockedCells[opponent], ...newSelected] },
            currentPlayer: nextPlayer,
          };
        }

        // watchtower: 상대(opponent)가 이 칸에 두는지 감시. 양쪽에 다 보이도록 상태에 저장
        const additions = newSelected.map((c) => ({ ...c, turnsLeft: 4 }));
        return {
          ...state,
          pendingTarget: null,
          watchtowers: { ...state.watchtowers, [opponent]: [...state.watchtowers[opponent], ...additions] },
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
