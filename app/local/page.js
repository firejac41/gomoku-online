"use client";

import { useEffect, useMemo, useReducer } from "react";
import Link from "next/link";
import GomokuBoard from "@/components/GomokuBoard";
import AugmentPanel from "@/components/AugmentPanel";
import AugmentSelectOverlay from "@/components/AugmentSelectOverlay";
import WinOverlay from "@/components/WinOverlay";
import { gameReducer, initialGameState } from "@/lib/gameReducer";
import { findThreatCells, findForbiddenCells } from "@/lib/gomokuEngine";

const TARGET_HINT = {
  banZone: "빈 칸 3곳을 선택하세요",
  permaBlock: "빈 칸 1곳을 선택하세요",
  removeStone: "제거할 상대 돌을 선택하세요",
  watchtower: "감시할 빈 칸 1곳을 선택하세요",
};

export default function LocalGamePage() {
  const [state, dispatch] = useReducer(gameReducer, undefined, initialGameState);
  const {
    board, currentPlayer, gameOver, winMessage, stonesPlaced, ownedAugments,
    forbiddenMessage, forbiddenToken, augmentSelect, oneTimeUsed, pendingTarget,
    blockedCells, permaBlockedCells, watchtowers, lastMove,
  } = state;

  // 금수/안내 메시지를 1.5초 후 자동으로 지움
  useEffect(() => {
    if (!forbiddenMessage) return;
    const timer = setTimeout(() => dispatch({ type: "CLEAR_FORBIDDEN" }), 1500);
    return () => clearTimeout(timer);
    // forbiddenToken을 매번 올려주기 때문에, 같은 문구가 연달아 떠도 토큰만으로 타이머가 재시작됨
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forbiddenToken]);

  const opponent = currentPlayer === 1 ? 2 : 1;
  const boardBlockedCells = useMemo(
    () => [...blockedCells[currentPlayer], ...permaBlockedCells[currentPlayer]],
    [blockedCells, permaBlockedCells, currentPlayer]
  );
  const fadedBlockedCells = useMemo(
    () => [...blockedCells[opponent], ...permaBlockedCells[opponent]],
    [blockedCells, permaBlockedCells, opponent]
  );
  const watchtowerCells = useMemo(() => [...watchtowers[1], ...watchtowers[2]], [watchtowers]);
  const pendingCells = pendingTarget && pendingTarget.kind !== "removeStone" ? pendingTarget.selected : [];

  const threatCells = useMemo(() => {
    const myAugIds = ownedAugments[currentPlayer].map((a) => a.id);
    if (!myAugIds.includes("threatRadar")) return [];
    const opponentAugIds = ownedAugments[opponent].map((a) => a.id);
    return findThreatCells(board, opponent, opponentAugIds, lastMove[opponent]);
  }, [board, ownedAugments, currentPlayer, opponent, lastMove]);

  // 렌주룰 금수는 흑돌 차례에만 의미 있음
  const forbiddenCells = useMemo(() => {
    if (currentPlayer !== 1) return [];
    return findForbiddenCells(board, ownedAugments[1].map((a) => a.id), lastMove[1]);
  }, [board, ownedAugments, currentPlayer, lastMove]);

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
          watchtowerCells={watchtowerCells}
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
