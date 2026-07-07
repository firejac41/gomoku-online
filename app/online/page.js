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

    localStorage.setItem(`gomoku-role-${data.id}`, "1");
    router.push(`/online/${data.id}`);
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
      <h1 className="text-2xl font-bold">온라인 대전</h1>
      <p className="opacity-80 max-w-sm">
        방을 만들면 공유 링크가 생겨요. 그 링크를 상대방에게 보내면 같은 판에서 실시간으로 대전할 수 있어요.
      </p>
      <button className="bigButton" onClick={handleCreateRoom} disabled={creating}>
        {creating ? "방 만드는 중..." : "방 만들기"}
      </button>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Link href="/" className="text-sm underline opacity-70 mt-2">← 처음으로</Link>
    </main>
  );
}
