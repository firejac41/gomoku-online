"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { gameReducer } from "@/lib/gameReducer";
import {
  findThreatCells,
  findThreatLines,
  findForbiddenCells,
  findOpenThreeSetupCells,
  getEffectiveAugmentIds,
  getRingBounds,
  getRingFinalBounds,
  colorForPlayer,
  countStones,
  ENHANCEABLE_AUGMENT_IDS,
} from "@/lib/gomokuEngine";
import { playStoneSound, playAugmentSound, countTotalStones } from "@/lib/sound";
import { useYourTurnAlert } from "@/lib/useYourTurnAlert";
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
  discard: "버릴 증강 카드를 내 패널에서 선택하세요",
  appraisal: "강화할 증강 카드를 내 패널에서 선택하세요",
  ward: "일직선이 되는 두 칸을 선택하세요 (그 사이가 양쪽 다 영원히 막혀요)",
  prevention: "보호할 내 돌을 선택하세요",
  lifeTransfer: "골드로 교체할 실버 카드를 내 패널에서 선택하세요",
  reverseScale: "역린으로 표시할 내 돌을 선택하세요",
};

function relocateHint(pendingTarget) {
  return pendingTarget.sourceCell ? "옮길 빈 칸을 선택하세요" : "옮길 내 돌을 선택하세요";
}

const DEFAULT_TURN_TIME_LIMIT = 30; // 매 착수마다 주어지는 기본 제한시간(초) - 노즈도르무가 발동되면 timeLimitOverride로 대체됨

// 물리적 신원(myRole, sessionStorage에 저장되어 이 탭에서 방을 나갔다 와도 고정 - 단, 새 탭/다른 브라우저와는 공유 안 됨)을 지금 이 판에서 실제로 맡은 논리적 색(1=흑돌/2=백돌)으로 변환
// 재도전이 성사될 때마다 colorFlipped가 토글되어, 같은 사람이 다음 판엔 반대 색을 맡게 됨
function toLogicalColor(identity, colorFlipped) {
  if (identity !== 1 && identity !== 2) return identity; // spectator/null은 그대로
  if (!colorFlipped) return identity;
  return identity === 1 ? 2 : 1;
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

  // 인게임 채팅 - DB에 저장하지 않고 Supabase Realtime Broadcast로만 실시간 전달 (게임 상태 리듀서와 완전히 분리)
  const [chatMessages, setChatMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [lastSeenChatCount, setLastSeenChatCount] = useState(0);
  const channelRef = useRef(null);
  const chatListRef = useRef(null);
  const hasUnreadChat = !chatOpen && chatMessages.length > lastSeenChatCount;

  // 채팅창을 열면 그 시점까지 온 메시지는 전부 "읽음" 처리
  useEffect(() => {
    if (chatOpen) setLastSeenChatCount(chatMessages.length);
  }, [chatOpen, chatMessages]);

  // 새 메시지가 오거나 채팅창을 열면 항상 맨 아래로 스크롤
  useEffect(() => {
    if (chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [chatMessages, chatOpen]);

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

      const savedRole = sessionStorage.getItem(`gomoku-role-${roomId}`);
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
        sessionStorage.setItem(`gomoku-role-${roomId}`, String(role));
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
      // 채팅은 DB에 남기지 않고 이 채널의 broadcast 이벤트로만 주고받음 (postgres_changes와 채널 공유)
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        setChatMessages((prev) => [...prev, payload]);
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  // 보낸 사람 본인에게는 broadcast가 기본적으로 돌아오지 않아서, 보낼 때 로컬에도 바로 추가해줌
  function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || !channelRef.current) return;
    if (myColor !== 1 && myColor !== 2) return; // 관전자는 채팅 못 보냄 (조회만 가능)
    const payload = { color: myBoardColor, text: text.slice(0, 200), ts: Date.now() };
    channelRef.current.send({ type: "broadcast", event: "chat", payload });
    setChatMessages((prev) => [...prev, payload]);
    setChatInput("");
  }

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
    const myColorNow = toLogicalColor(myRole, current.colorFlipped);
    if (current.pendingTarget) {
      if (myColorNow !== current.pendingTarget.player) return;
      dispatchAction({ type: "TARGET_CELL", x, y });
      return;
    }
    if (myColorNow !== current.currentPlayer) return;
    dispatchAction({ type: "CLICK_CELL", x, y });
  }

  function handlePick(augment) {
    const current = gameStateRef.current;
    const myColorNow = toLogicalColor(myRole, current?.colorFlipped);
    if (!current?.augmentSelect || myColorNow !== current.augmentSelect.player) return;
    dispatchAction({ type: "PICK_AUGMENT", augment });
  }

  function handleRerollSlot(index) {
    const current = gameStateRef.current;
    const myColorNow = toLogicalColor(myRole, current?.colorFlipped);
    if (!current?.augmentSelect || myColorNow !== current.augmentSelect.player) return;
    dispatchAction({ type: "REROLL_SLOT", index });
  }

  function handleUseAbility(player, ability) {
    const current = gameStateRef.current;
    const myColorNow = toLogicalColor(myRole, current?.colorFlipped);
    if (myColorNow !== player) return;
    dispatchAction({ type: "USE_ABILITY", player, ability });
  }

  function handlePickCardTarget(augmentId) {
    const current = gameStateRef.current;
    const myColorNow = toLogicalColor(myRole, current?.colorFlipped);
    if (!current?.pendingTarget || myColorNow !== current.pendingTarget.player) return;
    dispatchAction({ type: "PICK_CARD_TARGET", augmentId });
  }

  function handleRequestRematch(player) {
    const current = gameStateRef.current;
    const myColorNow = toLogicalColor(myRole, current?.colorFlipped);
    if (myColorNow !== player) return;
    dispatchAction({ type: "REQUEST_REMATCH", player });
  }

  // myColor/opponentColor는 "지금 이 판에서 내가 맡은 신원 슬롯"(1|2) - ownedAugments/turn 비교 등은 전부 이 슬롯 기준
  // myBoardColor/opponentBoardColor는 "실제로 보드 위에 놓이는 돌 색" - 입장 바꿔 생각하기가 켜지면 위 슬롯과 달라질 수 있음
  const myColor = gameState ? toLogicalColor(myRole, gameState.colorFlipped) : myRole;
  const opponentColor = myColor === 1 ? 2 : myColor === 2 ? 1 : null;
  const myBoardColor = gameState ? colorForPlayer(myColor, gameState.roleSwapActive) : myColor;
  const opponentBoardColor = myBoardColor === 1 ? 2 : myBoardColor === 2 ? 1 : null;

  // 위험 감지: 상대가 두면 이기는 빈 칸 대신, 그 승리를 완성해줄 상대 돌들을 선으로 이어서 보여줌
  const threatLines = useMemo(() => {
    if (!gameState || opponentColor === null || gameState.currentPlayer !== myColor) return [];
    const myAugIds = gameState.ownedAugments[myColor].map((a) => a.id);
    if (!myAugIds.includes("threatRadar")) return [];
    const totalStonesPlaced = gameState.stonesPlaced[1] + gameState.stonesPlaced[2];
    const opponentAugIds = getEffectiveAugmentIds(gameState.ownedAugments[opponentColor].map((a) => a.id), totalStonesPlaced);
    return findThreatLines(gameState.board, opponentBoardColor, opponentAugIds, gameState.lastMove[opponentColor]);
  }, [gameState, myColor, opponentColor, opponentBoardColor]);

  // 직감: 지금 내가 두면 바로 이기는 칸을 강조 표시 (findThreatCells를 나 자신 기준으로 재사용)
  const winCells = useMemo(() => {
    if (!gameState || myColor !== gameState.currentPlayer) return [];
    const myAugIds = gameState.ownedAugments[myColor].map((a) => a.id);
    if (!myAugIds.includes("intuition")) return [];
    const totalStonesPlaced = gameState.stonesPlaced[1] + gameState.stonesPlaced[2];
    const myEffectiveAugIds = getEffectiveAugmentIds(myAugIds, totalStonesPlaced);
    return findThreatCells(gameState.board, myBoardColor, myEffectiveAugIds, gameState.lastMove[myColor]);
  }, [gameState, myColor, myBoardColor]);

  // 예지: 상대가 다음에 두면 열린 3목이 되는 빈 칸을 미리 강조 표시
  const foresightCells = useMemo(() => {
    if (!gameState || opponentBoardColor === null) return [];
    const myAugIds = gameState.ownedAugments[myColor]?.map((a) => a.id) || [];
    if (!myAugIds.includes("foresight")) return [];
    return findOpenThreeSetupCells(gameState.board, opponentBoardColor);
  }, [gameState, myColor, opponentBoardColor]);

  // 렌주룰 금수는 "지금 흑돌을 두는 신원" 차례에만 의미 있고, 그 신원 본인 화면에만 표시
  const forbiddenCells = useMemo(() => {
    if (!gameState) return [];
    const blackIdentity = colorForPlayer(1, gameState.roleSwapActive);
    if (myColor !== blackIdentity || gameState.currentPlayer !== blackIdentity) return [];
    const ownedIds = getEffectiveAugmentIds(
      gameState.ownedAugments[blackIdentity].map((a) => a.id),
      gameState.stonesPlaced[1] + gameState.stonesPlaced[2]
    );
    return findForbiddenCells(gameState.board, ownedIds, gameState.lastMove[blackIdentity]);
  }, [gameState, myColor]);

  // 제한시간 타이머: 모든 클라이언트가 카운트다운을 표시하지만, 실제로 시간 초과를 발동시키는 건 지금 차례인 본인 클라이언트뿐
  const isTimerActive = !!gameState && !gameState.gameOver && !gameState.augmentSelect && !gameState.pendingTarget;
  const turnKey = gameState ? gameState.currentPlayer + JSON.stringify(gameState.lastMove[1]) + JSON.stringify(gameState.lastMove[2]) : "";
  const turnTimeLimit = (gameState && gameState.timeLimitOverride) || DEFAULT_TURN_TIME_LIMIT;
  const [timeLeft, setTimeLeft] = useState(turnTimeLimit);
  const timeoutFiredRef = useRef(false);

  // 온라인 한정: 실제로 지금 내(myColor) 차례가 됐을 때만 알림 (상대 턴 시작/관전자에게는 안 울림)
  const myTurnPulse = useYourTurnAlert(turnKey, isTimerActive && (myColor === 1 || myColor === 2) && myColor === gameState?.currentPlayer);

  // 렌더 중에 turnKey 변화를 감지해서 타이머를 리셋 (effect 안에서 동기적으로 setState하는 대신
  // React가 권장하는 "렌더링 중 상태 조정" 패턴 사용 - https://react.dev/learn/you-might-not-need-an-effect)
  const prevTurnKeyRef = useRef(turnKey);
  if (prevTurnKeyRef.current !== turnKey) {
    prevTurnKeyRef.current = turnKey;
    timeoutFiredRef.current = false;
    if (timeLeft !== turnTimeLimit) setTimeLeft(turnTimeLimit);
  }

  useEffect(() => {
    if (!isTimerActive) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (!timeoutFiredRef.current) {
            const current = gameStateRef.current;
            const myColorNow = toLogicalColor(myRole, current?.colorFlipped);
            if (current && myColorNow === current.currentPlayer) {
              timeoutFiredRef.current = true;
              dispatchAction({ type: "TIMEOUT" });
            }
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey, isTimerActive]);

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
    deadCells, prisonActive, lastMove, rematchRequested, ringActive, ringStartMove, ringTarget, placementClock, chaosActive, roleSwapActive, peekedCard, ultimatumCell, boardFlipCooldown,
    removeStoneCooldown, selfUndoCooldown, jailbreakCooldown, relocateCooldown, prepStanceCooldown, preventionCooldown,
    fogTurnsLeft, checkerboardActive, timeLimitOverride, pokerFacePending, reverseScaleCell,
  } = gameState;
  const ringBounds = getRingBounds(ringStartMove, placementClock, ringTarget);
  // 링 위에서 싸우자: 발동 즉시 최종 위치가 공개되니, 지금 레벨과 무관하게 항상 미리보기로 계산
  const ringFinalBounds = ringActive ? getRingFinalBounds(ringTarget) : null;
  // roleLabel은 "지금 실제로 보드 위에 놓이는 내 돌 색"을 보여줘야 하므로 myBoardColor 기준
  // (myColor까지만 쓰면 입장 바꿔 생각하기가 켜졌을 때 실제 색과 다르게 표시됨)
  const roleLabel = myBoardColor === 1 ? "흑돌" : myBoardColor === 2 ? "백돌" : "관전";
  const currentTurnColor = colorForPlayer(currentPlayer, roleSwapActive);
  const waitingForOpponent = !roomMeta.black_claimed || !roomMeta.white_claimed;

  // 마지막으로 놓인 수 표시 - 지금 차례가 아닌 쪽이 방금 둔 사람이라 그쪽의 lastMove를 보여주면 됨 (관전자도 동일)
  const lastOpponentMoveCell = lastMove[currentPlayer === 1 ? 2 : 1];

  // 진하게: 나를 실제로 막는 칸(역병으로 죽은 칸도 포함, 양쪽 다 막힘) / 흐리게: 내가 상대에게 건 금지라 나는 상관없는 칸
  // 영구 봉쇄는 프리즘 등급이라 교도소가 발동하면 실제로 풀리므로(gameReducer의 isBlocked 참고), 화면 표시도
  // 같이 꺼야 함 - 안 그러면 이미 클릭 가능해진 칸에 여전히 막힌 X 표시가 남아서 헷갈림
  const effectivePermaBlockedCells = prisonActive ? { 1: [], 2: [] } : permaBlockedCells;
  const boardBlockedCells = myColor === 1 || myColor === 2
    ? [...blockedCells[myColor], ...effectivePermaBlockedCells[myColor], ...deadCells]
    : [...deadCells];
  const fadedBlockedCells = myColor === 1 || myColor === 2
    ? [...blockedCells[opponentColor], ...effectivePermaBlockedCells[opponentColor]]
    : [...blockedCells[1], ...effectivePermaBlockedCells[1], ...blockedCells[2], ...effectivePermaBlockedCells[2]];

  // 감시탑은 숨김이 없어서 누구든 양쪽에 세워진 걸 다 보여줌
  const boardWatchtowerCells = [...watchtowerCells[1], ...watchtowerCells[2]];
  // 역린도 숨김이 없어서 양쪽이 표시해둔 돌을 다 보여줌
  const boardReverseScaleCells = [reverseScaleCell[1], reverseScaleCell[2]].filter(Boolean);

  // 금지구역/영구봉쇄/감시탑처럼 여러 칸을 고르는 중이면, 지금까지 고른 칸을 표시. 재배치는 옮길 원본 돌 자리를 표시
  const pendingCells = pendingTarget
    ? pendingTarget.kind === "relocate"
      ? pendingTarget.sourceCell ? [pendingTarget.sourceCell] : []
      : pendingTarget.kind !== "removeStone" && pendingTarget.kind !== "plague"
      ? pendingTarget.selected
      : []
    : [];

  // 온라인 한정: 증강 선택 중엔 상대(와 관전자)에게 카드 내용을 숨기고, 고르는 사람 화면에만 실제 카드를 보여줌
  const isMyAugmentSelect = augmentSelect && myColor === augmentSelect.player;
  const isOthersAugmentSelect = augmentSelect && !isMyAugmentSelect;

  // 파기/감정은 보드 칸이 아니라 "내 패널의 카드"를 대상으로 고르는 능력이라, 해당 플레이어 패널에만
  // 카드 선택 모드를 켜고 실제로 고를 수 있는 카드 id 목록을 같이 넘겨줌
  const cardTargetKind =
    pendingTarget?.kind === "discard" || pendingTarget?.kind === "appraisal" || pendingTarget?.kind === "lifeTransfer"
      ? pendingTarget.kind
      : null;
  function eligibleCardIdsFor(player) {
    if (!cardTargetKind || pendingTarget.player !== player) return [];
    if (cardTargetKind === "discard") {
      return ownedAugments[player].filter((a) => a.id !== "discard").map((a) => a.id);
    }
    if (cardTargetKind === "lifeTransfer") {
      return ownedAugments[player].filter((a) => a.tier === "silver" && a.id !== "lifeTransfer").map((a) => a.id);
    }
    return ownedAugments[player].filter((a) => ENHANCEABLE_AUGMENT_IDS.includes(a.id) && !a.enhanced).map((a) => a.id);
  }

  return (
    <main className="gamePage">
      <div className="homeBgGrid" aria-hidden="true" />
      <h1 className="gameTitle">오목 (온라인 대전)</h1>
      <p className="text-sm opacity-70">
        나는 {roleLabel}{myRole === "spectator" ? "으로 보는 중" : " 입니다"}
      </p>

      {waitingForOpponent && (
        <div className="statusBanner waiting">
          상대방을 기다리는 중이에요. 이 페이지 링크를 상대방에게 보내주세요.
        </div>
      )}

      {prisonActive && (
        <div className="statusBanner prison">
          🔒 '교도소' 발동 중 - 양쪽 모두 프리즘 효과가 비활성화됐어요
        </div>
      )}

      {ringActive && (
        <div className="statusBanner ring">
          🥊 '링 위에서 싸우자' 발동 중 - 판이 서서히 좁아지고 있어요
        </div>
      )}

      {chaosActive && (
        <div className="statusBanner chaos">
          🌀 '폭주' 발동 중 - 양쪽 다 조작권을 잃고 무작위로 돌을 둬요
        </div>
      )}

      {roleSwapActive && (
        <div className="statusBanner roleSwapBanner">
          🔄 '입장 바꿔 생각하기' 발동 중 - 서로 담당하는 돌 색이 뒤바뀌었어요
        </div>
      )}

      {checkerboardActive && (
        <div className="statusBanner checkerboardBanner">
          🏁 '체크무늬' 발동 중 - 짝수 칸(대각선 방향)만 착수할 수 있어요
        </div>
      )}

      {timeLimitOverride && (
        <div className="statusBanner nozdormuBanner">
          ⏳ '노즈도르무' 발동 중 - 양쪽 제한시간이 {timeLimitOverride}초로 고정됐어요
        </div>
      )}

      <div className={"turnIndicator" + (myTurnPulse ? " myTurnPulse" : "")}>
        {!gameOver && <span className={"turnDot " + (currentTurnColor === 1 ? "black" : "white")} />}
        {gameOver ? "" : (currentTurnColor === 1 ? "흑돌 차례" : "백돌 차례")}
      </div>
      <div className="stoneCountText">총 {stonesPlaced[1] + stonesPlaced[2]}수 (흑 {countStones(board, 1)} · 백 {countStones(board, 2)})</div>
      {isTimerActive && (
        <div className={"timerText " + (timeLeft <= 10 ? "urgent" : "")}>⏱ 남은 시간: {timeLeft}초</div>
      )}
      {pendingTarget && (
        <div className="pendingTargetBanner">
          {(colorForPlayer(pendingTarget.player, roleSwapActive) === 1 ? "흑돌" : "백돌")}: {pendingTarget.kind === "relocate" ? relocateHint(pendingTarget) : TARGET_HINT[pendingTarget.kind]}
          {pendingTarget.need > 1 ? ` (${pendingTarget.selected.length}/${pendingTarget.need})` : ""}
        </div>
      )}
      <div className="forbiddenMessage">{forbiddenMessage}</div>

      <div className="gameLayout">
        <AugmentPanel
          title={colorForPlayer(1, roleSwapActive) === 1 ? "⚫ 흑돌 증강" : "⚪ 백돌 증강"}
          augments={ownedAugments[1]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === 1 && myColor === 1}
          usedMap={oneTimeUsed[1]}
          onUseAbility={(ability) => handleUseAbility(1, ability)}
          side="left"
          peekedCard={myColor === 1 ? peekedCard[1] : null}
          cooldowns={{
            boardFlip: boardFlipCooldown[1],
            removeStone: removeStoneCooldown[1],
            selfUndo: selfUndoCooldown[1],
            jailbreak: jailbreakCooldown[1],
            relocate: relocateCooldown[1],
            prepStance: prepStanceCooldown[1],
            prevention: preventionCooldown[1],
          }}
          cardTargetActive={cardTargetKind !== null && pendingTarget.player === 1 && myColor === 1}
          eligibleCardIds={eligibleCardIdsFor(1)}
          onPickCardTarget={handlePickCardTarget}
          pokerFaceReveal={myColor === 1 ? pokerFacePending[1] : null}
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
          reverseScaleCells={boardReverseScaleCells}
          threatLines={threatLines}
          winCells={winCells}
          lastOpponentMoveCell={lastOpponentMoveCell}
          ringBounds={ringBounds}
          ringFinalBounds={ringFinalBounds}
          ultimatumCell={myColor === 1 || myColor === 2 ? ultimatumCell[myColor] : null}
          foresightCells={foresightCells}
          checkerboardActive={checkerboardActive}
          fogTurnsLeft={myColor === 1 || myColor === 2 ? fogTurnsLeft[myColor] : 0}
        />
        <AugmentPanel
          title={colorForPlayer(2, roleSwapActive) === 1 ? "⚫ 흑돌 증강" : "⚪ 백돌 증강"}
          augments={ownedAugments[2]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === 2 && myColor === 2}
          usedMap={oneTimeUsed[2]}
          onUseAbility={(ability) => handleUseAbility(2, ability)}
          side="right"
          peekedCard={myColor === 2 ? peekedCard[2] : null}
          cooldowns={{
            boardFlip: boardFlipCooldown[2],
            removeStone: removeStoneCooldown[2],
            selfUndo: selfUndoCooldown[2],
            jailbreak: jailbreakCooldown[2],
            relocate: relocateCooldown[2],
            prepStance: prepStanceCooldown[2],
            prevention: preventionCooldown[2],
          }}
          cardTargetActive={cardTargetKind !== null && pendingTarget.player === 2 && myColor === 2}
          eligibleCardIds={eligibleCardIdsFor(2)}
          onPickCardTarget={handlePickCardTarget}
          pokerFaceReveal={myColor === 2 ? pokerFacePending[2] : null}
        />
      </div>

      <Link href="/" className="gameBackLink">← 처음으로</Link>

      {gameOver && (
        <WinOverlay
          message={winMessage}
          rematchRequested={rematchRequested}
          onRequestRematch={handleRequestRematch}
          myRole={myColor}
          roleSwapActive={roleSwapActive}
        />
      )}

      {isMyAugmentSelect && (
        <AugmentSelectOverlay
          playerLabel={colorForPlayer(augmentSelect.player, roleSwapActive) === 1 ? "흑돌" : "백돌"}
          stoneCount={stonesPlaced[augmentSelect.player]}
          choices={augmentSelect.choices}
          onPick={handlePick}
          rerolledSlots={augmentSelect.rerolledSlots}
          onRerollSlot={handleRerollSlot}
          isGamble={augmentSelect.isGamble}
          bonusRerollsRemaining={augmentSelect.bonusRerollsRemaining}
          isStartDraft={augmentSelect.isStartDraft}
        />
      )}

      {isOthersAugmentSelect && (myColor === 1 || myColor === 2) && ownedAugments[myColor].some((a) => a.id === "cunning") && (
        <AugmentSelectOverlay
          playerLabel={colorForPlayer(augmentSelect.player, roleSwapActive) === 1 ? "흑돌" : "백돌"}
          stoneCount={stonesPlaced[augmentSelect.player]}
          choices={augmentSelect.choices}
          rerolledSlots={augmentSelect.rerolledSlots}
          isGamble={augmentSelect.isGamble}
          bonusRerollsRemaining={augmentSelect.bonusRerollsRemaining}
          isStartDraft={augmentSelect.isStartDraft}
          readOnly
        />
      )}
      {isOthersAugmentSelect && !((myColor === 1 || myColor === 2) && ownedAugments[myColor].some((a) => a.id === "cunning")) && (
        <div className="augmentSelectOverlay">
          <div className="augmentSelectContent">
            <h2>
              {(colorForPlayer(augmentSelect.player, roleSwapActive) === 1 ? "흑돌" : "백돌") +
                (augmentSelect.isStartDraft ? "이 시작 증강 선택 중..." : "이 증강 선택 중...")}
            </h2>
          </div>
        </div>
      )}

      <div className="chatWidget">
        {chatOpen && (
          <div className="chatPanel">
            <div className="chatHeader">
              <span>채팅</span>
              <button className="chatCloseButton" onClick={() => setChatOpen(false)}>✕</button>
            </div>
            <div className="chatMessages" ref={chatListRef}>
              {chatMessages.length === 0 && <div className="chatEmptyHint">아직 채팅이 없어요</div>}
              {chatMessages.map((m, i) => (
                <div key={i} className="chatMessage">
                  <span className={"chatSender " + (m.color === 1 ? "chatBlack" : "chatWhite")}>
                    {m.color === 1 ? "⚫ 흑돌:" : "⚪ 백돌:"}
                  </span>
                  <span className="chatText">{m.text}</span>
                </div>
              ))}
            </div>
            {(myColor === 1 || myColor === 2) && (
              <div className="chatInputRow">
                <input
                  className="chatInput"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChatMessage();
                  }}
                  placeholder="메시지 입력..."
                  maxLength={200}
                />
                <button className="chatSendButton" onClick={sendChatMessage}>전송</button>
              </div>
            )}
          </div>
        )}
        <button className="chatToggleButton" onClick={() => setChatOpen((prev) => !prev)}>
          💬
          {hasUnreadChat && <span className="chatUnreadDot" />}
        </button>
      </div>
    </main>
  );
}
