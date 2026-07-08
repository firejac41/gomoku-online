"use client";

import { useEffect, useState } from "react";
import { ShapeDiagram } from "@/components/AugmentSelectOverlay";

// 직접 "사용" 버튼으로 발동시키는 증강들 (그 외는 상시 적용되는 패시브 효과라 버튼 없음)
const ACTIVE_ABILITIES = {
  doubleMove: "이번 턴 2개 놓기",
  removeStone: "상대 돌 제거 (사용하면 턴 넘어감)",
  undo: "상대 마지막 수 무르기",
  selfUndo: "내 마지막 수 무르기",
  coinFlip: "동전 던지기",
  bind: "상대 턴 스킵",
  stinginess: "상대 증강 선택 줄이기",
  barter: "거래하기",
  watchtower: "감시탑 설치",
  ultimatum: "최후통첩 선언",
  leverage: "저울질 사용",
  colorSwap: "돌 색 전체 반전 (사용하면 턴 넘어감)",
  jailbreak: "막힌 자리 하나 해제",
  relocate: "내 돌 옮기기 (사용하면 턴 넘어감)",
  raid: "상대 돌 무작위 2개 제거 (사용하면 턴 넘어감)",
  lockdown: "상대 1회용 효과 봉인",
  plague: "상대 돌 하나 영구 봉인 (사용하면 턴 넘어감)",
  collapse: "3x3 구역 붕괴 (사용하면 턴 넘어감)",
  oracle: "다음 회차 프리즘 확정",
  boardFlip: "내 돌 전부 재배치 (사용하면 턴 넘어감)",
  wipeout: "판 위 돌 전부 지우기 (사용하면 턴 넘어감)",
};

// side: 이 패널이 화면 왼쪽/오른쪽 중 어디에 있는지 - 툴팁이 보드 쪽(반대 방향)으로 열리게 하기 위함
// peekedCard: 먼저 보기로 예약해 둔 카드 - 안내 메시지가 금방 사라져서 놓치기 쉬우니 여기 계속 표시해 둠
export default function AugmentPanel({ title, augments, canAct, usedMap, onUseAbility, side = "left", peekedCard = null }) {
  const [openIndex, setOpenIndex] = useState(null);

  // 터치/클릭으로 연 툴팁은 다른 곳을 터치하면 닫힘
  // (li 안쪽 클릭은 li의 onClick이 토글을 직접 처리하므로 여기서는 건드리지 않음 -
  //  stopPropagation은 리액트 합성 이벤트만 막고 document 리스너까지는 못 막기 때문)
  useEffect(() => {
    function handleOutsideClick(e) {
      if (e.target.closest(".augmentPanel li")) return;
      setOpenIndex(null);
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  return (
    <div className="augmentPanel">
      <h3>{title}</h3>
      <ul>
        {augments.map((augment, i) => {
          const abilityLabel = ACTIVE_ABILITIES[augment.id];
          const alreadyUsed = usedMap?.[augment.id];
          return (
            <li
              key={augment.id + i}
              className={"tier-" + augment.tier}
              onClick={(e) => {
                e.stopPropagation();
                setOpenIndex(openIndex === i ? null : i);
              }}
            >
              <div>{augment.name}</div>
              {augment.id === "peek" && peekedCard && (
                <div className="peekedCardNote">예약된 카드: '{peekedCard.name}'</div>
              )}
              {abilityLabel && (
                <button
                  className="abilityButton"
                  disabled={!canAct || alreadyUsed}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUseAbility(augment.id);
                  }}
                >
                  {alreadyUsed ? "사용 완료" : abilityLabel}
                </button>
              )}
              <div
                className={
                  "augmentTooltip " + (side === "right" ? "tooltipLeft" : "tooltipRight") + (openIndex === i ? " tooltipOpen" : "")
                }
              >
                {augment.desc}
                {augment.shape && <ShapeDiagram shape={augment.shape} gridSize={augment.shapeGrid} />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
