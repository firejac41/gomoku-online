// 로컬 모드/온라인 모드가 공유하는 게임 상태 리듀서
// 순수 함수라서 온라인 모드에서는 Supabase에 저장할 "다음 상태"를 계산하는 용도로도 그대로 재사용 가능

import {
  BOARD_SIZE,
  createEmptyBoard,
  checkWin,
  isForbiddenMove,
  checkTerritoryWin,
  checkFrameWin,
  isBoardEffectivelyFull,
  countStones,
  hasThreeOrMoreInARow,
  countOpenThrees,
  getEffectiveAugmentIds,
  findCaptures,
  getRingBounds,
  isOutsideRing,
  pickRandomRingTarget,
  getCellsCrushedByRingShrink,
  isCheckerboardBlocked,
  colorForPlayer,
  AUGMENTS,
  GAMBLE_OPTIONS,
  ONE_TIME_ABILITY_IDS,
  ONLINE_ONLY_IDS,
  ENHANCEABLE_AUGMENT_IDS,
  enhanceAugment,
  pickRandom,
  findIsolatedStones,
  findBreezeDestinations,
  findSaltEligibleCells,
} from "./gomokuEngine";

export function initialGameState(isOnlineMode = false) {
  const base = {
    isOnlineMode, // 안개(fog)처럼 온라인 전용 증강을 로컬 뽑기 풀에서 걸러내는 데 씀 (게임 로직 자체와는 무관)
    board: createEmptyBoard(),
    currentPlayer: 1,
    gameOver: false,
    winMessage: "",
    winnerPlayer: null, // 승리한 신원(1|2) - 무승부/물량전 무승자면 null. 재도전 시 "진 쪽이 색 선택" 기능에 씀
    pendingRematchColor: null, // 재도전 화면에서 진 쪽이 고른 다음 판 색(1|2) - 양쪽 다 확정되는 순간 소비됨
    stonesPlaced: { 1: 0, 2: 0 },
    ownedAugments: { 1: [], 2: [] },
    usedAugmentIds: { 1: [], 2: [] }, // 그 플레이어에게 이미 보여준(선택 안 했어도) 증강 id들 - 다시 안 나오게 제외용
    forbiddenMessage: "",
    forbiddenToken: 0,
    augmentSelect: null, // { player, choices: [augment,...], rerolledSlots: [bool,...], differentiated, isGamble?, bonusRerollsRemaining, isStartDraft? }
    draftTierPlan: [], // 회차별 등급(그 회차는 카드 전부 같은 등급) - 양쪽 플레이어가 같은 회차엔 같은 등급을 받도록 공유
    startDraftTier: null, // 시작 증강(0수, 착수 전) 회차 등급 - 양쪽이 같은 등급 3장을 받도록 draftTierPlan과 별개로 공유

    oneTimeUsed: { 1: {}, 2: {} }, // { removeStone:true, undo:true, selfUndo:true, revive:true, ... }
    lastMove: { 1: null, 2: null }, // 각 플레이어가 마지막으로 놓은 좌표 {x,y}
    blockedCells: { 1: [], 2: [] }, // 이 플레이어가 못 놓는 칸: [{x,y,turnsLeft}] (금지구역)
    permaBlockedCells: { 1: [], 2: [] }, // 이 플레이어가 영원히 못 놓는 칸: [{x,y}] (영구봉쇄)
    deadCells: [], // 역병으로 죽은 칸: [{x,y}] (양쪽 다 영원히 착수 불가)
    prisonActive: false, // 교도소 - 한 번 켜지면 게임이 끝날 때까지 양쪽의 프리즘 효과가 전부 비활성화
    // 링 위에서 싸우자의 축소 시계 전용 카운터 - 실제로 보드에 새 돌이 놓일 때마다(질풍노도 보너스 착수 포함)
    // 1씩 늘어나고 절대 줄어들지 않음. stonesPlaced(증강 선택 타이밍용)는 그 보너스 착수를 일부러 안 세서
    // 링이 실제보다 느리게 좁혀지는 문제가 있었고, 그렇다고 "보드 위 돌 총 개수"를 바로 쓰면
    // 포위 제거·습격·무르기 등으로 돌이 사라질 때 링이 도로 넓어지는 새 버그가 생겨서, 둘 다와 무관한 전용 카운터를 둠
    placementClock: 0,
    ringActive: false, // 링 위에서 싸우자 - 한 번 켜지면 게임이 끝날 때까지 판이 좁혀들며, 양쪽 모두에게 적용
    ringStartMove: null, // 링이 발동된 시점의 placementClock 값 (getRingBounds 계산 기준)
    ringTarget: null, // 최종적으로 좁혀질 8x8 박스의 좌상단 좌표 {minX,minY} - 발동 즉시 무작위로 정해지고 양쪽에 바로 공개됨
    chaosActive: false, // 폭주 - 한 번 켜지면 게임이 끝날 때까지 양쪽 모두 클릭 위치 무시하고 무작위 칸에 착수, 액티브 능력도 못 씀
    roleSwapActive: false, // 입장 바꿔 생각하기 - 한 번 켜지면 게임이 끝날 때까지 보드에 그려지는 돌 색이 서로 뒤바뀜 (실제 소유권/로직은 그대로, 겉모습만 반전)
    rushSecondStone: { 1: false, 2: false }, // 질풍노도 보유 시, 지금이 "부스트 턴"의 2번째 돌을 아직 안 놨는지
    rushBoosted: { 1: false, 2: false }, // 질풍노도 보유 시, 다음(또는 지금) 턴이 2개 놓는 "부스트 턴"인지 - 2턴에 1번만 true
    peekedCard: { 1: null, 2: null }, // 먼저 보기로 예약해 둔 다음 증강 선택 확정 카드
    doubleChoicePending: { 1: false, 2: false }, // 더블 초이스 - 다음 증강 선택만 4장
    skipNextDraft: { 1: false, 2: false }, // 동전 던지기 실패 - 다음 증강 선택 발생 시 카드 안 보여주고 그냥 넘어감
    gambleSkipRemaining: { 1: 0, 2: 0 }, // 도박으로 인해 건너뛸 남은 증강 선택 횟수
    bindSkip: { 1: false, 2: false }, // 속박 - 이 플레이어의 다음 턴을 통째로 건너뜀
    conquerorPending: { 1: false, 2: false }, // 정복자 퀘스트 달성 - 달성한 이 플레이어만의 다음 증강 선택 등급을 프리즘으로 확정 (draftTierPlan은 공유값이라 안 건드림, 상대는 영향 없음)
    differentiatedDraftPending: { 1: false, 2: false }, // 저울질 - 다음 증강 선택에서 상대가 가진 증강 제외
    watchtowerCells: { 1: [], 2: [] }, // 이 플레이어에게 세워진 감시탑: [{x,y,turnsLeft}] (둘 다 볼 수 있음)
    boardFlipCooldown: { 1: 0, 2: 0 }, // 판 뒤엎기 재사용 대기시간(남은 수) - 0이면 바로 사용 가능, 사용하면 6으로 리셋
    removeStoneCooldown: { 1: 0, 2: 0 }, // 돌 제거 재사용 대기시간 - 사용하면 5로 리셋
    selfUndoCooldown: { 1: 0, 2: 0 }, // 직전 무르기 재사용 대기시간 - 사용하면 4로 리셋
    jailbreakCooldown: { 1: 0, 2: 0 }, // 도장깨기 재사용 대기시간 - 사용하면 5로 리셋
    relocateCooldown: { 1: 0, 2: 0 }, // 재배치 재사용 대기시간 - 사용하면 6으로 리셋
    fogTurnsLeft: { 1: 0, 2: 0 }, // 안개 - 이 플레이어(피해자) 화면에서만 보드 외곽이 안 보이는 남은 자기 턴 수
    checkerboardActive: false, // 체크무늬 - 한 번 켜지면 게임이 끝날 때까지 (x+y) 홀수 칸은 양쪽 다 착수 불가
    brinkMilestone: { 1: 0, 2: 0 }, // 벼랑 끝 - 이미 보상을 받은 최고 격차 단계 (반복 발동 시 같은 단계는 중복 지급 안 되게 추적)
    timeLimitOverride: null, // 노즈도르무 - 발동되면 이후 게임 끝까지 양쪽 제한시간이 이 값(초)으로 고정
    pokerFacePending: { 1: null, 2: null }, // 포커페이스 - 사용하면 { turnsLeft, real } 로 저장, 3턴 뒤 real이면 카드 강탈 (본인 화면에만 real 여부 공개)
    timeCollapseSnapshot: { 1: null, 2: null }, // 시공간 붕괴 - 획득하는 순간의 보드 스냅샷 (아무 때나 1회 이 시점으로 되돌릴 수 있음)
    prepStanceActive: { 1: false, 2: false }, // 대비태세 - 켜져 있으면 다음 제거·봉쇄 공격 1회를 자동으로 막음(부적과 같은 소모 방식)
    prepStanceCooldown: { 1: 0, 2: 0 }, // 대비태세 재사용 대기시간 - 사용하면 5로 리셋
    preventedStone: { 1: null, 2: null }, // 예방으로 지정해둔 내 돌 좌표 {x,y} - 포위 제거/돌 제거로부터 1회 보호됨
    preventionCooldown: { 1: 0, 2: 0 }, // 예방 재사용 대기시간 - 사용하면 6으로 리셋
    interestBonusTier: { 1: 0, 2: 0 }, // 이자 - 다음 증강 선택 등급을 이만큼 단계 상승시킴(누적, 소모되면 0으로 리셋)
    blockHitCount: { 1: 0, 2: 0 }, // 역장 - 이 플레이어에게 금지구역/영구봉쇄/감시탑이 누적으로 걸린 횟수 (3이 되는 순간 반사 발동)
    reverseScaleCell: { 1: null, 2: null }, // 역린 - 이 플레이어가 지정한 내 돌 좌표 {x,y} (둘 다 볼 수 있음), 발동하면 즉시 null로 소모
    removalHitCount: { 1: 0, 2: 0 }, // 인과응보 - 이 플레이어가 제거 계열 효과로 실제로 당한 누적 횟수 (3이 되는 순간 상대 돌 3개 반격)
    disguisedCards: { 1: {}, 2: {} }, // 둔갑술 - { [realAugmentId]: fakeAugmentObject } - 이 플레이어가 자기 카드에 씌운 위장(상대 화면에만 적용, 실제 로직은 진짜 id 그대로)
    dungapsulActive: { 1: false, 2: false }, // 둔갑술 - 뽑는 즉시 발동, 켜져 있으면 이 플레이어가 이후 PICK_AUGMENT로 새로 얻는 카드마다 자동으로 위장이 씌워짐

    // 증강 전면 개편(2026-07-18) 이후 신규 카드들 - 판에 관여하되 승부처(외톨이 돌/돌에서 먼 칸)에는 못 닿는 저강도 액티브
    breezeCooldown: { 1: 0, 2: 0 }, // 입김 재사용 대기시간 - 사용하면 5로 리셋
    saltScatterCooldown: { 1: 0, 2: 0 }, // 소금 뿌리기 재사용 대기시간 - 사용하면 6으로 리셋
    acornTossCooldown: { 1: 0, 2: 0 }, // 도토리 던지기 재사용 대기시간 - 사용하면 6으로 리셋
    spotSwapCooldown: { 1: 0, 2: 0 }, // 자리 바꾸기 재사용 대기시간 - 사용하면 6으로 리셋
    turfCooldown: { 1: 0, 2: 0 }, // 텃세 재사용 대기시간 - 사용하면 5로 리셋
    gustCooldown: { 1: 0, 2: 0 }, // 돌풍 재사용 대기시간 - 사용하면 7로 리셋
    saltBombCooldown: { 1: 0, 2: 0 }, // 소금 폭탄 재사용 대기시간 - 사용하면 8로 리셋
    typhoonCooldown: { 1: 0, 2: 0 }, // 태풍 재사용 대기시간 - 사용하면 10으로 리셋
    // 바나나 껍질/소금비는 상시 패시브라 별도 상태 필드 없음 (ownedAugments 보유 여부만으로 발동 판정)

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
// - 각성(awakening)도 20수를 넘기면 자동으로 대각선 강화+일자진과 똑같은 효과를 얹어주므로, 이 배타 관계에서
// diagBoost/straightBoost와 동급으로 취급해야 함 (안 그러면 체크무늬+각성 조합으로 같은 폭탄 조합이 그대로 재현됨)
function getStageExcludeIds(state, player) {
  const tooLate = state.stonesPlaced[player] > EARLY_GAME_STONE_LIMIT;
  const alreadyThreatening = hasThreeOrMoreInARow(state.board);
  const ids = tooLate || alreadyThreatening || state.checkerboardActive ? [...LATE_GAME_HIDDEN_IDS] : [];
  if (state.checkerboardActive) ids.push("awakening");
  const bothOwnedIds = [
    ...state.ownedAugments[1].map((a) => a.id),
    ...state.ownedAugments[2].map((a) => a.id),
  ];
  if (bothOwnedIds.includes("diagBoost") || bothOwnedIds.includes("straightBoost") || bothOwnedIds.includes("awakening")) {
    ids.push("checkerboard");
  }
  return [...new Set(ids)];
}

// 안개는 온라인 전용이라 로컬 모드에서는 항상 뽑기 풀에서 제외해야 함
function getModeExcludeIds(state) {
  return state.isOnlineMode ? [] : ONLINE_ONLY_IDS;
}

// 회차별 등급 후보 - 실버 60% / 골드 30% / 프리즘 10% 고정 (사용자 지정: 프리즘 등장 확률은 정확히 10%)
const ROUND_TIER_POOL = ["silver", "silver", "silver", "silver", "silver", "silver", "gold", "gold", "gold", "prism"];

const AUGMENT_TIER_BY_ID = Object.fromEntries(AUGMENTS.map((a) => [a.id, a.tier]));

function markUsed(state, player, ability) {
  return { ...state.oneTimeUsed, [player]: { ...state.oneTimeUsed[player], [ability]: true } };
}

function otherPlayer(player) {
  return player === 1 ? 2 : 1;
}

// 둔갑술 위장 정리: 카드가 어떤 이유로든 player의 ownedAugments에서 빠지면(파기·인생환승 교체, 포커페이스 강탈 등)
// 그 카드에 걸려있던 위장도 같이 지운다. 안 지우면 나중에 같은 id 카드를 다시 얻었을 때 낡은 위장이 잘못 붙는다.
function clearDisguiseEntry(disguisedCards, player, id) {
  if (!disguisedCards?.[player]?.[id]) return disguisedCards;
  const copy = { ...disguisedCards[player] };
  delete copy[id];
  return { ...disguisedCards, [player]: copy };
}

// 교도소가 발동 중이면 프리즘 등급 증강은 전부 없는 셈 치고 판정 (자기 자신 포함, 양쪽 다 적용)
// (싱글플레이 AI도 이 필터를 그대로 재사용해야 교도소 발동 중에 프리즘 효과를 잘못 계산하지 않음)
export function getActiveAugmentIds(state, player) {
  const ids = state.ownedAugments[player].map((a) => a.id);
  if (!state.prisonActive) return ids;
  return ids.filter((id) => AUGMENT_TIER_BY_ID[id] !== "prism");
}

// 대상(targetPlayer)이 제거/봉쇄/무르기 계열 효과에 면역인지 (철옹성은 무한, 부적/대비태세는 1회성)
export function checkImmunity(state, targetPlayer) {
  const targetOwnedIds = getActiveAugmentIds(state, targetPlayer);
  if (targetOwnedIds.includes("fortress")) return { immune: true, reason: "fortress" };
  if (targetOwnedIds.includes("talisman") && !state.oneTimeUsed[targetPlayer]?.talisman) {
    return { immune: true, reason: "talisman" };
  }
  if (targetOwnedIds.includes("prepStance") && state.prepStanceActive[targetPlayer]) {
    return { immune: true, reason: "prepStance" };
  }
  return { immune: false, reason: null };
}

function immunityMessage(reason) {
  if (reason === "talisman") return "상대가 '부적'으로 효과를 막았어요";
  if (reason === "prepStance") return "상대가 '대비태세'로 효과를 막았어요";
  return "상대가 철옹성이라 효과가 통하지 않았어요";
}

// 면역 판정 결과를 oneTimeUsed에 반영 (부적이면 그 자리에서 소모 처리)
function applyImmunityConsumption(oneTimeUsed, targetPlayer, reason) {
  if (reason !== "talisman") return oneTimeUsed;
  return { ...oneTimeUsed, [targetPlayer]: { ...oneTimeUsed[targetPlayer], talisman: true } };
}

// 대비태세 소비: 면역 판정 결과가 prepStance면 그 자리에서 방어막을 끔 (oneTimeUsed와 별도 필드라 여기서 분리 처리) -
// 호출부에서 반환값을 그대로 spread하면 됨(prepStance가 아니면 빈 객체라 아무 영향 없음)
function consumePrepStance(state, targetPlayer, reason) {
  if (reason !== "prepStance") return {};
  return { prepStanceActive: { ...state.prepStanceActive, [targetPlayer]: false } };
}

// 여진: 이 플레이어가 아직 여진을 안 썼으면 제거계 효과를 1회 막아냄
function hasAftershockShield(state, victim) {
  const victimOwnedIds = getActiveAugmentIds(state, victim);
  return victimOwnedIds.includes("aftershock") && !state.oneTimeUsed[victim]?.aftershock;
}

// 도깨비불: 소모되지 않는 상시 반복 패시브 - 철옹성/부적/대비태세/여진/예방 등 기존 방어를 전부 통과한
// 뒤에도 제거 대상 하나하나마다 독립적으로 30%의 확률로 그 제거 시도를 무산시킴 (최후의 저항선)
function rollDokkaebiSurvival(state, victim) {
  return getActiveAugmentIds(state, victim).includes("dokkaebibul") && Math.random() < 0.3;
}

// 지금 이 플레이어가 실제로 착수 가능한 빈 칸 전부 (금지구역/영구봉쇄/역병칸/링 바깥/체크무늬/렌주룰 금수 전부 제외)
// - 폭주의 무작위 착수와 싱글플레이 AI의 후보 계산이 이 정의 하나를 공유해서, 새 착수 제한형 증강이 추가돼도
// 한 곳만 고치면 둘 다 정확하게 반영됨
export function getLegalCells(state, player) {
  const totalStonesPlaced = state.stonesPlaced[1] + state.stonesPlaced[2];
  const ringBounds = getRingBounds(state.ringStartMove, state.placementClock, state.ringTarget);
  const effectiveOwnedIds = getEffectiveAugmentIds(getActiveAugmentIds(state, player), totalStonesPlaced);
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
  return candidates;
}

// 폭주: 지금 이 플레이어가 실제로 착수 가능한 빈 칸 중 무작위 1곳
function pickRandomLegalCell(state, player) {
  return pickRandom(getLegalCells(state, player), 1)[0] || null;
}

// 시간초과 자동 처리용 - 금지 구역/영구 봉쇄의 칸 지정 화면에서 아직 안 고른 빈 칸 중 무작위 1곳
// (착수와 달리 렌주룰/링/체크무늬 등은 안 따짐 - TARGET_CELL의 실제 검증 기준과 동일하게 "빈 칸인지"만 봄)
function pickRandomEmptyCellForTarget(board, selected) {
  const candidates = [];
  for (let cy = 0; cy < BOARD_SIZE; cy++) {
    for (let cx = 0; cx < BOARD_SIZE; cx++) {
      if (board[cy][cx] !== 0) continue;
      if (selected.some((c) => c.x === cx && c.y === cy)) continue;
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
  battleRing: "'링 위에서 싸우자'가 발동돼서 이제부터 판이 서서히 좁아집니다! (최종 안전지대 위치가 점선으로 미리 공개돼요)",
  chaos: "'폭주'가 발동돼서 이제부터 양쪽 다 조작권을 잃고 무작위로 돌을 둡니다!",
  roleSwap: "'입장 바꿔 생각하기'가 발동돼서 이제부터 서로 담당하는 돌 색이 뒤바뀝니다!",
  checkerboard: "'체크무늬'가 발동돼서 이제부터 짝수 칸(대각선 방향)만 착수할 수 있습니다!",
  nozdormu: "'노즈도르무'가 발동돼서 이제부터 양쪽 제한시간이 15초로 고정됩니다!",
  dungapsul: "'둔갑술'이 발동돼서 이제부터 내가 새로 얻는 카드마다 상대 화면에서 자동으로 위장됩니다!",
};
function activateInstantAugments(state, grantedAugments, player) {
  const patch = {};
  const messages = [];
  for (const augment of grantedAugments) {
    // 시공간 붕괴: 획득하는 순간 그 시점의 보드를 조용히 저장해둠 (배너 메시지 없음 - 부활/철옹성 같은 다른 패시브 획득과 동일)
    if (augment.id === "timeCollapse" && !state.timeCollapseSnapshot[player]) {
      patch.timeCollapseSnapshot = { ...state.timeCollapseSnapshot, [player]: state.board.map((row) => row.slice()) };
    }
    if (augment.id === "prison" && !state.prisonActive && !patch.prisonActive) {
      patch.prisonActive = true;
      // 교도소는 "자기 자신 포함" 모든 프리즘 효과를 끄는 카드라, 이미 활성화돼 있던 다른 즉시발동 프리즘
      // 효과(링 위에서 싸우자/폭주/입장 바꿔 생각하기/체크무늬)도 이 순간 실제로 꺼야 함 - 이 네 효과는 ownedAugments
      // 목록이 아니라 별도 상태 플래그로 직접 게임플레이를 좌우해서, getActiveAugmentIds 필터링만으로는 안 꺼짐
      if (state.ringActive) {
        patch.ringActive = false;
        patch.ringStartMove = null;
        patch.ringTarget = null;
      }
      if (state.chaosActive) patch.chaosActive = false;
      if (state.roleSwapActive) patch.roleSwapActive = false;
      if (state.checkerboardActive) patch.checkerboardActive = false;
      messages.push(INSTANT_ACTIVATE_MESSAGE.prison);
    }
    // 아래 네 효과는 이미 교도소가 발동돼 있으면(또는 같은 순간 같이 발동되면) 즉시 죽는 카드라 켜지지 않아야 함
    if (augment.id === "battleRing" && !state.prisonActive && !patch.prisonActive && !state.ringActive && !patch.ringActive) {
      patch.ringActive = true;
      patch.ringStartMove = state.placementClock;
      patch.ringTarget = pickRandomRingTarget();
      messages.push(INSTANT_ACTIVATE_MESSAGE.battleRing);
    }
    if (augment.id === "chaos" && !state.prisonActive && !patch.prisonActive && !state.chaosActive && !patch.chaosActive) {
      patch.chaosActive = true;
      messages.push(INSTANT_ACTIVATE_MESSAGE.chaos);
    }
    if (augment.id === "roleSwap" && !state.prisonActive && !patch.prisonActive && !state.roleSwapActive && !patch.roleSwapActive) {
      patch.roleSwapActive = true;
      messages.push(INSTANT_ACTIVATE_MESSAGE.roleSwap);
    }
    if (augment.id === "checkerboard" && !state.prisonActive && !patch.prisonActive && !state.checkerboardActive && !patch.checkerboardActive) {
      patch.checkerboardActive = true;
      messages.push(INSTANT_ACTIVATE_MESSAGE.checkerboard);
    }
    if (augment.id === "nozdormu" && !state.timeLimitOverride && !patch.timeLimitOverride) {
      patch.timeLimitOverride = 15;
      messages.push(INSTANT_ACTIVATE_MESSAGE.nozdormu);
    }
    if (augment.id === "dungapsul" && !state.dungapsulActive[player] && !patch.dungapsulActive) {
      patch.dungapsulActive = { ...state.dungapsulActive, [player]: true };
      messages.push(INSTANT_ACTIVATE_MESSAGE.dungapsul);
    }
  }
  if (messages.length > 0) {
    patch.forbiddenMessage = messages.join(" ");
    patch.forbiddenToken = state.forbiddenToken + 1;
  }
  return patch;
}

// 낙수효과: 상대(granter)가 잠복/역감시/생존자/벼랑 끝으로 무료 카드를 처음 받을 때, 그 반대편(grantee)이
// 낙수효과를 보유하고 있으면 무료 실버 카드 1장을 함께 받음 (게임 전체 1회) - 아래 4개 지급 헬퍼가 공통으로 호출
function triggerTrickleDownIfNeeded(state, granter) {
  const grantee = otherPlayer(granter);
  const granteeOwnedIds = state.ownedAugments[grantee].map((a) => a.id);
  if (!granteeOwnedIds.includes("trickleDown") || state.oneTimeUsed[grantee]?.trickleDown) return null;
  const seenIds = state.usedAugmentIds[grantee];
  const [bonus] = drawFromPool([...granteeOwnedIds, ...getModeExcludeIds(state), ...IMMEDIATE_TARGET_EXCLUDE_IDS], seenIds, 1, colorForPlayer(grantee, state.roleSwapActive));
  if (!bonus) return null;
  return {
    ownedAugments: { ...state.ownedAugments, [grantee]: [...state.ownedAugments[grantee], bonus] },
    usedAugmentIds: { ...state.usedAugmentIds, [grantee]: [...seenIds, bonus.id] },
    oneTimeUsed: { ...state.oneTimeUsed, [grantee]: { ...state.oneTimeUsed[grantee], trickleDown: true } },
    forbiddenMessage: "'낙수효과' 발동! 무료 실버 카드 1장을 함께 받았어요!",
  };
}
// granter가 방금 무료 카드를 받은(patch가 이미 반영된) 상태를 기준으로 낙수효과를 이어붙임 - 두 patch의
// ownedAugments/usedAugmentIds/oneTimeUsed가 서로 다른 신원 키를 건드리므로 병합 시 trickleDownPatch가 이겨도 안전함
function mergeTrickleDown(state, patch, granter) {
  const trickleDownPatch = triggerTrickleDownIfNeeded({ ...state, ...patch }, granter);
  if (!trickleDownPatch) return patch;
  return {
    ...patch,
    ...trickleDownPatch,
    forbiddenMessage: [patch.forbiddenMessage, trickleDownPatch.forbiddenMessage].filter(Boolean).join(" "),
  };
}

// 잠복: 금지 구역/영구 봉쇄/감시탑에 처음 걸리는 피해자에게 카드 1장을 무료로 얹어줌
function triggerAmbushIfNeeded(state, victim) {
  const victimOwnedIds = state.ownedAugments[victim].map((a) => a.id);
  if (!victimOwnedIds.includes("ambush") || state.oneTimeUsed[victim]?.ambush) return null;
  const seenIds = state.usedAugmentIds[victim];
  const [bonus] = drawFromPool([...victimOwnedIds, ...getModeExcludeIds(state), ...IMMEDIATE_TARGET_EXCLUDE_IDS], seenIds, 1, colorForPlayer(victim, state.roleSwapActive));
  if (!bonus) return null;
  const patch = {
    ownedAugments: { ...state.ownedAugments, [victim]: [...state.ownedAugments[victim], bonus] },
    usedAugmentIds: { ...state.usedAugmentIds, [victim]: [...seenIds, bonus.id] },
    oneTimeUsed: { ...state.oneTimeUsed, [victim]: { ...state.oneTimeUsed[victim], ambush: true } },
    ...activateInstantAugments(state, [bonus], victim),
  };
  return mergeTrickleDown(state, patch, victim);
}

// 생존자 퀘스트: 이 플레이어(victim)의 돌이 이 판에서 처음 제거당하면 무료 실버 카드 2장 지급 (1회)
function triggerSurvivorQuestIfNeeded(state, victim) {
  const victimOwnedIds = state.ownedAugments[victim].map((a) => a.id);
  if (!victimOwnedIds.includes("survivor") || state.oneTimeUsed[victim]?.survivor) return null;
  const seenIds = state.usedAugmentIds[victim];
  const bonus = drawSeveralOfTier("silver", 2, [...victimOwnedIds, ...getModeExcludeIds(state), ...IMMEDIATE_TARGET_EXCLUDE_IDS], seenIds, colorForPlayer(victim, state.roleSwapActive));
  if (bonus.length === 0) return null;
  const patch = {
    ownedAugments: { ...state.ownedAugments, [victim]: [...state.ownedAugments[victim], ...bonus] },
    usedAugmentIds: { ...state.usedAugmentIds, [victim]: [...new Set([...seenIds, ...bonus.map((a) => a.id)])] },
    oneTimeUsed: { ...state.oneTimeUsed, [victim]: { ...state.oneTimeUsed[victim], survivor: true } },
    forbiddenMessage: "'생존자' 퀘스트 발동! 무료 카드 2장을 획득했어요!",
  };
  return mergeTrickleDown(state, patch, victim);
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
  const bonus = drawSeveralOfTier("silver", 1, [...ownedIds, ...getModeExcludeIds(state), ...IMMEDIATE_TARGET_EXCLUDE_IDS], seenIds, myColor);
  if (bonus.length === 0) return null;
  const patch = {
    ownedAugments: { ...state.ownedAugments, [player]: [...state.ownedAugments[player], ...bonus] },
    usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, ...bonus.map((a) => a.id)])] },
    brinkMilestone: { ...state.brinkMilestone, [player]: milestone },
    forbiddenMessage: "'벼랑 끝' 발동! 돌 개수가 열세라 무료 실버 카드를 획득했어요!",
  };
  return mergeTrickleDown(state, patch, player);
}

// 이자: 이 플레이어(victim)의 돌이 제거되거나 금지구역/영구봉쇄/감시탑에 실제로 걸릴 때마다(누적, 반복 발동),
// 다음 증강 선택 등급을 한 단계씩 상승시킴 - 실제 소비는 buildAugmentChoices의 effectiveTier 계산에서 이뤄짐
function triggerInterestIfNeeded(state, victim) {
  const victimOwnedIds = state.ownedAugments[victim].map((a) => a.id);
  if (!victimOwnedIds.includes("interest")) return null;
  return {
    interestBonusTier: { ...state.interestBonusTier, [victim]: (state.interestBonusTier[victim] || 0) + 1 },
    forbiddenMessage: "'이자' 발동! 다음 증강 선택 등급이 한 단계 상승해요",
  };
}

// 역장: 이 플레이어(victim)에게 금지구역/영구봉쇄/감시탑이 누적 3번째로 걸리는 순간(1회), 그 시점에 victim에게
// 걸려있는 모든 금지구역/영구봉쇄/감시탑을 전부 무효화하고 그대로 공격자에게 반사함(공격자가 그 칸들을 대신 못 쓰게 됨)
function triggerReflectShieldIfNeeded(state, victim) {
  // 역장은 프리즘 등급이라 교도소 발동 중엔 꺼져야 함 - 반드시 getActiveAugmentIds를 거쳐야 함
  const victimOwnedIds = getActiveAugmentIds(state, victim);
  if (!victimOwnedIds.includes("reflectShield") || state.oneTimeUsed[victim]?.reflectShield) return null;
  const hitCount = (state.blockHitCount[victim] || 0) + 1;
  if (hitCount < 3) {
    return { blockHitCount: { ...state.blockHitCount, [victim]: hitCount } };
  }
  const attacker = otherPlayer(victim);
  return {
    blockHitCount: { ...state.blockHitCount, [victim]: hitCount },
    oneTimeUsed: { ...state.oneTimeUsed, [victim]: { ...state.oneTimeUsed[victim], reflectShield: true } },
    blockedCells: {
      ...state.blockedCells,
      [victim]: [],
      [attacker]: [...state.blockedCells[attacker], ...state.blockedCells[victim]],
    },
    permaBlockedCells: {
      ...state.permaBlockedCells,
      [victim]: [],
      [attacker]: [...state.permaBlockedCells[attacker], ...state.permaBlockedCells[victim]],
    },
    watchtowerCells: {
      ...state.watchtowerCells,
      [victim]: [],
      [attacker]: [...state.watchtowerCells[attacker], ...state.watchtowerCells[victim]],
    },
    forbiddenMessage: "'역장' 발동! 걸려있던 봉쇄 효과가 전부 상대에게 반사됐어요!",
  };
}

// 인과응보: 이 플레이어(victim)가 제거 계열 효과(포위 제거/습격/돌 제거/역병/붕괴)로 누적 3번째 피해를
// 입는 순간(1회), 그 즉시 공격자(상대)의 돌 무작위 3개를 반격 제거함. raid와 동일하게 면역은 이 반격
// "행동" 전체에 대해 한 번만 체크함(1회성 방어막이 절반만 막는 건 말이 안 되므로 - talisman/prepStance의
// 기존 소모 방식과 일치). board는 호출 시점에 이미 이번 수의 제거가 반영된 그 스코프의 mutable 배열을 그대로
// 넘겨야 함 - 반환 patch에는 board를 안 담고 그 배열 자체를 직접 mutate함(raid와 동일한 패턴, 최종 반환값의
// board: newBoard가 같은 참조를 가리키므로 자동으로 반영됨)
function triggerKarmaIfNeeded(state, victim, board) {
  // 인과응보는 프리즘 등급이라 교도소 발동 중엔 꺼져야 함 - 반드시 getActiveAugmentIds를 거쳐야 함
  const victimOwnedIds = getActiveAugmentIds(state, victim);
  if (!victimOwnedIds.includes("karma") || state.oneTimeUsed[victim]?.karma) return null;
  const hitCount = (state.removalHitCount[victim] || 0) + 1;
  if (hitCount < 3) {
    return { removalHitCount: { ...state.removalHitCount, [victim]: hitCount } };
  }
  const attacker = otherPlayer(victim);
  const oneTimeUsedWithKarma = { ...state.oneTimeUsed, [victim]: { ...state.oneTimeUsed[victim], karma: true } };
  const immunity = checkImmunity(state, attacker);
  if (immunity.immune) {
    return {
      removalHitCount: { ...state.removalHitCount, [victim]: hitCount },
      oneTimeUsed: applyImmunityConsumption(oneTimeUsedWithKarma, attacker, immunity.reason),
      forbiddenMessage: "'인과응보' 발동! 하지만 " + immunityMessage(immunity.reason),
    };
  }
  const attackerColor = colorForPlayer(attacker, state.roleSwapActive);
  const attackerStones = [];
  for (let yy = 0; yy < BOARD_SIZE; yy++) {
    for (let xx = 0; xx < BOARD_SIZE; xx++) {
      if (board[yy][xx] === attackerColor) attackerStones.push({ x: xx, y: yy });
    }
  }
  const karmaTargets = pickRandom(attackerStones, Math.min(3, attackerStones.length));
  // 도깨비불: 공격자가 갖고 있으면 인과응보의 반격 대상 하나하나마다 독립적으로 30% 저항
  let karmaDokkaebiSurvived = 0;
  const karmaActuallyRemoved = [];
  for (const t of karmaTargets) {
    if (rollDokkaebiSurvival(state, attacker)) {
      karmaDokkaebiSurvived++;
      continue;
    }
    board[t.y][t.x] = 0;
    karmaActuallyRemoved.push(t);
  }
  return {
    removalHitCount: { ...state.removalHitCount, [victim]: hitCount },
    oneTimeUsed: oneTimeUsedWithKarma,
    forbiddenMessage:
      "'인과응보' 발동! 상대 돌 " +
      karmaActuallyRemoved.length +
      "개가 제거됐어요!" +
      (karmaDokkaebiSurvived > 0 ? " ('도깨비불'이 " + karmaDokkaebiSurvived + "개를 지켜냄)" : ""),
  };
}

// 금지구역/영구봉쇄/감시탑이 상대에게 실제로 성사됐을 때 공통으로 걸어야 하는 후속 효과 2가지(이자/역장)를
// 한 번에 처리 - 세 카드(금지구역/영구봉쇄/감시탑)의 성공 분기에서 공통으로 호출됨
function applyBlockLandedHooks(state, victim) {
  const interestPatch = triggerInterestIfNeeded(state, victim);
  const stateAfterInterest = interestPatch ? { ...state, ...interestPatch } : state;
  const reflectPatch = triggerReflectShieldIfNeeded(stateAfterInterest, victim);
  if (!interestPatch && !reflectPatch) return null;
  const messages = [interestPatch?.forbiddenMessage, reflectPatch?.forbiddenMessage].filter(Boolean).join(" ");
  return { ...interestPatch, ...reflectPatch, forbiddenMessage: messages };
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
// 이자: 등급을 한 단계씩 상승시킴 (실버→골드→프리즘, 프리즘은 이미 최고 등급이라 그대로 유지)
function bumpTier(tier) {
  if (tier === "silver") return "gold";
  return "prism";
}

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
  let effectiveTier = state.conquerorPending[player]
    ? "prism"
    : roundTier === "silver" && ownedIds.includes("lateBloomer") && totalStonesPlaced >= lateBloomerThreshold
      ? "gold"
      : roundTier;
  // 이자: 그동안 쌓인 만큼(누적) 등급을 한 단계씩 더 승급시킴 - 소비(리셋)는 이 뽑기를 트리거한 CLICK_CELL 쪽에서 처리
  const interestStacks = state.interestBonusTier[player] || 0;
  for (let i = 0; i < interestStacks; i++) effectiveTier = bumpTier(effectiveTier);

  // 더블 초이스(1장 늘림)는 그 회차 등급은 그대로 두고 장수만 조정
  let count = 3;
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

// 금지 구역/영구 봉쇄는 "뽑는 즉시 칸을 지정"해야만, 도박은 "고르는 즉시 별도 선택 화면"으로 이어져야만
// 실제로 효과가 생기는 카드라(셋 다 버튼이 없어서 나중에 따로 못 씀), 정상 드래프트(PICK_AUGMENT)가 아닌
// 다른 경로로 카드만 손에 쥐여주면 그 트리거를 걸 방법이 없어 영원히 죽은 카드가 됨
// - 동전 던지기/잠복/생존자/벼랑 끝/역감시 보너스/파기 교체처럼 "카드만 툭 던져주는" 모든 경로에서 공통으로 제외해야 함
const IMMEDIATE_TARGET_EXCLUDE_IDS = ["banZone", "permaBlock", "gamble"];

// 시작 증강(0수, 착수 전)에서는 위 3장(칸 지정/도박처럼 시작 시퀀스가 복잡해지는 카드)에 더해,
// "뽑는 순간 첫 수를 두기도 전에 게임을 사실상 결정짓는" 카드도 제외함 - 첫 착수 전이라 상대가
// 대응할 방법도, 판을 읽어보고 대비할 시간도 전혀 없는 상태에서 스노우볼이 시작되는 걸 막는 취지
// (사용자 피드백: "시작 증강 선택시 바로 겜 닫는 증강 선택 못하게 해주셈")
const START_DRAFT_INSTANT_EFFECT_EXCLUDE_IDS = [
  // 즉시발동형 - 뽑는 순간 게임 끝까지 지속되는 전역 효과 (설명에 "즉시 발동"이 명시된 카드들)
  "rush", "prison", "battleRing", "chaos", "roleSwap", "checkerboard", "nozdormu",
  // 제거 계열 - 상대 돌을 직접 지우거나 무력화하는 카드 (interest/survivor/karma가 이미 같은
  // 5개+오델로/인과응보를 "제거 계열"로 묶어서 쓰고 있는 것과 동일한 기준)
  "capture", "othello", "raid", "removeStone", "plague", "collapse", "karma",
];
const START_DRAFT_EXCLUDE_IDS = [...IMMEDIATE_TARGET_EXCLUDE_IDS, ...START_DRAFT_INSTANT_EFFECT_EXCLUDE_IDS];

// 포커페이스 강탈 대상에서도 항상 빼야 함 - 이미 칸이 지정되고 끝나버린 카드라(위와 같은 이유) 훔쳐가도 항상 죽은 카드가 됨
const POKER_FACE_STEAL_EXCLUDE_IDS = IMMEDIATE_TARGET_EXCLUDE_IDS;
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

// forbiddenMessage/forbiddenToken 말고 다른 필드가 하나라도 바뀌었으면 "진짜 변화"로 취급.
// 온라인 모드가 "안내 메시지만 있고 실제 변화는 없는" 액션을 서버에 반영 안 하는 데 쓰던 헬퍼였는데,
// 로컬/싱글플레이도 "액티브 능력이 실제로 발동했는지"(쿨다운에 막힌 안내만 뜨는 경우와 구분) 판정에 그대로 재사용함
export function hasRealChange(prev, next) {
  return Object.keys(next).some((key) => {
    if (key === "forbiddenMessage" || key === "forbiddenToken") return false;
    return prev[key] !== next[key];
  });
}

// 능력 사용음을 재생할지 판정하는 데 쓰는 액션 타입 - 실제 착수(CLICK_CELL)는 착수음이 따로 있어서 제외
export const ABILITY_SOUND_ACTION_TYPES = new Set(["USE_ABILITY", "TARGET_CELL", "PICK_CARD_TARGET"]);

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

      // 링 위에서 싸우자: 발동 후 실제 착수 횟수(placementClock) 기준으로 계속 좁혀 들어가는 안쪽 범위 바깥은 양쪽 다 착수 불가
      const ringBounds = getRingBounds(state.ringStartMove, state.placementClock, state.ringTarget);
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

      // 역린: 상대가 지정해둔 내 돌의 8방향 인접 칸(체비쇼프 거리 1)에 처음 두면 이번 수가 통째로 무효화되고
      // 표시도 소모됨(1회) - 감시탑과 같은 "밟으면 손해" 철학이지만 좌표가 정확히 일치할 필요 없이 인접이면 발동
      const reverseScaleMark = state.reverseScaleCell[opponent];
      if (
        reverseScaleMark &&
        Math.max(Math.abs(x - reverseScaleMark.x), Math.abs(y - reverseScaleMark.y)) === 1
      ) {
        const stateAfterReverseScale = { ...state, reverseScaleCell: { ...state.reverseScaleCell, [opponent]: null } };
        const reverseScalePostPatch = applyBlockLandedHooks(stateAfterReverseScale, currentPlayer);
        return {
          ...stateAfterReverseScale,
          ...reverseScalePostPatch,
          forbiddenMessage:
            "상대가 표시해둔 '역린'을 건드려서 이번 수가 사라졌어요!" +
            (reverseScalePostPatch?.forbiddenMessage ? " " + reverseScalePostPatch.forbiddenMessage : ""),
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

      const newBoard = state.board.map((row) => row.slice());
      newBoard[y][x] = currentColor;

      // 포위 제거 / 오델로: 상대가 철옹성이 아니면 "나-상대-나" 모양이 된 상대 돌을 제거하거나 내 색으로 뒤집음
      // 여진을 가진 피해자는 1회에 한해 제거를 막아냄. 둘 다 보유 중이면(둘 다 같은 "나-상대-나" 패턴을 노리는
      // 카드라) 잡힌 돌마다 50% 확률로 어느 효과를 적용할지 결정함 - 안 그러면 코드 순서상 포위 제거가 항상 먼저
      // 그 칸을 비워버려서 오델로가 뒤집을 대상을 못 찾아 완전히 죽은 카드가 됨(둘 다 프리즘 등급인데 하나가
      // 통째로 무의미해지는 건 좋은 밸런스가 아님)
      const opponentOwnedIds = getActiveAugmentIds(state, opponent);
      let aftershockUsedThisMove = false;
      let preventionUsedThisMove = false;
      let captureRemovedAny = false;
      let dokkaebiSurvivedCount = 0;
      const hasCapture = ownedIds.includes("capture");
      const hasOthello = ownedIds.includes("othello");
      if (!opponentOwnedIds.includes("fortress") && (hasCapture || hasOthello)) {
        for (const c of findCaptures(newBoard, x, y, currentColor)) {
          const applyCapture = hasCapture && (!hasOthello || Math.random() < 0.5);
          if (applyCapture) {
            if (!aftershockUsedThisMove && hasAftershockShield(state, opponent)) {
              aftershockUsedThisMove = true;
              continue;
            }
            // 예방: 피해자가 이 정확한 칸을 미리 지정해뒀으면(여진처럼) 1회 지켜냄
            const preventedCell = state.preventedStone[opponent];
            if (!preventionUsedThisMove && preventedCell && preventedCell.x === c.x && preventedCell.y === c.y) {
              preventionUsedThisMove = true;
              continue;
            }
            // 도깨비불: 위 방어들을 전부 통과한 뒤에도 최후로 30% 확률 저항 (낀 돌 하나하나마다 독립 판정)
            if (rollDokkaebiSurvival(state, opponent)) {
              dokkaebiSurvivedCount++;
              continue;
            }
            newBoard[c.y][c.x] = 0;
            captureRemovedAny = true;
          } else if (hasOthello) {
            newBoard[c.y][c.x] = currentColor;
          }
        }
      }

      // 여진이 발동됐으면 이후 로직은 전부 이 상태를 기준으로 계속 진행 (oneTimeUsed 갱신 반영)
      let stateAfterCapture = aftershockUsedThisMove
        ? { ...state, oneTimeUsed: { ...state.oneTimeUsed, [opponent]: { ...state.oneTimeUsed[opponent], aftershock: true } } }
        : state;
      // 예방이 발동됐으면 그 자리에서 소모 처리 (지켜낸 돌의 보호막은 다시 걸어줘야 새로 지정 가능)
      if (preventionUsedThisMove) {
        stateAfterCapture = {
          ...stateAfterCapture,
          preventedStone: { ...stateAfterCapture.preventedStone, [opponent]: null },
        };
      }
      // 역풍: 피해자가 역풍을 갖고 있고 이번 포위 제거 시도가 여진/예방으로 막혔으면, 공격자의 쿨다운형 카드를
      // 처벌함 - 다만 포위 제거/오델로 자체는 쿨다운 카드가 아니라서(패시브) 현재는 실질적으로 발동하지 않음
      // (돌 제거처럼 나중에 이 패턴을 쓰는 새 쿨다운형 "공격" 카드가 생기면 여기서도 같은 방식으로 확장하면 됨)

      // 링 위에서 싸우자의 축소 시계: 방금 보드에 돌 하나가 실제로 놓였으니 무조건 1 증가 (질풍노도 보너스 착수
      // 포함 - stonesPlaced와 달리 이 카운터는 그것도 그대로 셈). 부활로 이 수가 나중에
      // 무효화되더라도(아래 참고) 이미 지나간 시간이라 되돌리지 않음(포위 제거/퀘스트 지급 등 다른 부수효과와 동일)
      stateAfterCapture = { ...stateAfterCapture, placementClock: stateAfterCapture.placementClock + 1 };

      // 최후통첩: 이번 수로 발동됐으면 그 자리에서 바로 소모 처리 - 안 그러면 이 칸의 돌이 나중에(무르기/제거 등으로)
      // 사라졌다가 같은 자리에 다시 놓일 때마다 다리 놓기+연속 배치 보너스가 계속 재발동되는 버그가 생김
      // ("내가 그 칸에 처음 두는 순간" - 처음 한 번만 적용돼야 함)
      if (ultimatumFulfilled) {
        stateAfterCapture = {
          ...stateAfterCapture,
          ultimatumCell: { ...stateAfterCapture.ultimatumCell, [currentPlayer]: null },
        };
      }

      // 퀘스트 증강 체크: 생존자(포위 제거로 상대 돌이 실제로 사라짐) / 정복자(중앙 3x3 점유)
      const extraQuestMessages = [];
      if (captureRemovedAny) {
        const survivorPatch = triggerSurvivorQuestIfNeeded(stateAfterCapture, opponent);
        if (survivorPatch) {
          stateAfterCapture = { ...stateAfterCapture, ...survivorPatch };
          extraQuestMessages.push(survivorPatch.forbiddenMessage);
        }
        const interestPatch = triggerInterestIfNeeded(stateAfterCapture, opponent);
        if (interestPatch) {
          stateAfterCapture = { ...stateAfterCapture, ...interestPatch };
          extraQuestMessages.push(interestPatch.forbiddenMessage);
        }
        const karmaPatch = triggerKarmaIfNeeded(stateAfterCapture, opponent, newBoard);
        if (karmaPatch) {
          stateAfterCapture = { ...stateAfterCapture, ...karmaPatch };
          extraQuestMessages.push(karmaPatch.forbiddenMessage);
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
          countOpenThrees(newBoard, x, y, currentColor) > 0
        ) {
          const seenIds = stateAfterCapture.usedAugmentIds[opponent];
          const ownedIdsForDraw = [...stateAfterCapture.ownedAugments[opponent].map((a) => a.id), ...getModeExcludeIds(state), ...IMMEDIATE_TARGET_EXCLUDE_IDS];
          const [bonus] = drawFromPool(ownedIdsForDraw, seenIds, 1, colorForPlayer(opponent, state.roleSwapActive));
          if (bonus) {
            stateAfterCapture = {
              ...stateAfterCapture,
              ownedAugments: { ...stateAfterCapture.ownedAugments, [opponent]: [...stateAfterCapture.ownedAugments[opponent], bonus] },
              usedAugmentIds: { ...stateAfterCapture.usedAugmentIds, [opponent]: [...new Set([...seenIds, bonus.id])] },
              oneTimeUsed: { ...stateAfterCapture.oneTimeUsed, [opponent]: { ...stateAfterCapture.oneTimeUsed[opponent], counterWatch: true } },
              ...activateInstantAugments(stateAfterCapture, [bonus], opponent),
            };
            const counterWatchTrickleDownPatch = triggerTrickleDownIfNeeded(stateAfterCapture, opponent);
            if (counterWatchTrickleDownPatch) {
              stateAfterCapture = { ...stateAfterCapture, ...counterWatchTrickleDownPatch };
              extraQuestMessages.push(counterWatchTrickleDownPatch.forbiddenMessage);
            }
          }
        }
      }

      // 습격(rework): 원래는 "1회 사용" 버튼이었으나, 골드 등급 액티브가 너무 많다는 피드백으로 자동 발동 패시브로
      // 전환됨 - 상대(습격 소유자 기준 상대)가 이 판에서 처음으로 열린 3목을 만드는 순간, 버튼 없이 자동으로 그
      // 사람 돌 무작위 2개가 제거됨 (역감시와 같은 countOpenThrees 재사용 패턴, 색 전용이 아니라 양쪽 색 모두 체크 -
      // countOpenThrees는 player 인자를 안 넘기면 흑돌 기준으로만 판정하므로, 백돌이 열린 3목을 만든 경우까지
      // 정확히 잡아내려면 currentColor를 반드시 명시해야 함)
      // 대비태세/예방/이자와도 포위 제거·돌 제거와 동일한 패턴으로 연동함 - 역풍은 "쿨다운형 공격 카드"에만
      // 적용되는데 습격은 쿨다운이 아니라 자동 1회 발동이라 포위 제거와 마찬가지로 대상에서 제외됨
      const raidOwnerActiveIds = getActiveAugmentIds(stateAfterCapture, opponent);
      if (
        raidOwnerActiveIds.includes("raid") &&
        !stateAfterCapture.oneTimeUsed[opponent]?.raid &&
        countOpenThrees(newBoard, x, y, currentColor) > 0
      ) {
        const raidImmunity = checkImmunity(stateAfterCapture, currentPlayer);
        if (raidImmunity.immune) {
          stateAfterCapture = {
            ...stateAfterCapture,
            ...consumePrepStance(stateAfterCapture, currentPlayer, raidImmunity.reason),
            oneTimeUsed: applyImmunityConsumption(
              { ...stateAfterCapture.oneTimeUsed, [opponent]: { ...stateAfterCapture.oneTimeUsed[opponent], raid: true } },
              currentPlayer,
              raidImmunity.reason
            ),
          };
          extraQuestMessages.push("상대의 '습격'이 발동했지만 " + immunityMessage(raidImmunity.reason));
        } else {
          const raidPreventedCell = stateAfterCapture.preventedStone[currentPlayer];
          const moverStones = [];
          for (let yy = 0; yy < BOARD_SIZE; yy++) {
            for (let xx = 0; xx < BOARD_SIZE; xx++) {
              if (newBoard[yy][xx] !== currentColor) continue;
              // 예방으로 지정된 돌은 무작위 대상 풀에서 아예 제외됨 (돌 제거/포위 제거와 동일한 방식)
              if (raidPreventedCell && raidPreventedCell.x === xx && raidPreventedCell.y === yy) continue;
              moverStones.push({ x: xx, y: yy });
            }
          }
          const raidTargets = pickRandom(moverStones, Math.min(2, moverStones.length));
          // 도깨비불: 습격은 한 번에 여러 개를 노리는 효과라, 뽑힌 대상 하나하나마다 독립적으로 30% 저항 판정
          let raidDokkaebiSurvived = 0;
          const raidActuallyRemoved = [];
          for (const t of raidTargets) {
            if (rollDokkaebiSurvival(stateAfterCapture, currentPlayer)) {
              raidDokkaebiSurvived++;
              continue;
            }
            newBoard[t.y][t.x] = 0;
            raidActuallyRemoved.push(t);
          }
          stateAfterCapture = {
            ...stateAfterCapture,
            oneTimeUsed: { ...stateAfterCapture.oneTimeUsed, [opponent]: { ...stateAfterCapture.oneTimeUsed[opponent], raid: true } },
          };
          extraQuestMessages.push(
            "상대의 '습격'이 발동해 내 돌 " +
              raidActuallyRemoved.length +
              "개가 사라졌어요!" +
              (raidDokkaebiSurvived > 0 ? " ('도깨비불'이 " + raidDokkaebiSurvived + "개를 지켜냄)" : "")
          );
          if (raidActuallyRemoved.length > 0) {
            const raidSurvivorPatch = triggerSurvivorQuestIfNeeded(stateAfterCapture, currentPlayer);
            if (raidSurvivorPatch) {
              stateAfterCapture = { ...stateAfterCapture, ...raidSurvivorPatch };
              extraQuestMessages.push(raidSurvivorPatch.forbiddenMessage);
            }
            const raidInterestPatch = triggerInterestIfNeeded(stateAfterCapture, currentPlayer);
            if (raidInterestPatch) {
              stateAfterCapture = { ...stateAfterCapture, ...raidInterestPatch };
              extraQuestMessages.push(raidInterestPatch.forbiddenMessage);
            }
            const raidKarmaPatch = triggerKarmaIfNeeded(stateAfterCapture, currentPlayer, newBoard);
            if (raidKarmaPatch) {
              stateAfterCapture = { ...stateAfterCapture, ...raidKarmaPatch };
              extraQuestMessages.push(raidKarmaPatch.forbiddenMessage);
            }
          }
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
          winnerPlayer: currentPlayer,
        };
      }

      // 물량전: 아무도 안 이겼는데 (실제로 둘 수 있는 칸 기준으로) 보드가 다 찼으면, 물량전 소유자가 돌이
      // 더 많을 때 승리 처리 (아니면 무승부) - 각 신원이 실제로 놓고 있는 색(입장 바꿔 생각하기로 바뀌었을
      // 수 있음) 기준으로 자기 돌 개수를 셈. 링 위에서 싸우자/체크무늬/역병 등으로 "누구도 영원히 못 두는
      // 칸"이 있으면 그 칸은 다 찬 판정에서 제외해야 함 - 안 그러면 그 칸들이 영원히 비어 있어서
      // isBoardFull이 절대 true가 안 되고, 실제로 둘 수 있는 칸은 다 찼는데도 게임이 안 끝나는 소프트락이 생김
      const finalRingBounds = getRingBounds(state.ringStartMove, stateAfterCapture.placementClock, state.ringTarget);
      if (isBoardEffectivelyFull(newBoard, finalRingBounds, state.checkerboardActive, state.deadCells)) {
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
          winnerPlayer: p1Attrition ? 1 : p2Attrition ? 2 : null,
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

      // 돌 제거/직전 무르기/도장깨기/재배치도 같은 재사용 대기시간 방식 (보너스 돌은 카운트 안 함)
      const decayedRemoveStoneCooldown = isRushBonusStone
        ? state.removeStoneCooldown[currentPlayer]
        : Math.max(0, state.removeStoneCooldown[currentPlayer] - 1);
      const decayedSelfUndoCooldown = isRushBonusStone
        ? state.selfUndoCooldown[currentPlayer]
        : Math.max(0, state.selfUndoCooldown[currentPlayer] - 1);
      const decayedJailbreakCooldown = isRushBonusStone
        ? state.jailbreakCooldown[currentPlayer]
        : Math.max(0, state.jailbreakCooldown[currentPlayer] - 1);
      const decayedRelocateCooldown = isRushBonusStone
        ? state.relocateCooldown[currentPlayer]
        : Math.max(0, state.relocateCooldown[currentPlayer] - 1);
      // 대비태세/예방도 같은 재사용 대기시간 방식 (보너스 돌은 카운트 안 함)
      const decayedPrepStanceCooldown = isRushBonusStone
        ? state.prepStanceCooldown[currentPlayer]
        : Math.max(0, state.prepStanceCooldown[currentPlayer] - 1);
      const decayedPreventionCooldown = isRushBonusStone
        ? state.preventionCooldown[currentPlayer]
        : Math.max(0, state.preventionCooldown[currentPlayer] - 1);
      // 신규 심술 카드들도 같은 재사용 대기시간 방식 (보너스 돌은 카운트 안 함)
      const decayedBreezeCooldown = isRushBonusStone
        ? state.breezeCooldown[currentPlayer]
        : Math.max(0, state.breezeCooldown[currentPlayer] - 1);
      const decayedSaltScatterCooldown = isRushBonusStone
        ? state.saltScatterCooldown[currentPlayer]
        : Math.max(0, state.saltScatterCooldown[currentPlayer] - 1);
      const decayedAcornTossCooldown = isRushBonusStone
        ? state.acornTossCooldown[currentPlayer]
        : Math.max(0, state.acornTossCooldown[currentPlayer] - 1);
      const decayedSpotSwapCooldown = isRushBonusStone
        ? state.spotSwapCooldown[currentPlayer]
        : Math.max(0, state.spotSwapCooldown[currentPlayer] - 1);
      const decayedTurfCooldown = isRushBonusStone
        ? state.turfCooldown[currentPlayer]
        : Math.max(0, state.turfCooldown[currentPlayer] - 1);
      const decayedGustCooldown = isRushBonusStone
        ? state.gustCooldown[currentPlayer]
        : Math.max(0, state.gustCooldown[currentPlayer] - 1);
      const decayedSaltBombCooldown = isRushBonusStone
        ? state.saltBombCooldown[currentPlayer]
        : Math.max(0, state.saltBombCooldown[currentPlayer] - 1);
      const decayedTyphoonCooldown = isRushBonusStone
        ? state.typhoonCooldown[currentPlayer]
        : Math.max(0, state.typhoonCooldown[currentPlayer] - 1);

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
            // 프리즘 제외 + 금지구역/영구봉쇄 제외 + 상대가 이미 써버린(효과가 끝난) 카드 제외 + 흑돌/백돌
            // 전용 카드는 훔쳐가는 사람(currentPlayer)이 지금 그 색을 두고 있을 때만 대상에 포함 -
            // 안 그러면 강탈한 색 전용 카드가 새 주인에게는 영원히 발동 조건을 만족 못 하는 죽은 카드가 됨
            // (예: 백돌 전용 '역감시'를 흑돌이 훔치면, 게임 로직은 항상 "지금 백돌 두는 신원"의 카드만 확인해서
            // 흑돌 신원이 들고 있는 그 카드는 절대 체크되지 않음)
            const thiefColor = colorForPlayer(currentPlayer, stateAfterCapture.roleSwapActive);
            const stealPool = stateAfterCapture.ownedAugments[opponent].filter(
              (a) =>
                a.tier !== "prism" &&
                !POKER_FACE_STEAL_EXCLUDE_IDS.includes(a.id) &&
                !stateAfterCapture.oneTimeUsed[opponent]?.[a.id] &&
                matchesColor(a, thiefColor)
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
                // 강탈로 카드가 원주인의 손을 떠나면 그 카드에 걸려있던 둔갑술 위장도 같이 소멸
                disguisedCards: clearDisguiseEntry(stateAfterCapture.disguisedCards, opponent, stolen.id),
              };
              extraQuestMessages.push("'포커페이스'가 발동해서 상대의 '" + stolen.name + "' 카드를 강탈했어요!");
            } else {
              extraQuestMessages.push("'포커페이스'가 발동했지만 상대에게 강탈할 카드가 없었어요");
            }
          }
          // 가짜였으면 아무 메시지 없이 조용히 소멸
        }
      }

      const keepTurnThisMove = stayForSecondStone;

      const newStonesPlaced = isRushBonusStone
        ? state.stonesPlaced
        : { ...state.stonesPlaced, [currentPlayer]: state.stonesPlaced[currentPlayer] + 1 };

      // 링 위에서 싸우자: 이번 수로 placementClock이 늘어나 링이 새로 한 겹 더 좁혀졌으면, 새로 경계 밖이 된 칸의 돌을 삭제
      // - 상대 공격이 아니라 환경 요인(좁아지는 전장)이라 생존자/여진/철옹성 등 "제거 방어" 계열과 무관하게 무조건 삭제됨
      const newRingBounds = getRingBounds(state.ringStartMove, stateAfterCapture.placementClock, state.ringTarget);
      const crushedByRing = getCellsCrushedByRingShrink(ringBounds, newRingBounds);
      let finalBoard = newBoard;
      if (crushedByRing.length > 0) {
        finalBoard = newBoard.map((row) => row.slice());
        for (const c of crushedByRing) finalBoard[c.y][c.x] = 0;
        extraQuestMessages.push("'링 위에서 싸우자' 효과로 경계 밖 돌 " + crushedByRing.length + "개가 사라졌어요!");
      }

      // 바나나 껍질(상대 보유 패시브): 방금 놓인 돌이 외톨이(주변 8칸에 돌 없음)면 30% 확률로 무작위 인접
      // 칸(여전히 외톨이로 남는 칸)으로 미끄러짐 - 외톨이 돌은 어떤 라인/승리 판정에도 관여하지 않으므로
      // 승리 체크가 이미 끝난 이 시점에 옮겨도 안전함 (외톨이가 아닌 돌은 애초에 대상이 안 됨)
      let slipDest = null;
      if (
        getActiveAugmentIds(state, opponent).includes("bananaPeel") &&
        Math.random() < 0.3 &&
        findIsolatedStones(finalBoard, currentColor).some((c) => c.x === x && c.y === y)
      ) {
        const slipDests = findBreezeDestinations(finalBoard, x, y);
        if (slipDests.length > 0) {
          slipDest = pickRandom(slipDests, 1)[0];
          finalBoard = finalBoard.map((row) => row.slice());
          finalBoard[y][x] = 0;
          finalBoard[slipDest.y][slipDest.x] = currentColor;
          extraQuestMessages.push("상대의 '바나나 껍질'을 밟아서 방금 놓은 돌이 옆 칸으로 미끄러졌어요!");
        }
      }

      // 소금비(패시브, 프리즘): 실제 착수(placementClock)가 5의 배수가 되는 수마다, 보유자 1명당 모든 돌에서
      // 떨어진 무작위 빈 칸 1개가 양쪽 다 2턴 착수 금지 - 소금 뿌리기와 같은 blockedCells 재사용
      let saltRainCells = [];
      if (stateAfterCapture.placementClock % 5 === 0) {
        const rainOwnerCount = [1, 2].filter((p) => getActiveAugmentIds(state, p).includes("saltRain")).length;
        if (rainOwnerCount > 0) {
          const alreadyBlockedNow = [...state.blockedCells[1], ...state.blockedCells[2]];
          const rainEligible = findSaltEligibleCells(finalBoard).filter(
            (c) => !alreadyBlockedNow.some((b) => b.x === c.x && b.y === c.y)
          );
          saltRainCells = pickRandom(rainEligible, Math.min(rainOwnerCount, rainEligible.length));
          if (saltRainCells.length > 0) {
            extraQuestMessages.push("'소금비'가 내려서 먼 빈 칸 " + saltRainCells.length + "개가 잠시 양쪽 다 착수 금지됐어요!");
          }
        }
      }

      const baseState = {
        ...stateAfterCapture,
        board: finalBoard,
        stonesPlaced: newStonesPlaced,
        lastMove: { ...state.lastMove, [currentPlayer]: slipDest ? { x: slipDest.x, y: slipDest.y } : { x, y } },
        blockedCells: { ...state.blockedCells, [currentPlayer]: decayedBlocked },
        watchtowerCells: { ...state.watchtowerCells, [currentPlayer]: decayedWatchtower },
        boardFlipCooldown: { ...state.boardFlipCooldown, [currentPlayer]: decayedBoardFlipCooldown },
        removeStoneCooldown: { ...state.removeStoneCooldown, [currentPlayer]: decayedRemoveStoneCooldown },
        selfUndoCooldown: { ...state.selfUndoCooldown, [currentPlayer]: decayedSelfUndoCooldown },
        jailbreakCooldown: { ...state.jailbreakCooldown, [currentPlayer]: decayedJailbreakCooldown },
        relocateCooldown: { ...state.relocateCooldown, [currentPlayer]: decayedRelocateCooldown },
        prepStanceCooldown: { ...state.prepStanceCooldown, [currentPlayer]: decayedPrepStanceCooldown },
        preventionCooldown: { ...state.preventionCooldown, [currentPlayer]: decayedPreventionCooldown },
        breezeCooldown: { ...state.breezeCooldown, [currentPlayer]: decayedBreezeCooldown },
        saltScatterCooldown: { ...state.saltScatterCooldown, [currentPlayer]: decayedSaltScatterCooldown },
        acornTossCooldown: { ...state.acornTossCooldown, [currentPlayer]: decayedAcornTossCooldown },
        spotSwapCooldown: { ...state.spotSwapCooldown, [currentPlayer]: decayedSpotSwapCooldown },
        turfCooldown: { ...state.turfCooldown, [currentPlayer]: decayedTurfCooldown },
        gustCooldown: { ...state.gustCooldown, [currentPlayer]: decayedGustCooldown },
        saltBombCooldown: { ...state.saltBombCooldown, [currentPlayer]: decayedSaltBombCooldown },
        typhoonCooldown: { ...state.typhoonCooldown, [currentPlayer]: decayedTyphoonCooldown },
        fogTurnsLeft: { ...state.fogTurnsLeft, [currentPlayer]: decayedFogTurnsLeft },
        pokerFacePending: { ...stateAfterCapture.pokerFacePending, [currentPlayer]: decayedPokerFacePending },
        rushSecondStone: newRushSecondStone,
        rushBoosted: newRushBoosted,
        forbiddenMessage: [
          aftershockUsedThisMove ? "상대가 '여진'으로 돌을 지켜냈어요!" : "",
          dokkaebiSurvivedCount > 0 ? "상대의 '도깨비불'이 제거를 " + dokkaebiSurvivedCount + "번 피했어요!" : "",
          ...extraQuestMessages,
        ]
          .filter(Boolean)
          .join(" "),
        forbiddenToken:
          aftershockUsedThisMove || dokkaebiSurvivedCount > 0 || extraQuestMessages.length > 0
            ? state.forbiddenToken + 1
            : state.forbiddenToken,
      };

      // 소금비로 뽑힌 칸을 양쪽 blockedCells에 합침 (위 literal에서 이번 착수자의 기존 금지 칸 감쇠가 끝난 뒤에 얹음)
      if (saltRainCells.length > 0) {
        baseState.blockedCells = {
          1: [...baseState.blockedCells[1], ...saltRainCells.map((c) => ({ x: c.x, y: c.y, turnsLeft: 2 }))],
          2: [...baseState.blockedCells[2], ...saltRainCells.map((c) => ({ x: c.x, y: c.y, turnsLeft: 2 }))],
        };
      }

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
        // 증강 풀이 지금은 3종뿐이라, 이미 3개를 다 보유하면 이번 회차에 새로 보여줄 카드가 하나도 없음
        // - 그럴 땐 빈 선택 화면을 띄우는 대신 조용히 이번 회차만 건너뛰고 정상적으로 게임을 진행함
        if (choices.length === 0) {
          return {
            ...baseState,
            usedAugmentIds: { ...state.usedAugmentIds, [currentPlayer]: usedAugmentIds },
            draftTierPlan,
            currentPlayer: keepTurnThisMove ? currentPlayer : opponent,
          };
        }
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
          conquerorPending: { ...state.conquerorPending, [currentPlayer]: false },
          interestBonusTier: { ...state.interestBonusTier, [currentPlayer]: 0 },
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
      let nextState = gameReducer(state, { type: "CLICK_CELL", x: randomCell.x, y: randomCell.y });
      if (nextState === state) return state;

      // 방금 놓은 수가 증강 선택(질풍노도 부스트 턴 중이면 특히 잦음)을 띄웠거나, 그 카드가 다시
      // 금지 구역/영구 봉쇄처럼 즉시 칸 지정을 요구하거나, 도박 재선택 화면으로 이어지면 - 사람이 개입할 때까지
      // 게임이 통째로 멈춰버리므로 시간초과 한 번에 전부 무작위로 대신 처리해서 턴이 반드시 넘어가게 함
      // (그 외 pendingTarget 종류는 플레이어가 직접 능력 버튼을 눌러서 만든 경우라 범위 밖 - 필요하면 나중에 확장)
      for (let guard = 0; guard < 20; guard++) {
        if (nextState.augmentSelect) {
          const choice = pickRandom(nextState.augmentSelect.choices, 1)[0];
          if (!choice) break;
          nextState = gameReducer(nextState, { type: "PICK_AUGMENT", augment: choice });
          continue;
        }
        if (nextState.pendingTarget && (nextState.pendingTarget.kind === "banZone" || nextState.pendingTarget.kind === "permaBlock")) {
          const cell = pickRandomEmptyCellForTarget(nextState.board, nextState.pendingTarget.selected);
          if (!cell) break;
          nextState = gameReducer(nextState, { type: "TARGET_CELL", x: cell.x, y: cell.y });
          continue;
        }
        break;
      }

      if (nextState.forbiddenMessage) return nextState; // 속박/감시탑/즉발 카드 등 더 구체적인 메시지가 이미 있으면 그대로 둠
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
          const silvers = drawSeveralOfTier("silver", 2, [...ownedIds, ...modeExclude, ...IMMEDIATE_TARGET_EXCLUDE_IDS], seenIds, myColor);
          const golds = drawSeveralOfTier("gold", 1, [...ownedIds, ...modeExclude, ...IMMEDIATE_TARGET_EXCLUDE_IDS, ...silvers.map((a) => a.id)], seenIds, myColor);
          won = [...silvers, ...golds];
        } else {
          // 45% 확률로 프리즘 1개, 실패하면 아무것도 못 얻음 (진짜 도박)
          // 영구 봉쇄(permaBlock)도 프리즘 등급이라 여기서 뽑힐 수 있는데, 그 카드는 뽑는 즉시 칸을 지정해야만
          // 효과가 생기는 카드라 이 경로로 주면 칸을 지정할 방법이 없어 영원히 죽은 카드가 됨 - 반드시 제외해야 함
          won = Math.random() < 0.45 ? drawSeveralOfTier("prism", 1, [...ownedIds, ...IMMEDIATE_TARGET_EXCLUDE_IDS], seenIds, myColor) : [];
        }
        const newOwned = { ...state.ownedAugments, [player]: [...state.ownedAugments[player], ...won] };
        const instantPatch = activateInstantAugments(state, won, player);
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
      patch = { ...patch, ...activateInstantAugments(state, [augment], player) };

      // 둔갑술이 이미 발동 중이었으면(이번 픽으로 처음 발동된 게 아니라 그 전부터 있었으면), 방금 고른
      // 이 카드도 자동으로 위장됨 - 둔갑술 자기 자신은 위장 대상에서 제외(위장된 이름으로 뽑히면 정체가 티가 남)
      if (state.dungapsulActive[player] && augment.id !== "dungapsul") {
        const fakePool = AUGMENTS.filter((a) => a.tier === augment.tier && a.id !== augment.id && a.id !== "dungapsul");
        const [fake] = fakePool.length > 0 ? pickRandom(fakePool, 1) : [];
        if (fake) {
          patch.disguisedCards = {
            ...state.disguisedCards,
            [player]: { ...state.disguisedCards[player], [augment.id]: fake },
          };
        }
      }

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
        if (state.removeStoneCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'돌 제거'는 아직 재사용 대기 중이에요 (" + state.removeStoneCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const removeStoneOpponentColor = colorForPlayer(opponent, state.roleSwapActive);
        if (countStones(state.board, removeStoneOpponentColor) === 0) {
          return {
            ...state,
            forbiddenMessage: "돌 제거: 제거할 상대 돌이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return { ...state, pendingTarget: { player, kind: "removeStone", need: 1, selected: [] } };
      }

      if (ability === "watchtower") {
        return { ...state, pendingTarget: { player, kind: "watchtower", need: 1, selected: [] } };
      }

      if (ability === "ultimatum") {
        return { ...state, pendingTarget: { player, kind: "ultimatum", need: 1, selected: [] } };
      }

      if (ability === "jailbreak") {
        if (state.jailbreakCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'도장깨기'는 아직 재사용 대기 중이에요 (" + state.jailbreakCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const hasBlockedCell =
          state.blockedCells[player].length > 0 ||
          state.permaBlockedCells[player].length > 0 ||
          state.watchtowerCells[player].length > 0;
        if (!hasBlockedCell) {
          return {
            ...state,
            forbiddenMessage: "도장깨기: 해제할 막힌 자리가 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return { ...state, pendingTarget: { player, kind: "jailbreak", need: 1, selected: [] } };
      }

      if (ability === "relocate") {
        if (state.relocateCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'재배치'는 아직 재사용 대기 중이에요 (" + state.relocateCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const relocatePlayerColor = colorForPlayer(player, state.roleSwapActive);
        if (countStones(state.board, relocatePlayerColor) === 0) {
          return {
            ...state,
            forbiddenMessage: "재배치: 옮길 내 돌이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return { ...state, pendingTarget: { player, kind: "relocate", need: 1, selected: [], sourceCell: null } };
      }

      if (ability === "plague") {
        const plagueOpponentColor = colorForPlayer(opponent, state.roleSwapActive);
        if (countStones(state.board, plagueOpponentColor) === 0) {
          return {
            ...state,
            forbiddenMessage: "역병: 제거할 상대 돌이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
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
            ...consumePrepStance(state, opponent, fogImmunity.reason),
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

      if (ability === "lifeTransfer") {
        const eligibleLifeTransfer = state.ownedAugments[player].filter((a) => a.tier === "silver" && a.id !== "lifeTransfer");
        if (eligibleLifeTransfer.length === 0) {
          return {
            ...state,
            forbiddenMessage: "인생환승: 교체할 수 있는 실버 등급 증강이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return { ...state, pendingTarget: { player, kind: "lifeTransfer", need: 1, selected: [] } };
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

      if (ability === "timeCollapse") {
        const snapshot = state.timeCollapseSnapshot[player];
        if (!snapshot) return state; // 획득 시 항상 저장되므로 이론상 항상 존재함
        const revertedBoard = snapshot.map((row) => row.slice());
        // 역병/결계로 영원히 죽은 칸은 스냅샷 당시엔 돌이 있었더라도 되살아나면 안 됨 (deadCells의 불변식 유지)
        for (const cell of state.deadCells) revertedBoard[cell.y][cell.x] = 0;
        return {
          ...state,
          board: revertedBoard,
          lastMove: { 1: null, 2: null },
          oneTimeUsed: markUsed(state, player, "timeCollapse"),
          forbiddenMessage: "'시공간 붕괴'로 판이 획득 당시 상태로 되돌아갔어요!",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

      if (ability === "ward") {
        return { ...state, pendingTarget: { player, kind: "ward", need: 2, selected: [] } };
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
        // 영구 봉쇄(permaBlock)도 프리즘 등급이라 여기서 뽑힐 수 있는데, 그 카드는 뽑는 즉시 칸을 지정해야만
        // 효과가 생기는 카드라 이 경로로 주면 칸을 지정할 방법이 없어 영원히 죽은 카드가 됨 - 반드시 제외해야 함
        const prismPool = AUGMENTS.filter(
          (a) =>
            a.tier === "prism" &&
            matchesColor(a, myColorForBarter) &&
            !IMMEDIATE_TARGET_EXCLUDE_IDS.includes(a.id) &&
            !state.ownedAugments[player].some((o) => o.id === a.id)
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
        const barterInstantPatch = activateInstantAugments(state, [bonus], player);
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
          const ownedIdsAfter = [...state.ownedAugments[player].map((a) => a.id), ...getModeExcludeIds(state), ...IMMEDIATE_TARGET_EXCLUDE_IDS];
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
          const coinInstantPatch = activateInstantAugments(state, [bonus], player);
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

      if (ability === "selfUndo") {
        if (state.selfUndoCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'직전 무르기'는 아직 재사용 대기 중이에요 (" + state.selfUndoCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const last = state.lastMove[player];
        if (!last) return state;
        const newBoard = state.board.map((row) => row.slice());
        newBoard[last.y][last.x] = 0;
        return {
          ...state,
          board: newBoard,
          stonesPlaced: { ...state.stonesPlaced, [player]: state.stonesPlaced[player] - 1 },
          lastMove: { ...state.lastMove, [player]: null },
          selfUndoCooldown: { ...state.selfUndoCooldown, [player]: 4 },
        };
      }

      if (ability === "prepStance") {
        if (state.prepStanceCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'대비태세'는 아직 재사용 대기 중이에요 (" + state.prepStanceCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        if (state.prepStanceActive[player]) {
          return {
            ...state,
            forbiddenMessage: "'대비태세'는 이미 켜져 있어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return {
          ...state,
          prepStanceActive: { ...state.prepStanceActive, [player]: true },
          prepStanceCooldown: { ...state.prepStanceCooldown, [player]: 5 },
          forbiddenMessage: "'대비태세'로 방어막을 켰어요! 다음 제거·봉쇄 공격 1회를 막아줘요",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      // 입김/소금 뿌리기/도토리 던지기: 판에 실제로 관여하되, 대상이 외톨이 돌/돌에서 먼 빈 칸으로만 제한돼서
      // 구조적으로 승부를 못 뒤집는 저강도 심술 액티브 (승리/차단 필수 칸은 항상 기존 돌과 인접해 있다는 성질 이용)
      if (ability === "breeze") {
        if (state.breezeCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'입김'은 아직 재사용 대기 중이에요 (" + state.breezeCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const breezeOpponentColor = colorForPlayer(opponent, state.roleSwapActive);
        // 외톨이 돌 중에서도 "밀린 뒤에 여전히 외톨이로 남는" 목적지가 있는 돌만 후보
        const movable = findIsolatedStones(state.board, breezeOpponentColor)
          .map((cell) => ({ cell, dests: findBreezeDestinations(state.board, cell.x, cell.y) }))
          .filter((m) => m.dests.length > 0);
        if (movable.length === 0) {
          return {
            ...state,
            forbiddenMessage: "입김: 밀어낼 수 있는 상대 외톨이 돌이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const picked = pickRandom(movable, 1)[0];
        const dest = pickRandom(picked.dests, 1)[0];
        const breezeBoard = state.board.map((row) => row.slice());
        breezeBoard[picked.cell.y][picked.cell.x] = 0;
        breezeBoard[dest.y][dest.x] = breezeOpponentColor;
        // 밀린 돌이 상대의 마지막 수였다면 마지막 수 표시(빨간 테두리)도 새 위치를 따라가게 함
        const oppLast = state.lastMove[opponent];
        const movedWasLast = oppLast && oppLast.x === picked.cell.x && oppLast.y === picked.cell.y;
        return {
          ...state,
          board: breezeBoard,
          lastMove: movedWasLast ? { ...state.lastMove, [opponent]: { x: dest.x, y: dest.y } } : state.lastMove,
          breezeCooldown: { ...state.breezeCooldown, [player]: 5 },
          forbiddenMessage: "'입김'으로 상대 외톨이 돌 하나를 옆 칸으로 밀어냈어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "saltScatter") {
        if (state.saltScatterCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'소금 뿌리기'는 아직 재사용 대기 중이에요 (" + state.saltScatterCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const alreadyBlocked = [...state.blockedCells[1], ...state.blockedCells[2]];
        const saltEligible = findSaltEligibleCells(state.board).filter(
          (c) => !alreadyBlocked.some((b) => b.x === c.x && b.y === c.y)
        );
        if (saltEligible.length === 0) {
          return {
            ...state,
            forbiddenMessage: "소금 뿌리기: 뿌릴 만한 먼 빈 칸이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const saltCells = pickRandom(saltEligible, Math.min(3, saltEligible.length));
        // 양쪽 다 각자 2턴 동안 착수 금지 - 기존 금지 구역(blockedCells)의 카운트다운/렌더링(X 표시)을 그대로 재사용
        return {
          ...state,
          blockedCells: {
            1: [...state.blockedCells[1], ...saltCells.map((c) => ({ x: c.x, y: c.y, turnsLeft: 2 }))],
            2: [...state.blockedCells[2], ...saltCells.map((c) => ({ x: c.x, y: c.y, turnsLeft: 2 }))],
          },
          saltScatterCooldown: { ...state.saltScatterCooldown, [player]: 6 },
          forbiddenMessage: "'소금 뿌리기'! 먼 빈 칸 " + saltCells.length + "개가 잠시 양쪽 다 착수 금지됐어요",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "acornToss") {
        if (state.acornTossCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'도토리 던지기'는 아직 재사용 대기 중이에요 (" + state.acornTossCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const acornOpponentColor = colorForPlayer(opponent, state.roleSwapActive);
        const acornTargets = findIsolatedStones(state.board, acornOpponentColor);
        if (acornTargets.length === 0) {
          return {
            ...state,
            forbiddenMessage: "도토리 던지기: 없앨 수 있는 상대 외톨이 돌이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const acornTarget = pickRandom(acornTargets, 1)[0];
        const acornBoard = state.board.map((row) => row.slice());
        acornBoard[acornTarget.y][acornTarget.x] = 0;
        // 제거된 돌이 상대의 마지막 수였다면 마지막 수 표시가 빈 칸을 가리키지 않게 지움
        const acornOppLast = state.lastMove[opponent];
        const removedWasLast = acornOppLast && acornOppLast.x === acornTarget.x && acornOppLast.y === acornTarget.y;
        return {
          ...state,
          board: acornBoard,
          lastMove: removedWasLast ? { ...state.lastMove, [opponent]: null } : state.lastMove,
          acornTossCooldown: { ...state.acornTossCooldown, [player]: 6 },
          currentPlayer: opponent, // 내 턴을 통째로 소모 - 1수 맞교환이라 실질 이득이 없는 순수 심술
          forbiddenMessage: "'도토리 던지기'로 상대 외톨이 돌 하나를 없앴어요! (턴 소모)",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "spotSwap") {
        if (state.spotSwapCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'자리 바꾸기'는 아직 재사용 대기 중이에요 (" + state.spotSwapCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const swapMyColor = colorForPlayer(player, state.roleSwapActive);
        const swapOppColor = colorForPlayer(opponent, state.roleSwapActive);
        const myIsolated = findIsolatedStones(state.board, swapMyColor);
        const oppIsolated = findIsolatedStones(state.board, swapOppColor);
        if (myIsolated.length === 0 || oppIsolated.length === 0) {
          return {
            ...state,
            forbiddenMessage: "자리 바꾸기: 양쪽 다 외톨이 돌이 있어야 해요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        // 두 외톨이 돌은 정의상 서로 인접할 수 없어서(외톨이 = 주변 8칸에 돌 없음), 정확히 같은 두 칸을
        // 맞바꾸는 이 교환 후에도 둘 다 여전히 외톨이로 남음 - 별도 재검증 불필요
        const mySwap = pickRandom(myIsolated, 1)[0];
        const oppSwap = pickRandom(oppIsolated, 1)[0];
        const swapBoard = state.board.map((row) => row.slice());
        swapBoard[mySwap.y][mySwap.x] = swapOppColor;
        swapBoard[oppSwap.y][oppSwap.x] = swapMyColor;
        // 마지막 수 표시가 옮겨진 돌을 따라가게 함
        let swapLastMove = state.lastMove;
        const myLast = state.lastMove[player];
        if (myLast && myLast.x === mySwap.x && myLast.y === mySwap.y) {
          swapLastMove = { ...swapLastMove, [player]: { x: oppSwap.x, y: oppSwap.y } };
        }
        const oppLastSwap = state.lastMove[opponent];
        if (oppLastSwap && oppLastSwap.x === oppSwap.x && oppLastSwap.y === oppSwap.y) {
          swapLastMove = { ...swapLastMove, [opponent]: { x: mySwap.x, y: mySwap.y } };
        }
        return {
          ...state,
          board: swapBoard,
          lastMove: swapLastMove,
          spotSwapCooldown: { ...state.spotSwapCooldown, [player]: 6 },
          forbiddenMessage: "'자리 바꾸기'로 내 외톨이 돌과 상대 외톨이 돌의 위치를 맞바꿨어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "turf") {
        if (state.turfCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'텃세'는 아직 재사용 대기 중이에요 (" + state.turfCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const turfEligible = findSaltEligibleCells(state.board).filter(
          (c) => !state.blockedCells[opponent].some((b) => b.x === c.x && b.y === c.y)
        );
        if (turfEligible.length === 0) {
          return {
            ...state,
            forbiddenMessage: "텃세: 부릴 만한 먼 빈 칸이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const turfCell = pickRandom(turfEligible, 1)[0];
        return {
          ...state,
          blockedCells: {
            ...state.blockedCells,
            [opponent]: [...state.blockedCells[opponent], { x: turfCell.x, y: turfCell.y, turnsLeft: 3 }],
          },
          turfCooldown: { ...state.turfCooldown, [player]: 5 },
          forbiddenMessage: "'텃세'! 먼 빈 칸 1개가 상대만 3턴 동안 착수 금지됐어요",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "gust") {
        if (state.gustCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'돌풍'은 아직 재사용 대기 중이에요 (" + state.gustCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const gustOppColor = colorForPlayer(opponent, state.roleSwapActive);
        const gustBoard = state.board.map((row) => row.slice());
        const gustMoves = [];
        // 최대 2개를 하나씩 밀되, 앞선 이동을 반영한 최신 보드로 매번 재판정 (민 돌끼리 인접해지는 조합 방지)
        for (let i = 0; i < 2; i++) {
          const movable = findIsolatedStones(gustBoard, gustOppColor)
            .filter((c) => !gustMoves.some((m) => m.to.x === c.x && m.to.y === c.y)) // 이번에 이미 민 돌은 다시 안 밈
            .map((cell) => ({ cell, dests: findBreezeDestinations(gustBoard, cell.x, cell.y) }))
            .filter((m) => m.dests.length > 0);
          if (movable.length === 0) break;
          const gustPick = pickRandom(movable, 1)[0];
          const gustDest = pickRandom(gustPick.dests, 1)[0];
          gustBoard[gustPick.cell.y][gustPick.cell.x] = 0;
          gustBoard[gustDest.y][gustDest.x] = gustOppColor;
          gustMoves.push({ from: gustPick.cell, to: gustDest });
        }
        if (gustMoves.length === 0) {
          return {
            ...state,
            forbiddenMessage: "돌풍: 밀어낼 수 있는 상대 외톨이 돌이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        let gustLastMove = state.lastMove;
        const gustOppLast = state.lastMove[opponent];
        const gustMovedLast = gustOppLast && gustMoves.find((m) => m.from.x === gustOppLast.x && m.from.y === gustOppLast.y);
        if (gustMovedLast) {
          gustLastMove = { ...gustLastMove, [opponent]: { x: gustMovedLast.to.x, y: gustMovedLast.to.y } };
        }
        return {
          ...state,
          board: gustBoard,
          lastMove: gustLastMove,
          gustCooldown: { ...state.gustCooldown, [player]: 7 },
          forbiddenMessage: "'돌풍'으로 상대 외톨이 돌 " + gustMoves.length + "개를 밀어냈어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "saltBomb") {
        if (state.saltBombCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'소금 폭탄'은 아직 재사용 대기 중이에요 (" + state.saltBombCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const bombAlreadyBlocked = [...state.blockedCells[1], ...state.blockedCells[2]];
        const bombEligible = findSaltEligibleCells(state.board).filter(
          (c) => !bombAlreadyBlocked.some((b) => b.x === c.x && b.y === c.y)
        );
        if (bombEligible.length === 0) {
          return {
            ...state,
            forbiddenMessage: "소금 폭탄: 던질 만한 먼 빈 칸이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const bombCells = pickRandom(bombEligible, Math.min(5, bombEligible.length));
        return {
          ...state,
          blockedCells: {
            1: [...state.blockedCells[1], ...bombCells.map((c) => ({ x: c.x, y: c.y, turnsLeft: 3 }))],
            2: [...state.blockedCells[2], ...bombCells.map((c) => ({ x: c.x, y: c.y, turnsLeft: 3 }))],
          },
          saltBombCooldown: { ...state.saltBombCooldown, [player]: 8 },
          forbiddenMessage: "'소금 폭탄'! 먼 빈 칸 " + bombCells.length + "개가 잠시 양쪽 다 착수 금지됐어요",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "typhoon") {
        if (state.typhoonCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'태풍'은 아직 재사용 대기 중이에요 (" + state.typhoonCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const typhoonBoard = state.board.map((row) => row.slice());
        // 양쪽 색의 외톨이 돌 전부를 무작위 순서로 하나씩 밀어냄 - 앞선 이동을 반영해 매번 재판정하므로
        // (목적지 후보가 "다른 돌과 비인접인 칸"만이라) 어떤 순서로 밀려도 전부 서로 외톨이로 남음
        const typhoonTargets = pickRandom(
          [
            ...findIsolatedStones(typhoonBoard, 1).map((c) => ({ ...c, color: 1 })),
            ...findIsolatedStones(typhoonBoard, 2).map((c) => ({ ...c, color: 2 })),
          ],
          BOARD_SIZE * BOARD_SIZE
        );
        const typhoonMoves = [];
        for (const t of typhoonTargets) {
          if (typhoonBoard[t.y][t.x] !== t.color) continue;
          if (!findIsolatedStones(typhoonBoard, t.color).some((c) => c.x === t.x && c.y === t.y)) continue;
          const tDests = findBreezeDestinations(typhoonBoard, t.x, t.y);
          if (tDests.length === 0) continue;
          const tDest = pickRandom(tDests, 1)[0];
          typhoonBoard[t.y][t.x] = 0;
          typhoonBoard[tDest.y][tDest.x] = t.color;
          typhoonMoves.push({ from: { x: t.x, y: t.y }, to: tDest, color: t.color });
        }
        if (typhoonMoves.length === 0) {
          return {
            ...state,
            forbiddenMessage: "태풍: 흩날릴 외톨이 돌이 하나도 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        // 양쪽의 마지막 수 표시가 옮겨진 돌을 따라가게 함 (신원별 담당 색 기준으로 대조)
        let typhoonLastMove = state.lastMove;
        for (const p of [1, 2]) {
          const pLast = typhoonLastMove[p];
          if (!pLast) continue;
          const pColor = colorForPlayer(p, state.roleSwapActive);
          const movedP = typhoonMoves.find((m) => m.color === pColor && m.from.x === pLast.x && m.from.y === pLast.y);
          if (movedP) typhoonLastMove = { ...typhoonLastMove, [p]: { x: movedP.to.x, y: movedP.to.y } };
        }
        return {
          ...state,
          board: typhoonBoard,
          lastMove: typhoonLastMove,
          typhoonCooldown: { ...state.typhoonCooldown, [player]: 10 },
          forbiddenMessage: "'태풍'! 판 위 외톨이 돌 " + typhoonMoves.length + "개가 사방으로 흩날렸어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (ability === "prevention") {
        if (state.preventionCooldown[player] > 0) {
          return {
            ...state,
            forbiddenMessage: "'예방'은 아직 재사용 대기 중이에요 (" + state.preventionCooldown[player] + "수 남음)",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        if (state.preventedStone[player]) {
          return {
            ...state,
            forbiddenMessage: "'예방'은 이미 보호 중인 돌이 있어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const preventionPlayerColor = colorForPlayer(player, state.roleSwapActive);
        if (countStones(state.board, preventionPlayerColor) === 0) {
          return {
            ...state,
            forbiddenMessage: "예방: 보호할 내 돌이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return { ...state, pendingTarget: { player, kind: "prevention", need: 1, selected: [] } };
      }

      if (ability === "reverseScale") {
        const reverseScalePlayerColor = colorForPlayer(player, state.roleSwapActive);
        if (countStones(state.board, reverseScalePlayerColor) === 0) {
          return {
            ...state,
            forbiddenMessage: "역린: 표시할 내 돌이 없어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        return { ...state, pendingTarget: { player, kind: "reverseScale", need: 1, selected: [] } };
      }

      if (ability === "undo") {
        const last = state.lastMove[opponent];
        if (!last) return state;

        const immunity = checkImmunity(state, opponent);
        if (immunity.immune) {
          return {
            ...state,
            // 부적/철옹성/대비태세에 막히면 카드만 소모되고 내 턴은 그대로 유지 (돌은 정상적으로 놓을 수 있음)
            ...consumePrepStance(state, opponent, immunity.reason),
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
        // 예방: 이 정확한 칸이 피해자가 미리 지정해둔 보호 대상이면, 여진과 같은 방식으로 1회 막아줌 (여진이 먼저 소모됨)
        const preventionActive =
          !immunity.immune &&
          !aftershockActive &&
          !!state.preventedStone[opponent] &&
          state.preventedStone[opponent].x === x &&
          state.preventedStone[opponent].y === y;
        // 도깨비불: 위 방어들을 전부 통과한 뒤에도 최후로 30% 확률 저항
        const dokkaebiActive =
          !immunity.immune && !aftershockActive && !preventionActive && rollDokkaebiSurvival(state, opponent);
        const blocked = immunity.immune || aftershockActive || preventionActive || dokkaebiActive;
        const actuallyRemoved = !blocked;
        const newBoard = state.board.map((row) => row.slice());
        if (actuallyRemoved) newBoard[y][x] = 0;

        const survivorPatch = actuallyRemoved ? triggerSurvivorQuestIfNeeded(state, opponent) : null;
        const interestPatch = actuallyRemoved ? triggerInterestIfNeeded(state, opponent) : null;
        let workingState = state;
        if (survivorPatch) workingState = { ...workingState, ...survivorPatch };
        if (interestPatch) workingState = { ...workingState, ...interestPatch };
        const karmaPatch = actuallyRemoved ? triggerKarmaIfNeeded(workingState, opponent, newBoard) : null;
        if (karmaPatch) workingState = { ...workingState, ...karmaPatch };

        let newOneTimeUsed = applyImmunityConsumption(workingState.oneTimeUsed, opponent, immunity.reason);
        let extraMessage = "";
        if (aftershockActive) {
          newOneTimeUsed = { ...newOneTimeUsed, [opponent]: { ...newOneTimeUsed[opponent], aftershock: true } };
          extraMessage = "상대가 '여진'으로 돌을 지켜냈어요!";
        }
        if (preventionActive) {
          extraMessage = "상대가 '예방'으로 그 돌을 지켜냈어요!";
        }
        if (dokkaebiActive) {
          extraMessage = "상대가 '도깨비불'에 홀려서 그 돌은 그대로 남았어요!";
        }

        // 역풍: 피해자가 역풍을 갖고 있고 이번 공격이 (면역/여진/예방/도깨비불 중 무엇으로든) 실제로 막혔으면,
        // 공격자가 쓴 카드가 재사용 대기시간 방식일 때(현재는 돌 제거만 해당) 그 대기시간을 2배로 늘림
        // - 아래 return의 removeStoneCooldown 계산에서 이 값을 그대로 씀 (기본 5를 나중에 덮어쓰지 않도록 여기서만 결정)
        let backlashMessage = "";
        let removeStoneCooldownAfterUse = 5;
        if (blocked) {
          const victimOwnedIds = getActiveAugmentIds(workingState, opponent);
          if (victimOwnedIds.includes("backlash")) {
            removeStoneCooldownAfterUse = 10;
            backlashMessage = " 상대의 '역풍'에 걸려서 '돌 제거' 재사용 대기시간이 늘어났어요!";
          }
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
          ...consumePrepStance(state, opponent, immunity.reason),
          board: newBoard,
          pendingTarget: null,
          oneTimeUsed: newOneTimeUsed,
          removeStoneCooldown: { ...workingState.removeStoneCooldown, [player]: removeStoneCooldownAfterUse },
          preventedStone: preventionActive
            ? { ...workingState.preventedStone, [opponent]: null }
            : workingState.preventedStone,
          forbiddenMessage: (immunity.immune
            ? immunityMessage(immunity.reason)
            : (survivorPatch ? survivorPatch.forbiddenMessage + " " : "") +
              (interestPatch ? interestPatch.forbiddenMessage + " " : "") +
              (karmaPatch?.forbiddenMessage ? karmaPatch.forbiddenMessage + " " : "") +
              extraMessage +
              counterMessage) + backlashMessage,
          forbiddenToken:
            immunity.immune || extraMessage || counterMessage || survivorPatch || interestPatch || karmaPatch || backlashMessage
              ? state.forbiddenToken + 1
              : state.forbiddenToken,
          // 면역/여진/예방에 막히면 재사용 대기시간만 돌고 내 턴은 유지 (돌은 정상적으로 놓을 수 있음)
          currentPlayer: blocked ? player : opponent,
        };
      }

      if (kind === "watchtower") {
        if (state.board[y][x] !== 0) return state;
        const ambushPatch = !immunity.immune ? triggerAmbushIfNeeded(state, opponent) || {} : {};
        const watchtowerCard = state.ownedAugments[player].find((a) => a.id === "watchtower");
        const watchtowerWindow = watchtowerCard?.enhanced ? 6 : 4;
        const stateAfterWatchtower = {
          ...state,
          ...ambushPatch,
          ...consumePrepStance(state, opponent, immunity.reason),
          pendingTarget: null,
          watchtowerCells: immunity.immune
            ? state.watchtowerCells
            : { ...state.watchtowerCells, [opponent]: [...state.watchtowerCells[opponent], { x, y, turnsLeft: watchtowerWindow }] },
          oneTimeUsed: applyImmunityConsumption(
            // ambushPatch.oneTimeUsed는 이미 잠복(victim 키)뿐 아니라 낙수효과가 함께 발동했다면 그 신원(player 키일
            // 수도 있음)까지 반영된 완전한 {1:..,2:..} 객체이므로, watchtower 사용 표시만 player 키에 얹어야 함
            // (예전엔 [opponent] 키만 잘라와서 player 쪽에 낙수효과가 얹혔을 경우 그 표시가 조용히 유실되는 버그가 있었음)
            ambushPatch.oneTimeUsed
              ? { ...ambushPatch.oneTimeUsed, [player]: { ...ambushPatch.oneTimeUsed[player], watchtower: true } }
              : markUsed(state, player, "watchtower"),
            opponent,
            immunity.reason
          ),
          forbiddenMessage: immunity.immune ? immunityMessage(immunity.reason) : "",
          forbiddenToken: immunity.immune ? state.forbiddenToken + 1 : state.forbiddenToken,
          currentPlayer: immunity.immune ? player : opponent,
        };
        if (immunity.immune) return stateAfterWatchtower;
        const postPatch = applyBlockLandedHooks(stateAfterWatchtower, opponent);
        return postPatch
          ? { ...stateAfterWatchtower, ...postPatch, forbiddenToken: state.forbiddenToken + 1 }
          : stateAfterWatchtower;
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
          jailbreakCooldown: { ...state.jailbreakCooldown, [player]: 5 },
          forbiddenMessage: "'도장깨기'로 막힌 자리를 하나 풀었어요!",
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

      if (kind === "relocate") {
        if (!state.pendingTarget.sourceCell) {
          if (state.board[y][x] !== playerColor) return state;
          // 옮길 곳(빈 인접 칸)이 하나도 없으면(그 돌이 사방으로 꽉 막혀 있으면) sourceCell을 확정하지 않고
          // 다시 고르게 함 - 안 그러면 2단계에서 고를 목적지가 하나도 없어 pendingTarget이 영원히 안 풀리는
          // 소프트락이 됨 (AI 자동 대국으로 실제 재현됨)
          let hasDestination = false;
          for (let dx = -1; dx <= 1 && !hasDestination; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && state.board[ny][nx] === 0) {
                hasDestination = true;
                break;
              }
            }
          }
          if (!hasDestination) {
            return {
              ...state,
              forbiddenMessage: "재배치: 그 돌은 주변이 꽉 차서 옮길 수 없어요. 다른 돌을 선택하세요",
              forbiddenToken: state.forbiddenToken + 1,
            };
          }
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
          relocateCooldown: { ...state.relocateCooldown, [player]: 6 },
          currentPlayer: opponent,
        };
      }

      if (kind === "prevention") {
        if (state.board[y][x] !== playerColor) return state;
        return {
          ...state,
          preventedStone: { ...state.preventedStone, [player]: { x, y } },
          preventionCooldown: { ...state.preventionCooldown, [player]: 6 },
          pendingTarget: null,
          forbiddenMessage: "'예방'으로 이 돌을 보호했어요! 다음 제거 시도 1회를 막아줘요",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

      if (kind === "reverseScale") {
        if (state.board[y][x] !== playerColor) return state;
        return {
          ...state,
          reverseScaleCell: { ...state.reverseScaleCell, [player]: { x, y } },
          pendingTarget: null,
          oneTimeUsed: markUsed(state, player, "reverseScale"),
          forbiddenMessage: "'역린'으로 이 돌을 표시했어요! 상대가 인접 칸에 두면 그 수가 무효화돼요",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

      if (kind === "plague") {
        if (state.board[y][x] !== opponentColor) return state;
        // 도깨비불: 면역을 통과한 뒤에도 최후로 30% 확률 저항
        const dokkaebiActive = !immunity.immune && rollDokkaebiSurvival(state, opponent);
        const actuallyRemoved = !immunity.immune && !dokkaebiActive;
        const newBoard = state.board.map((row) => row.slice());
        if (actuallyRemoved) newBoard[y][x] = 0;
        const survivorPatch = actuallyRemoved ? triggerSurvivorQuestIfNeeded(state, opponent) : null;
        const interestPatch = actuallyRemoved ? triggerInterestIfNeeded(state, opponent) : null;
        let workingState = state;
        if (survivorPatch) workingState = { ...workingState, ...survivorPatch };
        if (interestPatch) workingState = { ...workingState, ...interestPatch };
        const karmaPatch = actuallyRemoved ? triggerKarmaIfNeeded(workingState, opponent, newBoard) : null;
        if (karmaPatch) workingState = { ...workingState, ...karmaPatch };
        return {
          ...workingState,
          ...consumePrepStance(state, opponent, immunity.reason),
          board: newBoard,
          pendingTarget: null,
          deadCells: actuallyRemoved ? [...state.deadCells, { x, y }] : state.deadCells,
          oneTimeUsed: applyImmunityConsumption(markUsed(workingState, player, "plague"), opponent, immunity.reason),
          forbiddenMessage: immunity.immune
            ? immunityMessage(immunity.reason)
            : dokkaebiActive
            ? "상대가 '도깨비불'에 홀려서 이번 '역병'은 실패했어요!"
            : (survivorPatch ? survivorPatch.forbiddenMessage + " " : "") +
              (interestPatch ? interestPatch.forbiddenMessage + " " : "") +
              (karmaPatch?.forbiddenMessage || ""),
          forbiddenToken:
            immunity.immune || dokkaebiActive || survivorPatch || interestPatch || karmaPatch
              ? state.forbiddenToken + 1
              : state.forbiddenToken,
          currentPlayer: immunity.immune || dokkaebiActive ? player : opponent,
        };
      }

      if (kind === "collapse") {
        // 철옹성/부적을 가진 상대의 돌은 이 3x3 범위 안에 있어도 지켜짐 (내 자신의 돌은 자폭이라 면역과 무관하게 그대로 사라짐)
        const newBoard = state.board.map((row) => row.slice());
        let blockedAny = false;
        let dokkaebiBlockedAny = false;
        let selfRemovedAny = false;
        let oppRemovedAny = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cx = x + dx;
            const cy = y + dy;
            if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) continue;
            if (newBoard[cy][cx] === opponentColor) {
              if (immunity.immune) {
                blockedAny = true;
                continue;
              }
              // 도깨비불: 면역을 통과한 상대 돌도 이 칸 하나마다 독립적으로 30% 확률로 저항
              if (rollDokkaebiSurvival(state, opponent)) {
                dokkaebiBlockedAny = true;
                continue;
              }
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
        const selfInterestPatch = selfRemovedAny ? triggerInterestIfNeeded(workingState, player) : null;
        if (selfInterestPatch) workingState = { ...workingState, ...selfInterestPatch };
        const oppInterestPatch = oppRemovedAny ? triggerInterestIfNeeded(workingState, opponent) : null;
        if (oppInterestPatch) workingState = { ...workingState, ...oppInterestPatch };
        const selfKarmaPatch = selfRemovedAny ? triggerKarmaIfNeeded(workingState, player, newBoard) : null;
        if (selfKarmaPatch) workingState = { ...workingState, ...selfKarmaPatch };
        const oppKarmaPatch = oppRemovedAny ? triggerKarmaIfNeeded(workingState, opponent, newBoard) : null;
        if (oppKarmaPatch) workingState = { ...workingState, ...oppKarmaPatch };
        const questMessage = [
          selfSurvivorPatch?.forbiddenMessage,
          oppSurvivorPatch?.forbiddenMessage,
          selfInterestPatch?.forbiddenMessage,
          oppInterestPatch?.forbiddenMessage,
          selfKarmaPatch?.forbiddenMessage,
          oppKarmaPatch?.forbiddenMessage,
        ]
          .filter(Boolean)
          .join(" ");
        return {
          ...workingState,
          ...consumePrepStance(state, opponent, immunity.reason),
          board: newBoard,
          pendingTarget: null,
          oneTimeUsed: applyImmunityConsumption(markUsed(workingState, player, "collapse"), opponent, immunity.reason),
          forbiddenMessage:
            (blockedAny
              ? immunityMessage(immunity.reason)
              : "'붕괴'로 3x3 구역이 사라졌어요!" + (questMessage ? " " + questMessage : "")) +
            (dokkaebiBlockedAny ? " '도깨비불'이 일부를 지켜냈어요!" : ""),
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

      if (kind === "ward") {
        if (selected.length === 0) {
          return { ...state, pendingTarget: { ...state.pendingTarget, selected: [{ x, y }] } };
        }
        const a = selected[0];
        // 첫 번째로 고른 칸을 다시 클릭하면 선택을 취소하고 처음부터 다시 고르게 함(토글)
        if (x === a.x && y === a.y) return { ...state, pendingTarget: { ...state.pendingTarget, selected: [] } };
        const dx = x - a.x;
        const dy = y - a.y;
        const isAligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
        if (!isAligned) {
          // 일직선이 아니면 처음 고른 칸은 유지한 채 다시 두 번째 칸을 고르게 함 (카드는 소모 안 됨)
          return {
            ...state,
            forbiddenMessage: "결계: 두 칸이 가로/세로/대각선으로 일직선이어야 해요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const stepX = Math.sign(dx);
        const stepY = Math.sign(dy);
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        const between = [];
        for (let i = 1; i < steps; i++) {
          const cx = a.x + stepX * i;
          const cy = a.y + stepY * i;
          if (state.board[cy][cx] === 0 && !state.deadCells.some((c) => c.x === cx && c.y === cy)) {
            between.push({ x: cx, y: cy });
          }
        }
        return {
          ...state,
          pendingTarget: null,
          deadCells: [...state.deadCells, ...between],
          oneTimeUsed: markUsed(state, player, "ward"),
          forbiddenMessage:
            between.length > 0
              ? "'결계'로 " + between.length + "칸이 게임 끝까지 양쪽 다 착수 금지됐어요!"
              : "'결계'를 사용했지만 사이에 막을 빈 칸이 없었어요",
          forbiddenToken: state.forbiddenToken + 1,
          currentPlayer: opponent,
        };
      }

      if (kind === "banZone" || kind === "permaBlock") {
        if (state.board[y][x] !== 0) return state;
        // 이미 선택한 칸을 다시 클릭하면 그 선택을 취소함(토글) - 잘못 고른 칸을 무르려면 예전엔
        // 방법이 없었음(조용히 무시됐음)
        if (selected.some((c) => c.x === x && c.y === y)) {
          return { ...state, pendingTarget: { ...state.pendingTarget, selected: selected.filter((c) => !(c.x === x && c.y === y)) } };
        }
        const newSelected = [...selected, { x, y }];

        if (newSelected.length < need) {
          return { ...state, pendingTarget: { ...state.pendingTarget, selected: newSelected } };
        }

        const nextPlayer = state.pendingTarget.keepTurn ? player : opponent;

        if (immunity.immune) {
          // 면역에 막히면 카드만 소모되고 내 턴은 유지 (돌은 정상적으로 놓을 수 있음)
          return {
            ...state,
            ...consumePrepStance(state, opponent, immunity.reason),
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
          const stateAfterBanZone = {
            ...state,
            ...ambushPatch,
            pendingTarget: null,
            blockedCells: { ...state.blockedCells, [opponent]: [...state.blockedCells[opponent], ...additions] },
            currentPlayer: nextPlayer,
          };
          const postPatch = applyBlockLandedHooks(stateAfterBanZone, opponent);
          return postPatch
            ? { ...stateAfterBanZone, ...postPatch, forbiddenToken: state.forbiddenToken + 1 }
            : stateAfterBanZone;
        }

        const stateAfterPermaBlock = {
          ...state,
          ...ambushPatch,
          pendingTarget: null,
          permaBlockedCells: { ...state.permaBlockedCells, [opponent]: [...state.permaBlockedCells[opponent], ...newSelected] },
          currentPlayer: nextPlayer,
        };
        const postPatch = applyBlockLandedHooks(stateAfterPermaBlock, opponent);
        return postPatch
          ? { ...stateAfterPermaBlock, ...postPatch, forbiddenToken: state.forbiddenToken + 1 }
          : stateAfterPermaBlock;
      }

      return state;
    }

    // 파기(discard)/감정(appraisal): 보드 칸이 아니라 "내가 보유한 증강 카드 하나"를 대상으로 고르는 액션
    case "PICK_CARD_TARGET": {
      const { augmentId } = action;
      if (!state.pendingTarget) return state;
      const { player, kind } = state.pendingTarget;
      if (kind !== "discard" && kind !== "appraisal" && kind !== "lifeTransfer") return state;

      const ownedList = state.ownedAugments[player];
      const idx = ownedList.findIndex((a) => a.id === augmentId);
      if (idx === -1) return state;
      const targetCard = ownedList[idx];

      if (kind === "lifeTransfer") {
        if (targetCard.tier !== "silver" || targetCard.id === "lifeTransfer") {
          return {
            ...state,
            forbiddenMessage: "인생환승: 실버 등급 증강만 대상으로 고를 수 있어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const remainingOwnedIds = ownedList.filter((_, i) => i !== idx).map((a) => a.id);
        const seenIds = state.usedAugmentIds[player];
        const newCard = drawOneOfTier(
          "gold",
          [...remainingOwnedIds, ...getModeExcludeIds(state), ...IMMEDIATE_TARGET_EXCLUDE_IDS],
          seenIds,
          colorForPlayer(player, state.roleSwapActive)
        );
        if (!newCard) {
          return {
            ...state,
            forbiddenMessage: "인생환승: 새로 뽑을 골드 카드가 남지 않아서 아무 일도 일어나지 않았어요",
            forbiddenToken: state.forbiddenToken + 1,
          };
        }
        const newOwnedList = ownedList.slice();
        newOwnedList[idx] = newCard;
        const lifeTransferInstantPatch = activateInstantAugments(state, [newCard], player);
        const lifeTransferMessage = "'인생환승'으로 '" + targetCard.name + "'을(를) 버리고 '" + newCard.name + "'을(를) 얻었어요!";
        return {
          ...state,
          ...lifeTransferInstantPatch,
          ownedAugments: { ...state.ownedAugments, [player]: newOwnedList },
          disguisedCards: clearDisguiseEntry(state.disguisedCards, player, targetCard.id),
          usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, newCard.id])] },
          pendingTarget: null,
          oneTimeUsed: markUsed(state, player, "lifeTransfer"),
          forbiddenMessage: lifeTransferInstantPatch.forbiddenMessage
            ? lifeTransferMessage + " " + lifeTransferInstantPatch.forbiddenMessage
            : lifeTransferMessage,
          forbiddenToken: state.forbiddenToken + 1,
        };
      }

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
          [...remainingOwnedIds, ...getModeExcludeIds(state), ...IMMEDIATE_TARGET_EXCLUDE_IDS],
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
        // 새로 뽑힌 카드가 교도소/링 위에서 싸우자 등 "뽑는 즉시 발동"하는 카드일 수 있어서 반드시 거쳐야 함
        // (일반 드래프트/거래/도박/동전 던지기/잠복은 이미 다 거치는데 파기만 빠뜨렸던 버그)
        const discardInstantPatch = activateInstantAugments(state, [newCard], player);
        const discardMessage = "'파기'로 '" + targetCard.name + "'을(를) 버리고 '" + newCard.name + "'을(를) 얻었어요!";
        return {
          ...state,
          ...discardInstantPatch,
          ownedAugments: { ...state.ownedAugments, [player]: newOwnedList },
          disguisedCards: clearDisguiseEntry(state.disguisedCards, player, targetCard.id),
          usedAugmentIds: { ...state.usedAugmentIds, [player]: [...new Set([...seenIds, newCard.id])] },
          pendingTarget: null,
          oneTimeUsed: markUsed(state, player, "discard"),
          forbiddenMessage: discardInstantPatch.forbiddenMessage ? discardMessage + " " + discardInstantPatch.forbiddenMessage : discardMessage,
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
      const { player, chosenColor } = action;
      if (!state.gameOver) return state;
      const newRequested = { ...state.rematchRequested, [player]: true };
      // 진 쪽이 다음 판 색을 직접 골랐으면(chosenColor) 상대가 아직 확정 안 했어도 기억해뒀다가,
      // 양쪽 다 확정되는 순간 그 선택대로 colorFlipped를 계산함 (온라인 전용 - 아래 참고)
      const newPendingColor = chosenColor != null ? chosenColor : state.pendingRematchColor;
      if (newRequested[1] && newRequested[2]) {
        // 기본값: 기존처럼 흑/백을 서로 바꿔서 시작(무승부이거나 색 선택 정보가 없을 때)
        let nextColorFlipped = !state.colorFlipped;
        // 진 쪽이 색을 직접 골랐으면 그 선택대로 colorFlipped를 계산(온라인 모드에서만 의미 있음 -
        // 로컬/싱글플레이는 물리적 신원 개념이 없어서 colorFlipped 자체가 렌더링에 안 쓰이는 무해한 값)
        if (state.isOnlineMode && state.winnerPlayer != null && newPendingColor != null) {
          const loserPlayer = otherPlayer(state.winnerPlayer);
          nextColorFlipped = newPendingColor !== loserPlayer;
        }
        return { ...initialGameState(state.isOnlineMode), colorFlipped: nextColorFlipped };
      }
      return { ...state, rematchRequested: newRequested, pendingRematchColor: newPendingColor };
    }

    default:
      return state;
  }
}
