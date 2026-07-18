"use client";

import { useEffect, useMemo, useRef, useReducer, useState } from "react";
import Link from "next/link";
import GomokuBoard from "@/components/GomokuBoard";
import AugmentPanel from "@/components/AugmentPanel";
import AugmentSelectOverlay from "@/components/AugmentSelectOverlay";
import WinOverlay from "@/components/WinOverlay";
import { gameReducer, initialGameState, hasRealChange, ABILITY_SOUND_ACTION_TYPES } from "@/lib/gameReducer";
import { decideAiAction, isAiTurn } from "@/lib/aiPlayer";
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
import { playStoneSound, playAugmentSound, playAbilitySound, countTotalStones } from "@/lib/sound";
import { useYourTurnAlert } from "@/lib/useYourTurnAlert";

const HUMAN_PLAYER = 1;
const AI_PLAYER = 2;

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

const DEFAULT_TURN_TIME_LIMIT = 30;

// AI가 액션을 다 계산해두고도 곧바로 착수해버리면 너무 기계적으로 보여서, 액션 종류별로 살짝 다른
// "생각하는 척" 지연을 준다 (착수/대상 선택은 조금 더 오래, 능력 사용은 조금 짧게)
function delayForAiAction(action) {
  if (action.type === "CLICK_CELL" || action.type === "TARGET_CELL") return 600 + Math.random() * 500;
  if (action.type === "PICK_AUGMENT" || action.type === "REROLL_SLOT") return 500 + Math.random() * 400;
  return 400 + Math.random() * 300;
}

export default function SingleplayerGamePage() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => initialGameState(false));
  const {
    board, currentPlayer, gameOver, winMessage, stonesPlaced, ownedAugments,
    forbiddenMessage, forbiddenToken, augmentSelect, oneTimeUsed, pendingTarget,
    blockedCells, permaBlockedCells, lastMove, watchtowerCells, deadCells, prisonActive, rematchRequested,
    ringActive, ringStartMove, ringTarget, placementClock, chaosActive, roleSwapActive, peekedCard, ultimatumCell, boardFlipCooldown,
    removeStoneCooldown, selfUndoCooldown, jailbreakCooldown, relocateCooldown, prepStanceCooldown, preventionCooldown,
    fogTurnsLeft, checkerboardActive, timeLimitOverride, pokerFacePending, reverseScaleCell,
  } = state;

  const turnTimeLimit = timeLimitOverride || DEFAULT_TURN_TIME_LIMIT;
  const aiTurn = isAiTurn(state, AI_PLAYER);

  // 액티브 능력이 실제로 발동했을 때만(쿨다운 등으로 막혀 안내 메시지만 뜬 경우는 제외) 사용음 재생 -
  // dispatch 전에 리듀서를 미리 한 번 돌려서 실제 변화 여부를 판정(RoomClient의 dispatchAction과 같은 패턴).
  // 사람/AI 양쪽 다 이 경로로 능력을 쓰므로 AI가 능력을 쓸 때도 똑같이 소리가 남
  function dispatchWithAbilitySound(action) {
    if (ABILITY_SOUND_ACTION_TYPES.has(action.type) && hasRealChange(state, gameReducer(state, action))) {
      playAbilitySound();
    }
    dispatch(action);
  }

  // AI 턴 구동: 상태가 바뀔 때마다 "지금 AI가 뭘 해야 하는지" 하나만 계산해서, 약간의 지연 후 디스패치.
  // 그 결과로 다시 이 effect가 돌면서 다음 액션을 계산 - 질풍노도 보너스 수/능력 여러 번 사용 등 여러 틱에
  // 걸친 AI 턴이 자연스럽게 이어짐 (사람 쪽 로직/리듀서는 전혀 안 건드림)
  useEffect(() => {
    if (!aiTurn) return;
    const action = decideAiAction(state, AI_PLAYER);
    if (!action) return;
    const timer = setTimeout(() => dispatchWithAbilitySound(action), delayForAiAction(action));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, aiTurn]);

  // 게임이 끝나면 AI도 잠시 후 스스로 재도전 버튼을 누름
  useEffect(() => {
    if (!gameOver || rematchRequested[AI_PLAYER]) return;
    const timer = setTimeout(() => dispatch({ type: "REQUEST_REMATCH", player: AI_PLAYER }), 900);
    return () => clearTimeout(timer);
  }, [gameOver, rematchRequested]);

  const isTimerActive = !gameOver && !augmentSelect && !pendingTarget;
  const turnKey = currentPlayer + JSON.stringify(lastMove[1]) + JSON.stringify(lastMove[2]);
  const [timeLeft, setTimeLeft] = useState(turnTimeLimit);
  const timeoutFiredRef = useRef(false);

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
    () => getRingBounds(ringStartMove, placementClock, ringTarget),
    [ringStartMove, placementClock, ringTarget]
  );
  const ringFinalBounds = useMemo(() => (ringActive ? getRingFinalBounds(ringTarget) : null), [ringActive, ringTarget]);

  useEffect(() => {
    if (!forbiddenMessage) return;
    const timer = setTimeout(() => dispatch({ type: "CLEAR_FORBIDDEN" }), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forbiddenToken]);

  const prevStoneCountRef = useRef(null);
  useEffect(() => {
    const count = countTotalStones(board);
    if (prevStoneCountRef.current !== null && count > prevStoneCountRef.current) {
      playStoneSound();
    }
    prevStoneCountRef.current = count;
  }, [board]);

  const hadAugmentSelectRef = useRef(false);
  useEffect(() => {
    if (augmentSelect && !hadAugmentSelectRef.current) {
      playAugmentSound();
    }
    hadAugmentSelectRef.current = !!augmentSelect;
  }, [augmentSelect]);

  // AI 턴이 끝나고 사람 차례가 됐을 때만 알림 (AI 턴이 시작될 때는 안 울림)
  const myTurnPulse = useYourTurnAlert(turnKey, isTimerActive && !aiTurn);

  const opponent = currentPlayer === 1 ? 2 : 1;
  const currentColor = colorForPlayer(currentPlayer, roleSwapActive);
  const opponentColor = colorForPlayer(opponent, roleSwapActive);
  const boardBlockedCells = useMemo(
    () => [...blockedCells[currentPlayer], ...(prisonActive ? [] : permaBlockedCells[currentPlayer]), ...deadCells],
    [blockedCells, permaBlockedCells, deadCells, currentPlayer, prisonActive]
  );
  const fadedBlockedCells = useMemo(
    () => [...blockedCells[opponent], ...(prisonActive ? [] : permaBlockedCells[opponent])],
    [blockedCells, permaBlockedCells, opponent, prisonActive]
  );
  const boardWatchtowerCells = useMemo(
    () => [...watchtowerCells[1], ...watchtowerCells[2]],
    [watchtowerCells]
  );
  const boardReverseScaleCells = useMemo(
    () => [reverseScaleCell[1], reverseScaleCell[2]].filter(Boolean),
    [reverseScaleCell]
  );
  const pendingCells = pendingTarget
    ? pendingTarget.kind === "relocate"
      ? pendingTarget.sourceCell ? [pendingTarget.sourceCell] : []
      : pendingTarget.kind !== "removeStone" && pendingTarget.kind !== "plague"
      ? pendingTarget.selected
      : []
    : [];

  const threatLines = useMemo(() => {
    const myAugIds = ownedAugments[currentPlayer].map((a) => a.id);
    if (!myAugIds.includes("threatRadar")) return [];
    const totalStonesPlaced = stonesPlaced[1] + stonesPlaced[2];
    const opponentAugIds = getEffectiveAugmentIds(ownedAugments[opponent].map((a) => a.id), totalStonesPlaced);
    return findThreatLines(board, opponentColor, opponentAugIds, lastMove[opponent]);
  }, [board, ownedAugments, currentPlayer, opponent, opponentColor, lastMove, stonesPlaced]);

  const winCells = useMemo(() => {
    const myAugIds = ownedAugments[currentPlayer].map((a) => a.id);
    if (!myAugIds.includes("intuition")) return [];
    const totalStonesPlaced = stonesPlaced[1] + stonesPlaced[2];
    const myEffectiveAugIds = getEffectiveAugmentIds(myAugIds, totalStonesPlaced);
    return findThreatCells(board, currentColor, myEffectiveAugIds, lastMove[currentPlayer]);
  }, [board, ownedAugments, currentPlayer, currentColor, lastMove, stonesPlaced]);

  const foresightCells = useMemo(() => {
    const myAugIds = ownedAugments[currentPlayer].map((a) => a.id);
    if (!myAugIds.includes("foresight")) return [];
    return findOpenThreeSetupCells(board, opponentColor);
  }, [board, ownedAugments, currentPlayer, opponentColor]);

  const lastOpponentMoveCell = lastMove[opponent];

  const forbiddenCells = useMemo(() => {
    if (currentColor !== 1) return [];
    const ownedIds = getEffectiveAugmentIds(ownedAugments[currentPlayer].map((a) => a.id), stonesPlaced[1] + stonesPlaced[2]);
    return findForbiddenCells(board, ownedIds, lastMove[currentPlayer]);
  }, [board, ownedAugments, currentPlayer, currentColor, lastMove, stonesPlaced]);

  function handleBoardClick(x, y) {
    if (pendingTarget) {
      dispatchWithAbilitySound({ type: "TARGET_CELL", x, y });
    } else {
      dispatch({ type: "CLICK_CELL", x, y });
    }
  }

  function handleUseAbility(player, ability) {
    dispatchWithAbilitySound({ type: "USE_ABILITY", player, ability });
  }

  function handlePickCardTarget(augmentId) {
    dispatchWithAbilitySound({ type: "PICK_CARD_TARGET", augmentId });
  }

  // AI(2번)의 pendingTarget/능력은 사람이 클릭으로 끼어들 수 없어야 하므로, 카드 대상 선택 모드는
  // 항상 사람(1번) 몫일 때만 켜짐 - AI 몫이면 decideAiAction이 알아서 PICK_CARD_TARGET을 디스패치함
  const cardTargetKind =
    pendingTarget?.kind === "discard" ||
    pendingTarget?.kind === "appraisal" ||
    pendingTarget?.kind === "lifeTransfer"
      ? pendingTarget.kind
      : null;
  function eligibleCardIdsFor(player) {
    if (player !== HUMAN_PLAYER) return [];
    if (!cardTargetKind || pendingTarget.player !== player) return [];
    if (cardTargetKind === "discard") {
      return ownedAugments[player].filter((a) => a.id !== "discard").map((a) => a.id);
    }
    if (cardTargetKind === "lifeTransfer") {
      return ownedAugments[player].filter((a) => a.tier === "silver" && a.id !== "lifeTransfer").map((a) => a.id);
    }
    return ownedAugments[player].filter((a) => ENHANCEABLE_AUGMENT_IDS.includes(a.id) && !a.enhanced).map((a) => a.id);
  }

  const isMyAugmentSelect = augmentSelect && augmentSelect.player === HUMAN_PLAYER;
  const isAiAugmentSelect = augmentSelect && augmentSelect.player === AI_PLAYER;

  return (
    <main className="gamePage">
      <div className="homeBgGrid" aria-hidden="true" />
      <h1 className="gameTitle">오목 (싱글플레이 - vs AI)</h1>
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
        {!gameOver && <span className={"turnDot " + (currentColor === 1 ? "black" : "white")} />}
        {gameOver ? "" : (currentColor === 1 ? "흑돌 차례" : "백돌 차례") + (aiTurn ? " (🤖 AI 생각 중...)" : " (내 차례)")}
      </div>
      <div className="stoneCountText">총 {stonesPlaced[1] + stonesPlaced[2]}수 (흑 {countStones(board, 1)} · 백 {countStones(board, 2)})</div>
      {isTimerActive && !aiTurn && (
        <div className={"timerText " + (timeLeft <= 10 ? "urgent" : "")}>⏱ 남은 시간: {timeLeft}초</div>
      )}
      {pendingTarget && pendingTarget.player === HUMAN_PLAYER && (
        <div className="pendingTargetBanner">
          {(colorForPlayer(pendingTarget.player, roleSwapActive) === 1 ? "흑돌" : "백돌")}: {pendingTarget.kind === "relocate" ? relocateHint(pendingTarget) : TARGET_HINT[pendingTarget.kind]}
          {pendingTarget.need > 1 ? ` (${pendingTarget.selected.length}/${pendingTarget.need})` : ""}
        </div>
      )}
      <div className="forbiddenMessage">{forbiddenMessage}</div>

      <div className="gameLayout">
        <AugmentPanel
          title={(colorForPlayer(HUMAN_PLAYER, roleSwapActive) === 1 ? "⚫ 흑돌 증강" : "⚪ 백돌 증강") + " (나)"}
          augments={ownedAugments[HUMAN_PLAYER]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === HUMAN_PLAYER}
          usedMap={oneTimeUsed[HUMAN_PLAYER]}
          onUseAbility={(ability) => handleUseAbility(HUMAN_PLAYER, ability)}
          side="left"
          peekedCard={peekedCard[HUMAN_PLAYER]}
          cooldowns={{
            boardFlip: boardFlipCooldown[HUMAN_PLAYER],
            removeStone: removeStoneCooldown[HUMAN_PLAYER],
            selfUndo: selfUndoCooldown[HUMAN_PLAYER],
            jailbreak: jailbreakCooldown[HUMAN_PLAYER],
            relocate: relocateCooldown[HUMAN_PLAYER],
            prepStance: prepStanceCooldown[HUMAN_PLAYER],
            prevention: preventionCooldown[HUMAN_PLAYER],
          }}
          cardTargetActive={cardTargetKind !== null && pendingTarget.player === HUMAN_PLAYER}
          eligibleCardIds={eligibleCardIdsFor(HUMAN_PLAYER)}
          onPickCardTarget={handlePickCardTarget}
          pokerFaceReveal={pokerFacePending[HUMAN_PLAYER]}
        />
        <GomokuBoard
          board={board}
          onCellClick={handleBoardClick}
          disabled={gameOver || !!augmentSelect || aiTurn}
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
          ultimatumCell={ultimatumCell[currentPlayer]}
          fadedUltimatumCell={ultimatumCell[opponent]}
          foresightCells={foresightCells}
          checkerboardActive={checkerboardActive}
          fogTurnsLeft={fogTurnsLeft[currentPlayer]}
        />
        <AugmentPanel
          title={(colorForPlayer(AI_PLAYER, roleSwapActive) === 1 ? "⚫ 흑돌 증강" : "⚪ 백돌 증강") + " (AI)"}
          augments={ownedAugments[AI_PLAYER]}
          canAct={false}
          usedMap={oneTimeUsed[AI_PLAYER]}
          onUseAbility={() => {}}
          side="right"
          peekedCard={null}
          cooldowns={{
            boardFlip: boardFlipCooldown[AI_PLAYER],
            removeStone: removeStoneCooldown[AI_PLAYER],
            selfUndo: selfUndoCooldown[AI_PLAYER],
            jailbreak: jailbreakCooldown[AI_PLAYER],
            relocate: relocateCooldown[AI_PLAYER],
            prepStance: prepStanceCooldown[AI_PLAYER],
            prevention: preventionCooldown[AI_PLAYER],
          }}
          cardTargetActive={false}
          eligibleCardIds={[]}
          onPickCardTarget={() => {}}
          pokerFaceReveal={null}
        />
      </div>

      <Link href="/" className="gameBackLink">← 처음으로</Link>

      {gameOver && (
        <WinOverlay
          message={winMessage}
          rematchRequested={rematchRequested}
          onRequestRematch={(player) => dispatch({ type: "REQUEST_REMATCH", player })}
          myRole={HUMAN_PLAYER}
          roleSwapActive={roleSwapActive}
        />
      )}

      {isMyAugmentSelect && (
        <AugmentSelectOverlay
          playerLabel={colorForPlayer(augmentSelect.player, roleSwapActive) === 1 ? "흑돌" : "백돌"}
          stoneCount={stonesPlaced[augmentSelect.player]}
          choices={augmentSelect.choices}
          onPick={(augment) => dispatch({ type: "PICK_AUGMENT", augment })}
          rerolledSlots={augmentSelect.rerolledSlots}
          onRerollSlot={(index) => dispatch({ type: "REROLL_SLOT", index })}
          isGamble={augmentSelect.isGamble}
          bonusRerollsRemaining={augmentSelect.bonusRerollsRemaining}
          isStartDraft={augmentSelect.isStartDraft}
        />
      )}

      {isAiAugmentSelect && (
        <div className="augmentSelectOverlay">
          <div className="augmentSelectContent">
            <h2>
              {"🤖 AI가 " +
                (colorForPlayer(augmentSelect.player, roleSwapActive) === 1 ? "흑돌" : "백돌") +
                (augmentSelect.isStartDraft ? " 시작 증강을 고르는 중..." : " 증강을 고르는 중...")}
            </h2>
          </div>
        </div>
      )}
    </main>
  );
}
