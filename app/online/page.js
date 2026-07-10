"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { initialGameState } from "@/lib/gameReducer";

export default function OnlinePage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateRoom() {
    setCreating(true);
    setError("");

    const { data, error } = await supabase
      .from("game_rooms")
      .insert({ state: initialGameState(), black_claimed: true })
      .select()
      .single();

    if (error || !data) {
      setError("방 만들기에 실패했어요. Supabase 테이블/설정을 확인해주세요.");
      setCreating(false);
      return;
    }

    // sessionStorage 사용: 새로고침해도 역할은 유지되지만, 같은 브라우저에서 탭을 새로 열면
    // (localStorage와 달리) 그 탭은 독립된 저장소를 가져서 흑돌/백돌 역할이 안 겹침
    sessionStorage.setItem(`gomoku-role-${data.id}`, "1");
    router.push(`/online/${data.id}`);
  }

  return (
    <main className="subPage">
      <div className="homeBgGrid" aria-hidden="true" />
      <div className="homeGlow" aria-hidden="true" />
      <div className="homeStoneBlur black" aria-hidden="true" />
      <div className="homeStoneBlur white" aria-hidden="true" />

      <div className="subPageCard">
        <span className="homeButtonIcon">🔗</span>
        <h1 className="subPageTitle">온라인 대전 (링크로 초대)</h1>
        <p className="subPageDesc">
          방을 만들면 공유 링크가 생겨요. 그 링크를 상대방에게 보내면 같은 판에서 실시간으로 대전할 수 있어요.
        </p>
        <button className="bigButton" onClick={handleCreateRoom} disabled={creating}>
          {creating ? "방 만드는 중..." : "방 만들기"}
        </button>
        {error && <p className="subPageError">{error}</p>}
      </div>
      <Link href="/" className="subPageBackLink">← 처음으로</Link>
    </main>
  );
}
