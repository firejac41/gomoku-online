"use client";

import { useState } from "react";
import { TIER_LABEL } from "@/lib/gomokuEngine";

// 예능 증강(액자 완성 등) 툴팁에 보여줄 미니 설계도. shape는 {x,y} 상대좌표 배열, gridSize는 정사각형 한 변 길이
export function ShapeDiagram({ shape, gridSize }) {
  const cells = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const filled = shape.some((c) => c.x === x && c.y === y);
      cells.push(<div key={x + "," + y} className={"shapeCell" + (filled ? " shapeCellFilled" : "")} />);
    }
  }
  return (
    <div className="shapeDiagram" style={{ gridTemplateColumns: `repeat(${gridSize}, 1fr)` }}>
      {cells}
    </div>
  );
}

// 4턴마다 뜨는 증강 선택 화면. 카드마다 개별로 1회씩 리롤 가능.
// 눈 아이콘을 누르고 있는 동안은 카드가 흐려지고 뒤에 있는 보드가 보임 (지금 판 상황을 보고 결정할 수 있게)
// 도박 증강의 실버3/프리즘1 양자택일 화면일 때는 isGamble=true로 리롤 버튼 없이 렌더링
// readOnly: 커닝으로 상대의 선택 화면을 훔쳐볼 때 true - 카드 내용은 그대로 보이지만 클릭/리롤이 전부 비활성화됨
export default function AugmentSelectOverlay({
  playerLabel,
  stoneCount,
  choices,
  rerolledSlots,
  onPick,
  onRerollSlot,
  isGamble,
  bonusRerollsRemaining,
  isStartDraft,
  readOnly = false,
}) {
  const [peeking, setPeeking] = useState(false);

  const togglePeek = () => setPeeking((prev) => !prev);
  const hasBonusRerolls = !isGamble && bonusRerollsRemaining > 0;

  return (
    <div className={"augmentSelectOverlay" + (peeking ? " peeking" : "")}>
      <button
        className="peekEyeButton"
        onClick={togglePeek}
        title={peeking ? "눌러서 카드 다시 보기" : "눌러서 판 보기"}
      >
        {peeking ? "👁 카드 다시 보기" : "👁 눌러서 판 보기"}
      </button>
      <div className="augmentSelectContent">
        <h2>
          {isGamble
            ? "도박 결과를 선택하세요!"
            : isStartDraft
            ? playerLabel + " 시작 증강 선택! (착수 전)"
            : playerLabel + " 증강 선택! (" + stoneCount + "수 달성)"}
          {readOnly && " 🔎 (커닝 중)"}
        </h2>
        {hasBonusRerolls && <div className="bonusRerollNotice">🎲 축적 보너스 리롤 {bonusRerollsRemaining}회 남음</div>}
        <div className="augmentSelectCards">
          {choices.map((augment, index) => {
            const usedNormalReroll = rerolledSlots[index];
            const canReroll = !usedNormalReroll || hasBonusRerolls;
            return (
              <div
                // key를 슬롯 위치(index) 기준으로 고정 - augment.id를 key에 넣으면 리롤할 때마다
                // React가 그 카드를 새 엘리먼트로 보고 리마운트해서, 처음 등장할 때 쓰는 화려한
                // cardPopIn(회전+확대+낙하) 애니메이션이 그 카드 하나만 다시 재생되며 버벅여 보였음
                key={index}
                className={"augmentCard tier-" + augment.tier}
                style={{ animationDelay: index * 0.12 + "s" }}
              >
                <div className="cardBody" onClick={readOnly ? undefined : () => onPick(augment)}>
                  <div className="cardTier">{TIER_LABEL[augment.tier]}</div>
                  <div className="cardName">{augment.quest ? "퀘스트: " + augment.name : augment.name}</div>
                  <div className="cardDesc">{augment.desc}</div>
                  {augment.shape && <ShapeDiagram shape={augment.shape} gridSize={augment.shapeGrid} />}
                </div>
                {!isGamble && !readOnly && (
                  <button
                    className="cardRerollButton"
                    disabled={!canReroll}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRerollSlot(index);
                    }}
                  >
                    {!canReroll ? "리롤 완료" : usedNormalReroll ? "🎲 보너스 리롤" : "🎲 이 카드만 리롤"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
