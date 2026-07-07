"use client";

export default function WinOverlay({ message, onRestart }) {
  return (
    <div className="winOverlay">
      <h2>{message}</h2>
      <button className="bigButton" onClick={onRestart}>다시하기</button>
    </div>
  );
}
