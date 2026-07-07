"use client";

import { useEffect, useRef } from "react";
import { BOARD_SIZE } from "@/lib/gomokuEngine";

const CELL = 40;
const PADDING = CELL;
const STONE_RADIUS = 17;
const CANVAS_SIZE = PADDING * 2 + (BOARD_SIZE - 1) * CELL;

// 15x15 오목판을 캔버스에 그리고, 클릭 좌표를 격자 좌표로 바꿔 onCellClick(x, y)로 알려줌
// blockedCells: 나를 실제로 막는 칸(진한 X), fadedBlockedCells: 내가 상대에게 건 금지라 나는 상관없는 칸(흐린 X)
// forbiddenCells: 렌주룰 금수 칸(진한 X), pendingCells: 금지구역 등 여러 칸 선택 중 이미 고른 칸(주황 테두리)
// watchtowerCells: 감시탑이 세워진 칸(주황 다이아몬드 - 숨김 없이 둘 다에게 보임), threatCells: 위험 감지로 강조할 칸(빨간 테두리)
// winCells: 직감으로 강조할, 지금 두면 바로 이기는 내 칸(초록 테두리)
// lastOpponentMoveCell: 상대가 마지막으로 둔 자리(빨간 사각 테두리) - 지금 판이 어디서 바뀌었는지 한눈에 보이게
// ringBounds: 링 위에서 싸우자로 좁혀 들어간 안쪽 범위 {minX,maxX,minY,maxY} - 바깥쪽을 어둡게 덮어서 표시
export default function GomokuBoard({
  board,
  onCellClick,
  disabled,
  blockedCells = [],
  fadedBlockedCells = [],
  forbiddenCells = [],
  pendingCells = [],
  watchtowerCells = [],
  threatCells = [],
  winCells = [],
  lastOpponentMoveCell = null,
  ringBounds = null,
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

    // 위험 감지: 상대가 다음에 두면 이기는 칸 강조
    for (const { x, y } of threatCells) {
      const cx = PADDING + x * CELL;
      const cy = PADDING + y * CELL;
      ctx.beginPath();
      ctx.arc(cx, cy, STONE_RADIUS + 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#ff4d4d";
      ctx.lineWidth = 2;
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
  }, [board, blockedCells, fadedBlockedCells, forbiddenCells, pendingCells, watchtowerCells, threatCells, winCells, lastOpponentMoveCell, ringBounds]);

  function handleClick(e) {
    if (disabled) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const x = Math.round((mouseX - PADDING) / CELL);
    const y = Math.round((mouseY - PADDING) / CELL);
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;
    onCellClick(x, y);
  }

  return (
    <canvas
      id="gomoku-board"
      ref={canvasRef}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      onClick={handleClick}
    />
  );
}
