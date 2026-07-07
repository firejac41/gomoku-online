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

// 대각선 강화/일자진용: 판 위에 어느 색이든 3개 이상 이어진 줄이 이미 있는지 (있으면 너무 강력해지니 그 뽑기를 막는 데 사용)
export function hasThreeOrMoreInARow(board) {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const player = board[y][x];
      if (player === 0) continue;
      if (getRunCounts(board, x, y, player).some((count) => count >= 3)) return true;
    }
  }
  return false;
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

// 각성: 오목은 보통 21수(양쪽 합산) 안에 승부가 갈리고 장기전이라 해봐야 40수 정도라서,
// "판 전체 총 수"가 그 승부처(20수)를 넘기고도 안 끝났으면 그때부터 대각선 강화+일자진을 자동으로 얹어줌
// checkWin/isForbiddenMove를 부를 때는 항상 이 함수를 거친 augmentIds를 넘겨야 각성 효과가 반영됨
const AWAKENING_TOTAL_MOVES_THRESHOLD = 20;
export function getEffectiveAugmentIds(ownedAugmentIds, totalStonesPlaced) {
  if (ownedAugmentIds.includes("awakening") && totalStonesPlaced >= AWAKENING_TOTAL_MOVES_THRESHOLD) {
    return [...ownedAugmentIds, "diagBoost", "straightBoost"];
  }
  return ownedAugmentIds;
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

// 물량전: 보드에 빈 칸이 하나도 없는지, 그리고 플레이어별 돌 개수
export function isBoardFull(board) {
  return board.every((row) => row.every((cell) => cell !== 0));
}

export function countStones(board, player) {
  let count = 0;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] === player) count++;
    }
  }
  return count;
}

// 네모 완성: 가로세로 4칸짜리 정사각형 테두리(모서리+변, 12칸). 정사각형은 90도 회전해도 같은 모양이라 회전 변형 없이 이 오프셋 하나로 충분
const SQUARE_FRAME_OFFSETS = [
  [0, 0], [1, 0], [2, 0], [3, 0],
  [0, 3], [1, 3], [2, 3], [3, 3],
  [0, 1], [0, 2],
  [3, 1], [3, 2],
];

// 증강 툴팁에 보여줄 "네모" 설계도 (SQUARE_FRAME_OFFSETS를 {x,y} 좌표로 변환한 것)
export const SQUARE_FRAME_SHAPE = SQUARE_FRAME_OFFSETS.map(([x, y]) => ({ x, y }));

// 방금 놓은 돌(x,y)이 네모 테두리의 어느 한 칸이 되는 4x4 네모가 존재하는지 확인
export function checkFrameWin(board, x, y, player) {
  for (const [ox, oy] of SQUARE_FRAME_OFFSETS) {
    const originX = x - ox;
    const originY = y - oy;
    const complete = SQUARE_FRAME_OFFSETS.every(([dx, dy]) => {
      const cx = originX + dx;
      const cy = originY + dy;
      return cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE && board[cy][cx] === player;
    });
    if (complete) return true;
  }
  return false;
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
  { id: "diagBoost", name: "대각선 강화", desc: "대각선 방향은 4개만 이어도 승리 (초반, 판 위에 3목 이상 없을 때만 등장)", tier: "prism" },
  { id: "straightBoost", name: "일자진", desc: "가로/세로도 4개만 이어도 승리 (초반, 판 위에 3목 이상 없을 때만 등장)", tier: "prism" },
  { id: "rush", name: "질풍노도", desc: "내 턴 2번 중 1번은 그 턴에 돌을 2개 놓음 (게임 끝날 때까지 반복)", tier: "prism" },
  { id: "fortress", name: "철옹성", desc: "내 돌은 상대의 제거·봉쇄 계열 효과에 면역", tier: "prism" },
  { id: "revive", name: "부활", desc: "상대가 승리하는 순간 1회만 그 승리를 무효화", tier: "prism" },
  { id: "awakening", name: "각성", desc: "판 전체 총 수가 20수를 넘기고도 안 끝나면, 그때부터 대각선 강화와 일자진 효과가 자동으로 같이 적용됨", tier: "prism" },
  { id: "bind", name: "속박", desc: "1회 사용 - 상대의 다음 턴을 통째로 건너뜀", tier: "prism" },
  { id: "othello", name: "오델로", desc: "돌을 놓았을 때 내 돌 사이에 상대 돌 1개가 끼어 있으면 그 돌을 내 색으로 뒤집음 (사이에 2개 이상이면 효과 없음)", tier: "prism" },
  { id: "colorSwap", name: "무위전변", desc: "지금 판 위의 모든 돌 색을 서로 반전시킴 (흑↔백, 1회, 원할 때 사용, 사용하면 턴이 넘어감)", tier: "prism" },
  { id: "bridge", name: "다리 놓기", desc: "내 돌 사이 빈칸 1개는 이어진 것으로 판정", tier: "prism" },
  { id: "boardFlip", name: "판 뒤엎기", desc: "1회 사용 - 내가 지금까지 둔 돌을 모두 지우고, 지운 개수만큼 무작위한 빈 칸에 다시 놓음 (사용하면 턴이 넘어감)", tier: "prism" },
  { id: "collapse", name: "붕괴", desc: "1회 사용 - 칸 1곳을 지정하면 그 칸을 중심으로 3x3(9칸) 안의 돌이 전부 사라짐", tier: "prism" },
  { id: "oracle", name: "신탁", desc: "1회 사용 - 다음 증강 선택 회차 등급을 프리즘으로 확정 (양쪽 모두 적용됨)", tier: "prism" },
  { id: "prison", name: "교도소", desc: "획득 즉시, 이후로 게임이 끝날 때까지 양쪽 모두의 프리즘 증강체 효과가 전부 비활성화됨 (자기 자신 포함)", tier: "prism" },
  { id: "domino", name: "도미노", desc: "포위 제거나 오델로로 상대 돌을 없애면, 그 턴에 한 번 더 놓을 수 있음", tier: "prism" },
  { id: "banZone", name: "금지 구역", desc: "선택한 3칸, 상대는 2턴 동안 착수 금지", tier: "gold" },
  { id: "undo", name: "되돌리기", desc: "상대의 마지막 수를 무르기 (1회, 원할 때 사용)", tier: "gold" },
  { id: "territory", name: "영역 점령", desc: "중앙 5x5에 내 돌 7개 이상이면 승리", tier: "gold" },
  { id: "permaBlock", name: "영구 봉쇄", desc: "선택한 칸 1개, 상대는 게임 끝까지 착수 금지", tier: "gold" },
  { id: "capture", name: "포위 제거", desc: "내돌-상대돌-내돌 모양이 되면 가운데 돌 자동 제거", tier: "gold" },
  { id: "doubleMove", name: "양수겹침", desc: "한 턴에 돌을 2개 놓기 (게임 중 1회, 원할 때 사용)", tier: "gold" },
  { id: "squareFrame", name: "네모", desc: "보드 아무 곳에나 가로세로 4칸짜리 네모 테두리를 완성하면 즉시 승리", tier: "gold", shape: SQUARE_FRAME_SHAPE, shapeGrid: 4 },
  { id: "stinginess", name: "인색", desc: "1회 사용 - 상대의 다음 증강 선택지를 1장 줄임", tier: "gold" },
  { id: "barter", name: "거래", desc: "1회 사용 - 내가 아직 안 쓴 1회용 증강체 효과를 전부 포기하고, 그 대신 프리즘 등급 증강체 1개를 무작위로 즉시 획득", tier: "gold" },
  { id: "watchtower", name: "감시탑", desc: "1회 사용 - 빈 칸 1곳을 지정(양쪽에 다 보임). 이후 상대가 4턴 안에 그 칸에 두면 그 수가 무효화됨", tier: "gold" },
  { id: "ultimatum", name: "최후통첩", desc: "1회 사용 - 빈 칸 1곳을 선언. 내가 그 칸에 처음 두는 순간 다리 놓기+연속 배치 효과를 함께 받음 (상대가 먼저 채우면 무효)", tier: "gold" },
  { id: "raid", name: "습격", desc: "1회 사용 - 상대 돌 중 무작위 2개를 제거", tier: "gold" },
  { id: "relocate", name: "재배치", desc: "1회 사용 - 내 돌 1개를 골라 인접한 빈 칸으로 옮김", tier: "gold" },
  { id: "lockdown", name: "봉인", desc: "1회 사용 - 상대의 아직 안 쓴 1회용 증강체 효과를 이번 판 동안 전부 봉인", tier: "gold" },
  { id: "plague", name: "역병", desc: "1회 사용 - 상대 돌 하나를 지정하면 그 돌이 사라지고, 그 자리는 영원히 아무도 못 두는 죽은 칸이 됨", tier: "gold" },
  { id: "sanctuary", name: "성역", desc: "내 돌로 4방향이 완전히 둘러싸인 빈 칸은 상대가 금지 구역·영구 봉쇄·감시탑으로 지정할 수 없음", tier: "gold" },
  { id: "adjacentLink", name: "연속 배치", desc: "직전에 놓은 돌과 인접하게 놓으면 그 방향은 2칸으로 취급", tier: "silver" },
  { id: "peek", name: "먼저 보기", desc: "다음 선택지 카드 1장을 지금 미리 확정해서 봄", tier: "silver" },
  { id: "doubleChoice", name: "더블 초이스", desc: "다음 증강 선택 시 3장 대신 4장 중에서 선택", tier: "silver" },
  { id: "selfUndo", name: "직전 무르기", desc: "내 마지막 수를 스스로 무르고 다시 두기 (1회, 원할 때 사용)", tier: "silver" },
  { id: "threatRadar", name: "위험 감지", desc: "내 턴에 상대의 승리 자리를 강조 표시", tier: "silver" },
  { id: "removeStone", name: "돌 제거", desc: "상대 돌 1개를 제거 (게임 중 1회, 원할 때 사용 / 사용하면 내 턴이 넘어감)", tier: "silver" },
  { id: "attrition", name: "물량전", desc: "보드가 완전히 다 찼을 때 내 돌이 상대보다 많으면 즉시 승리 (무승부 방지용)", tier: "silver" },
  { id: "coinFlip", name: "동전 던지기", desc: "1회 사용 - 50% 확률로 무작위 증강체 1개 즉시 획득, 50% 확률로 다음 증강 선택을 건너뜀", tier: "silver" },
  { id: "leverage", name: "저울질", desc: "1회 사용 - 내 증강체 수가 상대보다 적을 때만 사용 가능. 다음 증강 선택에서 상대가 이미 가진 증강체는 선택지에서 제외됨", tier: "silver" },
  { id: "gamble", name: "도박", desc: "선택 즉시 [실버 3개 획득] 또는 [프리즘 1개 획득] 중 하나를 고름. 대신 다음 증강 선택 2번을 건너뜀", tier: "silver" },
  { id: "talisman", name: "부적", desc: "상대의 제거·봉쇄·무르기 계열 효과를 1회 자동으로 막아줌 (버튼 없이 자동 발동)", tier: "silver" },
  { id: "intuition", name: "직감", desc: "내 턴에 내가 두면 바로 이기는 칸을 강조 표시", tier: "silver" },
  { id: "balance", name: "균형", desc: "내 돌이 상대보다 2개 이상 적으면, 그동안 렌주룰 금수가 면제됨", tier: "silver" },
  { id: "jailbreak", name: "도장깨기", desc: "1회 사용 - 상대가 나에게 걸어둔 금지 구역·영구 봉쇄·감시탑 중 하나를 지정해서 즉시 해제", tier: "silver" },
  { id: "aftershock", name: "여진", desc: "내 돌이 돌 제거나 포위 제거로 사라질 뻔하면, 1회에 한해 자동으로 지켜냄", tier: "silver" },
  { id: "lateBloomer", name: "늦둥이", desc: "판 전체 총 수가 16수를 넘긴 뒤로, 내가 뽑는 실버 등급 카드는 전부 골드로 승급됨", tier: "silver" },
  { id: "counterStrike", name: "맞불", desc: "상대가 나에게 돌 제거나 되돌리기를 성공시키면, 자동으로 나도 상대에게 같은 효과를 1회 되갚음", tier: "silver" },
  { id: "stockpile", name: "축적", desc: "내가 가진 증강체 1개당, 다음 증강 선택에서 리롤 가능 횟수가 1회씩 늘어남", tier: "silver" },
  { id: "ambush", name: "잠복", desc: "상대의 금지 구역·영구 봉쇄·감시탑에 처음 걸리는 순간, 그 즉시 무작위 증강체 카드 1장을 무료로 획득", tier: "silver" },
];

// oneTimeUsed로 소모 여부를 추적하는 모든 1회용 능력 id (거래로 한꺼번에 포기시킬 때 사용)
export const ONE_TIME_ABILITY_IDS = [
  "removeStone", "undo", "selfUndo", "doubleMove", "revive",
  "coinFlip", "bind", "stinginess", "leverage", "barter", "watchtower", "ultimatum",
  "colorSwap", "talisman",
  "boardFlip", "collapse", "oracle", "raid", "relocate", "lockdown", "plague",
  "jailbreak", "aftershock", "counterStrike", "ambush",
];

export const TIER_LABEL = { silver: "실버", gold: "골드", prism: "프리즘" };

// 도박(gamble) 증강을 고른 직후, 실버 3개 / 프리즘 1개 중 양자택일하는 특수 선택지 (AUGMENTS 풀에는 없는 가짜 카드)
export const GAMBLE_OPTIONS = [
  { id: "gambleSilver3", name: "실버 3개 획득", desc: "무작위 실버 증강 3개를 즉시 획득. 대신 다음 증강 선택 2번을 건너뜀", tier: "silver" },
  { id: "gamblePrism1", name: "프리즘 1개 획득", desc: "무작위 프리즘 증강 1개를 즉시 획득. 대신 다음 증강 선택 2번을 건너뜀", tier: "prism" },
];

// 배열에서 무작위로 count개를 중복 없이 뽑기
export function pickRandom(list, count) {
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
