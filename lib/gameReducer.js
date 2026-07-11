// 로컬 모드/온라인 모드가 공유하는 게임 상태 리듀서
// 순수 함수라서 온라인 모드에서는 Supabase에 저장할 "다음 상태"를 계산하는 용도로도 그대로 재사용 가능

import {
  BOARD_SIZE,
  createEmptyBoard,
  checkWin,
  isForbiddenMove,
  checkTerritoryWin,
  checkFrameWin,
  isBoardFull,
  countStones,
  hasThreeOrMoreInARow,
  countOpenThrees,
  getEffectiveAugmentIds,
  findCaptures,
  getRingBounds,
  isOutsideRing,
  isCheckerboardBlocked,
  colorForPlayer,
  AUGMENTS,
  GAMBLE_OPTIONS,
  ONE_TIME_ABILITY_IDS,
  ONLINE_ONLY_IDS,
  ENHANCEABLE_AUGMENT_IDS,
  enhanceAugment,
  pickRandom,
} from "./gomokuEngine";

export function initialGameState(isOnlineMode = false) {
  const base = {
    isOnlineMode, // 안개(fog)처럼 온라인 전용 증강을 로컬 뽑기 풀에서 걸러내는 데 씀 (게임 로직 자체와는 무관)
    board: createEmptyBoard(),
    currentPlayer: 1,
    gameOver: false,
    winMessage: "",
    stonesPlaced: { 1: 0, 2: 0 },
    ownedAugments: { 1: [], 2: [] },
    usedAugmentIds: { 1: [], 2: [] }, // 그 플레이어에게 이미 보여준(선택 안 했어도) 증강 id들 - 다시 안 나오게 제외용
    forbiddenMessage: "",
    forbiddenToken: 0,
    augmentSelect: null, // { player, choices: [augment,...], rerolledSlots: [bool,...], differentiated, isGamble?, bonusRerollsRemaining, isStartDraft? }
    draftTierPlan: [], // 회차별 등급(그 회차는 카드 전부 같은 등급) - 양쪽 플레이어가 같은 회차엔 같은 등급을 받도록 공유
    startDraftTier: null, // 시작 증강(0수, 착수 전) 회차 등급 - 양쪽이 같은 등급 3장을 받도록 draftTierPlan과 별개로 공유

    oneTimeUsed: { 1: {}, 2: {} }, // { removeStone:true, undo:true, selfUndo:true, doubleMove:true, revive:true, ... }
    lastMove: { 1: null, 2: null }, // 각 플레이어가 마지막으로 놓은 좌표 {x,y}
    blockedCells: { 1: [], 2: [] }, // 이 플레이어가 못 놓는 칸: [{x,y,turnsLeft}] (금지구역)
    permaBlockedCells: { 1: [], 2: [] }, // 이 플레이어가 영원히 못 놓는 칸: [{x,y}] (영구봉쇄)
    deadCells: [], // 역병으로 죽은 칸: [{x,y}] (양쪽 다 영원히 착수 불가)
    prisonActive: false, // 교도소 - 한 번 켜지면 게임이 끝날 때까지 양쪽의 프리즘 효과가 전부 비활성화
    ringActive: false, // 링 위에서 싸우자 - 한 번 켜지면 게임이 끝날 때까지 판이 좁혀들며, 양쪽 모두에게 적용
    ringStartMove: null, // 링이 발동된 시점의 총 착수 수 (getRingBounds 계산 기준)
    chaosActive: false, // 폭주 - 한 번 켜지면 게임이 끝날 때까지 양쪽 모두 클릭 위치 무시하고 무작위 칸에 착수, 액티브 능력도 못 씀
    roleSwapActive: false, // 입장 바꿔 생각하기 - 한 번 켜지면 게임이 끝날 때까지 보드에 그려지는 돌 색이 서로 뒤바뀜 (실제 소유권/로직은 그대로, 겉모습만 반전)
    doubleMoveActive: { 1: false, 2: false }, // 양수겹침 사용 중 - 이번 한 수는 턴이 안 넘어감
    rushSecondStone: { 1: false, 2: false }, // 질풍노도 보유 시, 지금이 "부스트 턴"의 2번째 돌을 아직 안 놨는지
    rushBoosted: { 1: false, 2: false }, // 질풍노도 보유 시, 다음(또는 지금) 턴이 2개 놓는 "부스트 턴"인지 - 2턴에 1번만 true
    peekedCard: { 1: null, 2: null }, // 먼저 보기로 예약해 둔 다음 증강 선택 확정 카드
    doubleChoicePending: { 1: false, 2: false }, // 더블 초이스 - 다음 증강 선택만 4장
    skipNextDraft: { 1: false, 2: false }, // 동전 던지기 실패 - 다음 증강 선택 발생 시 카드 안 보여주고 그냥 넘어감
    gambleSkipRemaining: { 1: 0, 2: 0 }, // 도박으로 인해 건너뛸 남은 증강 선택 횟수
    bindSkip: { 1: false, 2: false }, // 속박 - 이 플레이어의 다음 턴을 통째로 건너뜀
    stingyDraft: { 1: false, 2: false }, // 인색 - 이 플레이어의 다음 증강 선택지를 1장 줄임
    conquerorPending: { 1: false, 2: false }, // 정복자 퀘스트 달성 - 달성한 이 플레이어만의 다음 증강 선택 등급을 프리즘으로 확정 (draftTierPlan은 공유값이라 안 건드림, 상대는 영향 없음)
    differentiatedDraftPending: { 1: false, 2: false }, // 저울질 - 다음 증강 선택에서 상대가 가진 증강 제외
    watchtowerCells: { 1: [], 2: [] }, // 이 플레이어에게 세워진 감시탑: [{x,y,turnsLeft}] (둘 다 볼 수 있음)
    boardFlipCooldown: { 1: 0, 2: 0 }, // 판 뒤엎기 재사용 대기시간(남은 수) - 0이면 바로 사용 가능, 사용하면 6으로 리셋
    noYieldBonus: { 1: false, 2: false }, // 양보 없음 - 예약된 보너스 턴 (다음 착수 때 소모되어 그 턴에 한 번 더 놓게 함)
    fogTurnsLeft: { 1: 0, 2: 0 }, // 안개 - 이 플레이어(피해자) 화면에서만 보드 외곽이 안 보이는 남은 자기 턴 수
    checkerboardActive: false, // 체크무늬 - 한 번 켜지면 게임이 끝날 때까지 (x+y) 홀수 칸은 양쪽 다 착수 불가
    brinkMilestone: { 1: 0, 2: 0 }, // 벼랑 끝 - 이미 보상을 받은 최고 격차 단계 (반복 발동 시 같은 단계는 중복 지급 안 되게 추적)
    timeLimitOverride: null, // 노즈도르무 - 발동되면 이후 게임 끝까지 양쪽 제한시간이 이 값(초)으로 고정
    pokerFacePending: { 1: null, 2: null }, // 포커페이스 - 사용하면 { turnsLeft, real } 로 저장, 3턴 뒤 real이면 카드 강탈 (본인 화면에만 real 여부 공개)

    ultimatumCell: { 1: null, 2: null }, // 그 플레이어가 선언한 최후통첩 칸 {x,y}
    pendingTarget: null, // { player, kind, need, selected: [], keepTurn?, sourceCell? }
    rematchRequested: { 1: false, 2: false }, // 재도전 - 둘 다 눌러야 실제로 재시작됨
    colorFlipped: false, // 재도전이 성사될 때마다 토글됨 - 온라인 모드에서 물리적 플레이어(신원)와 논리적 색(흑/백)의 매핑을 뒤집는 데 사용
  };
  // 첫 착수 전에 흑돌부터 시작 증강을 먼저 고르고 시작 (백돌은 흑돌이 고른 직후 이어서 선택하게 됨 - PICK_AUGMENT 참고)
  return { ...base, ...buildStartAugmentChoices(base, 1) };
}

// 흑돌/백돌 전용 카드(colorOnly: 1|2) 필터 - myColor와 안 맞으면 애초에 뽑기 풀에 안 들어감
function matchesColor(augment, myColor) {
  return !augment.colorOnly || augment.colorOnly === myColor;
}

// hardExcludeIds: 무슨 일이 있어도 절대 뽑히면 안 되는 것(이미 보유 중 / 지금 같이 보이는 다른 카드)
// softExcludeIds: "이미 봤던 것"이라 되도록 피하고 싶지만, 풀이 모자라면 리셋해도 되는 것
function drawFromPool(hardExcludeIds, softExcludeIds, count, myColor) {
  let pool = AUGMENTS.filter((a) => matchesColor(a, myColor) && !hardExcludeIds.includes(a.id) && !softExcludeIds.includes(a.id));
  if (pool.length < count) {
    // 한 바퀴 다 돌았으면 "봤던 것" 제한만 리셋. 보유 중/지금 보이는 카드는 항상 제외 유지
    pool = AUGMENTS.filter((a) => matchesColor(a, myColor) && !hardExcludeIds.includes(a.id));
  }
  return pickRandom(pool, count);
}

// 특정 등급 1장만 뽑기 (등급 동기화용 - 리롤도 같은 등급끼리만 바뀌게 하는 데 사용)
function drawOneOfTier(tier, hardExcludeIds, softExcludeIds, myColor) {
  let pool = AUGMENTS.filter((a) => a.tier === tier && matchesColor(a, myColor) && !hardExcludeIds.includes(a.id) && !softExcludeIds.includes(a.id));
  if (pool.length === 0) pool = AUGMENTS.filter((a) => a.tier === tier && matchesColor(a, myColor) && !hardExcludeIds.includes(a.id));
  if (pool.length === 0) pool = AUGMENTS.filter((a) => matchesColor(a, myColor) && !hardExcludeIds.includes(a.id) && !softExcludeIds.includes(a.id));
  if (pool.length === 0) pool = AUGMENTS.filter((a) => matchesColor(a, myColor) && !hardExcludeIds.includes(a.id));
  return pickRandom(pool, 1)[0];
}

// 특정 등급 여러 장 뽑기 (도박 증강용)
function drawSeveralOfTier(tier, count, hardExcludeIds, softExcludeIds, myColor) {
  let pool = AUGMENTS.filter((a) => a.tier === tier && matchesColor(a, myColor) && !hardExcludeIds.includes(a.id) && !softExcludeIds.includes(a.id));
  if (pool.length < count) pool = AUGMENTS.filter((a) => a.tier === tier && matchesColor(a, myColor) && !hardExcludeIds.includes(a.id));
  return pickRandom(pool, count);
}

// 이 수까지, 그리고 판 위에 3목 이상이 아직 없을 때만 프리즘 뽑기에 대각선강화/일자진이 등장할 수 있음
// - 초반에만 나오게 해서 중후반 스노우볼을 막고, 3목을 일부러 만들어둔 다음 뽑는 편법도 막음
const EARLY_GAME_STONE_LIMIT = 8;
const LATE_GAME_HIDDEN_IDS = ["diagBoost", "straightBoost"];
// 체크무늬(대각선만 유효해짐)와 대각선 강화/일자진(대각선 승리 조건 완화)이 겹치면 한쪽에게 일방적으로
// 유리해지는 폭탄 조합이 되므로, 둘 중 하나가 이미 판에 있으면 서로의 뽑기 풀에서 배타적으로 제외함
function getStageExcludeIds(state, player) {
  const tooLate = state.stonesPlaced[player] > EARLY_GAME_STONE_LIMIT;
  const alreadyThreatening = hasThreeOrMoreInARow(state.board);
  const ids = tooLate || alreadyThreatening || state.checkerboardActive ? [...LATE_GAME_HIDDEN_IDS] : [];
  const bothOwnedIds = [
    ...state.ownedAugments[1].map((a) => a.id),
    ...state.ownedAugments[2].map((a) => a.id),
  ];
  if (bothOwnedIds.includes("diagBoost") || bothOwnedIds.includes("straightBoost")) ids.push("checkerboard");
  return [...new Set(ids)];
}

// 안개는 온라인 전용이라 로컬 모드에서는 항상 뽑기 풀에서 제외해야 함
function getModeExcludeIds(state) {
  return state.isOnlineMode ? [] : ONLINE_ONLY_IDS;
}

// 회차별 등급 후보 - 실버가 더 잘 나오고 프리즘은 드물게 (실버3:골드2:프리즘1 비율)
const ROUND_TIER_POOL = ["silver", "silver", "silver", "gold", "gold", "prism"];

const AUGMENT_TIER_BY_ID = Object.fromEntries(AUGMENTS.map((a) => [a.id, a.tier]));

function markUsed(state, player, ability) {
  return { ...state.oneTimeUsed, [player]: { ...state.oneTimeUsed[player], [ability]: true } };
}

function otherPlayer(player) {
  return player === 1 ? 2 : 1;
}

// 교도소가 발동 중이면 프리즘 등급 증강은 전부 없는 셈 치고 판정 (자기 자신 포함, 양쪽 다 적용)
function getActiveAugmentIds(state, player) {
  const ids = state.ownedAugments[player].map((a) => a.id);
  if (!state.prisonActive) return ids;
  return ids.filter((id) => AUGMENT_TIER_BY_ID[id] !== "prism");
}

// 대상(targetPlayer)이 제거/봉쇄/무르기 계열 효과에 면역인지 (철옹성은 무한, 부적은 1회성)
function checkImmunity(state, targetPlayer) {
  const targetOwnedIds = getActiveAugmentIds(state, targetPlayer);
  if (targetOwnedIds.includes("fortress")) return { immune: true, reason: "fortress" };
  if (targetOwnedIds.includes("talisman") && !state.oneTimeUsed[targetPlayer]?.talisman) {
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
  return { ...oneTimeUsed, [targetPlayer]: { ...oneTimeUsed[targetPlayer], talisman: true } };
}

// 여진: 이 플레이어가 아직 여진을 안 썼으면 제거계 효과를 1회 막아줌
function hasAftershockShield(state, victim) {
  const victimOwnedIds = getActiveAugmentIds(state, victim);
  return victimOwnedIds.includes("aftershock") && !state.oneTimeUsed[victim]?.aftershock;
}

// 폭주: 지금 이 플레이어가 실제로 착수 가능한 빈 칸(금지구역/영구봉쇄/역병칸/링 바깥/렌주룰 금수 전부 제외) 중 무작위 1곳
function pickRandomLegalCell(state, player) {
  const totalStonesPlacedForRing = state.stonesPlaced[1] + state.stonesPlaced[2];
  const ringBounds = getRingBounds(state.ringStartMove, totalStonesPlacedForRing);
  const effectiveOwnedIds = getEffectiveAugmentIds(getActiveAugmentIds(state, player), totalStonesPlacedForRing);
  const lastMoveForPlayer = state.lastMove[player];

  const candidates = [];
  for (let cy = 0; cy < BOARD_SIZE; cy++) {
    for (let cx = 0; cx < BOARD_SIZE; cx++) {
      if (state.board[cy][cx] !== 0) continue;
      if (isOutsideRing(ringBounds, cx, cy)) continue;
      if (isCheckerboardBlocked(state.checkerboardActive, cx, cy)) continue;
      if (state.blockedCells[player].some((c) => c.x === cx && c.y === cy)) continue;
      if (!state.prisonActive && state.permaBlockedCells[player].some((c) => c.x === cx && c.y === cy)) continue;
      if (state.deadCells.some((c) => c.x === cx && c.y === cy)) continue;
      if (colorForPlayer(player, state.roleSwapActive) === 1 && isForbiddenMove(state.board, cx, cy, effectiveOwnedIds, lastMoveForPlayer)) continue;
      candidates.push({ x: cx, y: cy });
    }
  }
  return pickRandom(candidates, 1)[0] || null;
}

// 교도소/링 위에서 싸우자/폭주는 "뽑는 순간 즉시 발동"하는 효과라 정상적인 증강 선택(PICK_AUGMENT)이 아니라
// 거래/도박/동전 던지기/잠복처럼 다른 경로로 얻었을 때도 똑같이 발동시켜야 함 - 이 함수를 그 모든 경로에서 공통으로 거침
// (안 그러면 카드만 보유하고 실제 효과는 하나도 안 켜지는 조용한 버그가 생김)
const INSTANT_ACTIVATE_MESSAGE = {
  prison: "'교도소'가 발동돼서 이제부터 양쪽 모두 프리즘 효과가 사라집니다!",
  battleRing: "'링 위에서 싸우자'가 발동돼서 이제부터 판이 서서히 좁아집니다!",
  chaos: "'폭주'가 발동돼서 이제부터 양쪽 다 조작권을 잃고 무작위로 돌을 둡니다!",
  roleSwap: "'입장 바꿔 생각하기'가 발동돼서 이제부터 서로 담당하는 돌 색이 뒤바뀝니다!",
  checkerboard: "'체크무늬'가 발동돼서 이제부터 짝수 칸(대각선 방향)만 착수할 수 있습니다!",
  nozdormu: "'노즈도르무'가 발동돼서 이제부터 양쪽 제한시간이 15초로 고정됩니다!",
};
function activateInstantAugments(state, grantedAugments) {
  const patch = {};
  const messages = [];
  for (const augment of grantedAugments) {
    if (augment.id === "prison" && !state.prisonActive && !patch.prisonActive) {
      patch.prisonActive = true;
      messages.push(INSTANT_ACTIVATE_MESSAGE.prison);
    }
    if (augment.id === "battleRing" && !state.ringActive && !patch.ringActive) {
      patch.ringActive = true;
      patch.ringStartMove = state.stonesPlaced[1] + state.stonesPlaced[2];
      messages.push(INSTANT_ACTIVATE_MESSAGE.battleRing);
    }
    if (augment.id === "chaos" && !state.chaosActive && !patch.chaosActive) {
      patch.chaosActive = true;
      messages.push(INSTANT_ACTIVATE_MESSAGE.chaos);
    }
    if (augment.id === "roleSwap" && !state.roleSwapActive && !patch.roleSwapActive) {
      patch.roleSwapActive = true;
      messages.push(INSTANT_ACTIVATE_MESSAGE.roleSwap);
    }
    if (augment.id === "checkerboard" && !state.checkerboardActive && !patch.checkerboardActive) {
      patch.checkerboardActive = true;
      messages.push(INSTANT_ACTIVATE_MESSAGE.checkerboard);
    }
    if (augment.id === "nozdormu" && !state.timeLimitOverride && !patch.timeLimitOverride) {
      patch.timeLimitOverride = 15;
      messages.push(INSTANT_ACTIVATE_MESSAGE.nozdormu);
    }
  }
  if (messages.length > 0) {
    patch.forbiddenMessage = messages.join(" ");
    patch.forbiddenToken = state.forbiddenToken + 1;
  }
  return patch;
}

// 잠복: 금지 구역/영구 봉쇄/감시탑에 처음 걸리는 피해자에게 카드 1장을 무료로 얹어줌
function triggerAmbushIfNeeded(state, victim) {
  const victimOwnedIds = state.ownedAugments[victim].map((a) => a.id);
  if (!victimOwnedIds.includes("ambush") || state.oneTimeUsed[victim]?.ambush) return null;
  const seenIds = state.usedAugmentIds[victim];
  const [bonus] = drawFromPool([...victimOwnedIds, ...getModeExcludeIds(state)], seenIds, 1, colorForPlayer(victim, state.roleSwapActive));
  if (!bonus) return null;
  return {
    ownedAugments: { ...state.ownedAugments, [victim]: [...state.ownedAugments[victim], bonus] },
    usedAugmentIds: { ...state.usedAugmentIds, [victim]: [...seenIds, bonus.id] },
    oneTimeUsed: { ...state.oneTimeUsed, [victim]: { ...state.oneTimeUsed[victim], ambush: true } },
    ...activateInstantAugments(state, [bonus]),
  };
}

// 생존자 퀘스트: 이 플레이어(victim)의 돌이 이 판에서 처음 제거당하면 무료 실버 카드 2장 지급 (1회)
function triggerSurvivorQuestIfNeeded(state, victim) {
  const victimOwnedIds = state.ownedAugments[victim].map((a) => a.id);
  if (!victimOwnedIds.includes("survivor") || state.oneTimeUsed[victim]?.survivor) return null;
  const seenIds = state.usedAugmentIds[victim];
  const bonus = drawSeveralOfTier("silver", 2, [...victimOwnedIds, ...getModeExcludeIds(state)], seenIds, colorForPlayer(victim, state.roleSwapActive));
  if (bonus.length === 0) return null;
  return {
    ownedAugments: { ...state.ownedAugments, [victim]: [...state.ownedAugments[victim], ...bonus] },
    usedAugmentIds: { ...state.usedAugmentIds, [victim]: [...new Set([...seenIds, ...bonus.map((a) => a.id)])] },
    oneTimeUsed: { ...state.oneTimeUsed, [victim]: { ...state.oneTimeUsed[victim], survivor: true } },
    forbiddenMessage: "'생존자' 퀘스트 발동! 무료 카드 2장을 획득했어요!",
  };
}

// 정복자 퀘스트: 중앙 3x3(9칸)에 이 플레이어의 돌이 5개 이상이면 다음 증강 선택 등급을 프리즘으로 확정 (1회)
const CENTER_ZONE_START = Math.floor((BOARD_SIZE - 3) / 2);
const CENTER_ZONE_WIN_COUNT = 5;
function countCenterZoneStones(board, color) {
  let count = 0;
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      if (board[CENTER_ZONE_START + dy][CENTER_ZONE_START + dx] === color) count++;
    }
  }
  return count;
}
function triggerConquerorQuestIfNeeded(state, player, board, color) {
  const ownedIds = state.ownedAugments[player].map((a) => a.id);
  if (!ownedIds.includes("conqueror") || state.oneTimeUsed[player]?.conqueror) return null;
  if (countCenterZoneStones(board, color) < CENTER_ZONE_WIN_COUNT) return null;
  // draftTierPlan은 두 플레이어가 공유하는 회차별 등급표라 여기다 직접 쓰면 같은 roundIndex에
  // 도달한 상대까지 프리즘을 받아가 버림 - 대신 이 플레이어 전용 플래그로만 다음 뽑기를 승급시킴
  return {
    conquerorPending: { ...state.conquerorPending, [player]: true },
    oneTimeUsed: { ...state.oneTimeUsed, [player]: { ...state.oneTimeUsed[player], conqueror: true } },
    forbiddenMessage: "'정복자' 퀘스트 발동! 다음 증강 선택 등급이 프리즘으로 확정됐어요!",
  };
}

// 벼랑 끝 퀘스트: 이 플레이어의 돌이 상대보다 일정 개수(기본 3개, 감정으로 강화하면 2개) 이상 적어질 때마다
// 반복 발동 - 이미 보상을 받은 최고 단계(brinkMilestone)를 넘어설 때만 다시 지급해서 같은 격차로 중복 지급되는 걸 막음
function triggerBrinkQuestIfNeeded(state, player, board) {
  const ownedIds = state.ownedAugments[player].map((a) => a.id);
  if (!ownedIds.includes("brink")) return null;
  const brinkCard = state.ownedAugments[player].find((a) => a.id === "brink");
  const step = brinkCard?.enhanced ? 2 : 3;
  const myColor = colorForPlayer(player, state.roleSwapActive);
  const oppColor = myColor === 1 ? 2 : 1;
  const deficit = countStones(board, oppColor) - countStones(board, myColor);
  const milestone = Math.floor(Math.max(0, deficit) / step);
  const lastMilestone = state.brinkMilestone[player] || 0;
  if (milestone <= lastMilestone) return null;
  const seenIds = state.usedAugmentIds[player];
  const bonus = drawSeveralOfTier("silver", 1, [...ownedIds, ...getModeExcludeIds(state)], seenIds, myColor);
  if (bonus.length === 0) return null;
  return {
    ownedAugments: { ...state.ownedAugments, [player]: [...state.ownedAugments[player], ...bonus] },
    usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, ...bonus.map((a) => a.id)])] },
    brinkMilestone: { ...state.brinkMilestone, [player]: milestone },
    forbiddenMessage: "'벼랑 끝' 발동! 돌 개수가 열세라 무료 실버 카드를 획득했어요!",
  };
}

// 회차 등급 결정 (이미 정해져 있으면 그대로, 아니면 그 자리에서 하나 뽑아서 draftTierPlan에 고정) - 두 플레이어가
// 같은 회차엔 같은 등급을 받도록, 그리고 먼저 보기가 예약하는 카드도 같은 등급 안에서 뽑히도록 이 함수 하나로 통일
function resolveRoundTier(state, roundIndex) {
  let roundTier = state.draftTierPlan[roundIndex];
  let newTierPlan = state.draftTierPlan;
  if (!roundTier) {
    roundTier = pickRandom(ROUND_TIER_POOL, 1)[0];
    newTierPlan = state.draftTierPlan.slice();
    newTierPlan[roundIndex] = roundTier;
  }
  return { roundTier, newTierPlan };
}

// 4턴 달성 시 새 증강 선택 카드 뽑기 (먼저 보기/더블 초이스/인색/저울질/늦둥이 반영, 회차 등급은 draftTierPlan에서 공유)
// 그 회차에 뜨는 카드는 전부 같은 등급(예: 이번 회차는 골드 3장) - 두 플레이어가 같은 회차엔 같은 등급을 받도록 맞춤
function buildAugmentChoices(state, player, roundIndex) {
  const ownedIds = state.ownedAugments[player].map((a) => a.id);
  const opponentOwnedIds = state.ownedAugments[otherPlayer(player)].map((a) => a.id);
  const seenIds = state.usedAugmentIds[player];
  const stageExcludeIds = getStageExcludeIds(state, player);
  const peeked = state.peekedCard[player];
  const differentiated = state.differentiatedDraftPending[player];
  const extraExclude = differentiated ? opponentOwnedIds : [];

  const { roundTier, newTierPlan } = resolveRoundTier(state, roundIndex);

  // 늦둥이: 16수(감정으로 강화하면 12수) 넘긴 뒤로 이 회차가 실버면, 나만 골드로 승급해서 뽑음 (상대는 원래 회차 등급 그대로)
  const totalStonesPlaced = state.stonesPlaced[1] + state.stonesPlaced[2];
  const lateBloomerCard = state.ownedAugments[player].find((a) => a.id === "lateBloomer");
  const lateBloomerThreshold = lateBloomerCard?.enhanced ? 12 : 16;
  // 정복자: 달성한 이 플레이어만 이번 뽑기를 프리즘으로 승급 (상대의 draftTierPlan은 그대로 유지되므로 상대는 영향 없음)
  const effectiveTier = state.conquerorPending[player]
    ? "prism"
    : roundTier === "silver" && ownedIds.includes("lateBloomer") && totalStonesPlaced >= lateBloomerThreshold
      ? "gold"
      : roundTier;

  // 인색(카드 1장 줄임)/더블 초이스(1장 늘림)는 그 회차 등급은 그대로 두고 장수만 조정
  let count = 3;
  if (state.stingyDraft[player]) count = Math.max(1, count - 1);
  if (state.doubleChoicePending[player]) count += 1;

  const hardExclude = [...ownedIds, ...stageExcludeIds, ...extraExclude, ...getModeExcludeIds(state)];
  const drawn = [];
  let remaining = count;

  if (peeked) {
    drawn.push(peeked);
    remaining -= 1; // 먼저 보기로 예약된 카드가 한 자리를 차지
  }

  const myColor = colorForPlayer(player, state.roleSwapActive);
  for (let i = 0; i < remaining; i++) {
    const usedSoFarIds = drawn.map((c) => c.id);
    const card = drawOneOfTier(effectiveTier, [...hardExclude, ...usedSoFarIds], seenIds, myColor);
    if (card) drawn.push(card);
  }
  return {
    choices: drawn,
    usedAugmentIds: [...new Set([...seenIds, ...drawn.map((c) => c.id)])],
    draftTierPlan: newTierPlan,
    differentiated,
  };
}

// 시작 증강(0수, 착수 전) 뽑기 - 즉시 칸 지정이 필요하거나(금지구역/영구봉쇄) 별도 선택 화면으로 이어지는(도박) 카드는
// 시작 시퀀스가 복잡해지는 걸 피하려고 제외. 나머지 카드는 전부 정상적으로 등장 가능 (4수마다 뜨는 회차에서는 그대로 다 등장함)
const START_DRAFT_EXCLUDE_IDS = ["banZone", "permaBlock", "gamble"];

// 포커페이스 강탈 대상에서 항상 빼는 카드 - 금지구역/영구봉쇄는 뽑는 즉시 칸을 지정해서 효과가 끝나버리고
// 이후 버튼도 없어서(oneTimeUsed에 기록조차 안 남음) 훔쳐가도 항상 죽은 카드가 되기 때문
const POKER_FACE_STEAL_EXCLUDE_IDS = ["banZone", "permaBlock"];
function buildStartAugmentChoices(state, player) {
  const seenIds = state.usedAugmentIds[player];
  const myColor = colorForPlayer(player, state.roleSwapActive);
  const roundTier = state.startDraftTier || pickRandom(ROUND_TIER_POOL, 1)[0];
  const modeExclude = getModeExcludeIds(state);
  const drawn = [];
  for (let i = 0; i < 3; i++) {
    const card = drawOneOfTier(roundTier, [...START_DRAFT_EXCLUDE_IDS, ...modeExclude, ...drawn.map((c) => c.id)], seenIds, myColor);
    if (card) drawn.push(card);
  }
  return {
    startDraftTier: roundTier,
    usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, ...drawn.map((c) => c.id)])] },
    augmentSelect: {
      player,
      choices: drawn,
      rerolledSlots: drawn.map(() => false),
      differentiated: false,
      bonusRerollsRemaining: 0,
      isStartDraft: true,
    },
  };
}

export function gameReducer(state, action) {
  switch (action.type) {
    case "CLICK_CELL": {
      let { x, y } = action;
      if (state.gameOver || state.augmentSelect || state.pendingTarget) return state;
      if (!state.chaosActive && state.board[y][x] !== 0) return state;

      const { currentPlayer } = state;
      const opponent = otherPlayer(currentPlayer);
      // 입장 바꿔 생각하기: 신원(currentPlayer/opponent)과 실제로 보드에 놓이는 돌 색이 다를 수 있어서 분리
      const currentColor = colorForPlayer(currentPlayer, state.roleSwapActive);
      const opponentColor = colorForPlayer(opponent, state.roleSwapActive);

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

      // 폭주: 조작권을 잃은 상태라 어디를 클릭해도 실제로는 무작위 빈 칸에 놓임
      if (state.chaosActive) {
        const randomCell = pickRandomLegalCell(state, currentPlayer);
        if (!randomCell) return state; // 둘 곳이 하나도 없음 (거의 발생 안 함)
        x = randomCell.x;
        y = randomCell.y;
      }

      // 링 위에서 싸우자: 발동 후 총 착수 수 기준으로 계속 좁혀 들어가는 안쪽 범위 바깥은 양쪽 다 착수 불가
      const totalStonesPlacedForRing = state.stonesPlaced[1] + state.stonesPlaced[2];
      const ringBounds = getRingBounds(state.ringStartMove, totalStonesPlacedForRing);
      const isOutsideRingCell = isOutsideRing(ringBounds, x, y);

      // 체크무늬: (x+y) 홀수 칸은 양쪽 다 착수 불가 (대각선 강화/일자진과는 뽑기 단계에서 이미 배타적으로 처리됨)
      const isCheckerboardBlockedCell = isCheckerboardBlocked(state.checkerboardActive, x, y);

      // 영구 봉쇄는 프리즘 등급이라 교도소가 발동하면 이미 걸린 것도 같이 풀림 (금지구역/역병은 프리즘이 아니라 그대로 유지)
      const isBlocked =
        state.blockedCells[currentPlayer].some((c) => c.x === x && c.y === y) ||
        (!state.prisonActive && state.permaBlockedCells[currentPlayer].some((c) => c.x === x && c.y === y)) ||
        state.deadCells.some((c) => c.x === x && c.y === y) ||
        isOutsideRingCell ||
        isCheckerboardBlockedCell;
      if (isBlocked) {
        return {
          ...state,
          forbiddenMessage: isOutsideRingCell
            ? "링 밖이라 놓을 수 없어요"
            : isCheckerboardBlockedCell
            ? "체크무늬 패턴이 아니라서 놓을 수 없어요"
            : "여기는 막혀 있어서 놓을 수 없어요",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      const ownedIds = getActiveAugmentIds(state, currentPlayer);
      const totalStonesPlaced = state.stonesPlaced[1] + state.stonesPlaced[2];
      const effectiveOwnedIds = getEffectiveAugmentIds(ownedIds, totalStonesPlaced);
      const prevMove = state.lastMove[currentPlayer];

      // 최후통첩: 내가 선언해 둔 칸에 지금 두는 거면, 이번 수만 다리 놓기+연속 배치 효과를 같이 받음
      const ultimatumCell = state.ultimatumCell[currentPlayer];
      const ultimatumFulfilled = !!ultimatumCell && ultimatumCell.x === x && ultimatumCell.y === y;
      const finalOwnedIds = ultimatumFulfilled ? [...effectiveOwnedIds, "bridge", "adjacentLink"] : effectiveOwnedIds;

      // 렌주룰 금수 판정 (흑돌만 적용, 렌주룰 자체는 증강과 무관 / 균형 보유 시 열세면 면제)
      // - "흑돌"은 지금 흑돌 색을 놓는 사람 기준(currentColor)이지, 신원(currentPlayer) 기준이 아님
      if (currentColor === 1) {
        const balanceCard = state.ownedAugments[currentPlayer].find((a) => a.id === "balance");
        const balanceThreshold = balanceCard?.enhanced ? 1 : 2;
        const isBalanceExempt =
          ownedIds.includes("balance") && countStones(state.board, 1) <= countStones(state.board, 2) - balanceThreshold;
        if (!isBalanceExempt) {
          const forbiddenReason = isForbiddenMove(state.board, x, y, finalOwnedIds, prevMove);
          if (forbiddenReason) {
            return {
              ...state,
              forbiddenMessage: "여기는 렌주룰 금수 자리예요 (" + forbiddenReason + ")",
              forbiddenToken: state.forbiddenToken + 1,
            };
          }
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
      newBoard[y][x] = currentColor;

      // 포위 제거 / 오델로: 상대가 철옹성이 아니면 "나-상대-나" 모양이 된 상대 돌을 제거하거나 내 색으로 뒤집음
      // 여진을 가진 피해자는 1회에 한해 제거를 막아내고, 그 회차 안에 뭔가 하나라도 없앴으면 도미노로 보너스 턴을 얻음
      const opponentOwnedIds = getActiveAugmentIds(state, opponent);
      let aftershockUsedThisMove = false;
      let capturedOrFlippedAny = false;
      let captureRemovedAny = false;
      if (!opponentOwnedIds.includes("fortress")) {
        if (ownedIds.includes("capture")) {
          for (const c of findCaptures(newBoard, x, y, currentColor)) {
            if (!aftershockUsedThisMove && hasAftershockShield(state, opponent)) {
              aftershockUsedThisMove = true;
              continue;
            }
            newBoard[c.y][c.x] = 0;
            capturedOrFlippedAny = true;
            captureRemovedAny = true;
          }
        }
        if (ownedIds.includes("othello")) {
          for (const c of findCaptures(newBoard, x, y, currentColor)) {
            newBoard[c.y][c.x] = currentColor;
            capturedOrFlippedAny = true;
          }
        }
      }
      const dominoBonusTurn = ownedIds.includes("domino") && capturedOrFlippedAny;

      // 여진이 발동됐으면 이후 로직은 전부 이 상태를 기준으로 계속 진행 (oneTimeUsed 갱신 반영)
      let stateAfterCapture = aftershockUsedThisMove
        ? { ...state, oneTimeUsed: { ...state.oneTimeUsed, [opponent]: { ...state.oneTimeUsed[opponent], aftershock: true } } }
        : state;

      // 퀘스트 증강 체크: 생존자(포위 제거로 상대 돌이 실제로 사라짐) / 정복자(중앙 3x3 점유)
      const extraQuestMessages = [];
      if (captureRemovedAny) {
        const survivorPatch = triggerSurvivorQuestIfNeeded(stateAfterCapture, opponent);
        if (survivorPatch) {
          stateAfterCapture = { ...stateAfterCapture, ...survivorPatch };
          extraQuestMessages.push(survivorPatch.forbiddenMessage);
        }
      }
      const conquerorPatch = triggerConquerorQuestIfNeeded(stateAfterCapture, currentPlayer, newBoard, currentColor);
      if (conquerorPatch) {
        stateAfterCapture = { ...stateAfterCapture, ...conquerorPatch };
        extraQuestMessages.push(conquerorPatch.forbiddenMessage);
      }

      // 벼랑 끝 퀘스트: 돌 개수 격차는 이번 수로 양쪽 다 바뀔 수 있으니 둘 다 체크
      const brinkPatch1 = triggerBrinkQuestIfNeeded(stateAfterCapture, 1, newBoard);
      if (brinkPatch1) {
        stateAfterCapture = { ...stateAfterCapture, ...brinkPatch1 };
        extraQuestMessages.push(brinkPatch1.forbiddenMessage);
      }
      const brinkPatch2 = triggerBrinkQuestIfNeeded(stateAfterCapture, 2, newBoard);
      if (brinkPatch2) {
        stateAfterCapture = { ...stateAfterCapture, ...brinkPatch2 };
        extraQuestMessages.push(brinkPatch2.forbiddenMessage);
      }

      // 백돌 전용 초반 견제 카드들: 흑돌이 방금 뒀을 때만 체크
      if (currentColor === 1) {
        const totalAfterThisMove = state.stonesPlaced[1] + state.stonesPlaced[2] + 1;

        // 역감시: 흑돌이 총 8수(감정으로 강화하면 10수) 이내에 처음 만드는 열린 3목을 감지하면 상대(백돌)에게 무료 카드 1장 지급 (1회)
        const opponentActiveIds = getActiveAugmentIds(stateAfterCapture, opponent);
        const counterWatchCard = stateAfterCapture.ownedAugments[opponent].find((a) => a.id === "counterWatch");
        const counterWatchWindow = counterWatchCard?.enhanced ? 10 : 8;
        if (
          opponentActiveIds.includes("counterWatch") &&
          !stateAfterCapture.oneTimeUsed[opponent]?.counterWatch &&
          totalAfterThisMove <= counterWatchWindow &&
          countOpenThrees(newBoard, x, y) > 0
        ) {
          const seenIds = stateAfterCapture.usedAugmentIds[opponent];
          const ownedIdsForDraw = [...stateAfterCapture.ownedAugments[opponent].map((a) => a.id), ...getModeExcludeIds(state)];
          const [bonus] = drawFromPool(ownedIdsForDraw, seenIds, 1, colorForPlayer(opponent, state.roleSwapActive));
          if (bonus) {
            stateAfterCapture = {
              ...stateAfterCapture,
              ownedAugments: { ...stateAfterCapture.ownedAugments, [opponent]: [...stateAfterCapture.ownedAugments[opponent], bonus] },
              usedAugmentIds: { ...stateAfterCapture.usedAugmentIds, [opponent]: [...new Set([...seenIds, bonus.id])] },
              oneTimeUsed: { ...stateAfterCapture.oneTimeUsed, [opponent]: { ...stateAfterCapture.oneTimeUsed[opponent], counterWatch: true } },
              ...activateInstantAugments(stateAfterCapture, [bonus]),
            };
          }
        }

        // 양보 없음: 총 4수 이내에 흑돌이 둘 때마다 15%(감정으로 강화하면 25%) 확률로 상대(백돌)의 다음 턴에 보너스 착수 1회를 예약
        // (이미 예약된 보너스가 있으면 중복으로 안 쌓임 - 너프: 원래 8수 창이 너무 세다는 피드백으로 4수로 축소)
        const noYieldCard = stateAfterCapture.ownedAugments[opponent].find((a) => a.id === "noYield");
        const noYieldChance = noYieldCard?.enhanced ? 0.25 : 0.15;
        if (
          opponentActiveIds.includes("noYield") &&
          !stateAfterCapture.noYieldBonus[opponent] &&
          totalAfterThisMove <= 4 &&
          Math.random() < noYieldChance
        ) {
          stateAfterCapture = {
            ...stateAfterCapture,
            noYieldBonus: { ...stateAfterCapture.noYieldBonus, [opponent]: true },
          };
        }
      }

      const isLineWin = checkWin(newBoard, x, y, currentColor, finalOwnedIds, prevMove);
      const isTerritoryWin = ownedIds.includes("territory") && checkTerritoryWin(newBoard, currentColor);
      const isFrameWin = ownedIds.includes("squareFrame") && checkFrameWin(newBoard, x, y, currentColor);

      if (isLineWin || isTerritoryWin || isFrameWin) {
        if (opponentOwnedIds.includes("revive") && !stateAfterCapture.oneTimeUsed[opponent]?.revive) {
          const revivedBoard = newBoard.map((row) => row.slice());
          revivedBoard[y][x] = 0;
          return {
            ...stateAfterCapture,
            board: revivedBoard,
            forbiddenMessage: "상대가 '부활'을 사용해서 방금 수가 무효화됐어요!",
            forbiddenToken: stateAfterCapture.forbiddenToken + 1,
            oneTimeUsed: markUsed(stateAfterCapture, opponent, "revive"),
            // 무효화된 수는 아예 없었던 셈이라, 이 턴을 날린 것 - 다음은 부활을 쓴 상대(방어자) 차례여야 함
            // (원래 currentPlayer를 그대로 두면 이기려던 쪽이 곧바로 한 번 더 두게 되는 버그였음)
            currentPlayer: opponent,
          };
        }
        let winSuffix = " 승리!";
        if (!isLineWin && isTerritoryWin) winSuffix = " 영역 점령 승리!";
        else if (!isLineWin && !isTerritoryWin && isFrameWin) winSuffix = " 네모 완성 승리!";
        return {
          ...stateAfterCapture,
          board: newBoard,
          forbiddenMessage: "",
          gameOver: true,
          winMessage: (currentColor === 1 ? "흑돌" : "백돌") + winSuffix,
        };
      }

      // 물량전: 아무도 안 이겼는데 보드가 다 찼으면, 물량전 소유자가 돌이 더 많을 때 승리 처리 (아니면 무승부)
      // - 각 신원이 실제로 놓고 있는 색(입장 바꿔 생각하기로 바뀌었을 수 있음) 기준으로 자기 돌 개수를 셈
      if (isBoardFull(newBoard)) {
        const p1Color = colorForPlayer(1, state.roleSwapActive);
        const p2Color = p1Color === 1 ? 2 : 1;
        const p1Count = countStones(newBoard, p1Color);
        const p2Count = countStones(newBoard, p2Color);
        const p1Attrition = state.ownedAugments[1].some((a) => a.id === "attrition") && p1Count > p2Count;
        const p2Attrition = state.ownedAugments[2].some((a) => a.id === "attrition") && p2Count > p1Count;
        return {
          ...stateAfterCapture,
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
          ...stateAfterCapture,
          board: newBoard,
          lastMove: { ...state.lastMove, [currentPlayer]: { x, y } },
          doubleMoveActive: { ...state.doubleMoveActive, [currentPlayer]: false },
          forbiddenMessage: "",
        };
      }

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

      // 질풍노도의 보너스 돌(owedSecondStone)은 같은 턴의 연장일 뿐이라, 금지구역/감시탑 카운트다운과
      // 착수 수(stonesPlaced) 증가·증강 선택 판정에서는 빼야 함 - 안 그러면 보너스 돌 덕분에 증강 선택을
      // 정상보다 훨씬 자주 보게 되는 버그가 생김 (질풍노도 소유자가 4수를 다른 사람보다 훨씬 빨리 채움)
      const isRushBonusStone = hasRush && owedSecondStone;

      // 금지구역 카운트다운 (내가 한 수 뒀으니 1턴 소진, 0 되면 해제) - 보너스 돌은 카운트 안 함
      const decayedBlocked = isRushBonusStone
        ? state.blockedCells[currentPlayer]
        : state.blockedCells[currentPlayer]
            .map((c) => ({ ...c, turnsLeft: c.turnsLeft - 1 }))
            .filter((c) => c.turnsLeft > 0);

      // 감시탑도 마찬가지로, 안 걸렸어도 내가 한 수 뒀으니 1턴 소진 - 보너스 돌은 카운트 안 함
      const decayedWatchtower = isRushBonusStone
        ? state.watchtowerCells[currentPlayer]
        : state.watchtowerCells[currentPlayer]
            .map((c) => ({ ...c, turnsLeft: c.turnsLeft - 1 }))
            .filter((c) => c.turnsLeft > 0);

      // 판 뒤엎기 재사용 대기시간도 같은 방식으로 소진 (보너스 돌은 카운트 안 함)
      const decayedBoardFlipCooldown = isRushBonusStone
        ? state.boardFlipCooldown[currentPlayer]
        : Math.max(0, state.boardFlipCooldown[currentPlayer] - 1);

      // 안개: 피해자 본인이 한 수 둘 때마다 1턴씩 소진 (보너스 돌은 카운트 안 함)
      const decayedFogTurnsLeft = isRushBonusStone
        ? state.fogTurnsLeft[currentPlayer]
        : Math.max(0, state.fogTurnsLeft[currentPlayer] - 1);

      // 포커페이스: 사용한 사람이 이후 3턴을 더 두면 결과가 정해짐 (보너스 돌은 카운트 안 함)
      // - 면역(철옹성/부적)은 이 강탈을 막지 못함(툴팁에 그런 문구가 없어서 의도적으로 체크 안 함)
      const pokerFaceBefore = stateAfterCapture.pokerFacePending[currentPlayer];
      let decayedPokerFacePending = pokerFaceBefore;
      if (pokerFaceBefore && !isRushBonusStone) {
        const nextTurnsLeft = pokerFaceBefore.turnsLeft - 1;
        if (nextTurnsLeft > 0) {
          decayedPokerFacePending = { ...pokerFaceBefore, turnsLeft: nextTurnsLeft };
        } else {
          decayedPokerFacePending = null;
          if (pokerFaceBefore.real) {
            // 프리즘 제외 + 금지구역/영구봉쇄 제외 + 상대가 이미 써버린(효과가 끝난) 카드 제외 -
            // 강탈해도 항상 "아직 살아있는" 카드만 걸리도록 함
            const stealPool = stateAfterCapture.ownedAugments[opponent].filter(
              (a) =>
                a.tier !== "prism" &&
                !POKER_FACE_STEAL_EXCLUDE_IDS.includes(a.id) &&
                !stateAfterCapture.oneTimeUsed[opponent]?.[a.id]
            );
            const [stolen] = stealPool.length > 0 ? pickRandom(stealPool, 1) : [];
            if (stolen) {
              stateAfterCapture = {
                ...stateAfterCapture,
                ownedAugments: {
                  ...stateAfterCapture.ownedAugments,
                  [opponent]: stateAfterCapture.ownedAugments[opponent].filter((a) => a !== stolen),
                  [currentPlayer]: [...stateAfterCapture.ownedAugments[currentPlayer], stolen],
                },
              };
              extraQuestMessages.push("'포커페이스'가 발동해서 상대의 '" + stolen.name + "' 카드를 강탈했어요!");
            } else {
              extraQuestMessages.push("'포커페이스'가 발동했지만 상대에게 강탈할 카드가 없었어요");
            }
          }
          // 가짜였으면 아무 메시지 없이 조용히 소멸
        }
      }

      // 도미노: 이번 수로 상대 돌을 없애거나 뒤집었으면 한 번 더 놓게 함 (질풍노도와는 별개로 겹쳐서 적용됨)
      // 양보 없음: 예약된 보너스 턴이 있으면 여기서 소모하고 한 번 더 놓게 함 (도미노처럼 정상적으로 카운트됨)
      const noYieldBonusStone = !!state.noYieldBonus[currentPlayer];
      const keepTurnThisMove = stayForSecondStone || dominoBonusTurn || noYieldBonusStone;

      const newStonesPlaced = isRushBonusStone
        ? state.stonesPlaced
        : { ...state.stonesPlaced, [currentPlayer]: state.stonesPlaced[currentPlayer] + 1 };
      const baseState = {
        ...stateAfterCapture,
        board: newBoard,
        stonesPlaced: newStonesPlaced,
        lastMove: { ...state.lastMove, [currentPlayer]: { x, y } },
        blockedCells: { ...state.blockedCells, [currentPlayer]: decayedBlocked },
        watchtowerCells: { ...state.watchtowerCells, [currentPlayer]: decayedWatchtower },
        boardFlipCooldown: { ...state.boardFlipCooldown, [currentPlayer]: decayedBoardFlipCooldown },
        fogTurnsLeft: { ...state.fogTurnsLeft, [currentPlayer]: decayedFogTurnsLeft },
        pokerFacePending: { ...stateAfterCapture.pokerFacePending, [currentPlayer]: decayedPokerFacePending },
        rushSecondStone: newRushSecondStone,
        rushBoosted: newRushBoosted,
        noYieldBonus: { ...stateAfterCapture.noYieldBonus, [currentPlayer]: false },
        forbiddenMessage: [aftershockUsedThisMove ? "상대가 '여진'으로 돌을 지켜냈어요!" : "", ...extraQuestMessages]
          .filter(Boolean)
          .join(" "),
        forbiddenToken:
          aftershockUsedThisMove || extraQuestMessages.length > 0 ? state.forbiddenToken + 1 : state.forbiddenToken,
      };

      if (!isRushBonusStone && newStonesPlaced[currentPlayer] % 4 === 0) {
        // 동전 던지기 실패로 예약된 스킵이면, 카드 없이 이번 증강 선택 타이밍만 넘기고 정상적으로 턴 진행
        if (state.skipNextDraft[currentPlayer]) {
          return {
            ...baseState,
            skipNextDraft: { ...state.skipNextDraft, [currentPlayer]: false },
            currentPlayer: keepTurnThisMove ? currentPlayer : opponent,
          };
        }
        // 도박으로 예약된 스킵이 남아있으면 마찬가지로 이번 증강 선택만 건너뜀
        if (state.gambleSkipRemaining[currentPlayer] > 0) {
          const remaining = state.gambleSkipRemaining[currentPlayer] - 1;
          return {
            ...baseState,
            gambleSkipRemaining: { ...state.gambleSkipRemaining, [currentPlayer]: remaining },
            currentPlayer: keepTurnThisMove ? currentPlayer : opponent,
            forbiddenMessage: "도박 효과로 이번 증강 선택을 건너뛰었어요! (남은 스킵 " + remaining + "회)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }

        const roundIndex = newStonesPlaced[currentPlayer] / 4 - 1;
        const stateForDraft = { ...state, stonesPlaced: newStonesPlaced };
        const { choices, usedAugmentIds, draftTierPlan, differentiated } = buildAugmentChoices(stateForDraft, currentPlayer, roundIndex);
        // 축적: 내가 가진 증강 1개당 이번 증강 선택에서 보너스 리롤 1회씩 (감정으로 강화하면 2회씩)
        const stockpileCard = state.ownedAugments[currentPlayer].find((a) => a.id === "stockpile");
        const bonusRerolls = stockpileCard
          ? state.ownedAugments[currentPlayer].length * (stockpileCard.enhanced ? 2 : 1)
          : 0;
        return {
          ...baseState,
          usedAugmentIds: { ...state.usedAugmentIds, [currentPlayer]: usedAugmentIds },
          draftTierPlan,
          peekedCard: { ...state.peekedCard, [currentPlayer]: null },
          doubleChoicePending: { ...state.doubleChoicePending, [currentPlayer]: false },
          stingyDraft: { ...state.stingyDraft, [currentPlayer]: false },
          conquerorPending: { ...state.conquerorPending, [currentPlayer]: false },
          differentiatedDraftPending: { ...state.differentiatedDraftPending, [currentPlayer]: false },
          augmentSelect: {
            player: currentPlayer,
            choices,
            rerolledSlots: choices.map(() => false),
            differentiated,
            bonusRerollsRemaining: bonusRerolls,
          },
          // currentPlayer는 그대로 둠 - 증강 선택을 다 고른 뒤(PICK_AUGMENT)에 turn 처리
        };
      }

      return { ...baseState, currentPlayer: keepTurnThisMove ? currentPlayer : opponent };
    }

    // 제한시간 초과: 지금 차례인 플레이어를 대신해 무작위 합법 칸(증강/렌주룰 금지자리 제외)에 자동으로 착수시키고
    // 나머지 처리(포위 제거, 승리 판정, 증강 선택 트리거 등)는 CLICK_CELL과 완전히 동일하게 재사용
    case "TIMEOUT": {
      if (state.gameOver || state.augmentSelect || state.pendingTarget) return state;
      const randomCell = pickRandomLegalCell(state, state.currentPlayer);
      if (!randomCell) return state;
      const nextState = gameReducer(state, { type: "CLICK_CELL", x: randomCell.x, y: randomCell.y });
      if (nextState === state) return state;
      if (nextState.forbiddenMessage) return nextState; // 속박/감시탑 등 더 구체적인 메시지가 이미 있으면 그대로 둠
      return {
        ...nextState,
        forbiddenMessage: "⏱ 제한시간 초과! 무작위 칸에 자동으로 착수했어요",
        forbiddenToken: nextState.forbiddenToken + 1,
      };
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

      if (augment.id === "gambleMixed" || augment.id === "gamblePrism1") {
        const ownedIds = state.ownedAugments[player].map((a) => a.id);
        const seenIds = state.usedAugmentIds[player];
        const myColor = colorForPlayer(player, state.roleSwapActive);
        const modeExclude = getModeExcludeIds(state);
        let won;
        if (augment.id === "gambleMixed") {
          // 실버 2개 + 골드 1개 (guaranteed) - 두 뽑기가 서로 겹치지 않도록 먼저 뽑은 실버를 제외 목록에 포함
          const silvers = drawSeveralOfTier("silver", 2, [...ownedIds, "gamble", ...modeExclude], seenIds, myColor);
          const golds = drawSeveralOfTier("gold", 1, [...ownedIds, "gamble", ...modeExclude, ...silvers.map((a) => a.id)], seenIds, myColor);
          won = [...silvers, ...golds];
        } else {
          // 45% 확률로 프리즘 1개, 실패하면 아무것도 못 얻음 (진짜 도박)
          won = Math.random() < 0.45 ? drawSeveralOfTier("prism", 1, [...ownedIds, "gamble"], seenIds, myColor) : [];
        }
        const newOwned = { ...state.ownedAugments, [player]: [...state.ownedAugments[player], ...won] };
        const instantPatch = activateInstantAugments(state, won);
        const wonMessage =
          won.length > 0
            ? (player === 1 ? "흑돌" : "백돌") + "이 도박으로 " + won.map((a) => a.name).join(", ") + " 얻었어요! (다음 증강 선택 2번 스킵)"
            : (player === 1 ? "흑돌" : "백돌") + "이 도박에 실패해서 아무것도 못 얻었어요! (다음 증강 선택 2번 스킵)";
        return {
          ...state,
          ...instantPatch,
          ownedAugments: newOwned,
          usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, ...won.map((a) => a.id)])] },
          gambleSkipRemaining: { ...state.gambleSkipRemaining, [player]: state.gambleSkipRemaining[player] + 2 },
          augmentSelect: null,
          currentPlayer: keepTurn ? player : otherPlayer(player),
          forbiddenMessage: instantPatch.forbiddenMessage ? wonMessage + " " + instantPatch.forbiddenMessage : wonMessage,
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
        // 다음 회차의 등급을 여기서 미리 확정(먼저 뽑은 사람이 없었으면 새로 뽑아서 draftTierPlan에 고정)해서
        // 예약 카드도 그 등급 안에서만 뽑히게 함 - 안 그러면 실버 카드인 먼저 보기로 프리즘을 확정해버리는
        // 회차 등급 동기화 무력화 버그가 생김
        const nextRoundIndex = Math.floor(state.stonesPlaced[player] / 4);
        const { roundTier, newTierPlan } = resolveRoundTier(state, nextRoundIndex);
        // 정복자가 이미 발동돼 있으면(달성 직후 먼저 보기를 고른 경우) 예약 카드도 프리즘 안에서 뽑음
        const effectiveRoundTier = state.conquerorPending[player] ? "prism" : roundTier;
        const guaranteed = drawOneOfTier(
          effectiveRoundTier,
          [...ownedIdsAfter, ...stageExcludeIds, ...getModeExcludeIds(state)],
          seenIds,
          colorForPlayer(player, state.roleSwapActive)
        );
        patch.draftTierPlan = newTierPlan;
        if (guaranteed) {
          patch.peekedCard = { ...state.peekedCard, [player]: guaranteed };
          patch.usedAugmentIds = { ...state.usedAugmentIds, [player]: [...seenIds, guaranteed.id] };
          patch.forbiddenMessage = "먼저 보기: '" + guaranteed.name + "' 카드가 다음 증강 선택에 확정으로 나와요!";
          patch.forbiddenToken = state.forbiddenToken + 1;
        }
      }
      if (augment.id === "doubleChoice") {
        patch.doubleChoicePending = { ...state.doubleChoicePending, [player]: true };
      }
      patch = { ...patch, ...activateInstantAugments(state, [augment]) };

      // 시작 증강(0수, 착수 전) 선택 - 흑돌이 고르면 곧바로 백돌의 시작 증강 선택으로 넘어가고,
      // 백돌까지 다 고르면 그때 비로소 실제 게임이 시작됨(흑돌부터 착수)
      if (state.augmentSelect.isStartDraft) {
        const stateAfterPick = { ...state, ...patch, ownedAugments: newOwned };
        if (player === 1) {
          return { ...stateAfterPick, ...buildStartAugmentChoices(stateAfterPick, 2) };
        }
        return { ...stateAfterPick, augmentSelect: null, currentPlayer: 1 };
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
      if (!state.augmentSelect || state.augmentSelect.isGamble) return state;
      const alreadyRerolled = state.augmentSelect.rerolledSlots[index];
      const bonusRemaining = state.augmentSelect.bonusRerollsRemaining || 0;
      if (alreadyRerolled && bonusRemaining <= 0) return state;

      const player = state.augmentSelect.player;
      const currentCard = state.augmentSelect.choices[index];
      const otherShownIds = state.augmentSelect.choices.filter((_, i) => i !== index).map((c) => c.id);
      const ownedIds = state.ownedAugments[player].map((a) => a.id);
      const stageExcludeIds = getStageExcludeIds(state, player);
      // 저울질로 상대 카드를 제외한 증강 선택이었으면, 리롤도 같은 제한을 유지
      const opponentOwnedIds = state.augmentSelect.differentiated
        ? state.ownedAugments[otherPlayer(player)].map((a) => a.id)
        : [];
      const seenIds = state.usedAugmentIds[player];

      // 리롤은 같은 등급 안에서만 다른 카드로 바뀜 (등급 조합 자체는 그대로 유지)
      const newCard = drawOneOfTier(
        currentCard.tier,
        [...otherShownIds, ...ownedIds, ...opponentOwnedIds, ...stageExcludeIds, ...getModeExcludeIds(state), currentCard.id],
        seenIds,
        colorForPlayer(player, state.roleSwapActive)
      );
      if (!newCard) return state;

      const newChoices = state.augmentSelect.choices.slice();
      newChoices[index] = newCard;
      const newRerolledSlots = state.augmentSelect.rerolledSlots.slice();
      // 축적 보너스: 이미 한 번 리롤한 슬롯을 또 리롤하는 거면 보너스 풀에서 소모
      const usingBonus = alreadyRerolled;
      if (!usingBonus) newRerolledSlots[index] = true;

      return {
        ...state,
        usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, newCard.id])] },
        augmentSelect: {
          ...state.augmentSelect,
          choices: newChoices,
          rerolledSlots: newRerolledSlots,
          bonusRerollsRemaining: usingBonus ? bonusRemaining - 1 : bonusRemaining,
        },
      };
    }

    // 즉시 타겟팅이 필요 없는 증강을 원할 때 사용
    case "USE_ABILITY": {
      const { player, ability } = action;
      if (state.gameOver || state.augmentSelect || state.pendingTarget) return state;
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

      const ownedIds = getActiveAugmentIds(state, player);
      if (!ownedIds.includes(ability)) return state;
      if (state.oneTimeUsed[player]?.[ability]) return state;

      const opponent = otherPlayer(player);

      if (ability === "removeStone") {
        return { ...state, pendingTarget: { player, kind: "removeStone", need: 1, selected: [] } };
      }

      if (ability === "watchtower") {
        return { ...state, pendingTarget: { player, kind: "watchtower", need: 1, selected: [] } };
      }

      if (ability === "ultimatum") {
        return { ...state, pendingTarget: { player, kind: "ultimatum", need: 1, selected: [] } };
      }

      if (ability === "jailbreak") {
        return { ...state, pendingTarget: { player, kind: "jailbreak", need: 1, selected: [] } };
      }

      if (ability === "relocate") {
        return { ...state, pendingTarget: { player, kind: "relocate", need: 1, selected: [], sourceCell: null } };
      }

      if (ability === "plague") {
        return { ...state, pendingTarget: { player, kind: "plague", need: 1, selected: [] } };
      }

      if (ability === "collapse") {
        return { ...state, pendingTarget: { player, kind: "collapse", need: 1, selected: [] } };
      }

      if (ability === "fog") {
        const fogImmunity = checkImmunity(state, opponent);
        if (fogImmunity.immune) {
          return {
            ...state,
            oneTimeUsed: applyImmunityConsumption(markUsed(state, player, "fog"), opponent, fogImmunity.reason),
            forbiddenMessage: immunityMessage(fogImmunity.reason),
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return {
          ...state,
          fogTurnsLeft: { ...state.fogTurnsLeft, [opponent]: 3 },
          oneTimeUsed: markUsed(state, player, "fog"),
          forbiddenMessage: "'안개'로 상대 시야를 3턴 동안 가렸어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      // 포커페이스: 상대에게는 정체를 알 수 없는 경고 문구만 뜨고(진짜/가짜 동일), 결과는 본인 화면에만 즉시 공개됨
      // (pokerFacePending을 owner 전용으로 렌더링하는 건 AugmentPanel/app 쪽 책임 - peekedCard와 같은 패턴)
      // 면역(철옹성/부적)은 체크하지 않음 - 두 카드 설명 문구에 "강탈 효과를 막아준다"는 언급이 없어서 의도적으로 제외
      if (ability === "pokerFace") {
        const isReal = Math.random() < 1 / 3;
        return {
          ...state,
          pokerFacePending: { ...state.pokerFacePending, [player]: { turnsLeft: 3, real: isReal } },
          oneTimeUsed: markUsed(state, player, "pokerFace"),
          forbiddenMessage: (player === 1 ? "흑돌" : "백돌") + "이 '포커페이스'를 사용했어요. 무언가 조짐이 보입니다...",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "discard") {
        const eligibleDiscard = state.ownedAugments[player].filter((a) => a.id !== "discard");
        if (eligibleDiscard.length === 0) {
          return {
            ...state,
            forbiddenMessage: "파기: 버릴 수 있는 다른 증강이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return { ...state, pendingTarget: { player, kind: "discard", need: 1, selected: [] } };
      }

      if (ability === "appraisal") {
        const eligibleAppraisal = state.ownedAugments[player].filter(
          (a) => ENHANCEABLE_AUGMENT_IDS.includes(a.id) && !a.enhanced
        );
        if (eligibleAppraisal.length === 0) {
          return {
            ...state,
            forbiddenMessage: "감정: 강화할 수 있는 증강이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return { ...state, pendingTarget: { player, kind: "appraisal", need: 1, selected: [] } };
      }

      if (ability === "raid") {
        const immunity = checkImmunity(state, opponent);
        if (immunity.immune) {
          return {
            ...state,
            oneTimeUsed: applyImmunityConsumption(markUsed(state, player, "raid"), opponent, immunity.reason),
            forbiddenMessage: immunityMessage(immunity.reason),
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const opponentColorForRaid = colorForPlayer(opponent, state.roleSwapActive);
        const opponentStones = [];
        for (let yy = 0; yy < BOARD_SIZE; yy++) {
          for (let xx = 0; xx < BOARD_SIZE; xx++) {
            if (state.board[yy][xx] === opponentColorForRaid) opponentStones.push({ x: xx, y: yy });
          }
        }
        const targets = pickRandom(opponentStones, Math.min(2, opponentStones.length));
        const newBoard = state.board.map((row) => row.slice());
        for (const t of targets) newBoard[t.y][t.x] = 0;
        const survivorPatch = targets.length > 0 ? triggerSurvivorQuestIfNeeded(state, opponent) : null;
        const stateAfterSurvivor = survivorPatch ? { ...state, ...survivorPatch } : state;
        return {
          ...stateAfterSurvivor,
          board: newBoard,
          oneTimeUsed: markUsed(stateAfterSurvivor, player, "raid"),
          currentPlayer: opponent,
          forbiddenMessage:
            (survivorPatch ? survivorPatch.forbiddenMessage + " " : "") + "'습격'으로 상대 돌 " + targets.length + "개를 제거했어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "lockdown") {
        const usedPatch = { ...state.oneTimeUsed[opponent] };
        for (const owned of state.ownedAugments[opponent]) {
          if (ONE_TIME_ABILITY_IDS.includes(owned.id)) usedPatch[owned.id] = true;
        }
        let newOneTimeUsed = markUsed(state, player, "lockdown");
        newOneTimeUsed = { ...newOneTimeUsed, [opponent]: usedPatch };
        return {
          ...state,
          oneTimeUsed: newOneTimeUsed,
          forbiddenMessage: "'봉인'으로 상대의 남은 1회용 효과를 전부 막았어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "oracle") {
        const nextRoundIndex = Math.floor(state.stonesPlaced[player] / 4);
        const newTierPlan = state.draftTierPlan.slice();
        newTierPlan[nextRoundIndex] = "prism";
        return {
          ...state,
          draftTierPlan: newTierPlan,
          oneTimeUsed: markUsed(state, player, "oracle"),
          forbiddenMessage: "'신탁'으로 다음 증강 선택 등급이 프리즘으로 확정됐어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "boardFlip") {
        // 1회용이 아니라 재사용 대기시간(쿨다운) 방식 - 대기 중이면 카드는 소모하지 않고 안내만 띄움
        if (state.boardFlipCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'판 뒤엎기'는 아직 재사용 대기 중이에요 (" + state.boardFlipCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const myColorForFlip = colorForPlayer(player, state.roleSwapActive);
        const newBoard = state.board.map((row) => row.slice());
        let count = 0;
        for (let yy = 0; yy < BOARD_SIZE; yy++) {
          for (let xx = 0; xx < BOARD_SIZE; xx++) {
            if (newBoard[yy][xx] === myColorForFlip) {
              newBoard[yy][xx] = 0;
              count++;
            }
          }
        }
        const emptyCells = [];
        for (let yy = 0; yy < BOARD_SIZE; yy++) {
          for (let xx = 0; xx < BOARD_SIZE; xx++) {
            if (newBoard[yy][xx] === 0) emptyCells.push({ x: xx, y: yy });
          }
        }
        const spots = pickRandom(emptyCells, Math.min(count, emptyCells.length));
        for (const s of spots) newBoard[s.y][s.x] = myColorForFlip;
        return {
          ...state,
          board: newBoard,
          lastMove: { ...state.lastMove, [player]: null },
          boardFlipCooldown: { ...state.boardFlipCooldown, [player]: 6 },
          forbiddenMessage: "'판 뒤엎기'로 돌이 전부 무작위로 재배치됐어요! (재사용까지 6수)",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

      if (ability === "wipeout") {
        return {
          ...state,
          board: createEmptyBoard(),
          lastMove: { 1: null, 2: null },
          oneTimeUsed: markUsed(state, player, "wipeout"),
          forbiddenMessage: "'백지화'로 판 위의 돌이 전부 사라졌어요! (증강과 진행 수는 그대로예요)",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

      if (ability === "bind") {
        return {
          ...state,
          bindSkip: { ...state.bindSkip, [opponent]: true },
          oneTimeUsed: markUsed(state, player, "bind"),
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

      if (ability === "stinginess") {
        return {
          ...state,
          stingyDraft: { ...state.stingyDraft, [opponent]: true },
          oneTimeUsed: markUsed(state, player, "stinginess"),
        };
      }

      if (ability === "leverage") {
        if (state.ownedAugments[player].length >= state.ownedAugments[opponent].length) {
          return {
            ...state,
            forbiddenMessage: "저울질은 내 증강 수가 상대보다 적을 때만 쓸 수 있어요",
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
        const myColorForBarter = colorForPlayer(player, state.roleSwapActive);
        const prismPool = AUGMENTS.filter(
          (a) => a.tier === "prism" && matchesColor(a, myColorForBarter) && !state.ownedAugments[player].some((o) => o.id === a.id)
        );
        if (prismPool.length === 0) {
          return {
            ...state,
            oneTimeUsed: { ...state.oneTimeUsed, [player]: usedPatch },
            forbiddenMessage: "거래: 이미 프리즘 증강을 전부 가지고 있어서 아무 일도 일어나지 않았어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const [bonus] = pickRandom(prismPool, 1);
        const barterInstantPatch = activateInstantAugments(state, [bonus]);
        const barterMessage = "거래 완료! 남은 1회용 카드를 전부 넘기고 '" + bonus.name + "' 획득!";
        return {
          ...state,
          ...barterInstantPatch,
          ownedAugments: { ...state.ownedAugments, [player]: [...state.ownedAugments[player], bonus] },
          usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...state.usedAugmentIds[player], bonus.id])] },
          oneTimeUsed: { ...state.oneTimeUsed, [player]: usedPatch },
          forbiddenMessage: barterInstantPatch.forbiddenMessage ? barterMessage + " " + barterInstantPatch.forbiddenMessage : barterMessage,
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "coinFlip") {
        const used = markUsed(state, player, "coinFlip");
        if (Math.random() < 0.5) {
          const ownedIdsAfter = [...state.ownedAugments[player].map((a) => a.id), ...getModeExcludeIds(state)];
          const seenIds = state.usedAugmentIds[player];
          const [bonus] = drawFromPool(ownedIdsAfter, seenIds, 1, colorForPlayer(player, state.roleSwapActive));
          if (!bonus) {
            return {
              ...state,
              oneTimeUsed: used,
              forbiddenMessage: "동전 던지기: 뽑을 카드가 남지 않아서 아무 일도 일어나지 않았어요",
              forbiddenToken: state.forbiddenToken + 1,
            };
          }
          const coinInstantPatch = activateInstantAugments(state, [bonus]);
          const coinMessage = "동전 던지기 성공! '" + bonus.name + "' 획득!";
          return {
            ...state,
            ...coinInstantPatch,
            ownedAugments: { ...state.ownedAugments, [player]: [...state.ownedAugments[player], bonus] },
            usedAugmentIds: { ...state.usedAugmentIds, [player]: [...seenIds, bonus.id] },
            oneTimeUsed: used,
            forbiddenMessage: coinInstantPatch.forbiddenMessage ? coinMessage + " " + coinInstantPatch.forbiddenMessage : coinMessage,
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return {
          ...state,
          skipNextDraft: { ...state.skipNextDraft, [player]: true },
          oneTimeUsed: used,
          forbiddenMessage: "동전 던지기 실패... 다음 증강 선택을 건너뛰게 됐어요",
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
        let newStonesPlaced = { ...state.stonesPlaced, [opponent]: state.stonesPlaced[opponent] - 1 };
        let newLastMove = { ...state.lastMove, [opponent]: null };
        let newOneTimeUsed = markUsed(state, player, "undo");
        let counterMessage = "";

        // 맞불: 무르기를 당한 쪽이 맞불을 갖고 있으면, 자동으로 공격자의 마지막 수도 같이 무름
        const victimOwnedIds = state.ownedAugments[opponent].map((a) => a.id);
        if (victimOwnedIds.includes("counterStrike") && !state.oneTimeUsed[opponent]?.counterStrike) {
          const attackerLast = state.lastMove[player];
          if (attackerLast && newBoard[attackerLast.y][attackerLast.x] === colorForPlayer(player, state.roleSwapActive)) {
            newBoard[attackerLast.y][attackerLast.x] = 0;
            newStonesPlaced = { ...newStonesPlaced, [player]: newStonesPlaced[player] - 1 };
            newLastMove = { ...newLastMove, [player]: null };
            counterMessage = "상대가 '맞불'로 내 마지막 수도 같이 무르기 당했어요!";
          }
          newOneTimeUsed = { ...newOneTimeUsed, [opponent]: { ...newOneTimeUsed[opponent], counterStrike: true } };
        }

        return {
          ...state,
          board: newBoard,
          stonesPlaced: newStonesPlaced,
          lastMove: newLastMove,
          oneTimeUsed: newOneTimeUsed,
          currentPlayer: opponent,
          forbiddenMessage: counterMessage,
          forbiddenToken: counterMessage ? state.forbiddenToken + 1 : state.forbiddenToken,
        };
      }

      return state;
    }

    // 금지 구역 / 영구 봉쇄 / 돌 제거 / 감시탑 / 최후통첩 / 도장깨기 / 재배치 / 역병 / 붕괴의 칸(또는 상대 돌) 선택
    case "TARGET_CELL": {
      const { x, y } = action;
      if (!state.pendingTarget) return state;
      const { player, kind, need, selected } = state.pendingTarget;
      const opponent = otherPlayer(player);
      const immunity = checkImmunity(state, opponent);
      const playerColor = colorForPlayer(player, state.roleSwapActive);
      const opponentColor = colorForPlayer(opponent, state.roleSwapActive);

      if (kind === "removeStone") {
        if (state.board[y][x] !== opponentColor) return state;
        const aftershockActive = !immunity.immune && hasAftershockShield(state, opponent);
        const actuallyRemoved = !immunity.immune && !aftershockActive;
        const newBoard = state.board.map((row) => row.slice());
        if (actuallyRemoved) newBoard[y][x] = 0;

        const survivorPatch = actuallyRemoved ? triggerSurvivorQuestIfNeeded(state, opponent) : null;
        const workingState = survivorPatch ? { ...state, ...survivorPatch } : state;

        let newOneTimeUsed = applyImmunityConsumption(markUsed(workingState, player, "removeStone"), opponent, immunity.reason);
        let extraMessage = "";
        if (aftershockActive) {
          newOneTimeUsed = { ...newOneTimeUsed, [opponent]: { ...newOneTimeUsed[opponent], aftershock: true } };
          extraMessage = "상대가 '여진'으로 돌을 지켜냈어요!";
        }

        // 맞불: 제거가 실제로 성공했고 피해자가 맞불을 갖고 있으면 자동으로 공격자 돌도 하나 제거
        let counterMessage = "";
        if (actuallyRemoved) {
          const victimOwnedIds = workingState.ownedAugments[opponent].map((a) => a.id);
          if (victimOwnedIds.includes("counterStrike") && !workingState.oneTimeUsed[opponent]?.counterStrike) {
            const attackerLast = workingState.lastMove[player];
            if (attackerLast && newBoard[attackerLast.y][attackerLast.x] === playerColor) {
              newBoard[attackerLast.y][attackerLast.x] = 0;
              counterMessage = " 상대가 '맞불'로 내 돌도 같이 제거했어요!";
            }
            newOneTimeUsed = { ...newOneTimeUsed, [opponent]: { ...newOneTimeUsed[opponent], counterStrike: true } };
          }
        }

        return {
          ...workingState,
          board: newBoard,
          pendingTarget: null,
          oneTimeUsed: newOneTimeUsed,
          forbiddenMessage: immunity.immune
            ? immunityMessage(immunity.reason)
            : (survivorPatch ? survivorPatch.forbiddenMessage + " " : "") + extraMessage + counterMessage,
          forbiddenToken:
            immunity.immune || extraMessage || counterMessage || survivorPatch ? state.forbiddenToken + 1 : state.forbiddenToken,
          // 면역/여진에 막히면 카드만 소모되고 내 턴은 유지 (돌은 정상적으로 놓을 수 있음)
          currentPlayer: immunity.immune || aftershockActive ? player : opponent,
        };
      }

      if (kind === "watchtower") {
        if (state.board[y][x] !== 0) return state;
        const ambushPatch = !immunity.immune ? triggerAmbushIfNeeded(state, opponent) || {} : {};
        const watchtowerCard = state.ownedAugments[player].find((a) => a.id === "watchtower");
        const watchtowerWindow = watchtowerCard?.enhanced ? 6 : 4;
        return {
          ...state,
          ...ambushPatch,
          pendingTarget: null,
          watchtowerCells: immunity.immune
            ? state.watchtowerCells
            : { ...state.watchtowerCells, [opponent]: [...state.watchtowerCells[opponent], { x, y, turnsLeft: watchtowerWindow }] },
          oneTimeUsed: applyImmunityConsumption(
            ambushPatch.oneTimeUsed ? { ...markUsed(state, player, "watchtower"), [opponent]: ambushPatch.oneTimeUsed[opponent] } : markUsed(state, player, "watchtower"),
            opponent,
            immunity.reason
          ),
          forbiddenMessage: immunity.immune ? immunityMessage(immunity.reason) : "",
          forbiddenToken: immunity.immune ? state.forbiddenToken + 1 : state.forbiddenToken,
          currentPlayer: immunity.immune ? player : opponent,
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

      if (kind === "jailbreak") {
        const inBanZone = state.blockedCells[player].some((c) => c.x === x && c.y === y);
        const inPermaBlock = state.permaBlockedCells[player].some((c) => c.x === x && c.y === y);
        const inWatchtower = state.watchtowerCells[player].some((c) => c.x === x && c.y === y);
        if (!inBanZone && !inPermaBlock && !inWatchtower) return state;
        return {
          ...state,
          pendingTarget: null,
          blockedCells: inBanZone
            ? { ...state.blockedCells, [player]: state.blockedCells[player].filter((c) => !(c.x === x && c.y === y)) }
            : state.blockedCells,
          permaBlockedCells: inPermaBlock
            ? { ...state.permaBlockedCells, [player]: state.permaBlockedCells[player].filter((c) => !(c.x === x && c.y === y)) }
            : state.permaBlockedCells,
          watchtowerCells: inWatchtower
            ? { ...state.watchtowerCells, [player]: state.watchtowerCells[player].filter((c) => !(c.x === x && c.y === y)) }
            : state.watchtowerCells,
          oneTimeUsed: markUsed(state, player, "jailbreak"),
          forbiddenMessage: "'도장깨기'로 막힌 자리를 하나 풀었어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (kind === "relocate") {
        if (!state.pendingTarget.sourceCell) {
          if (state.board[y][x] !== playerColor) return state;
          return { ...state, pendingTarget: { ...state.pendingTarget, sourceCell: { x, y } } };
        }
        const src = state.pendingTarget.sourceCell;
        const isAdjacent = Math.abs(x - src.x) <= 1 && Math.abs(y - src.y) <= 1 && !(x === src.x && y === src.y);
        if (state.board[y][x] !== 0 || !isAdjacent) return state;
        const newBoard = state.board.map((row) => row.slice());
        newBoard[src.y][src.x] = 0;
        newBoard[y][x] = playerColor;
        return {
          ...state,
          board: newBoard,
          lastMove: { ...state.lastMove, [player]: { x, y } },
          pendingTarget: null,
          oneTimeUsed: markUsed(state, player, "relocate"),
          currentPlayer: opponent,
        };
      }

      if (kind === "plague") {
        if (state.board[y][x] !== opponentColor) return state;
        const actuallyRemoved = !immunity.immune;
        const newBoard = state.board.map((row) => row.slice());
        if (actuallyRemoved) newBoard[y][x] = 0;
        const survivorPatch = actuallyRemoved ? triggerSurvivorQuestIfNeeded(state, opponent) : null;
        const workingState = survivorPatch ? { ...state, ...survivorPatch } : state;
        return {
          ...workingState,
          board: newBoard,
          pendingTarget: null,
          deadCells: immunity.immune ? state.deadCells : [...state.deadCells, { x, y }],
          oneTimeUsed: applyImmunityConsumption(markUsed(workingState, player, "plague"), opponent, immunity.reason),
          forbiddenMessage: immunity.immune ? immunityMessage(immunity.reason) : survivorPatch ? survivorPatch.forbiddenMessage : "",
          forbiddenToken: immunity.immune || survivorPatch ? state.forbiddenToken + 1 : state.forbiddenToken,
          currentPlayer: immunity.immune ? player : opponent,
        };
      }

      if (kind === "collapse") {
        // 철옹성/부적을 가진 상대의 돌은 이 3x3 범위 안에 있어도 지켜짐 (내 자신의 돌은 자폭이라 면역과 무관하게 그대로 사라짐)
        const newBoard = state.board.map((row) => row.slice());
        let blockedAny = false;
        let selfRemovedAny = false;
        let oppRemovedAny = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cx = x + dx;
            const cy = y + dy;
            if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) continue;
            if (newBoard[cy][cx] === opponentColor && immunity.immune) {
              blockedAny = true;
              continue;
            }
            if (newBoard[cy][cx] === playerColor) selfRemovedAny = true;
            else if (newBoard[cy][cx] === opponentColor) oppRemovedAny = true;
            newBoard[cy][cx] = 0;
          }
        }
        const selfSurvivorPatch = selfRemovedAny ? triggerSurvivorQuestIfNeeded(state, player) : null;
        let workingState = selfSurvivorPatch ? { ...state, ...selfSurvivorPatch } : state;
        const oppSurvivorPatch = oppRemovedAny ? triggerSurvivorQuestIfNeeded(workingState, opponent) : null;
        if (oppSurvivorPatch) workingState = { ...workingState, ...oppSurvivorPatch };
        const questMessage = [selfSurvivorPatch?.forbiddenMessage, oppSurvivorPatch?.forbiddenMessage].filter(Boolean).join(" ");
        return {
          ...workingState,
          board: newBoard,
          pendingTarget: null,
          oneTimeUsed: applyImmunityConsumption(markUsed(workingState, player, "collapse"), opponent, immunity.reason),
          forbiddenMessage: blockedAny
            ? immunityMessage(immunity.reason)
            : "'붕괴'로 3x3 구역이 사라졌어요!" + (questMessage ? " " + questMessage : ""),
          forbiddenToken: state.forbiddenToken + 1,
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

        const ambushPatch = triggerAmbushIfNeeded(state, opponent) || {};

        if (kind === "banZone") {
          const banZoneCard = state.ownedAugments[player].find((a) => a.id === "banZone");
          const banZoneTurns = banZoneCard?.enhanced ? 3 : 2;
          const additions = newSelected.map((c) => ({ ...c, turnsLeft: banZoneTurns }));
          return {
            ...state,
            ...ambushPatch,
            pendingTarget: null,
            blockedCells: { ...state.blockedCells, [opponent]: [...state.blockedCells[opponent], ...additions] },
            currentPlayer: nextPlayer,
          };
        }

        return {
          ...state,
          ...ambushPatch,
          pendingTarget: null,
          permaBlockedCells: { ...state.permaBlockedCells, [opponent]: [...state.permaBlockedCells[opponent], ...newSelected] },
          currentPlayer: nextPlayer,
        };
      }

      return state;
    }

    // 파기(discard)/감정(appraisal): 보드 칸이 아니라 "내가 보유한 증강 카드 하나"를 대상으로 고르는 액션
    case "PICK_CARD_TARGET": {
      const { augmentId } = action;
      if (!state.pendingTarget) return state;
      const { player, kind } = state.pendingTarget;
      if (kind !== "discard" && kind !== "appraisal") return state;

      const ownedList = state.ownedAugments[player];
      const idx = ownedList.findIndex((a) => a.id === augmentId);
      if (idx === -1) return state;
      const targetCard = ownedList[idx];

      if (kind === "discard") {
        if (targetCard.id === "discard") {
          return {
            ...state,
            forbiddenMessage: "파기 카드 자신은 대상으로 고를 수 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const remainingOwnedIds = ownedList.filter((_, i) => i !== idx).map((a) => a.id);
        const seenIds = state.usedAugmentIds[player];
        const newCard = drawOneOfTier(
          targetCard.tier,
          [...remainingOwnedIds, ...getModeExcludeIds(state)],
          seenIds,
          colorForPlayer(player, state.roleSwapActive)
        );
        if (!newCard) {
          return {
            ...state,
            forbiddenMessage: "파기: 새로 뽑을 카드가 남지 않아서 아무 일도 일어나지 않았어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const newOwnedList = ownedList.slice();
        newOwnedList[idx] = newCard;
        return {
          ...state,
          ownedAugments: { ...state.ownedAugments, [player]: newOwnedList },
          usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, newCard.id])] },
          pendingTarget: null,
          oneTimeUsed: markUsed(state, player, "discard"),
          forbiddenMessage: "'파기'로 '" + targetCard.name + "'을(를) 버리고 '" + newCard.name + "'을(를) 얻었어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      // appraisal
      if (!ENHANCEABLE_AUGMENT_IDS.includes(targetCard.id) || targetCard.enhanced) {
        return {
          ...state,
          forbiddenMessage: "감정: 이 증강은 강화할 수 없어요",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }
      const enhanced = enhanceAugment(targetCard);
      const enhancedOwnedList = ownedList.slice();
      enhancedOwnedList[idx] = enhanced;
      return {
        ...state,
        ownedAugments: { ...state.ownedAugments, [player]: enhancedOwnedList },
        pendingTarget: null,
        oneTimeUsed: markUsed(state, player, "appraisal"),
        forbiddenMessage: "'감정'으로 '" + targetCard.name + "'을(를) '" + enhanced.name + "'(으)로 강화했어요!",
        forbiddenToken: state.forbiddenToken + 1,
      };
    }

    case "CLEAR_FORBIDDEN":
      return { ...state, forbiddenMessage: "" };

    // 재도전: 게임이 끝났을 때만 누를 수 있고, 흑돌/백돌 둘 다 눌러야 실제로 새 판이 시작됨
    case "REQUEST_REMATCH": {
      const { player } = action;
      if (!state.gameOver) return state;
      const newRequested = { ...state.rematchRequested, [player]: true };
      if (newRequested[1] && newRequested[2]) {
        // 재도전이 성사될 때마다 흑/백을 서로 바꿔서 시작 (온라인 모드: 물리적 플레이어와 논리적 색의 매핑을 뒤집음)
        return { ...initialGameState(state.isOnlineMode), colorFlipped: !state.colorFlipped };
      }
      return { ...state, rematchRequested: newRequested };
    }

    default:
      return state;
  }
}
