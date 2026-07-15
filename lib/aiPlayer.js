// 싱글플레이(컴퓨터 대전) 상대 AI - 휴리스틱 기반, 외부 API를 쓰지 않음
//
// 설계 원칙: 이 게임은 68개+ 증강이 있고 앞으로도 계속 늘어나거나 패치될 거라, "각 증강 id마다 AI 코드를 직접
// 하드코딩"하는 방식은 새 증강이 나올 때마다 이 파일도 매번 고쳐야 해서 금방 낡는다. 대신 최대한 "실제 리듀서를
// 그대로 시험 삼아 돌려보고(dry-run) 결과를 관찰"하는 방식으로 판단해서, gameReducer.js에 새 증강 케이스가
// 추가되기만 하면(이미 이 프로젝트의 표준 패턴) 이 파일을 안 고쳐도 AI가 그 증강을 자동으로 인식하고 다룰 수 있게 함:
//   - "지금 이 액티브 능력을 쓸 수 있는가" -> USE_ABILITY를 실제로 dry-run 해보고 상태가 의미 있게 바뀌는지로 판정
//     (쿨다운/1회용 소모/조건부 실패 등 리듀서가 이미 하는 모든 게이트를 그대로 재사용 - 별도 자격 체크 코드 불필요)
//   - "대상(칸/카드)을 뭘로 골라야 하는가" -> pendingTarget.kind 이름을 몰라도, 후보들을 dry-run TARGET_CELL로
//     실제로 시도해보고 실제로 상태가 바뀌는 것들 중 결과 보드 평가가 가장 좋은 걸 고름
// 다만 "증강 선택 카드 3장 중 뭘 고를지"와 "액티브 능력을 지금 당장 쓸 가치가 있는지" 같은 순수 취향 판단은
// dry-run만으로 알 수 없어서, 등급 기반 기본 점수 + 알려진 카드에 대한 소소한 보정치(AUGMENT_PICK_HINTS)를 쓴다.
// 처음 보는(향후 추가된) 카드는 보정치가 0이라 등급 점수만으로 평가되고, 액티브 능력도 기본 우선순위값으로
// 적당히 시도해봄 - 절대 크래시하거나 멈추지 않고, 조금 둔감하게라도 항상 뭔가 합리적인 선택을 함.

import {
  BOARD_SIZE,
  AXIS_DIRECTIONS,
  checkWin,
  findThreatCells,
  colorForPlayer,
  getEffectiveAugmentIds,
  pickRandom,
} from "./gomokuEngine.js";
import { gameReducer, getActiveAugmentIds, getLegalCells } from "./gameReducer.js";

const CENTER = (BOARD_SIZE - 1) / 2;

function otherPlayer(p) {
  return p === 1 ? 2 : 1;
}

function inBounds(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

// ---------------------------------------------------------------------------
// 보드 평가 (색상 무관 - 증강별 정확한 승리 조건은 checkWin/findThreatCells로 별도 체크하고,
// 여기서는 "이 모양이 대략 얼마나 위협적인가"만 근사치로 매김)
// ---------------------------------------------------------------------------

// (x,y)를 중심으로 (dx,dy) 축 방향 라인을 문자열로: 'X'=이 색, 'O'=상대색 또는 보드 밖, '.'=빈칸
function scanLine(board, x, y, dx, dy, range, color) {
  let line = "";
  for (let i = -range; i <= range; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;
    if (!inBounds(nx, ny)) {
      line += "O";
      continue;
    }
    const cell = board[ny][nx];
    line += cell === color ? "X" : cell === 0 ? "." : "O";
  }
  return line;
}

const PATTERNS = [
  { re: /XXXXX/, score: 100000 },
  { re: /\.XXXX\./, score: 15000 },
  { re: /OXXXX\.|\.XXXXO/, score: 7000 },
  { re: /XXXX/, score: 4000 },
  { re: /XX\.XX/, score: 6000 },
  { re: /X\.XXX|XXX\.X/, score: 3500 },
  { re: /\.XXX\./, score: 1200 },
  { re: /OXXX\.|\.XXXO/, score: 300 },
  { re: /\.X\.XX\.|\.XX\.X\./, score: 350 },
  { re: /\.XX\./, score: 70 },
];

// 특정 칸(x,y)에 color를 놓았다고 가정할 때 그 칸 기준 4방향 패턴 점수 (착수 후보 정렬용, 가볍게 그 칸만 봄)
function cellPotential(board, x, y, color) {
  const test = board.map((row) => row.slice());
  test[y][x] = color;
  let total = 0;
  for (const { dx, dy } of AXIS_DIRECTIONS) {
    const line = scanLine(test, x, y, dx, dy, 4, color);
    for (const { re, score } of PATTERNS) {
      if (re.test(line)) total += score;
    }
  }
  return total;
}

// 보드 전체를 이 색 기준으로 평가(능력 사용 판단/대상 선정용 - 조금 더 비쌈, 자주 부르지 않음)
// 같은 줄을 여러 번 세지 않도록 각 축에서 "줄의 시작점"(뒤쪽 이웃이 같은 색이 아닌 지점)에서만 패턴을 셈
function fullBoardScore(board, color) {
  let total = 0;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== color) continue;
      for (const { dx, dy } of AXIS_DIRECTIONS) {
        const bx = x - dx;
        const by = y - dy;
        if (inBounds(bx, by) && board[by][bx] === color) continue;
        const line = scanLine(board, x, y, dx, dy, 4, color);
        for (const { re, score } of PATTERNS) {
          if (re.test(line)) total += score;
        }
      }
    }
  }
  return total;
}

function evalStateForPlayer(state, aiPlayer) {
  const myColor = colorForPlayer(aiPlayer, state.roleSwapActive);
  const oppColor = myColor === 1 ? 2 : 1;
  return fullBoardScore(state.board, myColor) - fullBoardScore(state.board, oppColor);
}

// ---------------------------------------------------------------------------
// 착수 선택
// ---------------------------------------------------------------------------

function decideAiMove(state, aiPlayer) {
  const opponent = otherPlayer(aiPlayer);
  const myColor = colorForPlayer(aiPlayer, state.roleSwapActive);
  const oppColor = myColor === 1 ? 2 : 1;
  const total = state.stonesPlaced[1] + state.stonesPlaced[2];
  const myEffIds = getEffectiveAugmentIds(getActiveAugmentIds(state, aiPlayer), total);
  const oppEffIds = getEffectiveAugmentIds(getActiveAugmentIds(state, opponent), total);

  const legalCells = getLegalCells(state, aiPlayer);
  if (legalCells.length === 0) return null;

  // 폭주 중엔 어차피 클릭 좌표를 리듀서가 무시하고 무작위 칸으로 대체하니 계산 낭비하지 않음
  if (state.chaosActive) return legalCells[0];

  // 1. 지금 바로 이기는 자리가 있으면 최우선으로 둠
  for (const cell of legalCells) {
    const test = state.board.map((row) => row.slice());
    test[cell.y][cell.x] = myColor;
    if (checkWin(test, cell.x, cell.y, myColor, myEffIds, state.lastMove[aiPlayer])) return cell;
  }

  // 2. 상대가 다음 수로 이기는 자리가 있으면 그중 하나를 반드시 막음
  const oppWinCells = findThreatCells(state.board, oppColor, oppEffIds, state.lastMove[opponent]);
  const legalKeySet = new Set(legalCells.map((c) => c.x + "," + c.y));
  const blockable = oppWinCells.filter((c) => legalKeySet.has(c.x + "," + c.y));
  const candidatePool = blockable.length > 0 ? blockable : legalCells;

  // 3. 남은 후보 중 (내 이득 + 상대 이득 견제 - 중앙에서 먼 정도) 기준 최고점 + 약간의 무작위성으로 선택
  let best = null;
  for (const cell of candidatePool) {
    const myGain = cellPotential(state.board, cell.x, cell.y, myColor);
    const oppGain = cellPotential(state.board, cell.x, cell.y, oppColor);
    const centerBias = -(Math.abs(cell.x - CENTER) + Math.abs(cell.y - CENTER)) * 2;
    const score = myGain + oppGain * 0.9 + centerBias + Math.random() * 15;
    if (!best || score > best.score) best = { x: cell.x, y: cell.y, score };
  }
  return best;
}

// ---------------------------------------------------------------------------
// 증강 선택 (드래프트) - 등급 기반 기본 점수 + 알려진 카드 보정치. 모르는 카드는 등급 점수만으로 평가되니
// 새 증강이 추가돼도 절대 죽지 않고, 그냥 그 등급에 맞는 무난한 가치로 취급됨
// ---------------------------------------------------------------------------

const TIER_BASE_SCORE = { silver: 10, gold: 22, prism: 38 };

// 알려진 카드에 대한 손질 - 없는 id는 그냥 0(등급 점수만으로 판단)이라 미래에 카드가 추가/삭제/패치돼도 안전함
const AUGMENT_PICK_HINTS = {
  diagBoost: 6, straightBoost: 6, rush: 10, fortress: 4, revive: 6, awakening: 4,
  bind: 6, othello: 4, colorSwap: -2, bridge: 4, boardFlip: -6, collapse: 4,
  oracle: 8, prison: 2, domino: 6, permaBlock: 8, battleRing: -4, chaos: -8,
  capture: 8, roleSwap: -2, checkerboard: -6, timeCollapse: 4, ward: 2,
  banZone: 6, undo: 6, territory: 4, doubleMove: 8, squareFrame: 2,
  barter: 4, watchtower: 4, ultimatum: 2, raid: 4, relocate: 2, lockdown: 4,
  plague: 6, sanctuary: 2, conqueror: 2, adjacentLink: 4, peek: 2, doubleChoice: 6,
  selfUndo: 0, threatRadar: 6, removeStone: 6, attrition: 2, coinFlip: 0,
  leverage: 2, gamble: -2, talisman: 4, intuition: 6, balance: 2, jailbreak: 0,
  aftershock: 4, lateBloomer: 2, counterStrike: 4, stockpile: 4, ambush: 2,
  survivor: 2, counterWatch: 2, noYield: 2, fog: 0, foresight: 4, brink: 2,
  appraisal: 4, discard: 0, nozdormu: -2, pokerFace: 2, gambleMixed: 6, gamblePrism1: -8,
  underdogGrit: 2,
};

function scoreAugmentForPick(state, player, augment) {
  let score = TIER_BASE_SCORE[augment.tier] ?? 16; // 처음 보는 등급이면 중간값
  score += AUGMENT_PICK_HINTS[augment.id] ?? 0;
  if (augment.quest) score += 3; // 퀘스트는 페널티 없는 순수 이득이라 약간 가산
  return score;
}

const WEAK_PICK_THRESHOLD = 8;

function decideAugmentSelectAction(state, aiPlayer) {
  const sel = state.augmentSelect;
  const scored = sel.choices.map((c, i) => ({
    i,
    c,
    score: scoreAugmentForPick(state, aiPlayer, c) + Math.random() * 3,
  }));
  scored.sort((a, b) => b.score - a.score);
  const worst = scored[scored.length - 1];
  // 도박 하위 선택지(실버3/프리즘1)는 리롤이 안 되니 건드리지 않음. 가장 약한 슬롯이 아직 리롤 안 됐고
  // 너무 약하면 한 번 리롤 - 리롤은 슬롯당 최대 1번(+축적 보너스)이라 자연히 끝남(무한 루프 안 생김)
  if (!sel.isGamble && worst.score < WEAK_PICK_THRESHOLD && !sel.rerolledSlots[worst.i]) {
    return { type: "REROLL_SLOT", index: worst.i };
  }
  return { type: "PICK_AUGMENT", augment: scored[0].c };
}

// ---------------------------------------------------------------------------
// 액티브 능력 사용 판단 - "쓸 수 있는지"는 실제 리듀서를 dry-run해서 판정(자격 체크 코드 중복 없음),
// "지금 쓸 가치가 있는지"만 우선순위 표로 판단. 표에 없는(미래) id는 기본값으로 적당히 시도해봄
// ---------------------------------------------------------------------------

const IGNORED_STATE_KEYS = new Set(["forbiddenMessage", "forbiddenToken"]);

// 리듀서가 실제로 뭔가 바꿨는지(단순 안내 메시지 말고) 확인 - 이걸로 "이 능력을 지금 쓸 수 있는지"를
// 리듀서의 실제 게이트 로직(쿨다운/1회용/조건부 실패 등)을 그대로 재사용해서 판정함
function stateMeaningfullyChanged(before, after) {
  if (before === after) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (IGNORED_STATE_KEYS.has(key)) continue;
    if (before[key] !== after[key]) return true;
  }
  return false;
}

function getReadyAbilities(state, aiPlayer) {
  const ready = [];
  const tried = new Set();
  for (const card of state.ownedAugments[aiPlayer]) {
    if (tried.has(card.id)) continue;
    tried.add(card.id);
    const next = gameReducer(state, { type: "USE_ABILITY", player: aiPlayer, ability: card.id });
    if (stateMeaningfullyChanged(state, next)) ready.push(card.id);
  }
  return ready;
}

function buildAiContext(state, aiPlayer) {
  const opponent = otherPlayer(aiPlayer);
  const myColor = colorForPlayer(aiPlayer, state.roleSwapActive);
  const oppColor = myColor === 1 ? 2 : 1;
  const total = state.stonesPlaced[1] + state.stonesPlaced[2];
  const oppEffIds = getEffectiveAugmentIds(getActiveAugmentIds(state, opponent), total);
  const oppThreatens = findThreatCells(state.board, oppColor, oppEffIds, state.lastMove[opponent]).length > 0;
  const netScore = fullBoardScore(state.board, myColor) - fullBoardScore(state.board, oppColor);
  return { oppThreatens, netScore, midGame: total >= 6 };
}

// 각 능력을 "지금" 쓸 가치가 있는지에 대한 대략적 우선순위. 표에 없는 id는 DEFAULT_UNKNOWN_PRIORITY로 처리되니
// 새 액티브 능력이 추가돼도 AI가 완전히 무시하지는 않음(적당히 시도해봄)
const ABILITY_PRIORITY = {
  bind: (ctx) => (ctx.oppThreatens ? 100 : -10),
  undo: (ctx) => (ctx.oppThreatens ? 95 : 5),
  removeStone: (ctx) => (ctx.oppThreatens ? 90 : 10),
  plague: (ctx) => (ctx.oppThreatens ? 88 : 8),
  collapse: (ctx) => (ctx.oppThreatens ? 85 : 6),
  selfUndo: (ctx) => (ctx.oppThreatens ? 80 : -100),
  timeCollapse: (ctx) => (ctx.oppThreatens || ctx.netScore < -1500 ? 70 : -10),
  wipeout: (ctx) => (ctx.oppThreatens ? 60 : ctx.netScore < -2000 ? 40 : -20),
  colorSwap: (ctx) => (ctx.netScore < -1200 ? 55 : -30),
  boardFlip: (ctx) => (ctx.netScore < -800 ? 45 : ctx.midGame ? 5 : -10),
  doubleMove: () => 65,
  oracle: () => 60,
  appraisal: () => 55,
  coinFlip: () => 40,
  leverage: () => 50,
  watchtower: (ctx) => (ctx.midGame ? 30 : 10),
  ultimatum: (ctx) => (ctx.midGame ? 28 : 10),
  relocate: (ctx) => (ctx.midGame ? 25 : 5),
  pokerFace: (ctx) => (ctx.midGame ? 20 : 5),
  lockdown: () => 22,
  barter: () => 18,
  jailbreak: () => 22,
  discard: () => 12,
  ward: (ctx) => (ctx.midGame ? 20 : 5),
  fog: () => 15,
};
const DEFAULT_UNKNOWN_PRIORITY = 15;
const ABILITY_USE_THRESHOLD = 20;

function chooseAbilityToUse(state, aiPlayer) {
  if (state.chaosActive) return null; // 폭주 중엔 사람 UI와 동일하게 액티브 능력을 아예 안 씀
  const ready = getReadyAbilities(state, aiPlayer);
  if (ready.length === 0) return null;
  const ctx = buildAiContext(state, aiPlayer);
  let best = null;
  for (const id of ready) {
    const scoreFn = ABILITY_PRIORITY[id];
    const score = (scoreFn ? scoreFn(ctx) : DEFAULT_UNKNOWN_PRIORITY) + Math.random() * 4;
    if (!best || score > best.score) best = { id, score };
  }
  return best && best.score >= ABILITY_USE_THRESHOLD ? best.id : null;
}

// ---------------------------------------------------------------------------
// pendingTarget(칸 선택) / PICK_CARD_TARGET(카드 선택) 대상 결정
// - kind 이름을 몰라도 됨: 후보를 실제로 dry-run해서 "리듀서가 받아들이는(상태가 바뀌는)" 것들 중
//   결과 보드 평가가 가장 좋은 걸 고름. 2단계 능력(재배치/결계)은 1단계 더 내다봄
// ---------------------------------------------------------------------------

function allBoardCells() {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) cells.push({ x, y });
  }
  return cells;
}

// depth 0(첫 단계)에서는 판 전체를 후보로 보고, 그 다음 단계(anchor가 있을 때)는 방금 고른 자리에
// 가까운 곳부터 일부만 봐서 계산량을 억제 (재배치의 인접 칸, 결계의 두 번째 정렬 지점 등)
function candidateCellsForTarget(anchor) {
  let cells = allBoardCells();
  if (anchor) {
    cells = cells
      .map((c) => ({ ...c, d: Math.max(Math.abs(c.x - anchor.x), Math.abs(c.y - anchor.y)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 40);
  }
  return cells;
}

function resolvePendingTarget(state, aiPlayer, depth = 0, anchor = null) {
  const candidates = candidateCellsForTarget(anchor);
  let best = null;
  for (const c of candidates) {
    const next = gameReducer(state, { type: "TARGET_CELL", x: c.x, y: c.y });
    if (!stateMeaningfullyChanged(state, next)) continue;

    let score;
    const stillMidSelection = next.pendingTarget && next.pendingTarget.player === aiPlayer;
    if (stillMidSelection && depth < 1) {
      const deeper = resolvePendingTarget(next, aiPlayer, depth + 1, c);
      score = deeper ? deeper.score - 2 : evalStateForPlayer(next, aiPlayer) - 20;
    } else if (stillMidSelection) {
      // 미리보기 한도(1단계)를 넘는 다단계 능력 - 일단 진행시키고 나머지는 다음 틱에서 마저 결정
      score = evalStateForPlayer(state, aiPlayer) + 5;
    } else {
      score = evalStateForPlayer(next, aiPlayer);
    }
    score += Math.random() * 2;
    if (!best || score > best.score) best = { x: c.x, y: c.y, score };
  }
  return best;
}

// 파기/감정처럼 보드 칸이 아니라 "내가 보유한 카드"를 대상으로 고르는 능력 (discard는 점수를 반전시켜
// "가장 덜 쓸모있는" 카드를 버리고, 그 외(감정 등)는 점수가 가장 높은(=가장 아까운) 카드를 대상으로 고름)
function decidePickCardTarget(state, aiPlayer) {
  const pt = state.pendingTarget;
  const owned = state.ownedAugments[aiPlayer];
  let best = null;
  for (const card of owned) {
    const next = gameReducer(state, { type: "PICK_CARD_TARGET", augmentId: card.id });
    if (!stateMeaningfullyChanged(state, next)) continue;
    const raw = scoreAugmentForPick(state, aiPlayer, card) + Math.random() * 2;
    const effective = pt.kind === "discard" ? -raw : raw;
    if (!best || effective > best.effective) best = { augmentId: card.id, effective };
  }
  return best ? best.augmentId : null;
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

// 지금 이 상태에서 AI가 다음으로 디스패치해야 할 액션 하나를 결정 (없으면 null - AI 차례가 아니거나 게임 종료)
// 호출 측(컴포넌트)이 이 액션 하나를 dispatch하고, 리듀서가 반영한 새 상태로 이 함수를 다시 부르는 식으로
// 한 턴(질풍노도 보너스 수, 능력 여러 번 사용 등)이 여러 틱에 걸쳐 자연스럽게 진행됨
export function decideAiAction(state, aiPlayer) {
  if (state.gameOver) return null;

  if (state.augmentSelect && state.augmentSelect.player === aiPlayer) {
    return decideAugmentSelectAction(state, aiPlayer);
  }

  if (state.pendingTarget && state.pendingTarget.player === aiPlayer) {
    const cellTarget = resolvePendingTarget(state, aiPlayer);
    if (cellTarget) return { type: "TARGET_CELL", x: cellTarget.x, y: cellTarget.y };
    const cardId = decidePickCardTarget(state, aiPlayer);
    if (cardId) return { type: "PICK_CARD_TARGET", augmentId: cardId };
    return null;
  }

  if (state.currentPlayer === aiPlayer) {
    const abilityId = chooseAbilityToUse(state, aiPlayer);
    if (abilityId) return { type: "USE_ABILITY", player: aiPlayer, ability: abilityId };
    const move = decideAiMove(state, aiPlayer);
    return move ? { type: "CLICK_CELL", x: move.x, y: move.y } : null;
  }

  return null;
}

// 지금 이 상태가 AI 쪽의 어떤 형태로든 "행동할 차례"인지 (UI에서 사람 입력을 막을지 판단하는 데 씀)
export function isAiTurn(state, aiPlayer) {
  if (state.gameOver) return false;
  if (state.augmentSelect) return state.augmentSelect.player === aiPlayer;
  if (state.pendingTarget) return state.pendingTarget.player === aiPlayer;
  return state.currentPlayer === aiPlayer;
}
