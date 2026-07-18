"use client";

import { useState } from "react";
import { colorForPlayer } from "@/lib/gomokuEngine";

// myRole: 1 | 2 | "spectator" | null (null이면 로컬 모드 - 양쪽 버튼 다 누를 수 있음)
// rematchRequested: { 1: bool, 2: bool } - 둘 다 눌러야 실제로 재시작됨
// roleSwapActive: 게임 종료 시점에 입장 바꿔 생각하기가 켜져 있었는지 - 켜져 있었으면 신원 1/2이 실제로
// 담당했던 돌 색이 뒤바뀌어 있었으므로, 버튼 라벨도 신원이 아니라 실제 담당 색 기준으로 보여줘야 함
// winnerPlayer: 승리한 신원(1|2) - 무승부면 null
// enableLoserColorChoice: true면(온라인 모드 전용) 승자가 있는 판에서 진 쪽이 다음 판 색을 직접 고르는
// 화면으로 바뀜 - 로컬/싱글플레이는 물리적 신원 개념이 없어서 이 기능이 무의미하므로 항상 false로 둠
export default function WinOverlay({
  message,
  rematchRequested,
  onRequestRematch,
  myRole,
  roleSwapActive = false,
  winnerPlayer = null,
  enableLoserColorChoice = false,
}) {
  // 증강 선택 화면의 "누르고 있으면 판 보기" 눈 아이콘과 같은 패턴 - 게임이 끝난 뒤에도
  // 최종 보드를 다시 볼 방법이 없다는 피드백을 반영
  const [peeking, setPeeking] = useState(false);
  const togglePeek = () => setPeeking((prev) => !prev);

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

  function wrap(content) {
    return (
      <div className={"winOverlay" + (peeking ? " peeking" : "")}>
        <button
          className="peekEyeButton"
          onClick={togglePeek}
          title={peeking ? "눌러서 결과 다시 보기" : "눌러서 판 보기"}
        >
          {peeking ? "👁 결과 다시 보기" : "👁 눌러서 판 보기"}
        </button>
        <div className="winOverlayCard">
          <h2>{message}</h2>
          {content}
        </div>
      </div>
    );
  }

  const loserChoiceActive = enableLoserColorChoice && winnerPlayer != null;

  if (loserChoiceActive) {
    const loserPlayer = winnerPlayer === 1 ? 2 : 1;

    if (myRole === loserPlayer) {
      const requested = rematchRequested?.[loserPlayer];
      return wrap(
        <>
          <p className="rematchHint">다음 판에서 원하는 색을 골라주세요</p>
          <div className="rematchButtons">
            <button
              className="bigButton"
              disabled={requested}
              onClick={() => onRequestRematch(loserPlayer, 1)}
            >
              {requested ? "선택 완료 ✓" : "⚫ 흑돌로 재도전"}
            </button>
            <button
              className="bigButton"
              disabled={requested}
              onClick={() => onRequestRematch(loserPlayer, 2)}
            >
              {requested ? "선택 완료 ✓" : "⚪ 백돌로 재도전"}
            </button>
          </div>
          <p className="rematchHint">상대가 동의하면 고른 색으로 새 판이 시작돼요</p>
        </>
      );
    }

    if (myRole === winnerPlayer) {
      const requested = rematchRequested?.[winnerPlayer];
      return wrap(
        <>
          <p className="rematchHint">진 쪽이 다음 판 색을 고르는 중이에요</p>
          <div className="rematchButtons">
            <button className="bigButton" disabled={requested} onClick={() => onRequestRematch(winnerPlayer)}>
              {requested ? "재도전 동의함 ✓" : "재도전 동의"}
            </button>
          </div>
        </>
      );
    }

    // 관전자
    return wrap(<p className="rematchHint">진 쪽이 다음 판 색을 고르는 중이에요...</p>);
  }

  // 기존 동작 (로컬/싱글플레이, 또는 온라인이라도 무승부일 땐 진 쪽이 없어서 이 방식 그대로 유지)
  return wrap(
    <>
      <div className="rematchButtons">
        {renderButton(1)}
        {renderButton(2)}
      </div>
      <p className="rematchHint">둘 다 재도전을 눌러야 새 판이 시작돼요</p>
    </>
  );
}
