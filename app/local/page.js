"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import Link from "next/link";
import GomokuBoard from "@/components/GomokuBoard";
import AugmentPanel from "@/components/AugmentPanel";
import AugmentSelectOverlay from "@/components/AugmentSelectOverlay";
import WinOverlay from "@/components/WinOverlay";
import { gameReducer, initialGameState } from "@/lib/gameReducer";
import { findThreatCells, findForbiddenCells, getEffectiveAugmentIds } from "@/lib/gomokuEngine";
import { playStoneSound, playAugmentSound, countTotalStones } from "@/lib/sound";

const TARGET_HINT = {
  banZone: "빈 칸 3곳을 선택하세요",
  permaBlock: "빈 칸 1곳을 선택하세요",
  removeStone: "제거할 상대 돌을 선택하세요",
  watchtower: "감시탑을 세울 빈 칸을 선택하세요",
  ultimatum: "최후통첩으로 선언할 빈 칸을 선택하세요",
};

export default function LocalGamePage() {
  const [state, dispatch] = useReducer(gameReducer, undefined, initialGameState);
  const {
    board, currentPlayer, gameOver, winMessage, stonesPlaced, ownedAugments,
    forbiddenMessage, forbiddenToken, augmentSelect, oneTimeUsed, pendingTarget,
    blockedCells, permaBlockedCells, lastMove, watchtowerCells,
  } = state;

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
  const boardBlockedCells = useMemo(
    () => [...blockedCells[currentPlayer], ...permaBlockedCells[currentPlayer]],
    [blockedCells, permaBlockedCells, currentPlayer]
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
  const pendingCells = pendingTarget && pendingTarget.kind !== "removeStone" ? pendingTarget.selected : [];

  const threatCells = useMemo(() => {
    const myAugIds = ownedAugments[currentPlayer].map((a) => a.id);
    if (!myAugIds.includes("threatRadar")) return [];
    const totalStonesPlaced = stonesPlaced[1] + stonesPlaced[2];
    const opponentAugIds = getEffectiveAugmentIds(ownedAugments[opponent].map((a) => a.id), totalStonesPlaced);
    return findThreatCells(board, opponent, opponentAugIds, lastMove[opponent]);
  }, [board, ownedAugments, currentPlayer, opponent, lastMove, stonesPlaced]);

  // 렌주룰 금수는 흑돌 차례에만 의미 있음
  const forbiddenCells = useMemo(() => {
    if (currentPlayer !== 1) return [];
    const ownedIds = getEffectiveAugmentIds(ownedAugments[1].map((a) => a.id), stonesPlaced[1] + stonesPlaced[2]);
    return findForbiddenCells(board, ownedIds, lastMove[1]);
  }, [board, ownedAugments, currentPlayer, lastMove, stonesPlaced]);

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
      <div className="text-lg mb-1">{gameOver ? "" : (currentPlayer === 1 ? "흑돌 차례" : "백돌 차례")}</div>
      {pendingTarget && (
        <div className="pendingTargetBanner">
          {(pendingTarget.player === 1 ? "흑돌" : "백돌")}: {TARGET_HINT[pendingTarget.kind]}
          {pendingTarget.need > 1 ? ` (${pendingTarget.selected.length}/${pendingTarget.need})` : ""}
        </div>
      )}
      <div className="forbiddenMessage">{forbiddenMessage}</div>

      <div className="gameLayout">
        <AugmentPanel
          title="⚫ 흑돌 증강체"
          augments={ownedAugments[1]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && currentPlayer === 1}
          usedMap={oneTimeUsed[1]}
          onUseAbility={(ability) => handleUseAbility(1, ability)}
          side="left"
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
          threatCells={threatCells}
        />
        <AugmentPanel
          title="⚪ 백돌 증강체"
          augments={ownedAugments[2]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && currentPlayer === 2}
          usedMap={oneTimeUsed[2]}
          onUseAbility={(ability) => handleUseAbility(2, ability)}
          side="right"
        />
      </div>

      <Link href="/" className="text-sm underline opacity-70 mt-4">← 처음으로</Link>

      {gameOver && <WinOverlay message={winMessage} onRestart={() => dispatch({ type: "RESTART" })} />}

      {augmentSelect && (
        <AugmentSelectOverlay
          playerLabel={augmentSelect.player === 1 ? "흑돌" : "백돌"}
          stoneCount={stonesPlaced[augmentSelect.player]}
          choices={augmentSelect.choices}
          onPick={(augment) => dispatch({ type: "PICK_AUGMENT", augment })}
          rerolledSlots={augmentSelect.rerolledSlots}
          onRerollSlot={(index) => dispatch({ type: "REROLL_SLOT", index })}
          isGamble={augmentSelect.isGamble}
        />
      )}
    </main>
  );
}
