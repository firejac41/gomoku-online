"use client";

import { colorForPlayer } from "@/lib/gomokuEngine";

// myRole: 1 | 2 | "spectator" | null (null이면 로컬 모드 - 양쪽 버튼 다 누를 수 있음)
// rematchRequested: { 1: bool, 2: bool } - 둘 다 눌러야 실제로 재시작됨
// roleSwapActive: 게임 종료 시점에 입장 바꿔 생각하기가 켜져 있었는지 - 켜져 있었으면 신원 1/2이 실제로
// 담당했던 돌 색이 뒤바뀌어 있었으므로, 버튼 라벨도 신원이 아니라 실제 담당 색 기준으로 보여줘야 함
export default function WinOverlay({ message, rematchRequested, onRequestRematch, myRole, roleSwapActive = false }) {
  function renderButton(player) {
    const requested = rematchRequested?.[player];
    const clickable = myRole === null || myRole === player;
    const label = colorForPlayer(player, roleSwapActive) === 1 ? "⚫ 흑돌" : "⚪ 백돌";
    return (
      <button
        key={player}
        className="bigButton"
        disabled={!clickable || requested}
        onClick={() => onRequestRematch(player)}
      >
        {requested ? label + " 재도전 요청함 ✓" : label + " 재도전"}
      </button>
    );
  }

  return (
    <div className="winOverlay">
      <div className="winOverlayCard">
        <h2>{message}</h2>
        <div className="rematchButtons">
          {renderButton(1)}
          {renderButton(2)}
        </div>
        <p className="rematchHint">둘 다 재도전을 눌러야 새 판이 시작돼요</p>
      </div>
    </div>
  );
}
