"use client";

import { useEffect, useRef } from "react";
import { BOARD_SIZE } from "@/lib/gomokuEngine";

const CELL = 40;
const PADDING = CELL;
const STONE_RADIUS = 17;
const CANVAS_SIZE = PADDING * 2 + (BOARD_SIZE - 1) * CELL;

// 15x15 오목판을 캔버스에 그리고, 클릭 좌표를 격자 좌표로 바꿔 onCellClick(x, y)로 알려줌
// blockedCells: 증강체로 못 놓는 칸, forbiddenCells: 렌주룰 금수 칸 (둘 다 빨간 X 표시)
// threatCells: 위험 감지로 강조할 칸(빨간 테두리), watchtowerCells: 감시탑이 세워진 칸(주황 다이아몬드 - 둘 다에게 보임)
export default function GomokuBoard({
  board,
  onCellClick,
  disabled,
  blockedCells = [],
  forbiddenCells = [],
  threatCells = [],
  watchtowerCells = [],
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

    // 막힌 칸 / 렌주룰 금수 칸: 빨간 X 표시
    ctx.strokeStyle = "#e74c3c";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const { x, y } of [...blockedCells, ...forbiddenCells]) {
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
  }, [board, blockedCells, forbiddenCells, threatCells, watchtowerCells]);

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
