"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { gameReducer } from "@/lib/gameReducer";
import { findThreatCells, findForbiddenCells, getEffectiveAugmentIds, getRingBounds } from "@/lib/gomokuEngine";
import { playStoneSound, playAugmentSound, countTotalStones } from "@/lib/sound";
import GomokuBoard from "@/components/GomokuBoard";
import AugmentPanel from "@/components/AugmentPanel";
import AugmentSelectOverlay from "@/components/AugmentSelectOverlay";
import WinOverlay from "@/components/WinOverlay";

const TARGET_HINT = {
  banZone: "빈 칸 3곳을 선택하세요",
  permaBlock: "빈 칸 1곳을 선택하세요",
  removeStone: "제거할 상대 돌을 선택하세요",
  watchtower: "감시탑을 세울 빈 칸을 선택하세요",
  ultimatum: "최후통첩으로 선언할 빈 칸을 선택하세요",
  jailbreak: "해제할 막힌 자리를 선택하세요",
  plague: "영구 봉인할 상대 돌을 선택하세요",
  collapse: "중심으로 삼을 칸을 선택하세요 (3x3이 사라져요)",
};

function relocateHint(pendingTarget) {
  return pendingTarget.sourceCell ? "옮길 빈 칸을 선택하세요" : "옮길 내 돌을 선택하세요";
}

// 방에 아직 아무도 흑/백을 안 맡았으면 선점, 이미 있으면 남은 자리 선점, 둘 다 찼으면 관전
// 리턴값에 방금 반영된 claimed 플래그도 같이 담아줘서, 호출부가 갱신 전 값을 쓰는 실수를 방지함
async function claimRole(roomId, room) {
  let blackClaimed = room.black_claimed;
  let whiteClaimed = room.white_claimed;

  if (!blackClaimed) {
    const { data } = await supabase
      .from("game_rooms")
      .update({ black_claimed: true })
      .eq("id", roomId)
      .eq("black_claimed", false)
      .select();
    if (data && data.length > 0) {
      return { role: 1, blackClaimed: true, whiteClaimed };
    }
  }
  if (!whiteClaimed) {
    const { data } = await supabase
      .from("game_rooms")
      .update({ white_claimed: true })
      .eq("id", roomId)
      .eq("white_claimed", false)
      .select();
    if (data && data.length > 0) {
      return { role: 2, blackClaimed, whiteClaimed: true };
    }
  }
  return { role: "spectator", blackClaimed, whiteClaimed };
}

// forbiddenMessage/forbiddenToken 말고 다른 필드가 하나라도 바뀌었으면 "진짜 변화"로 취급해서 서버에 반영
function hasRealChange(prev, next) {
  return Object.keys(next).some((key) => {
    if (key === "forbiddenMessage" || key === "forbiddenToken") return false;
    return prev[key] !== next[key];
  });
}

export default function RoomClient({ roomId }) {
  const [status, setStatus] = useState("loading"); // loading | notfound | ready
  const [gameState, setGameState] = useState(null);
  const [roomMeta, setRoomMeta] = useState({ black_claimed: false, white_claimed: false });
  const [myRole, setMyRole] = useState(null); // 1 | 2 | 'spectator'
  const [forbiddenMessage, setForbiddenMessage] = useState("");
  const gameStateRef = useRef(null);
  const forbiddenTimer = useRef(null);
  const prevStoneCountRef = useRef(null);
  const hadAugmentSelectRef = useRef(false);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // 보드 위 돌 개수가 늘어난 순간(=착수, 상대의 수 포함) 착수음 재생. 처음 로딩될 때는 안 울리게 함
  useEffect(() => {
    if (!gameState) return;
    const count = countTotalStones(gameState.board);
    if (prevStoneCountRef.current !== null && count > prevStoneCountRef.current) {
      playStoneSound();
    }
    prevStoneCountRef.current = count;
  }, [gameState]);

  // 증강 선택 카드가 새로 뜨는 순간(null -> 카드 목록)에만 증강 등장음 재생. 리롤로 카드가 바뀔 때는 다시 안 울림. 양쪽 클라이언트 다 들림
  useEffect(() => {
    if (!gameState) return;
    if (gameState.augmentSelect && !hadAugmentSelectRef.current) {
      playAugmentSound();
    }
    hadAugmentSelectRef.current = !!gameState.augmentSelect;
  }, [gameState]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      const { data: room, error } = await supabase.from("game_rooms").select("*").eq("id", roomId).single();
      if (error || !room) {
        if (!cancelled) setStatus("notfound");
        return;
      }

      const savedRole = localStorage.getItem(`gomoku-role-${roomId}`);
      let role;
      let blackClaimed = room.black_claimed;
      let whiteClaimed = room.white_claimed;

      if (savedRole === "1" || savedRole === "2") {
        role = Number(savedRole);
      } else if (savedRole === "spectator") {
        role = "spectator";
      } else {
        const claimed = await claimRole(roomId, room);
        role = claimed.role;
        blackClaimed = claimed.blackClaimed;
        whiteClaimed = claimed.whiteClaimed;
        localStorage.setItem(`gomoku-role-${roomId}`, String(role));
      }

      if (cancelled) return;
      setMyRole(role);
      setGameState(room.state);
      setRoomMeta({ black_claimed: blackClaimed, white_claimed: whiteClaimed });
      setStatus("ready");
    }

    setup();

    const channel = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          setGameState(payload.new.state);
          setRoomMeta({ black_claimed: payload.new.black_claimed, white_claimed: payload.new.white_claimed });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  async function pushState(newState) {
    setGameState(newState);
    await supabase.from("game_rooms").update({ state: newState }).eq("id", roomId);
  }

  function flashForbidden(message) {
    setForbiddenMessage(message);
    clearTimeout(forbiddenTimer.current);
    forbiddenTimer.current = setTimeout(() => setForbiddenMessage(""), 1500);
  }

  // 액션을 로컬 리듀서로 미리 계산해보고, 실제로 판이 바뀌는 경우에만 서버에 반영해서 상대에게 전파
  function dispatchAction(action) {
    const current = gameStateRef.current;
    const newState = gameReducer(current, action);
    if (newState === current) return;

    // 안내 메시지(먼저 보기/동전 던지기/거래 등)는 실제 상태 변화 여부와 무관하게 나한테만 로컬로 띄움
    // (gameState.forbiddenMessage는 서버에 올라가도 상대 화면에서는 안 쓰이니 상대에게 새어나가지 않음)
    if (newState.forbiddenMessage) flashForbidden(newState.forbiddenMessage);

    if (!hasRealChange(current, newState)) {
      // 렌주룰 금수 안내처럼 나한테만 보이면 되는 변화는 서버에 안 올림
      return;
    }

    pushState(newState);
  }

  function handleCellClick(x, y) {
    const current = gameStateRef.current;
    if (!current) return;
    if (current.pendingTarget) {
      if (myRole !== current.pendingTarget.player) return;
      dispatchAction({ type: "TARGET_CELL", x, y });
      return;
    }
    if (myRole !== current.currentPlayer) return;
    dispatchAction({ type: "CLICK_CELL", x, y });
  }

  function handlePick(augment) {
    const current = gameStateRef.current;
    if (!current?.augmentSelect || myRole !== current.augmentSelect.player) return;
    dispatchAction({ type: "PICK_AUGMENT", augment });
  }

  function handleRerollSlot(index) {
    const current = gameStateRef.current;
    if (!current?.augmentSelect || myRole !== current.augmentSelect.player) return;
    dispatchAction({ type: "REROLL_SLOT", index });
  }

  function handleUseAbility(player, ability) {
    if (myRole !== player) return;
    dispatchAction({ type: "USE_ABILITY", player, ability });
  }

  function handleRequestRematch(player) {
    if (myRole !== player) return;
    dispatchAction({ type: "REQUEST_REMATCH", player });
  }

  const opponentRole = myRole === 1 ? 2 : myRole === 2 ? 1 : null;
  const threatCells = useMemo(() => {
    if (!gameState || opponentRole === null || gameState.currentPlayer !== myRole) return [];
    const myAugIds = gameState.ownedAugments[myRole].map((a) => a.id);
    if (!myAugIds.includes("threatRadar")) return [];
    const totalStonesPlaced = gameState.stonesPlaced[1] + gameState.stonesPlaced[2];
    const opponentAugIds = getEffectiveAugmentIds(gameState.ownedAugments[opponentRole].map((a) => a.id), totalStonesPlaced);
    return findThreatCells(gameState.board, opponentRole, opponentAugIds, gameState.lastMove[opponentRole]);
  }, [gameState, myRole, opponentRole]);

  // 직감: 지금 내가 두면 바로 이기는 칸을 강조 표시 (findThreatCells를 나 자신 기준으로 재사용)
  const winCells = useMemo(() => {
    if (!gameState || myRole !== gameState.currentPlayer) return [];
    const myAugIds = gameState.ownedAugments[myRole].map((a) => a.id);
    if (!myAugIds.includes("intuition")) return [];
    const totalStonesPlaced = gameState.stonesPlaced[1] + gameState.stonesPlaced[2];
    const myEffectiveAugIds = getEffectiveAugmentIds(myAugIds, totalStonesPlaced);
    return findThreatCells(gameState.board, myRole, myEffectiveAugIds, gameState.lastMove[myRole]);
  }, [gameState, myRole]);

  // 렌주룰 금수는 흑돌 차례에만 의미 있고, 흑돌 본인 화면에만 표시
  const forbiddenCells = useMemo(() => {
    if (!gameState || myRole !== 1 || gameState.currentPlayer !== 1) return [];
    const ownedIds = getEffectiveAugmentIds(
      gameState.ownedAugments[1].map((a) => a.id),
      gameState.stonesPlaced[1] + gameState.stonesPlaced[2]
    );
    return findForbiddenCells(gameState.board, ownedIds, gameState.lastMove[1]);
  }, [gameState, myRole]);

  if (status === "loading") {
    return <main className="min-h-screen flex items-center justify-center">불러오는 중...</main>;
  }

  if (status === "notfound") {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3">
        <p>방을 찾을 수 없어요. 링크를 다시 확인해주세요.</p>
        <Link href="/" className="text-sm underline opacity-70">← 처음으로</Link>
      </main>
    );
  }

  const {
    board, currentPlayer, gameOver, winMessage, stonesPlaced, ownedAugments,
    augmentSelect, oneTimeUsed, pendingTarget, blockedCells, permaBlockedCells, watchtowerCells,
    deadCells, prisonActive, lastMove, rematchRequested, ringActive, ringStartMove, chaosActive,
  } = gameState;
  const ringBounds = getRingBounds(ringStartMove, stonesPlaced[1] + stonesPlaced[2]);
  const roleLabel = myRole === 1 ? "흑돌" : myRole === 2 ? "백돌" : "관전";
  const waitingForOpponent = !roomMeta.black_claimed || !roomMeta.white_claimed;

  // 마지막으로 놓인 수 표시 - 지금 차례가 아닌 쪽이 방금 둔 사람이라 그쪽의 lastMove를 보여주면 됨 (관전자도 동일)
  const lastOpponentMoveCell = lastMove[currentPlayer === 1 ? 2 : 1];

  // 진하게: 나를 실제로 막는 칸(역병으로 죽은 칸도 포함, 양쪽 다 막힘) / 흐리게: 내가 상대에게 건 금지라 나는 상관없는 칸
  const boardBlockedCells = myRole === 1 || myRole === 2
    ? [...blockedCells[myRole], ...permaBlockedCells[myRole], ...deadCells]
    : [...deadCells];
  const fadedBlockedCells = myRole === 1 || myRole === 2
    ? [...blockedCells[opponentRole], ...permaBlockedCells[opponentRole]]
    : [...blockedCells[1], ...permaBlockedCells[1], ...blockedCells[2], ...permaBlockedCells[2]];

  // 감시탑은 숨김이 없어서 누구든 양쪽에 세워진 걸 다 보여줌
  const boardWatchtowerCells = [...watchtowerCells[1], ...watchtowerCells[2]];

  // 금지구역/영구봉쇄/감시탑처럼 여러 칸을 고르는 중이면, 지금까지 고른 칸을 표시. 재배치는 옮길 원본 돌 자리를 표시
  const pendingCells = pendingTarget
    ? pendingTarget.kind === "relocate"
      ? pendingTarget.sourceCell ? [pendingTarget.sourceCell] : []
      : pendingTarget.kind !== "removeStone" && pendingTarget.kind !== "plague"
      ? pendingTarget.selected
      : []
    : [];

  // 온라인 한정: 증강 선택 중엔 상대(와 관전자)에게 카드 내용을 숨기고, 고르는 사람 화면에만 실제 카드를 보여줌
  const isMyAugmentSelect = augmentSelect && myRole === augmentSelect.player;
  const isOthersAugmentSelect = augmentSelect && !isMyAugmentSelect;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center gap-2 py-8">
      <h1 className="text-2xl font-bold">오목 (온라인 대전)</h1>
      <p className="text-sm opacity-70">
        나는 {roleLabel}{myRole === "spectator" ? "으로 보는 중" : " 입니다"}
      </p>

      {waitingForOpponent && (
        <div className="text-sm bg-[#3a3a3a] rounded-md px-3 py-2 max-w-sm">
          상대방을 기다리는 중이에요. 이 페이지 링크를 상대방에게 보내주세요.
        </div>
      )}

      {prisonActive && (
        <div className="text-sm bg-[#3a1a1a] rounded-md px-3 py-2 max-w-sm">
          🔒 '교도소' 발동 중 - 양쪽 모두 프리즘 효과가 비활성화됐어요
        </div>
      )}

      {ringActive && (
        <div className="text-sm bg-[#3a2a0f] rounded-md px-3 py-2 max-w-sm">
          🥊 '링 위에서 싸우자' 발동 중 - 판이 서서히 좁아지고 있어요
        </div>
      )}

      {chaosActive && (
        <div className="text-sm bg-[#3a0f2a] rounded-md px-3 py-2 max-w-sm">
          🌀 '폭주' 발동 중 - 양쪽 다 조작권을 잃고 무작위로 돌을 둬요
        </div>
      )}

      <div className="text-lg mb-1">{gameOver ? "" : (currentPlayer === 1 ? "흑돌 차례" : "백돌 차례")}</div>
      <div className="text-xs opacity-60 mb-1">총 {stonesPlaced[1] + stonesPlaced[2]}수</div>
      {pendingTarget && (
        <div className="pendingTargetBanner">
          {(pendingTarget.player === 1 ? "흑돌" : "백돌")}: {pendingTarget.kind === "relocate" ? relocateHint(pendingTarget) : TARGET_HINT[pendingTarget.kind]}
          {pendingTarget.need > 1 ? ` (${pendingTarget.selected.length}/${pendingTarget.need})` : ""}
        </div>
      )}
      <div className="forbiddenMessage">{forbiddenMessage}</div>

      <div className="gameLayout">
        <AugmentPanel
          title="⚫ 흑돌 증강"
          augments={ownedAugments[1]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === 1 && myRole === 1}
          usedMap={oneTimeUsed[1]}
          onUseAbility={(ability) => handleUseAbility(1, ability)}
          side="left"
        />
        <GomokuBoard
          board={board}
          onCellClick={handleCellClick}
          disabled={gameOver || !!augmentSelect || myRole === "spectator"}
          blockedCells={boardBlockedCells}
          fadedBlockedCells={fadedBlockedCells}
          forbiddenCells={forbiddenCells}
          pendingCells={pendingCells}
          watchtowerCells={boardWatchtowerCells}
          threatCells={threatCells}
          winCells={winCells}
          lastOpponentMoveCell={lastOpponentMoveCell}
          ringBounds={ringBounds}
        />
        <AugmentPanel
          title="⚪ 백돌 증강"
          augments={ownedAugments[2]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === 2 && myRole === 2}
          usedMap={oneTimeUsed[2]}
          onUseAbility={(ability) => handleUseAbility(2, ability)}
          side="right"
        />
      </div>

      <Link href="/" className="text-sm underline opacity-70 mt-4">← 처음으로</Link>

      {gameOver && (
        <WinOverlay
          message={winMessage}
          rematchRequested={rematchRequested}
          onRequestRematch={handleRequestRematch}
          myRole={myRole}
        />
      )}

      {isMyAugmentSelect && (
        <AugmentSelectOverlay
          playerLabel={augmentSelect.player === 1 ? "흑돌" : "백돌"}
          stoneCount={stonesPlaced[augmentSelect.player]}
          choices={augmentSelect.choices}
          onPick={handlePick}
          rerolledSlots={augmentSelect.rerolledSlots}
          onRerollSlot={handleRerollSlot}
          isGamble={augmentSelect.isGamble}
          bonusRerollsRemaining={augmentSelect.bonusRerollsRemaining}
        />
      )}

      {isOthersAugmentSelect && (
        <div className="augmentSelectOverlay">
          <div className="augmentSelectContent">
            <h2>{(augmentSelect.player === 1 ? "흑돌" : "백돌") + "이 증강 선택 중..."}</h2>
          </div>
        </div>
      )}
    </main>
  );
}
