// 오목 + 렌주룰 + 증강체 순수 로직 (DOM에 의존하지 않음, 로컬 모드/온라인 모드 둘 다 재사용)

export const BOARD_SIZE = 15;

// 4개 방향(가로/세로/대각선 2개). 인덱스 0,1 = 직선(가로/세로), 2,3 = 대각선
export const AXIS_DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
];
const DIAGONAL_AXIS_INDEXES = [2, 3];

export function createEmptyBoard() {
  const board = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    board.push(new Array(BOARD_SIZE).fill(0));
  }
  return board;
}

// (x, y)에서 (dx, dy) 방향으로 같은 색 돌이 몇 개 연속되는지 세기
export function countSameColor(board, x, y, dx, dy, player) {
  let count = 0;
  let nx = x + dx;
  let ny = y + dy;
  while (
    nx >= 0 && nx < BOARD_SIZE &&
    ny >= 0 && ny < BOARD_SIZE &&
    board[ny][nx] === player
  ) {
    count++;
    nx += dx;
    ny += dy;
  }
  return count;
}

// "다리 놓기" 증강체용: 빈칸 1개는 다리로 보고 뚫고 지나가며, 그 빈칸도 카운트에 포함시킴
// 단, 다리를 건넌 다음 실제 돌로 이어지지 않고 끝나버리면(허공에 매달린 빈칸) 그 빈칸은 카운트에서 뺌
function countSameColorBridged(board, x, y, dx, dy, player) {
  const cells = [];
  let gapUsed = false;
  let nx = x + dx;
  let ny = y + dy;
  while (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE) {
    const cell = board[ny][nx];
    if (cell === player) {
      cells.push(true);
    } else if (cell === 0 && !gapUsed) {
      gapUsed = true;
      cells.push(false);
    } else {
      break;
    }
    nx += dx;
    ny += dy;
  }
  while (cells.length > 0 && cells[cells.length - 1] === false) {
    cells.pop();
  }
  return cells.length;
}

export function getRunCounts(board, x, y, player) {
  return AXIS_DIRECTIONS.map(({ dx, dy }) => {
    return 1 + countSameColor(board, x, y, dx, dy, player) + countSameColor(board, x, y, -dx, -dy, player);
  });
}

// 증강체를 반영한 축별 연결 개수. bridge(다리 놓기)와 adjacentLink(연속 배치, 직전 수와 인접 배치 시 보너스)를 적용
function getEffectiveRunCounts(board, x, y, player, ownedAugmentIds, lastMove) {
  const useBridge = ownedAugmentIds.includes("bridge");
  const useAdjacentLink = ownedAugmentIds.includes("adjacentLink");
  const countFn = useBridge ? countSameColorBridged : countSameColor;

  return AXIS_DIRECTIONS.map(({ dx, dy }) => {
    let count = 1 + countFn(board, x, y, dx, dy, player) + countFn(board, x, y, -dx, -dy, player);

    if (useAdjacentLink && lastMove) {
      const adx = x - lastMove.x;
      const ady = y - lastMove.y;
      const isMatchingAxis = (adx === dx && ady === dy) || (adx === -dx && ady === -dy);
      if (isMatchingAxis) count += 1; // 직전 수와 이 축 방향으로 바로 인접 -> 2칸짜리 연결 보너스
    }

    return count;
  });
}

// 이 축이 대각선 강화 / 일자진의 영향을 받는지에 따라 승리에 필요한 개수를 정함 (기본 5)
function getWinThreshold(axisIndex, ownedAugmentIds) {
  const isDiagonal = DIAGONAL_AXIS_INDEXES.includes(axisIndex);
  if (isDiagonal && ownedAugmentIds.includes("diagBoost")) return 4;
  if (!isDiagonal && ownedAugmentIds.includes("straightBoost")) return 4;
  return 5;
}

// 렌주룰: 흑돌은 정확히 임계값일 때만 승리(장목은 승리 아님), 백돌은 임계값 이상이면 승리
// ownedAugmentIds/lastMove를 넘기면 대각선 강화·일자진·다리 놓기·연속 배치 효과가 반영됨
export function checkWin(board, x, y, player, ownedAugmentIds = [], lastMove = null) {
  const counts = getEffectiveRunCounts(board, x, y, player, ownedAugmentIds, lastMove);
  return AXIS_DIRECTIONS.some((_, axisIndex) => {
    const threshold = getWinThreshold(axisIndex, ownedAugmentIds);
    const count = counts[axisIndex];
    return player === 1 ? count === threshold : count >= threshold;
  });
}

// 위험 감지: 지금 빈칸 중에 상대(opponent)가 두면 바로 이기는 칸들을 찾기
export function findThreatCells(board, opponent, opponentOwnedAugmentIds, opponentLastMove) {
  const threats = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) continue;
      const testBoard = board.map((row) => row.slice());
      testBoard[y][x] = opponent;
      if (checkWin(testBoard, x, y, opponent, opponentOwnedAugmentIds, opponentLastMove)) {
        threats.push({ x, y });
      }
    }
  }
  return threats;
}

// 영역 점령: 보드 중앙 5x5(인덱스 5~9)에 내 돌이 7개 이상이면 승리
const TERRITORY_MIN = 5;
const TERRITORY_MAX = 9;
export function checkTerritoryWin(board, player) {
  let count = 0;
  for (let y = TERRITORY_MIN; y <= TERRITORY_MAX; y++) {
    for (let x = TERRITORY_MIN; x <= TERRITORY_MAX; x++) {
      if (board[y][x] === player) count++;
    }
  }
  return count >= 7;
}

// 포위 제거: 방금 놓은 돌(x,y) 기준으로 "나-상대-나" 모양이 되는 상대 돌 좌표들을 찾기
export function findCaptures(board, x, y, player) {
  const opponent = player === 1 ? 2 : 1;
  const captured = [];
  for (const { dx, dy } of AXIS_DIRECTIONS) {
    for (const sign of [1, -1]) {
      const mx = x + dx * sign, my = y + dy * sign;
      const fx = x + dx * sign * 2, fy = y + dy * sign * 2;
      if (
        mx >= 0 && mx < BOARD_SIZE && my >= 0 && my < BOARD_SIZE &&
        fx >= 0 && fx < BOARD_SIZE && fy >= 0 && fy < BOARD_SIZE &&
        board[my][mx] === opponent && board[fy][fx] === player
      ) {
        captured.push({ x: mx, y: my });
      }
    }
  }
  return captured;
}

export function hasOverline(board, x, y) {
  const counts = getRunCounts(board, x, y, 1);
  return counts.some((count) => count >= 6);
}

// (x, y)를 중심으로 (dx, dy) 축 방향의 돌 상태를 문자열로 변환
// '1'=흑돌, '0'=빈칸, '2'=백돌 또는 보드 밖(막힌 것으로 취급)
export function getDirectionLine(board, x, y, dx, dy, range) {
  let line = "";
  for (let i = -range; i <= range; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;
    if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) {
      line += "2";
    } else if (board[ny][nx] === 0) {
      line += "0";
    } else if (board[ny][nx] === 1) {
      line += "1";
    } else {
      line += "2";
    }
  }
  return line;
}

export function countOpenThrees(board, x, y) {
  let count = 0;
  for (const { dx, dy } of AXIS_DIRECTIONS) {
    const line = getDirectionLine(board, x, y, dx, dy, 5);
    if (/01110/.test(line) || /010110/.test(line) || /011010/.test(line)) {
      count++;
    }
  }
  return count;
}

export function countFours(board, x, y) {
  let count = 0;
  for (const { dx, dy } of AXIS_DIRECTIONS) {
    const line = getDirectionLine(board, x, y, dx, dy, 5);
    if (
      /01111/.test(line) || /11110/.test(line) ||
      /10111/.test(line) || /11011/.test(line) || /11101/.test(line)
    ) {
      count++;
    }
  }
  return count;
}

// 흑돌 금수 여부 판정 (호출 전에 board[y][x]에 흑돌을 임시로 놓아둔 상태여야 함)
// 렌주룰 금수 판정 자체는 증강체와 무관하게 항상 기본 규칙으로 검사함
export function getForbiddenReason(board, x, y) {
  if (hasOverline(board, x, y)) return "장목 (6개 이상)";
  if (countOpenThrees(board, x, y) >= 2) return "3-3 (삼삼)";
  if (countFours(board, x, y) >= 2) return "4-4 (사사)";
  return null;
}

// 이 빈 칸에 흑돌을 두면 렌주룰 금수인지 판정 (5개를 완성하는 수는 예외로 허용)
export function isForbiddenMove(board, x, y, ownedAugmentIds, lastMove) {
  const testBoard = board.map((row) => row.slice());
  testBoard[y][x] = 1;
  const isWinningMove = checkWin(testBoard, x, y, 1, ownedAugmentIds, lastMove);
  if (isWinningMove) return null;
  return getForbiddenReason(testBoard, x, y);
}

// 지금 흑돌 차례에 금수라서 못 두는 빈 칸들을 전부 찾기 (보드에 X 표시용)
export function findForbiddenCells(board, ownedAugmentIds, lastMove) {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) continue;
      if (isForbiddenMove(board, x, y, ownedAugmentIds, lastMove)) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

// 등급: silver(약함) / gold(강함) / prism(매우 강함)
export const AUGMENTS = [
  { id: "diagBoost", name: "대각선 강화", desc: "대각선 방향은 4개만 이어도 승리", tier: "prism" },
  { id: "straightBoost", name: "일자진", desc: "가로/세로도 4개만 이어도 승리", tier: "prism" },
  { id: "rush", name: "질풍노도", desc: "게임이 끝날 때까지 매 턴 돌 2개씩 놓기", tier: "prism" },
  { id: "fortress", name: "철옹성", desc: "내 돌은 상대의 제거·봉쇄 계열 효과에 면역", tier: "prism" },
  { id: "revive", name: "부활", desc: "상대가 승리하는 순간 1회만 그 승리를 무효화", tier: "prism" },
  { id: "doubleMove", name: "양수겹침", desc: "한 턴에 돌을 2개 놓기 (게임 중 1회, 원할 때 사용)", tier: "gold" },
  { id: "banZone", name: "금지 구역", desc: "선택한 3칸, 상대는 5턴 동안 착수 금지", tier: "gold" },
  { id: "removeStone", name: "돌 제거", desc: "상대 돌 1개를 제거 (게임 중 1회, 원할 때 사용)", tier: "gold" },
  { id: "undo", name: "되돌리기", desc: "상대의 마지막 수를 무르기 (1회, 원할 때 사용)", tier: "gold" },
  { id: "territory", name: "영역 점령", desc: "중앙 5x5에 내 돌 7개 이상이면 승리", tier: "gold" },
  { id: "bridge", name: "다리 놓기", desc: "내 돌 사이 빈칸 1개는 이어진 것으로 판정", tier: "gold" },
  { id: "permaBlock", name: "영구 봉쇄", desc: "선택한 칸 1개, 상대는 게임 끝까지 착수 금지", tier: "gold" },
  { id: "capture", name: "포위 제거", desc: "내돌-상대돌-내돌 모양이 되면 가운데 돌 자동 제거", tier: "gold" },
  { id: "adjacentLink", name: "연속 배치", desc: "직전에 놓은 돌과 인접하게 놓으면 그 방향은 2칸으로 취급", tier: "silver" },
  { id: "peek", name: "먼저 보기", desc: "다음 선택지 카드 1장을 지금 미리 확정해서 봄", tier: "silver" },
  { id: "doubleChoice", name: "더블 초이스", desc: "다음 증강 선택 시 3장 대신 4장 중에서 선택", tier: "silver" },
  { id: "selfUndo", name: "직전 무르기", desc: "내 마지막 수를 스스로 무르고 다시 두기 (1회, 원할 때 사용)", tier: "silver" },
  { id: "threatRadar", name: "위험 감지", desc: "내 턴에 상대의 승리 자리를 강조 표시", tier: "silver" },
];

export const TIER_LABEL = { silver: "실버", gold: "골드", prism: "프리즘" };

// 배열에서 무작위로 count개를 중복 없이 뽑기
export function pickRandom(list, count) {
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
