"use client";

import { useEffect, useRef, useState } from "react";
import { playYourTurnSound } from "@/lib/sound";

const AWAY_TITLE = "🔔 당신 차례! - 증강 오목";

// "내 턴이 됐다"는 신호를 사운드 + 화면 강조 펄스 + (탭이 안 보일 때) 브라우저 탭 제목 깜빡임으로 알려줌.
// turnKey가 바뀌면서 active가 true인 순간에만 발동 (첫 렌더/마운트에는 안 울림).
// 반환값(pulse)을 turnIndicator 같은 엘리먼트의 className에 조건부로 붙이면 잠깐 반짝이는 강조 효과가 재생됨.
export function useYourTurnAlert(turnKey, active) {
  const [pulse, setPulse] = useState(false);
  const prevKeyRef = useRef(turnKey);
  const mountedRef = useRef(false);

  useEffect(() => {
    const changed = prevKeyRef.current !== turnKey;
    prevKeyRef.current = turnKey;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return undefined;
    }
    if (changed && active) {
      playYourTurnSound();
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);

  // 탭을 안 보고 있을 때만 제목을 깜빡임 - 화면을 보고 있으면 위 펄스 강조로 충분하고, 계속 깜빡이면 오히려 방해됨
  useEffect(() => {
    if (!active) return undefined;
    const originalTitle = document.title;
    let intervalId = null;
    let showAlert = true;

    function startBlink() {
      if (intervalId) return;
      intervalId = setInterval(() => {
        document.title = showAlert ? AWAY_TITLE : originalTitle;
        showAlert = !showAlert;
      }, 900);
    }
    function stopBlink() {
      if (!intervalId) return;
      clearInterval(intervalId);
      intervalId = null;
      document.title = originalTitle;
    }
    function handleVisibilityChange() {
      if (document.hidden) startBlink();
      else stopBlink();
    }

    if (document.hidden) startBlink();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopBlink();
    };
  }, [active]);

  return pulse;
}
