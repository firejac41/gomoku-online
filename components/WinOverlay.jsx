"use client";

// myRole: 1 | 2 | "spectator" | null (null이면 로컬 모드 - 양쪽 버튼 다 누를 수 있음)
// rematchRequested: { 1: bool, 2: bool } - 둘 다 눌러야 실제로 재시작됨
export default function WinOverlay({ message, rematchRequested, onRequestRematch, myRole }) {
  function renderButton(player, label) {
    const requested = rematchRequested?.[player];
    const clickable = myRole === null || myRole === player;
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
      <h2>{message}</h2>
      <div className="rematchButtons">
        {renderButton(1, "⚫ 흑돌")}
        {renderButton(2, "⚪ 백돌")}
      </div>
      <p className="rematchHint">둘 다 재도전을 눌러야 새 판이 시작돼요</p>
    </div>
  );
}
