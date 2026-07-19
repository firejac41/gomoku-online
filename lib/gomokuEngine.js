// 오목 + 렌주룰 + 증강 순수 로직 (DOM에 의존하지 않음, 로컬 모드/온라인 모드 둘 다 재사용)

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

// "다리 놓기" 증강용: 빈칸 1개는 다리로 보고 뚫고 지나가며, 그 빈칸도 카운트에 포함시킴
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

// 다리 놓기는 카드 설명상 "빈칸 1개"만 다리로 허용해야 하는데, 정방향/역방향을 각각 독립적으로
// countSameColorBridged로 계산하면 두 방향에 동시에 빈칸 1개씩(총 2개)을 다리로 놓는 조합이 가능해져
// 스펙을 벗어난 과도한 연결(예: 2돌-빈칸-이번 수-빈칸-2돌 = 실제 돌 4개로 7칸 연결)이 생김.
// 축 전체(양방향 합산)에 걸쳐 빈칸 예산 1개만 배분되도록, "빈칸을 정방향에 몰아준 경우" vs
// "역방향에 몰아준 경우" 두 가지만 계산해 더 긴 쪽을 채택함 (실제 단일 빈칸 상황에서는 결과가 동일함)
function bridgedAxisCounts(board, x, y, dx, dy, player) {
  const forwardBridged = countSameColorBridged(board, x, y, dx, dy, player);
  const backwardBridged = countSameColorBridged(board, x, y, -dx, -dy, player);
  const forwardPlain = countSameColor(board, x, y, dx, dy, player);
  const backwardPlain = countSameColor(board, x, y, -dx, -dy, player);
  const gapForward = { forward: forwardBridged, backward: backwardPlain };
  const gapBackward = { forward: forwardPlain, backward: backwardBridged };
  const sumForward = gapForward.forward + gapForward.backward;
  const sumBackward = gapBackward.forward + gapBackward.backward;
  return sumForward >= sumBackward ? gapForward : gapBackward;
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

// 증강을 반영한 축별 연결 개수. bridge(다리 놓기)와 adjacentLink(연속 배치, 직전 수와 인접 배치 시 보너스)를 적용
function getEffectiveRunCounts(board, x, y, player, ownedAugmentIds, lastMove) {
  const useBridge = ownedAugmentIds.includes("bridge");
  const useAdjacentLink = ownedAugmentIds.includes("adjacentLink");

  return AXIS_DIRECTIONS.map(({ dx, dy }) => {
    const { forward, backward } = useBridge
      ? bridgedAxisCounts(board, x, y, dx, dy, player)
      : { forward: countSameColor(board, x, y, dx, dy, player), backward: countSameColor(board, x, y, -dx, -dy, player) };
    let count = 1 + forward + backward;

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

// 위험 감지 리워크용: 빈 칸 (x,y)에 opponent가 두면 이기는 축이 있는지 확인하고, 있으면 그 축에
// 이미 놓여 있는 돌들의 양 끝 좌표를 반환 (빈칸 자체가 아니라 실제 바둑돌들을 선으로 잇기 위함)
function getThreatLineEndpoints(board, x, y, player, ownedAugmentIds, lastMove) {
  const useBridge = ownedAugmentIds.includes("bridge");
  const useAdjacentLink = ownedAugmentIds.includes("adjacentLink");
  const lines = [];

  AXIS_DIRECTIONS.forEach(({ dx, dy }, axisIndex) => {
    const threshold = getWinThreshold(axisIndex, ownedAugmentIds);
    const { forward, backward } = useBridge
      ? bridgedAxisCounts(board, x, y, dx, dy, player)
      : { forward: countSameColor(board, x, y, dx, dy, player), backward: countSameColor(board, x, y, -dx, -dy, player) };
    let total = 1 + forward + backward;
    if (useAdjacentLink && lastMove) {
      const adx = x - lastMove.x;
      const ady = y - lastMove.y;
      const isMatchingAxis = (adx === dx && ady === dy) || (adx === -dx && ady === -dy);
      if (isMatchingAxis) total += 1;
    }
    const reachesThreshold = player === 1 ? total === threshold : total >= threshold;
    if (!reachesThreshold) return;
    if (forward === 0 && backward === 0) return; // 이을 실제 돌이 하나도 없으면(순전히 보너스로만 채워짐) 건너뜀

    lines.push({
      x1: x - dx * backward,
      y1: y - dy * backward,
      x2: x + dx * forward,
      y2: y + dy * forward,
    });
  });

  return lines;
}

// 위험 감지: 상대가 두면 이기는 빈 칸들을 강조하는 대신, 그 승리를 완성시켜줄 상대 돌들을 선으로 이어서 보여줌
export function findThreatLines(board, opponent, opponentOwnedAugmentIds, opponentLastMove) {
  const lines = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) continue;
      for (const line of getThreatLineEndpoints(board, x, y, opponent, opponentOwnedAugmentIds, opponentLastMove)) {
        lines.push(line);
      }
    }
  }
  return lines;
}

// 예지: 지금 빈칸 중에 상대가 두면 "열린 3목"이 되는 자리들을 찾기 (즉시 승리가 아니라 한 수 앞선 위협 감지용)
// countOpenThrees는 순수 패턴 판정이라 증강/직전수와 무관 - 위험 감지/직감과 동일하게 단순 시뮬레이션으로 충분
// (countOpenThrees는 player 인자를 안 넘기면 흑돌 기준으로만 판정하므로, 상대가 백돌일 때도 정확히 감지되도록
// 반드시 opponent를 명시해서 넘겨야 함 - 안 그러면 상대가 백돌일 때는 항상 조용히 감지 실패함)
export function findOpenThreeSetupCells(board, opponent) {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) continue;
      const testBoard = board.map((row) => row.slice());
      testBoard[y][x] = opponent;
      if (countOpenThrees(testBoard, x, y, opponent) > 0) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

// 체크무늬: (x+y)가 홀수인 칸은 착수 금지(짝수 칸만 생존 - 가로/세로 5목은 원천 봉쇄되고 대각선만 유효해짐)
export function isCheckerboardBlocked(active, x, y) {
  return !!active && (x + y) % 2 !== 0;
}

// 안개는 온라인 모드에서만 의미가 있어(로컬은 같은 화면을 같이 봐서 숨길 대상이 없음) 로컬 뽑기 풀에서 항상 제외해야 함
// (현재 증강 풀에는 온라인 전용 카드가 없어서 비어있음 - 나중에 다시 생기면 여기 추가)
export const ONLINE_ONLY_IDS = [];

// 감정(appraisal) 증강으로 강화 가능한 카드 목록과 강화판("이름+") 설명 - 착수 횟수/제거 계열 카드는
// 스노우볼이 커지니 일부러 제외하고, 수치 하나만 살짝 세지는 카드들로만 한정함
// (현재 증강 풀에는 강화 가능한 카드가 없어서 비어있음 - 나중에 다시 생기면 여기 추가)
export const ENHANCEABLE_AUGMENT_IDS = [];
const ENHANCED_DESCRIPTIONS = {};
export function enhanceAugment(baseAugment) {
  return { ...baseAugment, name: baseAugment.name + "+", desc: ENHANCED_DESCRIPTIONS[baseAugment.id] || baseAugment.desc, enhanced: true };
}

// 영역 점령: 보드 중앙 5x5(인덱스 5~9, 총 25칸)에 내 돌이 절반(13개) 이상이면 승리
const TERRITORY_MIN = 5;
const TERRITORY_MAX = 9;
const TERRITORY_WIN_COUNT = 13;
export function checkTerritoryWin(board, player) {
  let count = 0;
  for (let y = TERRITORY_MIN; y <= TERRITORY_MAX; y++) {
    for (let x = TERRITORY_MIN; x <= TERRITORY_MAX; x++) {
      if (board[y][x] === player) count++;
    }
  }
  return count >= TERRITORY_WIN_COUNT;
}

// 물량전: 보드에 빈 칸이 하나도 없는지, 그리고 플레이어별 돌 개수
export function isBoardFull(board) {
  return board.every((row) => row.every((cell) => cell !== 0));
}

// 무승부/물량전 판정용 - 링 바깥·체크무늬 홀수 칸·영원히 죽은 칸(deadCells)은 그 누구도 영원히 채울 수 없는
// 칸이라, 이 칸들까지 "빈 칸"으로 세면 isBoardFull이 절대 true가 될 수 없어 소프트락이 생김
// (예: 링 위에서 싸우자로 좁혀진 바깥 영역은 텅 빈 채 영원히 남으므로, 실제로 둘 수 있는 칸이 전부 찼어도
// 전체 보드 기준 "가득 참"은 영영 오지 않았음 - 실제로 둘 수 있는 칸 기준으로 판정해야 함)
export function isBoardEffectivelyFull(board, ringBounds, checkerboardActive, deadCells) {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) continue;
      if (isOutsideRing(ringBounds, x, y)) continue;
      if (isCheckerboardBlocked(checkerboardActive, x, y)) continue;
      if (deadCells.some((c) => c.x === x && c.y === y)) continue;
      return false;
    }
  }
  return true;
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
// '1'=player 색 돌, '0'=빈칸, '2'=상대 돌 또는 보드 밖(막힌 것으로 취급)
// player 기본값은 1(흑) - 렌주룰 금수 판정(hasOverline/countOpenThrees/countFours가 getForbiddenReason에서 쓰일 때)은
// 항상 흑돌 전용이라 이 기본값에 의존해도 안전하지만, 예지/습격처럼 "어느 색이든" 열린 3목을 검사해야 하는
// 호출부는 반드시 실제로 검사하려는 색을 player로 명시해야 함 - 안 그러면 백돌을 검사할 때 조용히 항상 실패함
export function getDirectionLine(board, x, y, dx, dy, range, player = 1) {
  let line = "";
  for (let i = -range; i <= range; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;
    if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) {
      line += "2";
    } else if (board[ny][nx] === 0) {
      line += "0";
    } else if (board[ny][nx] === player) {
      line += "1";
    } else {
      line += "2";
    }
  }
  return line;
}

export function countOpenThrees(board, x, y, player = 1) {
  let count = 0;
  for (const { dx, dy } of AXIS_DIRECTIONS) {
    const line = getDirectionLine(board, x, y, dx, dy, 5, player);
    if (/01110/.test(line) || /010110/.test(line) || /011010/.test(line)) {
      count++;
    }
  }
  return count;
}

export function countFours(board, x, y, player = 1) {
  let count = 0;
  for (const { dx, dy } of AXIS_DIRECTIONS) {
    const line = getDirectionLine(board, x, y, dx, dy, 5, player);
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
// 렌주룰 금수 판정 자체는 증강과 무관하게 항상 기본 규칙으로 검사함
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

// 링 위에서 싸우자: 발동 시점부터 몇 수(양쪽 합산)마다 판이 사방으로 한 겹씩 좁혀 들어가 최종 8x8까지 줄어듦
// - 최종적으로 좁혀질 위치(ringTarget)는 발동 즉시 무작위로 정해지고, 양쪽에 바로 공개됨(숨기지 않음)
export const RING_SHRINK_INTERVAL = 4; // 이만큼 총 착수 수가 지날 때마다 한 겹씩
export const RING_MAX_LEVEL = 7; // 15 - 7 = 8 (최종 크기)
const RING_FINAL_SIZE_INDEX = BOARD_SIZE - 1 - RING_MAX_LEVEL; // 7 - 최종 8칸 정사각형의 마지막 인덱스 오프셋

// 발동 즉시 호출 - 최종 8x8 박스의 좌상단 좌표를 무작위로 하나 고름 (0~7 범위, 어느 쪽이든 보드 안에 다 들어감)
export function pickRandomRingTarget() {
  return {
    minX: Math.floor(Math.random() * (RING_FINAL_SIZE_INDEX + 1)),
    minY: Math.floor(Math.random() * (RING_FINAL_SIZE_INDEX + 1)),
  };
}

// ringTarget으로부터 최종(레벨 7) 8x8 박스 범위를 계산 - ringTarget이 없으면(구버전 호환) 판 중앙으로 대체
export function getRingFinalBounds(ringTarget) {
  const target = ringTarget || { minX: Math.ceil(RING_MAX_LEVEL / 2), minY: Math.ceil(RING_MAX_LEVEL / 2) };
  return {
    minX: target.minX,
    maxX: target.minX + RING_FINAL_SIZE_INDEX,
    minY: target.minY,
    maxY: target.minY + RING_FINAL_SIZE_INDEX,
  };
}

// ringStartMove/totalStonesPlaced는 실제로는 gameReducer의 placementClock 값(실제로 보드에 새 돌이 놓인
// 횟수 - 질풍노도 보너스 착수도 포함, 절대 줄어들지 않음)을 넘겨받음. 이 함수 자체는 그
// 의미를 몰라도 되는 순수 함수라 매개변수명은 그대로 두되, 호출부가 반드시 placementClock을 넘겨야 함
// (stonesPlaced 합계를 쓰면 그 보너스 착수분만큼 링이 실제보다 느리게 좁혀지는 버그가 생김)
export function getRingLevel(ringStartMove, totalStonesPlaced) {
  if (ringStartMove == null) return 0;
  const elapsed = totalStonesPlaced - ringStartMove;
  return Math.max(0, Math.min(RING_MAX_LEVEL, Math.floor(elapsed / RING_SHRINK_INTERVAL)));
}

// 지금 링 레벨 기준으로 아직 놓을 수 있는 안쪽 범위 (아직 안 좁혀졌으면 null)
// - 레벨 0(판 전체)에서 레벨 RING_MAX_LEVEL(최종 8x8, ringTarget 위치)까지 선형 보간
export function getRingBounds(ringStartMove, totalStonesPlaced, ringTarget) {
  const level = getRingLevel(ringStartMove, totalStonesPlaced);
  if (level === 0) return null;
  const final = getRingFinalBounds(ringTarget);
  const minX = Math.round((final.minX * level) / RING_MAX_LEVEL);
  const maxX = BOARD_SIZE - 1 - Math.round(((BOARD_SIZE - 1 - final.maxX) * level) / RING_MAX_LEVEL);
  const minY = Math.round((final.minY * level) / RING_MAX_LEVEL);
  const maxY = BOARD_SIZE - 1 - Math.round(((BOARD_SIZE - 1 - final.maxY) * level) / RING_MAX_LEVEL);
  return { minX, maxX, minY, maxY };
}

export function isOutsideRing(ringBounds, x, y) {
  if (!ringBounds) return false;
  return x < ringBounds.minX || x > ringBounds.maxX || y < ringBounds.minY || y > ringBounds.maxY;
}

// 링이 방금 한 겹 더 좁혀져서(oldBounds -> newBounds) 새로 경계 밖이 된 칸들을 찾기 (그 자리의 돌은 삭제 대상)
export function getCellsCrushedByRingShrink(oldBounds, newBounds) {
  if (!newBounds) return [];
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (isOutsideRing(newBounds, x, y) && !isOutsideRing(oldBounds, x, y)) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

// 입장 바꿔 생각하기: roleSwapActive가 켜져 있으면 이 플레이어(신원)가 실제로 두는 돌 색을 반대로 뒤집음
// (신원(ownedAugments/stonesPlaced/turn 순서 등의 키)과 보드 위 실제 돌 색을 분리하는 유일한 지점 - 대칭 변환이라
// player 자리에 신원을 넣으면 "이 신원이 놓는 색"을, 색을 넣으면 "그 색을 놓는 신원"을 그대로 돌려줌)
export function colorForPlayer(player, roleSwapActive) {
  if (!roleSwapActive || (player !== 1 && player !== 2)) return player;
  return player === 1 ? 2 : 1;
}

// 증강 시스템 전면 개편(2026-07-18): 기존 76개 카드는 "증강 하나가 게임을 뒤집는 도파민"을 노리고 설계됐는데,
// 실제 플레이어 반응은 그런 확정적 파워보다 슴슴한 판을 원한다는 쪽이었음. 그래서 기존 카드를 전부 뽑기
// 풀에서 비활성화(이 배열에서 삭제)하고, 새 철학의 카드로 교체함: **실제로 게임판에 관여하되, 발동해도
// 승부를 뒤집거나 확정 승리를 만들 수는 없고 상대를 거슬리게만 하는** 파워.
// 핵심 안전 설계: 봉쇄/제거/이동 효과는 아무리 약해도 "승부처 칸"(상대가 4목을 막아야 하는 칸 등)에 닿는
// 순간 그 한 번이 게임을 결정해버림. 승리/차단 필수 칸은 항상 기존 돌과 인접(거리 1)해 있다는 성질을 이용해,
// 세 카드 전부 "돌 근처에는 물리적으로 닿을 수 없는" 조건을 내장함 - 외톨이 돌(주변 8칸에 돌이 하나도 없는
// 돌)만 대상으로 하거나, 모든 돌에서 떨어진 빈 칸만 잠그거나, 턴을 통째로 소모시켜 이득을 0으로 상쇄함.
// 기존 카드들의 리듀서/UI 코드는 이 배열에서 빠진 순간 전부 도달 불가능한 죽은 코드가 되므로 안전하게 그대로
// 둠(별도 삭제 없이 이 배열 하나만 교체하면 게임에서 완전히 사라짐).
// 등급 배분(총 10개): 실버 5 / 골드 3 / 프리즘 2 - 회차 등급 확률은 실버 60% / 골드 30% / 프리즘 10% 고정
// (gameReducer.js의 ROUND_TIER_POOL 참고). 골드/프리즘도 "더 화려하고 더 성가심"일 뿐, 같은 안전 원칙
// (외톨이 돌/돌에서 먼 칸만 대상)을 그대로 따라서 승부에는 여전히 관여 못 함.
export const AUGMENTS = [
  {
    id: "breeze",
    name: "입김",
    desc: "쿨다운 5수 · 사용해도 턴은 안 넘어감\n상대의 외톨이 돌(주변 8칸에 돌이 없는 돌) 하나가\n무작위 인접 빈 칸으로 한 칸 밀려남\n(밀린 뒤에도 외톨이인 자리로만 - 연결된 판세는 절대 못 건드림)",
    tier: "silver",
  },
  {
    id: "saltScatter",
    name: "소금 뿌리기",
    desc: "쿨다운 6수 · 사용해도 턴은 안 넘어감\n모든 돌에서 떨어져 있는 무작위 빈 칸 3개가\n잠시(양쪽 각자 2턴) 양쪽 다 착수 금지됨\n(승부처 근처는 절대 안 잠김)",
    tier: "silver",
  },
  {
    id: "acornToss",
    name: "도토리 던지기",
    desc: "쿨다운 6수 · 사용하면 턴이 넘어감\n상대의 외톨이 돌(주변 8칸에 돌이 없는 돌) 하나를 제거\n(내 턴을 통째로 쓰므로 이득은 없는 순수 심술)",
    tier: "silver",
  },
  {
    id: "spotSwap",
    name: "자리 바꾸기",
    desc: "쿨다운 6수 · 사용해도 턴은 안 넘어감\n내 외톨이 돌 하나와 상대 외톨이 돌 하나의 위치를 서로 맞바꿈\n(양쪽 다 외톨이 돌이 있어야 사용 가능 - 판세에는 영향 없는 순수 신경전)",
    tier: "silver",
  },
  {
    id: "turf",
    name: "텃세",
    desc: "쿨다운 5수 · 사용해도 턴은 안 넘어감\n모든 돌에서 떨어져 있는 무작위 빈 칸 1개가\n상대만 3턴 동안 착수 금지됨 (나는 둘 수 있음)",
    tier: "silver",
  },
  {
    id: "gust",
    name: "돌풍",
    desc: "쿨다운 7수 · 사용해도 턴은 안 넘어감\n상대의 외톨이 돌 최대 2개가 각각 무작위 인접 빈 칸으로 밀려남\n(입김의 강화판 - 밀린 뒤에도 외톨이인 자리로만)",
    tier: "gold",
  },
  {
    id: "bananaPeel",
    name: "바나나 껍질",
    desc: "상시 패시브 (소모 없음)\n상대가 놓는 돌이 외톨이(주변 8칸에 돌 없음)로 놓이면\n30% 확률로 그 돌이 옆 칸으로 미끄러짐\n(외톨이 돌만 대상이라 판세에는 영향 없음)",
    tier: "gold",
  },
  {
    id: "saltBomb",
    name: "소금 폭탄",
    desc: "쿨다운 8수 · 사용해도 턴은 안 넘어감\n모든 돌에서 떨어져 있는 무작위 빈 칸 5개가\n잠시(양쪽 각자 3턴) 양쪽 다 착수 금지됨\n(소금 뿌리기의 강화판)",
    tier: "gold",
  },
  {
    id: "typhoon",
    name: "태풍",
    desc: "쿨다운 10수 · 사용해도 턴은 안 넘어감\n판 위 모든 외톨이 돌(내 돌·상대 돌 전부)이\n각각 무작위 방향으로 한 칸씩 흩날림\n(밀린 뒤에도 외톨이인 자리로만 - 화려하지만 판세에는 영향 없음)",
    tier: "prism",
  },
  {
    id: "saltRain",
    name: "소금비",
    desc: "상시 패시브 (소모 없음) · 게임 끝까지 반복\n실제 착수 5번마다 모든 돌에서 떨어진 무작위 빈 칸 1개가\n잠시(양쪽 각자 2턴) 양쪽 다 착수 금지됨",
    tier: "prism",
  },
];

// (x,y)의 8방향 이웃에 색 무관 아무 돌이라도 있는지 (ignore 좌표는 없는 셈 치고 검사)
function hasNeighborStone(board, x, y, ignore) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
      if (ignore && ignore.x === nx && ignore.y === ny) continue;
      if (board[ny][nx] !== 0) return true;
    }
  }
  return false;
}

// 입김/도토리 던지기용: 그 색의 "외톨이 돌"(주변 8칸에 어느 색이든 돌이 하나도 없는 돌) 좌표 전부 찾기
// - 외톨이 돌은 정의상 어떤 라인/연결에도 관여하지 않아서, 밀거나 제거해도 판세에 영향을 줄 수 없음
export function findIsolatedStones(board, color) {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== color) continue;
      if (!hasNeighborStone(board, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

// 입김: (sx,sy)의 외톨이 돌을 밀 수 있는 목적지 - 인접 빈 칸이면서, 옮긴 뒤에도 여전히 외톨이로 남는 칸만
// (옮긴 돌이 다른 돌과 연결되는 순간 라인 형성에 관여할 수 있게 되므로 - 예: 거리 2에 있던 상대 4목의
// 완성 칸으로 밀려 들어가면 승리 판정도 안 거친 5목이 판 위에 생겨버림 - 그 가능성 자체를 원천 차단)
export function findBreezeDestinations(board, sx, sy) {
  const dests = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = sx + dx;
      const ny = sy + dy;
      if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
      if (board[ny][nx] !== 0) continue;
      if (hasNeighborStone(board, nx, ny, { x: sx, y: sy })) continue;
      dests.push({ x: nx, y: ny });
    }
  }
  return dests;
}

// 소금 뿌리기: 모든 돌에서 떨어진(주변 8칸에 돌이 하나도 없는) 빈 칸 전부 찾기
// - 승리/차단 필수 칸은 항상 그 라인의 돌과 인접(체비쇼프 거리 1)해 있으므로, 이 칸들은 즉시 승부에 절대 관여 못 함
export function findSaltEligibleCells(board) {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== 0) continue;
      if (hasNeighborStone(board, x, y)) continue;
      cells.push({ x, y });
    }
  }
  return cells;
}

// oneTimeUsed로 소모 여부를 추적하는 모든 1회용 능력 id (거래로 한꺼번에 포기시킬 때 사용)
// (현재 증강 풀은 전부 쿨다운 방식 액티브라 1회용 능력이 없어서 비어있음)
export const ONE_TIME_ABILITY_IDS = [];

export const TIER_LABEL = { silver: "실버", gold: "골드", prism: "프리즘" };

// 도박(gamble) 증강을 고른 직후, 실버 3개 / 프리즘 1개 중 양자택일하는 특수 선택지 (AUGMENTS 풀에는 없는 가짜 카드)
export const GAMBLE_OPTIONS = [
  { id: "gambleMixed", name: "실버 2개 + 골드 1개 획득", desc: "무작위 실버 증강 2개 + 골드 증강 1개를 즉시 획득\n대신 다음 증강 선택 2번을 건너뜀", tier: "gold" },
  { id: "gamblePrism1", name: "프리즘 1개 획득 (45%)", desc: "45% 확률로 무작위 프리즘 증강 1개 획득\n실패하면 아무것도 못 얻음\n어느 쪽이든 다음 증강 선택 2번을 건너뜀", tier: "prism" },
];

// 배열에서 무작위로 count개를 중복 없이 뽑기
// 주의: `sort(() => Math.random() - 0.5)` 방식은 균등 셔플이 아님(자리별 확률이 크게 쏠림 - 특히 배열 앞쪽
// 원소가 과다 선택됨) - 반드시 피셔-예이츠 셔플을 써야 모든 원소가 실제로 같은 확률로 뽑힘
export function pickRandom(list, count) {
  const shuffled = [...list];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
