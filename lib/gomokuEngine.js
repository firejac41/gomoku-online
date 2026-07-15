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

// 위험 감지 리워크용: 빈 칸 (x,y)에 opponent가 두면 이기는 축이 있는지 확인하고, 있으면 그 축에
// 이미 놓여 있는 돌들의 양 끝 좌표를 반환 (빈칸 자체가 아니라 실제 바둑돌들을 선으로 잇기 위함)
function getThreatLineEndpoints(board, x, y, player, ownedAugmentIds, lastMove) {
  const useBridge = ownedAugmentIds.includes("bridge");
  const useAdjacentLink = ownedAugmentIds.includes("adjacentLink");
  const countFn = useBridge ? countSameColorBridged : countSameColor;
  const lines = [];

  AXIS_DIRECTIONS.forEach(({ dx, dy }, axisIndex) => {
    const threshold = getWinThreshold(axisIndex, ownedAugmentIds);
    const forward = countFn(board, x, y, dx, dy, player);
    const backward = countFn(board, x, y, -dx, -dy, player);
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
export const ONLINE_ONLY_IDS = ["fog"];

// 감정(appraisal) 증강으로 강화 가능한 카드 목록과 강화판("이름+") 설명 - 착수 횟수/제거 계열 카드는
// 스노우볼이 커지니 일부러 제외하고, 수치 하나만 살짝 세지는 카드들로만 한정함
export const ENHANCEABLE_AUGMENT_IDS = [
  "banZone", "watchtower", "balance", "lateBloomer", "noYield", "counterWatch", "stockpile", "brink",
];
const ENHANCED_DESCRIPTIONS = {
  banZone: "칸 3개 선택\n상대는 3턴(강화) 동안 그 칸에 착수 금지",
  watchtower: "1회 사용\n빈 칸 1곳 지정 (양쪽에 다 보임)\n상대가 6턴(강화) 안에 그 칸에 두면 그 수가 무효화됨",
  balance: "흑돌 전용\n내 돌이 상대보다 1개(강화) 이상 적으면\n그동안 렌주룰 금수가 면제됨",
  lateBloomer: "총 수가 12수(강화)를 넘긴 뒤로\n내가 뽑는 실버 등급 카드는 전부 골드로 승급",
  noYield: "백돌 전용\n총 4수 이내에 흑돌이 둘 때마다 25%(강화) 확률로\n내 다음 턴에 보너스 착수 1회 발생",
  counterWatch: "백돌 전용\n흑돌이 총 10수(강화) 이내에 처음 만드는 열린 3목을 감지하면\n그 즉시 무작위 증강 카드 1장을 무료로 획득",
  stockpile: "내가 가진 증강 1개당\n다음 증강 선택에서 리롤 가능 횟수가 2회(강화)씩 증가",
  brink: questDesc("내 돌이 상대보다 2개(강화) 이상 적어져야 합니다\n(반복 발동)", "그 즉시 무료 실버 카드 1장을 획득"),
};
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
// 횟수 - 질풍노도 보너스 착수/양수겹침 둘째 착수도 포함, 절대 줄어들지 않음)을 넘겨받음. 이 함수 자체는 그
// 의미를 몰라도 되는 순수 함수라 매개변수명은 그대로 두되, 호출부가 반드시 placementClock을 넘겨야 함
// (stonesPlaced 합계를 쓰면 그 두 카드의 보너스 착수분만큼 링이 실제보다 느리게 좁혀지는 버그가 생김)
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

// 퀘스트 증강 설명 포맷: 조건 / "보상: 보상 내용" 2줄 - .cardDesc·.augmentTooltip이 white-space: pre-line이라 그대로 줄바꿈됨
// (카드 이름 자체는 "퀘스트: 이름"으로 따로 표시됨 - AugmentSelectOverlay.jsx/AugmentPanel.jsx의 augment.quest 분기 참고)
function questDesc(condition, reward) {
  return "조건: " + condition + "\n보상: " + reward;
}

// 등급: silver(약함) / gold(강함) / prism(매우 강함)
export const AUGMENTS = [
  { id: "diagBoost", name: "대각선 강화", desc: "대각선 방향은 4개만 이어도 승리\n초반 전용 (판에 3목 이상 있으면 등장 안 함)", tier: "prism" },
  { id: "straightBoost", name: "일자진", desc: "가로·세로 방향도 4개만 이어도 승리\n초반 전용 (판에 3목 이상 있으면 등장 안 함)", tier: "prism" },
  { id: "rush", name: "질풍노도", desc: "즉시 발동 · 게임 끝까지 지속\n내 턴 2번 중 1번은 그 턴에 돌을 2개 놓음", tier: "prism" },
  { id: "fortress", name: "철옹성", desc: "내 돌은 상대의 제거·봉쇄 계열 효과에 면역", tier: "prism" },
  { id: "revive", name: "부활", desc: "상대가 승리하는 순간 1회만\n그 승리를 무효화", tier: "prism" },
  { id: "awakening", name: "각성", desc: "총 수가 20수를 넘기면 자동 발동\n그때부터 대각선 강화 + 일자진 효과가 함께 적용됨", tier: "prism" },
  { id: "bind", name: "속박", desc: "1회 사용\n상대의 다음 턴을 통째로 건너뜀", tier: "prism" },
  { id: "othello", name: "오델로", desc: "내 돌 사이에 상대 돌 1개가 끼면 내 색으로 뒤집음\n(2개 이상 끼면 효과 없음)\n포위 제거와 함께 있으면 낀 돌마다 50%로 둘 중 하나 적용", tier: "prism" },
  { id: "colorSwap", name: "무위전변", desc: "1회 사용 · 사용하면 턴 넘어감\n판 위의 모든 돌 색을 흑↔백으로 반전", tier: "prism" },
  { id: "bridge", name: "다리 놓기", desc: "내 돌 사이 빈칸 1개는 이어진 것으로 판정", tier: "prism" },
  { id: "boardFlip", name: "판 뒤엎기", desc: "쿨다운 6수 · 사용하면 턴 넘어감\n내가 둔 돌을 모두 지우고, 지운 개수만큼 무작위 빈 칸에 다시 놓음", tier: "prism" },
  { id: "collapse", name: "붕괴", desc: "1회 사용\n칸 1곳을 지정하면 그 칸 중심 3x3(9칸)의 돌이 전부 사라짐", tier: "prism" },
  { id: "oracle", name: "신탁", desc: "1회 사용\n다음 증강 선택 회차 등급을 프리즘으로 확정\n(양쪽 모두 적용됨)", tier: "prism" },
  { id: "prison", name: "교도소", desc: "즉시 발동\n이후 게임 끝까지 양쪽 모두의 프리즘 효과가 전부 비활성화\n(자기 자신 포함)", tier: "prism" },
  { id: "domino", name: "도미노", desc: "포위 제거나 오델로로 상대 돌을 없애면\n그 턴에 한 번 더 놓을 수 있음", tier: "prism" },
  { id: "permaBlock", name: "영구 봉쇄", desc: "칸 1개 선택\n상대는 그 칸에 게임 끝까지 착수 금지", tier: "prism" },
  { id: "battleRing", name: "링 위에서 싸우자", desc: "즉시 발동\n판이 4수마다 사방으로 한 겹씩 좁혀져 최종 8x8까지 축소\n(게임 끝까지 유지, 양쪽 모두 적용)\n최종 경계는 즉시 점선으로 공개되고,\n경계 밖으로 밀려난 칸의 돌은 그 즉시 삭제됨", tier: "prism" },
  { id: "chaos", name: "폭주", desc: "즉시 발동\n게임 끝까지 양쪽 모두 조작권 상실\n클릭해도 무작위 빈 칸에 놓이고, 액티브 능력도 전부 사용 불가", tier: "prism" },
  { id: "wipeout", name: "백지화", desc: "1회 사용 · 사용하면 턴 넘어감\n판 위의 돌을 양쪽 다 전부 지움\n(보유 증강과 지금까지 놓은 수는 그대로 유지)", tier: "prism" },
  { id: "capture", name: "포위 제거", desc: "내돌-상대돌-내돌 모양이 되면 가운데 돌 자동 제거\n오델로와 함께 있으면 낀 돌마다 50%로 둘 중 하나 적용", tier: "prism" },
  { id: "roleSwap", name: "입장 바꿔 생각하기", desc: "즉시 발동\n게임 끝까지 나와 상대가 담당하는 돌 색이 서로 뒤바뀜\n(승리 조건도 색을 따라 함께 바뀜)\n렌주룰은 신원이 아니라 지금 흑돌 두는 사람 기준", tier: "prism" },
  { id: "banZone", name: "금지 구역", desc: "칸 3개 선택\n상대는 2턴 동안 그 칸에 착수 금지", tier: "gold" },
  { id: "undo", name: "되돌리기", desc: "1회 사용\n상대의 마지막 수를 무르기", tier: "gold" },
  { id: "territory", name: "영역 점령", desc: "중앙 5x5에 내 돌이 13개 이상(절반 이상)이면 즉시 승리", tier: "gold" },
  { id: "doubleMove", name: "양수겹침", desc: "1회 사용\n한 턴에 돌을 2개 놓음", tier: "gold" },
  { id: "squareFrame", name: "네모", desc: "보드 아무 곳에나 가로세로 4칸짜리 네모 테두리를 완성하면 즉시 승리", tier: "gold", shape: SQUARE_FRAME_SHAPE, shapeGrid: 4 },
  { id: "barter", name: "거래", desc: "1회 사용\n아직 안 쓴 1회용 증강 효과를 전부 포기하고\n프리즘 증강 1개를 무작위로 즉시 획득", tier: "gold" },
  { id: "watchtower", name: "감시탑", desc: "1회 사용\n빈 칸 1곳 지정 (양쪽에 다 보임)\n상대가 4턴 안에 그 칸에 두면 그 수가 무효화됨", tier: "gold" },
  { id: "ultimatum", name: "최후통첩", desc: "1회 사용\n빈 칸 1곳을 선언\n내가 그 칸에 처음 두는 순간 다리 놓기+연속 배치 효과 획득\n(상대가 먼저 채우면 무효)", tier: "gold" },
  { id: "raid", name: "습격", desc: "자동 발동 (1회)\n상대가 이 판에서 처음 열린 3목을 만드는 순간\n그 즉시 상대 돌 무작위 2개가 제거됨", tier: "gold" },
  { id: "relocate", name: "재배치", desc: "쿨다운 6수 · 사용하면 턴 넘어감\n내 돌 1개를 골라 인접한 빈 칸으로 옮김", tier: "gold" },
  { id: "lockdown", name: "봉인", desc: "1회 사용\n상대의 아직 안 쓴 1회용 증강 효과를 이번 판 동안 전부 봉인", tier: "gold" },
  { id: "plague", name: "역병", desc: "1회 사용\n상대 돌 하나를 지정하면 그 돌이 사라지고\n그 자리는 영원히 아무도 못 두는 죽은 칸이 됨", tier: "gold" },
  { id: "sanctuary", name: "성역", desc: "내 돌로 4방향이 완전히 둘러싸인 빈 칸은\n상대가 금지 구역·영구 봉쇄·감시탑으로 지정할 수 없음", tier: "gold" },
  {
    id: "conqueror",
    name: "정복자",
    desc: questDesc("중앙 3x3(9칸)에 나의 돌을 5개 이상 둬야 합니다", "그 즉시 다음 증강 선택 등급이 프리즘으로 확정됨"),
    tier: "gold",
    quest: true,
  },
  { id: "adjacentLink", name: "연속 배치", desc: "직전에 둔 돌 바로 옆(가로·세로·대각선)에 이어 놓으면\n실제로는 2개뿐이어도 3개를 이은 것처럼 판정\n(그 방향으로 +1칸 보너스)", tier: "silver" },
  { id: "peek", name: "먼저 보기", desc: "다음 증강 선택 때 나올 카드 1장을 지금 미리 확정하고 확인\n(다음 선택지 3장 중 하나로 반드시 포함됨)", tier: "silver" },
  { id: "doubleChoice", name: "추가 선택", desc: "다음 증강 선택 시 3장 대신 4장 중에서 선택", tier: "silver" },
  { id: "selfUndo", name: "직전 무르기", desc: "쿨다운 4수\n내 마지막 수를 스스로 무르고 다시 두기", tier: "silver" },
  { id: "threatRadar", name: "위험 감지", desc: "내 턴에 상대의 승리 자리를 강조 표시", tier: "silver" },
  { id: "removeStone", name: "돌 제거", desc: "쿨다운 5수 · 사용하면 내 턴 넘어감\n상대 돌 1개를 제거", tier: "silver" },
  { id: "attrition", name: "물량전", desc: "보드가 완전히 다 찼을 때 내 돌이 상대보다 많으면 즉시 승리\n(무승부 방지용)", tier: "silver" },
  { id: "coinFlip", name: "동전 던지기", desc: "1회 사용\n50% 확률로 무작위 증강 1개 즉시 획득\n50% 확률로 다음 증강 선택을 건너뜀", tier: "silver" },
  { id: "leverage", name: "저울질", desc: "1회 사용 · 내 증강 수가 상대보다 적을 때만 사용 가능\n다음 증강 선택에서 상대가 이미 가진 증강은 선택지에서 제외됨", tier: "silver" },
  { id: "gamble", name: "도박", desc: "선택 즉시 양자택일\nA) 실버 2개 + 골드 1개 획득\nB) 45% 확률로 프리즘 1개 획득 (실패 시 아무것도 못 얻음)\n대신 다음 증강 선택 2번을 건너뜀", tier: "silver" },
  { id: "talisman", name: "부적", desc: "자동 발동 (1회)\n상대의 제거·봉쇄·무르기 계열 효과를 자동으로 막아줌", tier: "silver" },
  { id: "intuition", name: "직감", desc: "내 턴에 내가 두면 바로 이기는 칸을 강조 표시", tier: "silver" },
  { id: "balance", name: "균형", desc: "흑돌 전용\n내 돌이 상대보다 2개 이상 적으면\n그동안 렌주룰 금수가 면제됨", tier: "silver", colorOnly: 1 },
  { id: "jailbreak", name: "도장깨기", desc: "쿨다운 5수\n상대가 나에게 걸어둔 금지 구역·영구 봉쇄·감시탑 중 하나를 지정해\n즉시 해제", tier: "silver" },
  { id: "aftershock", name: "여진", desc: "자동 발동 (1회)\n내 돌이 돌 제거·포위 제거로 사라질 뻔하면 자동으로 지켜냄", tier: "silver" },
  { id: "lateBloomer", name: "늦둥이", desc: "총 수가 16수를 넘긴 뒤로\n내가 뽑는 실버 등급 카드는 전부 골드로 승급", tier: "silver" },
  { id: "underdogGrit", name: "역전의 근성", desc: "새 증강 선택이 열릴 때마다\n그 시점에 내 증강 개수가 상대보다 적으면\n이번 회차만 뽑기 등급이 한 단계 상승 (누적 안 됨)", tier: "silver" },
  { id: "counterStrike", name: "맞불", desc: "자동 발동\n상대가 나에게 돌 제거·되돌리기를 성공시키면\n자동으로 나도 상대에게 같은 효과를 1회 되갚음", tier: "silver" },
  { id: "stockpile", name: "축적", desc: "내가 가진 증강 1개당\n다음 증강 선택에서 리롤 가능 횟수가 1회씩 증가", tier: "silver" },
  { id: "ambush", name: "잠복", desc: "자동 발동 (1회)\n상대의 금지 구역·영구 봉쇄·감시탑에 처음 걸리는 순간\n무작위 증강 카드 1장을 무료로 획득", tier: "silver" },
  {
    id: "survivor",
    name: "생존자",
    desc: questDesc("내 돌이 이 판에서 처음 제거당해야 합니다\n(포위 제거·습격·돌 제거·역병·붕괴)", "그 즉시 무료 실버 카드 2장을 획득"),
    tier: "silver",
    quest: true,
  },
  { id: "counterWatch", name: "역감시", desc: "백돌 전용\n흑돌이 총 8수 이내에 처음 만드는 열린 3목을 감지하면\n그 즉시 무작위 증강 카드 1장을 무료로 획득", tier: "silver", colorOnly: 2 },
  { id: "noYield", name: "양보 없음", desc: "백돌 전용\n총 4수 이내에 흑돌이 둘 때마다 15% 확률로\n내 다음 턴에 보너스 착수 1회 발생", tier: "gold", colorOnly: 2 },
  { id: "fog", name: "안개", desc: "온라인 전용 · 1회 사용\n상대 턴 기준 3턴 동안 상대 화면에서만\n보드 외곽 2줄이 안개로 가려짐", tier: "silver", onlineOnly: true },
  { id: "foresight", name: "예지", desc: "상대가 다음에 두면 열린 3목이 되는 빈 칸을 미리 강조 표시", tier: "gold" },
  {
    id: "checkerboard",
    name: "체크무늬",
    desc: "즉시 발동\n게임 끝까지 (x+y) 좌표 합이 짝수인 칸만 착수 가능\n(가로·세로 5목 불가, 대각선만 승리 가능)\n대각선 강화·일자진과는 함께 나오지 않음",
    tier: "prism",
  },
  {
    id: "brink",
    name: "벼랑 끝",
    desc: questDesc("내 돌이 상대보다 3개 이상 적어져야 합니다\n(반복 발동)", "그 즉시 무료 실버 카드 1장을 획득"),
    tier: "gold",
    quest: true,
  },
  {
    id: "appraisal",
    name: "감정",
    desc: "1회 사용\n보유한 증강 중 강화 가능한 카드 하나를 강화판(이름+)으로 교체\n(금지 구역·감시탑·균형·늦둥이·양보 없음·역감시·축적·벼랑 끝만 가능)",
    tier: "gold",
  },
  { id: "discard", name: "파기", desc: "1회 사용\n보유한 증강 카드 하나를 버리고 같은 등급의 새 카드로 교체", tier: "silver" },
  { id: "nozdormu", name: "노즈도르무", desc: "즉시 발동\n게임 끝까지 양쪽 모두의 제한시간이 15초로 고정", tier: "gold" },
  {
    id: "pokerFace",
    name: "포커페이스",
    desc: "1회 사용\n상대에게는 정체불명의 경고만 뜨고, 나에게만 진짜/가짜 여부를 바로 알려줌\n33% 확률로 진짜 - 3턴 뒤 상대의 안 쓴 실버·골드 카드 중 1장을 무작위로 강탈\n가짜면 3턴 뒤 조용히 사라짐",
    tier: "gold",
  },
  {
    id: "timeCollapse",
    name: "시공간 붕괴",
    desc: "획득 즉시 그 시점 보드를 저장\n게임 중 아무 때나 1회 그 시점으로 판을 되돌림\n(양쪽 돌 전부 대상, 놓은 수·보유 증강은 유지)\n사용하면 턴 넘어감",
    tier: "prism",
  },
  {
    id: "ward",
    name: "결계",
    desc: "1회 사용\n판 위의 두 칸을 지정 (가로·세로·대각선 일직선이어야 함)\n그 사이 빈 칸들이 게임 끝까지 양쪽 모두 착수 금지",
    tier: "prism",
  },
  {
    id: "prepStance",
    name: "대비태세",
    desc: "쿨다운 5수 · 사용해도 턴은 안 넘어감\n즉시 방어막이 생겨 다음 제거·봉쇄 공격 1회를 자동으로 막아줌\n(부적과 같은 방식이지만 원하는 타이밍에 직접 켤 수 있음)",
    tier: "silver",
  },
  {
    id: "prevention",
    name: "예방",
    desc: "쿨다운 6수\n내 돌 하나를 지정하면 그 돌은 포위 제거·돌 제거로부터 1회 보호됨\n(여진과 달리 어떤 돌을 지킬지 직접 선택 가능)",
    tier: "gold",
  },
  {
    id: "interest",
    name: "이자",
    desc: "내 돌이 제거되거나 금지 구역·영구 봉쇄·감시탑에 실제로 걸릴 때마다\n다음 증강 선택 등급이 한 단계 상승 (누적, 실버→골드→프리즘)",
    tier: "gold",
  },
  {
    id: "backlash",
    name: "역풍",
    desc: "면역(철옹성·부적·대비태세)이나 여진·예방으로\n상대의 제거 공격을 막아내면\n그 카드가 쿨다운 방식일 때 대기시간이 2배로 늘어남",
    tier: "gold",
  },
  {
    id: "reflectShield",
    name: "역장",
    desc: "나에게 금지 구역·영구 봉쇄·감시탑이 누적 3번째로 걸리는 순간(1회)\n그때 걸려있는 모든 금지 구역·영구 봉쇄·감시탑이\n무효화되고 그대로 상대에게 반사됨",
    tier: "prism",
  },
];

// oneTimeUsed로 소모 여부를 추적하는 모든 1회용 능력 id (거래로 한꺼번에 포기시킬 때 사용)
// - boardFlip/removeStone/selfUndo/jailbreak/relocate는 1회용이 아니라 재사용 대기시간(쿨다운) 방식이라
//   이 목록에는 없음 (넣으면 거래/봉인이 "아직 안 쓴 1회용 효과"로 착각해서 영구히 소모/봉인시켜버림)
export const ONE_TIME_ABILITY_IDS = [
  "undo", "doubleMove", "revive",
  "coinFlip", "bind", "leverage", "barter", "watchtower", "ultimatum",
  "colorSwap", "talisman",
  "collapse", "oracle", "raid", "lockdown", "plague",
  "aftershock", "counterStrike", "ambush", "wipeout",
  "fog", "appraisal", "discard", "pokerFace", "timeCollapse", "ward",
  "reflectShield",
];

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
