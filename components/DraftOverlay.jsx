"use client";

import { TIER_LABEL } from "@/lib/gomokuEngine";

// 4턴마다 뜨는 증강체 선택 화면. 카드마다 개별로 1회씩 리롤 가능
export default function DraftOverlay({ playerLabel, stoneCount, choices, rerolledSlots, onPick, onRerollSlot }) {
  return (
    <div className="draftOverlay">
      <h2>{playerLabel} 증강체 선택! ({stoneCount}수 달성)</h2>
      <div className="draftCards">
        {choices.map((augment, index) => (
          <div
            key={augment.id + "-" + index}
            className={"augmentCard tier-" + augment.tier}
            style={{ animationDelay: index * 0.12 + "s" }}
          >
            <div className="cardBody" onClick={() => onPick(augment)}>
              <div className="cardTier">{TIER_LABEL[augment.tier]}</div>
              <div className="cardName">{augment.name}</div>
              <div className="cardDesc">{augment.desc}</div>
            </div>
            <button
              className="cardRerollButton"
              disabled={rerolledSlots[index]}
              onClick={(e) => {
                e.stopPropagation();
                onRerollSlot(index);
              }}
            >
              {rerolledSlots[index] ? "리롤 완료" : "🎲 이 카드만 리롤"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
