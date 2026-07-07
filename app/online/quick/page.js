"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { initialGameState } from "@/lib/gameReducer";

const STALE_QUEUE_ROW_MAX_AGE_MS = 5 * 60 * 1000; // 5분 넘게 안 매칭된 대기열 행은 방치된 걸로 보고 청소

export default function QuickMatchPage() {
  const router = useRouter();
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState("");

  const queueIdRef = useRef(null);
  const pollTimerRef = useRef(null);
  const channelRef = useRef(null);
  const attemptInFlightRef = useRef(false);

  // 방치된(탭을 그냥 닫아버린) 대기열 행들을 이 페이지에 올 때마다 가볍게 청소
  useEffect(() => {
    const cutoff = new Date(Date.now() - STALE_QUEUE_ROW_MAX_AGE_MS).toISOString();
    supabase.from("matchmaking_queue").delete().eq("matched", false).lt("created_at", cutoff);
    return () => stopMatching();
  }, []);

  function stopMatching() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }

  // 매칭에 성공해서 "내가 짝을 찾은 쪽"이 됐을 때: 방을 실제로 만들고(기존 방 만들기와 동일한 방식) 양쪽 대기열 행에 room_id를 채워줌
  async function becomeMatcherAndGo(myQueueId, opponentQueueId) {
    const { data: room, error: roomError } = await supabase
      .from("game_rooms")
      .insert({ state: initialGameState(), black_claimed: true })
      .select()
      .single();

    if (roomError || !room) {
      setError("매칭엔 성공했지만 방 생성에 실패했어요. 다시 시도해주세요.");
      setMatching(false);
      stopMatching();
      return;
    }

    await supabase.from("matchmaking_queue").update({ room_id: room.id }).in("id", [myQueueId, opponentQueueId]);
    localStorage.setItem(`gomoku-role-${room.id}`, "1");
    stopMatching();
    router.push(`/online/${room.id}`);
  }

  async function handleQuickMatch() {
    setError("");
    setMatching(true);

    const { data: queueRow, error: insertError } = await supabase
      .from("matchmaking_queue")
      .insert({})
      .select()
      .single();

    if (insertError || !queueRow) {
      setError("매칭 대기열 등록에 실패했어요. Supabase 테이블/설정을 확인해주세요.");
      setMatching(false);
      return;
    }

    const myQueueId = queueRow.id;
    queueIdRef.current = myQueueId;

    // 다른 누군가가 나를 짝지어주면(=내 대기열 행에 room_id가 채워지면) 그 방으로 이동
    channelRef.current = supabase
      .channel(`match-${myQueueId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matchmaking_queue", filter: `id=eq.${myQueueId}` },
        (payload) => {
          if (payload.new.room_id) {
            stopMatching();
            queueIdRef.current = null;
            router.push(`/online/${payload.new.room_id}`);
          }
        }
      )
      .subscribe();

    // 내가 먼저 대기 중이던 다른 사람을 찾아서 짝지어주는 쪽이 될 수도 있으니, 주기적으로 시도
    // 반환값(matched 여부)을 명시적으로 넘겨야, cancel/await 타이밍에 따라 폴링을 잘못 다시 시작하는 걸 막을 수 있음
    async function attempt() {
      if (attemptInFlightRef.current) return false;
      attemptInFlightRef.current = true;
      try {
        const { data: opponentId } = await supabase.rpc("try_match", { my_id: myQueueId });
        if (opponentId) {
          stopMatching();
          queueIdRef.current = null;
          await becomeMatcherAndGo(myQueueId, opponentId);
          return true;
        }
        return false;
      } finally {
        attemptInFlightRef.current = false;
      }
    }

    const matchedImmediately = await attempt();
    if (!matchedImmediately && queueIdRef.current === myQueueId) {
      pollTimerRef.current = setInterval(attempt, 2500);
    }
  }

  async function handleCancelMatch() {
    stopMatching();
    const myQueueId = queueIdRef.current;
    queueIdRef.current = null;
    setMatching(false);
    if (myQueueId) {
      await supabase.from("matchmaking_queue").delete().eq("id", myQueueId);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
      <h1 className="text-2xl font-bold">온라인 대전 (빠른 매칭)</h1>

      {matching ? (
        <>
          <p className="opacity-80 max-w-sm">상대를 찾는 중이에요...</p>
          <button className="bigButton" onClick={handleCancelMatch}>취소</button>
        </>
      ) : (
        <>
          <p className="opacity-80 max-w-sm">
            지금 대기 중인 다른 사람과 바로 짝지어드려요.
          </p>
          <button className="bigButton" onClick={handleQuickMatch}>빠른 대전 찾기</button>
        </>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Link href="/" className="text-sm underline opacity-70 mt-2">← 처음으로</Link>
    </main>
  );
}
