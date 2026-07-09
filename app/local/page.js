"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import GomokuBoard from "@/components/GomokuBoard";
import AugmentPanel from "@/components/AugmentPanel";
import AugmentSelectOverlay from "@/components/AugmentSelectOverlay";
import WinOverlay from "@/components/WinOverlay";
import { gameReducer, initialGameState } from "@/lib/gameReducer";
import { findThreatCells, findThreatLines, findForbiddenCells, getEffectiveAugmentIds, getRingBounds, colorForPlayer, countStones } from "@/lib/gomokuEngine";
import { playStoneSound, playAugmentSound, countTotalStones } from "@/lib/sound";

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

const TURN_TIME_LIMIT = 30; // 매 착수마다 주어지는 제한시간(초)

export default function LocalGamePage() {
  const [state, dispatch] = useReducer(gameReducer, undefined, initialGameState);
  const {
    board, currentPlayer, gameOver, winMessage, stonesPlaced, ownedAugments,
    forbiddenMessage, forbiddenToken, augmentSelect, oneTimeUsed, pendingTarget,
    blockedCells, permaBlockedCells, lastMove, watchtowerCells, deadCells, prisonActive, rematchRequested,
    ringActive, ringStartMove, chaosActive, roleSwapActive, peekedCard, ultimatumCell, boardFlipCooldown,
  } = state;

  // 제한시간 타이머: 착수 하나가 끝날 때마다(같은 플레이어가 이어서 두는 질풍노도/양수겹침 보너스 수 포함) 새로 30초 시작
  const isTimerActive = !gameOver && !augmentSelect && !pendingTarget;
  const turnKey = currentPlayer + JSON.stringify(lastMove[1]) + JSON.stringify(lastMove[2]);
  const [timeLeft, setTimeLeft] = useState(TURN_TIME_LIMIT);
  const timeoutFiredRef = useRef(false);

  // 렌더 중에 turnKey 변화를 감지해서 타이머를 리셋 (effect 안에서 동기적으로 setState하는 대신
  // React가 권장하는 "렌더링 중 상태 조정" 패턴 사용 - https://react.dev/learn/you-might-not-need-an-effect)
  const prevTurnKeyRef = useRef(turnKey);
  if (prevTurnKeyRef.current !== turnKey) {
    prevTurnKeyRef.current = turnKey;
    timeoutFiredRef.current = false;
    if (timeLeft !== TURN_TIME_LIMIT) setTimeLeft(TURN_TIME_LIMIT);
  }

  useEffect(() => {
    if (!isTimerActive) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (!timeoutFiredRef.current) {
            timeoutFiredRef.current = true;
            dispatch({ type: "TIMEOUT" });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [turnKey, isTimerActive]);

  const ringBounds = useMemo(
    () => getRingBounds(ringStartMove, stonesPlaced[1] + stonesPlaced[2]),
    [ringStartMove, stonesPlaced]
  );

  // 금수/안내 메시지를 1.5초 후 자동으로 지움
  useEffect(() => {
    if (!forbiddenMessage) return;
    const timer = setTimeout(() => dispatch({ type: "CLEAR_FORBIDDEN" }), 1500);
    return () => clearTimeout(timer);
    // forbiddenToken을 매번 올려주기 때문에, 같은 문구가 연달아 떠도 토큰만으로 타이머가 재시작됨
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forbiddenToken]);

  // 보드 위 돌 개수가 늘어난 순간(=착수) 착수음 재생. 첫 렌더에는 안 울리게 null로 초기화
  const prevStoneCountRef = useRef(null);
  useEffect(() => {
    const count = countTotalStones(board);
    if (prevStoneCountRef.current !== null && count > prevStoneCountRef.current) {
      playStoneSound();
    }
    prevStoneCountRef.current = count;
  }, [board]);

  // 증강 선택 카드가 새로 뜨는 순간(null -> 카드 목록)에만 증강 등장음 재생. 리롤로 카드가 바뀔 때는 다시 안 울림
  const hadAugmentSelectRef = useRef(false);
  useEffect(() => {
    if (augmentSelect && !hadAugmentSelectRef.current) {
      playAugmentSound();
    }
    hadAugmentSelectRef.current = !!augmentSelect;
  }, [augmentSelect]);

  const opponent = currentPlayer === 1 ? 2 : 1;
  // 입장 바꿔 생각하기: 신원(currentPlayer/opponent)과 실제로 보드에 놓이는 돌 색이 다를 수 있음
  const currentColor = colorForPlayer(currentPlayer, roleSwapActive);
  const opponentColor = colorForPlayer(opponent, roleSwapActive);
  const boardBlockedCells = useMemo(
    () => [...blockedCells[currentPlayer], ...permaBlockedCells[currentPlayer], ...deadCells],
    [blockedCells, permaBlockedCells, deadCells, currentPlayer]
  );
  const fadedBlockedCells = useMemo(
    () => [...blockedCells[opponent], ...permaBlockedCells[opponent]],
    [blockedCells, permaBlockedCells, opponent]
  );
  // 감시탑은 숨김이 없어서 누구 턴이든 양쪽에 세워진 걸 다 보여줌
  const boardWatchtowerCells = useMemo(
    () => [...watchtowerCells[1], ...watchtowerCells[2]],
    [watchtowerCells]
  );
  // 금지구역/영구봉쇄/감시탑처럼 여러 칸을 고르는 중이면, 지금까지 고른 칸을 표시. 재배치는 옮길 원본 돌 자리를 표시
  const pendingCells = pendingTarget
    ? pendingTarget.kind === "relocate"
      ? pendingTarget.sourceCell ? [pendingTarget.sourceCell] : []
      : pendingTarget.kind !== "removeStone" && pendingTarget.kind !== "plague"
      ? pendingTarget.selected
      : []
    : [];

  // 위험 감지: 상대가 두면 이기는 빈 칸 대신, 그 승리를 완성해줄 상대 돌들을 선으로 이어서 보여줌
  const threatLines = useMemo(() => {
    const myAugIds = ownedAugments[currentPlayer].map((a) => a.id);
    if (!myAugIds.includes("threatRadar")) return [];
    const totalStonesPlaced = stonesPlaced[1] + stonesPlaced[2];
    const opponentAugIds = getEffectiveAugmentIds(ownedAugments[opponent].map((a) => a.id), totalStonesPlaced);
    return findThreatLines(board, opponentColor, opponentAugIds, lastMove[opponent]);
  }, [board, ownedAugments, currentPlayer, opponent, opponentColor, lastMove, stonesPlaced]);

  // 직감: 지금 두면 바로 이기는 칸을 강조 표시 (findThreatCells를 나 자신 기준으로 재사용)
  const winCells = useMemo(() => {
    const myAugIds = ownedAugments[currentPlayer].map((a) => a.id);
    if (!myAugIds.includes("intuition")) return [];
    const totalStonesPlaced = stonesPlaced[1] + stonesPlaced[2];
    const myEffectiveAugIds = getEffectiveAugmentIds(myAugIds, totalStonesPlaced);
    return findThreatCells(board, currentColor, myEffectiveAugIds, lastMove[currentPlayer]);
  }, [board, ownedAugments, currentPlayer, currentColor, lastMove, stonesPlaced]);

  // 마지막으로 놓인 수 표시 - 지금 차례가 아닌 쪽이 방금 둔 사람
  const lastOpponentMoveCell = lastMove[opponent];

  // 렌주룰 금수는 "지금 흑돌을 두는 신원"의 차례에만 의미 있음 (입장 바꿔 생각하기로 신원 1이 아닐 수 있음)
  const forbiddenCells = useMemo(() => {
    if (currentColor !== 1) return [];
    const ownedIds = getEffectiveAugmentIds(ownedAugments[currentPlayer].map((a) => a.id), stonesPlaced[1] + stonesPlaced[2]);
    return findForbiddenCells(board, ownedIds, lastMove[currentPlayer]);
  }, [board, ownedAugments, currentPlayer, currentColor, lastMove, stonesPlaced]);

  function handleBoardClick(x, y) {
    if (pendingTarget) {
      dispatch({ type: "TARGET_CELL", x, y });
    } else {
      dispatch({ type: "CLICK_CELL", x, y });
    }
  }

  function handleUseAbility(player, ability) {
    dispatch({ type: "USE_ABILITY", player, ability });
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center gap-2 py-8">
      <h1 className="text-2xl font-bold">오목 (로컬 대전)</h1>
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
      {roleSwapActive && (
        <div className="text-sm bg-[#0f2a3a] rounded-md px-3 py-2 max-w-sm">
          🔄 '입장 바꿔 생각하기' 발동 중 - 서로 담당하는 돌 색이 뒤바뀌었어요
        </div>
      )}
      <div className="text-lg mb-1">{gameOver ? "" : (currentColor === 1 ? "흑돌 차례" : "백돌 차례")}</div>
      <div className="text-xs opacity-60 mb-1">총 {stonesPlaced[1] + stonesPlaced[2]}수 (흑 {countStones(board, 1)} · 백 {countStones(board, 2)})</div>
      {isTimerActive && (
        <div className={"text-sm " + (timeLeft <= 10 ? "text-red-400" : "opacity-70")}>⏱ 남은 시간: {timeLeft}초</div>
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
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === 1}
          usedMap={oneTimeUsed[1]}
          onUseAbility={(ability) => handleUseAbility(1, ability)}
          side="left"
          peekedCard={peekedCard[1]}
          cooldowns={{ boardFlip: boardFlipCooldown[1] }}
        />
        <GomokuBoard
          board={board}
          onCellClick={handleBoardClick}
          disabled={gameOver || !!augmentSelect}
          blockedCells={boardBlockedCells}
          fadedBlockedCells={fadedBlockedCells}
          forbiddenCells={forbiddenCells}
          pendingCells={pendingCells}
          watchtowerCells={boardWatchtowerCells}
          threatLines={threatLines}
          winCells={winCells}
          lastOpponentMoveCell={lastOpponentMoveCell}
          ringBounds={ringBounds}
          ultimatumCell={ultimatumCell[currentPlayer]}
          fadedUltimatumCell={ultimatumCell[opponent]}
        />
        <AugmentPanel
          title={colorForPlayer(2, roleSwapActive) === 1 ? "⚫ 흑돌 증강" : "⚪ 백돌 증강"}
          augments={ownedAugments[2]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === 2}
          usedMap={oneTimeUsed[2]}
          onUseAbility={(ability) => handleUseAbility(2, ability)}
          side="right"
          peekedCard={peekedCard[2]}
          cooldowns={{ boardFlip: boardFlipCooldown[2] }}
        />
      </div>

      <Link href="/" className="text-sm underline opacity-70 mt-4">← 처음으로</Link>

      {gameOver && (
        <WinOverlay
          message={winMessage}
          rematchRequested={rematchRequested}
          onRequestRematch={(player) => dispatch({ type: "REQUEST_REMATCH", player })}
          myRole={null}
        />
      )}

      {augmentSelect && (
        <AugmentSelectOverlay
          playerLabel={colorForPlayer(augmentSelect.player, roleSwapActive) === 1 ? "흑돌" : "백돌"}
          stoneCount={stonesPlaced[augmentSelect.player]}
          choices={augmentSelect.choices}
          onPick={(augment) => dispatch({ type: "PICK_AUGMENT", augment })}
          rerolledSlots={augmentSelect.rerolledSlots}
          onRerollSlot={(index) => dispatch({ type: "REROLL_SLOT", index })}
          isGamble={augmentSelect.isGamble}
          bonusRerollsRemaining={augmentSelect.bonusRerollsRemaining}
        />
      )}
    </main>
  );
}
