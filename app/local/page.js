"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import Link from "next/link";
import GomokuBoard from "@/components/GomokuBoard";
import AugmentPanel from "@/components/AugmentPanel";
import AugmentSelectOverlay from "@/components/AugmentSelectOverlay";
import WinOverlay from "@/components/WinOverlay";
import { gameReducer, initialGameState, hasRealChange, ABILITY_SOUND_ACTION_TYPES } from "@/lib/gameReducer";
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

export default function LocalGamePage() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => initialGameState(false));

  // 액티브 능력이 실제로 발동했을 때만(쿨다운 등으로 막혀 안내 메시지만 뜬 경우는 제외) 사용음 재생 -
  // dispatch 전에 리듀서를 미리 한 번 돌려서 실제 변화 여부를 판정(RoomClient의 dispatchAction과 같은 패턴)
  function dispatchWithAbilitySound(action) {
    if (ABILITY_SOUND_ACTION_TYPES.has(action.type) && hasRealChange(state, gameReducer(state, action))) {
      playAbilitySound();
    }
    dispatch(action);
  }

  const {
    board, currentPlayer, gameOver, winMessage, stonesPlaced, ownedAugments,
    forbiddenMessage, forbiddenToken, augmentSelect, oneTimeUsed, pendingTarget,
    blockedCells, permaBlockedCells, lastMove, watchtowerCells, deadCells, prisonActive, rematchRequested,
    ringActive, ringStartMove, ringTarget, placementClock, chaosActive, roleSwapActive, peekedCard, ultimatumCell, boardFlipCooldown,
    removeStoneCooldown, selfUndoCooldown, jailbreakCooldown, relocateCooldown, prepStanceCooldown, preventionCooldown,
    fogTurnsLeft, checkerboardActive, timeLimitOverride, pokerFacePending, reverseScaleCell,
    breezeCooldown, saltScatterCooldown, acornTossCooldown, spotSwapCooldown, turfCooldown, recruitCooldown, gustCooldown, saltBombCooldown, typhoonCooldown,
  } = state;

  const turnTimeLimit = timeLimitOverride || DEFAULT_TURN_TIME_LIMIT;

  // 제한시간 타이머: 착수 하나가 끝날 때마다(같은 플레이어가 이어서 두는 질풍노도 보너스 수 포함) 새로 타이머 시작
  const isTimerActive = !gameOver && !augmentSelect && !pendingTarget;
  const turnKey = currentPlayer + JSON.stringify(lastMove[1]) + JSON.stringify(lastMove[2]);
  const [timeLeft, setTimeLeft] = useState(turnTimeLimit);
  const timeoutFiredRef = useRef(false);

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
  // 링 위에서 싸우자: 발동 즉시 최종 위치가 공개되니, 지금 레벨과 무관하게 항상 미리보기로 계산
  const ringFinalBounds = useMemo(() => (ringActive ? getRingFinalBounds(ringTarget) : null), [ringActive, ringTarget]);

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

  // 로컬(패스앤플레이)은 "내 턴"이라는 신원 구분이 없어서, 실제로 둘 수 있는 새 턴이 시작될 때마다 알림
  // (다음 플레이어에게 판을 넘기라는 신호로도 겸함)
  const myTurnPulse = useYourTurnAlert(turnKey, isTimerActive);

  const opponent = currentPlayer === 1 ? 2 : 1;
  // 입장 바꿔 생각하기: 신원(currentPlayer/opponent)과 실제로 보드에 놓이는 돌 색이 다를 수 있음
  const currentColor = colorForPlayer(currentPlayer, roleSwapActive);
  const opponentColor = colorForPlayer(opponent, roleSwapActive);
  // 영구 봉쇄는 프리즘 등급이라 교도소가 발동하면 실제로 풀리므로(gameReducer의 isBlocked 참고), 화면 표시도
  // 같이 꺼야 함 - 안 그러면 이미 클릭 가능해진 칸에 여전히 막힌 X 표시가 남아서 헷갈림
  const boardBlockedCells = useMemo(
    () => [...blockedCells[currentPlayer], ...(prisonActive ? [] : permaBlockedCells[currentPlayer]), ...deadCells],
    [blockedCells, permaBlockedCells, deadCells, currentPlayer, prisonActive]
  );
  const fadedBlockedCells = useMemo(
    () => [...blockedCells[opponent], ...(prisonActive ? [] : permaBlockedCells[opponent])],
    [blockedCells, permaBlockedCells, opponent, prisonActive]
  );
  // 감시탑은 숨김이 없어서 누구 턴이든 양쪽에 세워진 걸 다 보여줌
  const boardWatchtowerCells = useMemo(
    () => [...watchtowerCells[1], ...watchtowerCells[2]],
    [watchtowerCells]
  );
  // 역린도 숨김이 없어서 양쪽이 표시해둔 돌을 다 보여줌
  const boardReverseScaleCells = useMemo(
    () => [reverseScaleCell[1], reverseScaleCell[2]].filter(Boolean),
    [reverseScaleCell]
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

  // 예지: 상대가 다음에 두면 열린 3목이 되는 빈 칸을 미리 강조 표시
  const foresightCells = useMemo(() => {
    const myAugIds = ownedAugments[currentPlayer].map((a) => a.id);
    if (!myAugIds.includes("foresight")) return [];
    return findOpenThreeSetupCells(board, opponentColor);
  }, [board, ownedAugments, currentPlayer, opponentColor]);

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

  // 파기/감정은 보드 칸이 아니라 "내 패널의 카드"를 대상으로 고르는 능력이라, 해당 플레이어 패널에만
  // 카드 선택 모드를 켜고 실제로 고를 수 있는 카드 id 목록을 같이 넘겨줌
  const cardTargetKind =
    pendingTarget?.kind === "discard" ||
    pendingTarget?.kind === "appraisal" ||
    pendingTarget?.kind === "lifeTransfer"
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
      <h1 className="gameTitle">오목 (로컬 대전)</h1>
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
        {gameOver ? "" : (currentColor === 1 ? "흑돌 차례" : "백돌 차례")}
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
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === 1}
          usedMap={oneTimeUsed[1]}
          onUseAbility={(ability) => handleUseAbility(1, ability)}
          side="left"
          peekedCard={peekedCard[1]}
          cooldowns={{
            boardFlip: boardFlipCooldown[1],
            removeStone: removeStoneCooldown[1],
            selfUndo: selfUndoCooldown[1],
            jailbreak: jailbreakCooldown[1],
            relocate: relocateCooldown[1],
            prepStance: prepStanceCooldown[1],
            prevention: preventionCooldown[1],
            breeze: breezeCooldown[1],
            saltScatter: saltScatterCooldown[1],
            acornToss: acornTossCooldown[1],
            spotSwap: spotSwapCooldown[1],
            turf: turfCooldown[1],
            recruit: recruitCooldown[1],
            gust: gustCooldown[1],
            saltBomb: saltBombCooldown[1],
            typhoon: typhoonCooldown[1],
          }}
          cardTargetActive={cardTargetKind !== null && pendingTarget.player === 1}
          eligibleCardIds={eligibleCardIdsFor(1)}
          onPickCardTarget={handlePickCardTarget}
          pokerFaceReveal={pokerFacePending[1]}
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
          title={colorForPlayer(2, roleSwapActive) === 1 ? "⚫ 흑돌 증강" : "⚪ 백돌 증강"}
          augments={ownedAugments[2]}
          canAct={!augmentSelect && !pendingTarget && !gameOver && !chaosActive && currentPlayer === 2}
          usedMap={oneTimeUsed[2]}
          onUseAbility={(ability) => handleUseAbility(2, ability)}
          side="right"
          peekedCard={peekedCard[2]}
          cooldowns={{
            boardFlip: boardFlipCooldown[2],
            removeStone: removeStoneCooldown[2],
            selfUndo: selfUndoCooldown[2],
            jailbreak: jailbreakCooldown[2],
            relocate: relocateCooldown[2],
            prepStance: prepStanceCooldown[2],
            prevention: preventionCooldown[2],
            breeze: breezeCooldown[2],
            saltScatter: saltScatterCooldown[2],
            acornToss: acornTossCooldown[2],
            spotSwap: spotSwapCooldown[2],
            turf: turfCooldown[2],
            recruit: recruitCooldown[2],
            gust: gustCooldown[2],
            saltBomb: saltBombCooldown[2],
            typhoon: typhoonCooldown[2],
          }}
          cardTargetActive={cardTargetKind !== null && pendingTarget.player === 2}
          eligibleCardIds={eligibleCardIdsFor(2)}
          onPickCardTarget={handlePickCardTarget}
          pokerFaceReveal={pokerFacePending[2]}
        />
      </div>

      <Link href="/" className="gameBackLink">← 처음으로</Link>

      {gameOver && (
        <WinOverlay
          message={winMessage}
          rematchRequested={rematchRequested}
          onRequestRematch={(player) => dispatch({ type: "REQUEST_REMATCH", player })}
          myRole={null}
          roleSwapActive={roleSwapActive}
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
          isStartDraft={augmentSelect.isStartDraft}
        />
      )}
    </main>
  );
}
