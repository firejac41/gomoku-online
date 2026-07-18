"use client";

import { useEffect, useRef } from "react";
import { BOARD_SIZE } from "@/lib/gomokuEngine";

const CELL = 40;
const PADDING = CELL;
const STONE_RADIUS = 17;
const CANVAS_SIZE = PADDING * 2 + (BOARD_SIZE - 1) * CELL;
// 안개: 보드 외곽 2줄(그리드 인덱스 1.5 지점까지)을 가리는 밴드 두께를 캔버스 대비 퍼센트로 미리 계산
// (캔버스가 CSS로 축소 표시될 수 있어서 오버레이도 % 기반으로 깔아야 항상 같은 자리에 맞음)
const FOG_BAND_PERCENT = ((PADDING + 1.5 * CELL) / CANVAS_SIZE) * 100;

// 15x15 오목판을 캔버스에 그리고, 클릭 좌표를 격자 좌표로 바꿔 onCellClick(x, y)로 알려줌
// blockedCells: 나를 실제로 막는 칸(진한 X), fadedBlockedCells: 내가 상대에게 건 금지라 나는 상관없는 칸(흐린 X)
// forbiddenCells: 렌주룰 금수 칸(진한 X), pendingCells: 금지구역 등 여러 칸 선택 중 이미 고른 칸(주황 테두리)
// watchtowerCells: 감시탑이 세워진 칸(주황 다이아몬드 - 숨김 없이 둘 다에게 보임)
// threatLines: 위험 감지로 강조할, 상대의 승리를 완성해줄 돌들을 잇는 선(빨간 선)
// winCells: 직감으로 강조할, 지금 두면 바로 이기는 내 칸(초록 테두리)
// lastOpponentMoveCell: 상대가 마지막으로 둔 자리(빨간 사각 테두리) - 지금 판이 어디서 바뀌었는지 한눈에 보이게
// ringBounds: 링 위에서 싸우자로 좁혀 들어간 안쪽 범위 {minX,maxX,minY,maxY} - 바깥쪽을 어둡게 덮어서 표시
// ringFinalBounds: 링이 최종적으로 도착할 위치(발동 즉시 공개) - 지금 레벨과 무관하게 항상 같은 자리에 노란 점선으로 미리 표시
// ultimatumCell: 내가 선언한 최후통첩 칸(보라 사각 점선 - 나에게만 보임), fadedUltimatumCell: 상대가 선언한 칸(로컬 모드에서만 흐리게 표시)
// foresightCells: 예지로 강조할, 상대가 다음에 두면 열린 3목이 되는 빈 칸(노란 다이아몬드)
// checkerboardActive: 체크무늬 발동 중이면 (x+y) 짝수 칸에 옅은 체크 타일 하이라이트를 깔아줌
// fogTurnsLeft: 안개에 걸린 내 남은 턴 수(0보다 크면) - 보드 외곽 2줄을 안개 오버레이로 가림 (온라인 전용)
// reverseScaleCells: 역린으로 표시된 돌들(빨간 다이아몬드 - 숨김 없이 양쪽 다 보임) - 인접 8칸에 두면 무효화됨
export default function GomokuBoard({
  board,
  onCellClick,
  disabled,
  blockedCells = [],
  fadedBlockedCells = [],
  forbiddenCells = [],
  pendingCells = [],
  watchtowerCells = [],
  threatLines = [],
  winCells = [],
  lastOpponentMoveCell = null,
  ringBounds = null,
  ringFinalBounds = null,
  ultimatumCell = null,
  fadedUltimatumCell = null,
  foresightCells = [],
  checkerboardActive = false,
  fogTurnsLeft = 0,
  reverseScaleCells = [],
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 격자선
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    for (let i = 0; i < BOARD_SIZE; i++) {
      const pos = PADDING + i * CELL;
      ctx.beginPath();
      ctx.moveTo(PADDING, pos);
      ctx.lineTo(PADDING + (BOARD_SIZE - 1) * CELL, pos);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pos, PADDING);
      ctx.lineTo(pos, PADDING + (BOARD_SIZE - 1) * CELL);
      ctx.stroke();
    }

    // 체크무늬: (x+y)가 짝수인(=착수 가능한) 칸마다 타일을 깔아서 패턴을 한눈에 보이게 함
    // (원래 알파 0.10은 보드 배경 위에서 거의 안 보인다는 피드백이 있어서 상향 + 타일 테두리 추가)
    if (checkerboardActive) {
      ctx.fillStyle = "rgba(70, 160, 255, 0.28)";
      ctx.strokeStyle = "rgba(70, 160, 255, 0.5)";
      ctx.lineWidth = 1;
      for (let cy = 0; cy < BOARD_SIZE; cy++) {
        for (let cx = 0; cx < BOARD_SIZE; cx++) {
          if ((cx + cy) % 2 !== 0) continue;
          const px = PADDING + cx * CELL;
          const py = PADDING + cy * CELL;
          ctx.fillRect(px - CELL / 2, py - CELL / 2, CELL, CELL);
          ctx.strokeRect(px - CELL / 2, py - CELL / 2, CELL, CELL);
        }
      }
    }

    // 링 위에서 싸우자: 좁혀 들어간 바깥 범위를 어둡게 덮고, 안쪽 경계는 주황 테두리로 표시
    if (ringBounds) {
      const left = PADDING + (ringBounds.minX - 0.5) * CELL;
      const right = PADDING + (ringBounds.maxX + 0.5) * CELL;
      const top = PADDING + (ringBounds.minY - 0.5) * CELL;
      const bottom = PADDING + (ringBounds.maxY + 0.5) * CELL;
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(0, 0, CANVAS_SIZE, top);
      ctx.fillRect(0, bottom, CANVAS_SIZE, CANVAS_SIZE - bottom);
      ctx.fillRect(0, top, left, bottom - top);
      ctx.fillRect(right, top, CANVAS_SIZE - right, bottom - top);
      ctx.strokeStyle = "#ff9800";
      ctx.lineWidth = 3;
      ctx.strokeRect(left, top, right - left, bottom - top);
    }

    // 링 위에서 싸우자: 발동 즉시 최종적으로 좁혀질 위치를 노란 점선으로 미리 보여줌 (현재 레벨과 무관하게 항상 같은 자리)
    if (ringFinalBounds) {
      const left = PADDING + (ringFinalBounds.minX - 0.5) * CELL;
      const right = PADDING + (ringFinalBounds.maxX + 0.5) * CELL;
      const top = PADDING + (ringFinalBounds.minY - 0.5) * CELL;
      const bottom = PADDING + (ringFinalBounds.maxY + 0.5) * CELL;
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = "#ffd54f";
      ctx.lineWidth = 2;
      ctx.strokeRect(left, top, right - left, bottom - top);
      ctx.restore();
    }

    function drawX(x, y) {
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      const half = CELL * 0.28;
      ctx.beginPath();
      ctx.moveTo(cx - half, cy - half);
      ctx.lineTo(cx + half, cy + half);
      ctx.moveTo(cx + half, cy - half);
      ctx.lineTo(cx - half, cy + half);
      ctx.stroke();
    }

    // 나를 실제로 막는 칸 / 렌주룰 금수 칸: 진한 빨간 X 표시
    ctx.strokeStyle = "#e74c3c";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.globalAlpha = 1;
    for (const { x, y } of [...blockedCells, ...forbiddenCells]) {
      drawX(x, y);
    }

    // 내가 상대에게 건 금지 칸: 나한테는 상관없으니 흐리게 표시 (누가 놓은 건지 구분되도록)
    ctx.globalAlpha = 0.32;
    for (const { x, y } of fadedBlockedCells) {
      drawX(x, y);
    }
    ctx.globalAlpha = 1;

    // 위험 감지: 상대의 승리를 완성해줄 돌들을 빨간 선으로 이어서 표시 (빈 칸이 아니라 이미 놓인 돌들을 이음)
    ctx.strokeStyle = "#ff4d4d";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const { x1, y1, x2, y2 } of threatLines) {
      const cx1 = PADDING + x1 * CELL;
      const cy1 = PADDING + y1 * CELL;
      const cx2 = PADDING + x2 * CELL;
      const cy2 = PADDING + y2 * CELL;
      ctx.beginPath();
      ctx.moveTo(cx1, cy1);
      ctx.lineTo(cx2, cy2);
      ctx.stroke();
    }

    // 직감: 지금 두면 바로 이기는 내 칸 강조
    for (const { x, y } of winCells) {
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      ctx.beginPath();
      ctx.arc(cx, cy, STONE_RADIUS + 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#2ecc71";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 예지: 상대가 다음에 두면 열린 3목이 되는 빈 칸 - 노란 다이아몬드로 표시
    ctx.strokeStyle = "#f1c40f";
    ctx.lineWidth = 2;
    for (const { x, y } of foresightCells) {
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      const half = CELL * 0.24;
      ctx.beginPath();
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half, cy);
      ctx.lineTo(cx, cy + half);
      ctx.lineTo(cx - half, cy);
      ctx.closePath();
      ctx.stroke();
    }

    // 상대의 마지막 수: 빨간 사각 테두리로 표시
    if (lastOpponentMoveCell) {
      const cx = PADDING + lastOpponentMoveCell.x * CELL;
      const cy = PADDING + lastOpponentMoveCell.y * CELL;
      const half = STONE_RADIUS + 3;
      ctx.strokeStyle = "#ff3b3b";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
    }

    // 감시탑: 여기에 두면 무효화되는 칸 - 주황 다이아몬드로 표시 (숨김 없이 양쪽 다 보임)
    ctx.strokeStyle = "#f39c12";
    ctx.lineWidth = 2;
    for (const { x, y } of watchtowerCells) {
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      const half = CELL * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half, cy);
      ctx.lineTo(cx, cy + half);
      ctx.lineTo(cx - half, cy);
      ctx.closePath();
      ctx.stroke();
    }

    // 역린: 인접 8칸에 두면 무효화되는 표시된 돌 - 빨간 다이아몬드로 표시 (숨김 없이 양쪽 다 보임, 감시탑과 색으로 구분)
    ctx.strokeStyle = "#e74c3c";
    ctx.lineWidth = 2;
    for (const { x, y } of reverseScaleCells) {
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      const half = CELL * 0.38;
      ctx.beginPath();
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half, cy);
      ctx.lineTo(cx, cy + half);
      ctx.lineTo(cx - half, cy);
      ctx.closePath();
      ctx.stroke();
    }

    // 최후통첩: 내가 선언한 칸 - 보라 점선 사각형으로 나에게만 표시
    function drawUltimatumMark(x, y) {
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      const half = STONE_RADIUS + 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = "#9b59b6";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    if (ultimatumCell) drawUltimatumMark(ultimatumCell.x, ultimatumCell.y);
    if (fadedUltimatumCell) {
      ctx.globalAlpha = 0.32;
      drawUltimatumMark(fadedUltimatumCell.x, fadedUltimatumCell.y);
      ctx.globalAlpha = 1;
    }

    // 금지구역 등 여러 칸을 고르는 중일 때, 이미 고른 칸 표시
    for (const { x, y } of pendingCells) {
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      ctx.beginPath();
      ctx.arc(cx, cy, STONE_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = "#f5a623";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 돌
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const player = board[y][x];
        if (player !== 0) {
          const cx = PADDING + x * CELL;
          const cy = PADDING + y * CELL;
          ctx.beginPath();
          ctx.arc(cx, cy, STONE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = player === 1 ? "#1a1a1a" : "#f5f5f5";
          ctx.fill();
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }, [board, blockedCells, fadedBlockedCells, forbiddenCells, pendingCells, watchtowerCells, threatLines, winCells, lastOpponentMoveCell, ringBounds, ringFinalBounds, ultimatumCell, fadedUltimatumCell, foresightCells, checkerboardActive, reverseScaleCells]);

  function handleClick(e) {
    if (disabled) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // 모바일에서 CSS로 캔버스를 축소 표시할 때, 실제 캔버스 해상도와 화면 표시 크기가 달라지므로 비율 보정
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    const x = Math.round((mouseX - PADDING) / CELL);
    const y = Math.round((mouseY - PADDING) / CELL);
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
    onCellClick(x, y);
  }

  return (
    <div className="boardWrapper">
      <canvas
        id="gomoku-board"
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        onClick={handleClick}
      />
      {fogTurnsLeft > 0 && (
        <>
          {/* backdropFilter는 인라인 style로 직접 줌 - CSS 클래스에 넣으면 이 프로젝트 빌드 파이프라인이 제거함 */}
          <div className="fogBand fogBandTop" style={{ height: FOG_BAND_PERCENT + "%", backdropFilter: "blur(5px)" }} />
          <div className="fogBand fogBandBottom" style={{ height: FOG_BAND_PERCENT + "%", backdropFilter: "blur(5px)" }} />
          <div className="fogBand fogBandLeft" style={{ width: FOG_BAND_PERCENT + "%", backdropFilter: "blur(5px)" }} />
          <div className="fogBand fogBandRight" style={{ width: FOG_BAND_PERCENT + "%", backdropFilter: "blur(5px)" }} />
        </>
      )}
    </div>
  );
}
