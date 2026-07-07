# gomoku-online 작업 기록

이 파일은 새 대화에서 이어서 작업할 수 있도록 지금까지 한 작업을 정리한 문서입니다.
최신 커밋: `ac369ef` (master 브랜치, origin과 동기화됨)

## 프로젝트 개요

- 오목 + 렌주룰 + "4턴마다 증강체 선택"을 결합한 로그라이크 스타일 웹 게임
- 스택: Next.js (App Router), Supabase(온라인 대전용 실시간 동기화), Tailwind
- 모드 3가지: `/local`(로컬 패스앤플레이), `/online`(링크 초대), `/online/quick`(빠른 매칭)
- 핵심 파일
  - `lib/gomokuEngine.js` — 순수 보드/렌주룰/증강체 목록(AUGMENTS) 로직, DOM 의존 없음
  - `lib/gameReducer.js` — 모든 게임 상태 전이를 처리하는 단일 리듀서 (로컬/온라인 공용)
  - `components/GomokuBoard.jsx` — 캔버스 렌더링 + 클릭 좌표 변환
  - `components/AugmentPanel.jsx` — 보유 증강체 표시 + 액티브 능력 버튼
  - `components/AugmentSelectOverlay.jsx` — 4턴마다 뜨는 증강 선택 화면 (구 DraftOverlay)
  - `components/RoomClient.jsx` — 온라인 모드 (Supabase 구독)
  - `app/local/page.js` — 로컬 모드 (useReducer)
  - `components/WinOverlay.jsx` — 승리 화면 + 상호 재도전 버튼

## 이번 세션에서 한 일 (시간 순)

### 1. 기존 피드백 18개 반영 (커밋 `1b1ace8`)
사용자가 스트리밍하며 남긴 초기 피드백 18개를 처리:
- 드래프트 → "증강 선택" 용어 통일 (컴포넌트명 `DraftOverlay` → `AugmentSelectOverlay`, CSS 클래스 포함)
- 증강 선택 등급 동기화 도입 (처음엔 3장 혼합 등급 → 나중에 "회차당 단일 등급"으로 재수정, 아래 참고)
- 질풍노도(rush) 너프: 매턴 2개 → 2턴에 1번만 2개
- 대각선강화/일자진: 초반에만 등장하도록 제한
- 온라인 모드에서 상대가 고르는 중인 증강 카드 내용 숨김
- 금지칸 표시 구분(내가 막힌 칸 vs 내가 상대를 막은 칸), 다중 선택 중 진행 상황 표시
- 증강 선택 화면에 "누르고 있으면 판 보기" 눈 아이콘 추가
- 신규 증강: 속박(bind), 오델로(othello), 무위전변(colorSwap), 도박(gamble), 부적(talisman), 액자 완성(→ 나중에 origin의 squareFrame과 통합되며 제거됨)

### 2. origin/master 대규모 병합 (커밋 `21eceab`)
- 같은 베이스 커밋에서 origin이 독립적으로 증강 10개 + 온라인 빠른매칭 + 효과음을 이미 추가한 상태였음
- 충돌 6개 파일(`gomokuEngine.js`, `gameReducer.js`, `RoomClient.jsx`, `GomokuBoard.jsx`, `AugmentPanel.jsx`, `app/local/page.js`)을 수작업으로 병합
- origin의 10개 증강(squareFrame, attrition="물량전", awakening="각성", coinFlip, bind, stinginess, barter, watchtower, ultimatum, leverage)을 그대로 채택
- 중복 개념은 제거: 우리가 만든 3x3 "액자 완성"은 origin의 4x4 "네모"(squareFrame)로 통합, 우리 "속박"/"감시탑" 로직은 origin 버전으로 통일
- **물량전(attrition)이 진짜 "물량전"이었음** — 초기 피드백에서 "물량전 실버 강등"을 요청했을 때 이 증강이 존재하지 않아 doubleMove를 잘못 강등했었는데, 병합 후 attrition에 실버 강등을 재적용하고 doubleMove는 골드로 원복

### 3. 등급 동기화 재설계 (커밋 `25ad1a8`)
- 처음 구현은 "그 회차 3장이 [골드,골드,프리즘] 같은 혼합 조합"을 양쪽이 공유하는 방식이었음
- 사용자 피드백: "그게 아니라 이번 회차는 카드 3장이 통째로 같은 등급(예: 다 골드)이길 원했다"
- `ROUND_TIER_POOL = ["silver","silver","silver","gold","gold","prism"]`에서 회차당 등급 하나를 뽑아 `draftTierPlan[roundIndex]`에 저장, 양쪽 플레이어가 같은 회차엔 항상 같은 단일 등급을 받음

### 4. 신규 증강 30개 브레인스토밍 → 18개로 압축 → 구현 (커밋 `0d442c2`)
사용자가 "신박한 거 30개 가져와봐" 요청 → 30개 제시 → "기존 증강이랑 겹치는 거 빼고 가져와봐" 요청 → 13개 제거하고 17개 확정 → 유저가 "판 뒤엎기" 아이디어 추가 + "붕괴"/"교도소" 스펙 조정 → 최종 18개 구현.

**신규 실버(8)**: 직감(intuition), 균형(balance), 도장깨기(jailbreak), 여진(aftershock), 늦둥이(lateBloomer), 맞불(counterStrike), 축적(stockpile), 잠복(ambush)
**신규 골드(5)**: 습격(raid), 재배치(relocate), 봉인(lockdown), 역병(plague), 성역(sanctuary)
**신규 프리즘(5)**: 판 뒤엎기(boardFlip), 붕괴(collapse), 신탁(oracle), 교도소(prison), 도미노(domino)

구현 메모:
- **교도소(prison)**: `state.prisonActive` 전역 플래그. `getActiveAugmentIds(state, player)`가 켜져 있으면 소유 증강 id 목록에서 프리즘 등급을 전부 걸러냄. `checkImmunity`(철옹성/부적 체크)도 이 필터를 통과한 목록을 씀. **자기 자신 포함**해서 다 꺼짐.
- **붕괴(collapse)**: 새 UI 안 만들고 기존 "칸 1개 클릭" 패턴 재사용 — 클릭한 칸이 3x3의 중심이 됨
- **재배치(relocate)**: 최초로 만든 2단계 pendingTarget (내 돌 클릭 → 인접 빈칸 클릭). `pendingTarget.sourceCell`로 단계 구분
- **역병(plague)**: "승리 판정에서 그 돌만 영구 무효" 대신 "제거 + 그 칸을 양쪽 다 영원히 착수 불가"로 단순화 구현 (모든 승리 조건 함수를 다 고칠 필요 없음). `state.deadCells` 전역 배열
- **여진/맞불/잠복**: 기존 capture/removeStone/undo/banZone 처리 지점에 자동 발동 훅을 꽂음 (새 액션 타입 안 만듦)

### 5. 2차 피드백 5개 (커밋 `f1a3faf`, `ac369ef`)
1. 대각선강화/일자진이 여전히 사기 → `hasThreeOrMoreInARow(board)` 체크 추가, 판 위에 3목 이상 있으면 그 즉시 뽑기 풀에서 제외 (일부러 3목 만들고 뽑는 편법 방지)
2. 다리 놓기(bridge) 골드 → 프리즘 승급
3. 금지구역(banZone) 5턴 → 2턴 너프
4. 상대 마지막 수를 빨간 사각 테두리로 표시 (`GomokuBoard`의 `lastOpponentMoveCell` prop)
5. 재도전을 상호 확인제로 변경 — `REQUEST_REMATCH` 액션 + `rematchRequested: {1,2}` 상태, 둘 다 눌러야 `initialGameState()`로 리셋됨. 기존 `RESTART` 액션은 제거하고 `WinOverlay`를 흑돌/백돌 개별 버튼으로 교체
6. (후속) 영구 봉쇄(permaBlock)가 금지구역이랑 똑같이 골드였던 걸 발견 → 프리즘으로 승급, 교도소 발동 시 이미 걸린 영구봉쇄도 즉시 풀리도록 `isBlocked` 체크에 `!state.prisonActive` 조건 추가

## 현재 증강 전체 목록 (등급별, 총 34개 + 도박 전용 가짜카드 2개)

### 프리즘 (14)
| id | 이름 | 효과 |
|---|---|---|
| diagBoost | 대각선 강화 | 대각선 4개만 이어도 승리 (초반+3목 없을 때만 등장) |
| straightBoost | 일자진 | 가로/세로 4개만 이어도 승리 (초반+3목 없을 때만 등장) |
| rush | 질풍노도 | 2턴에 1번 그 턴에 2개 놓음 |
| fortress | 철옹성 | 제거·봉쇄 계열 효과 면역 |
| revive | 부활 | 패배 순간 1회 무효화 |
| awakening | 각성 | 20수 넘도록 안 끝나면 대각선강화+일자진 자동 적용 |
| bind | 속박 | 상대 다음 턴 통째로 스킵 |
| othello | 오델로 | 사이에 낀 상대 돌 1개를 내 색으로 뒤집음 |
| colorSwap | 무위전변 | 판 전체 돌 색 반전 (턴 넘어감) |
| bridge | 다리 놓기 | 내 돌 사이 빈칸 1개를 이어진 것으로 판정 |
| boardFlip | 판 뒤엎기 | 내 돌 전부 지우고 같은 수만큼 무작위 재배치 (턴 넘어감) |
| collapse | 붕괴 | 클릭한 칸 중심 3x3 전부 제거 |
| oracle | 신탁 | 다음 회차 등급을 프리즘으로 확정 (양쪽 적용) |
| prison | 교도소 | 이후 게임 끝까지 양쪽 프리즘 효과 전부 비활성화 (자기 포함) |
| domino | 도미노 | 상대 돌 제거/뒤집기 성공 시 그 턴에 한 번 더 |
| permaBlock | 영구 봉쇄 | 칸 1개 게임 끝까지 착수 금지 |

### 골드 (11)
banZone(금지구역,3칸/2턴), undo(되돌리기), territory(영역점령), capture(포위제거), doubleMove(양수겹침),
squareFrame(네모, 4x4 테두리 완성 즉시승리), stinginess(인색), barter(거래), watchtower(감시탑),
ultimatum(최후통첩), raid(습격), relocate(재배치), lockdown(봉인), plague(역병), sanctuary(성역)

### 실버 (17)
adjacentLink(연속배치), peek(먼저보기), doubleChoice(더블초이스), selfUndo(직전무르기), threatRadar(위험감지),
removeStone(돌제거), attrition(물량전), coinFlip(동전던지기), leverage(저울질), gamble(도박), talisman(부적),
intuition(직감), balance(균형), jailbreak(도장깨기), aftershock(여진), lateBloomer(늦둥이),
counterStrike(맞불), stockpile(축적), ambush(잠복)

정확한 최신 목록/설명은 `lib/gomokuEngine.js`의 `AUGMENTS` 배열이 항상 진짜 소스입니다 (이 문서는 스냅샷).

## 알아두면 좋은 설계 패턴

- **회차 등급 공유**: `state.draftTierPlan[roundIndex]`에 그 회차 등급을 캐싱, 양쪽이 같은 roundIndex에 도달하면 같은 값을 재사용. `roundIndex = stonesPlaced[player]/4 - 1`
- **1회용 능력 공통 처리**: `oneTimeUsed[player][abilityId]` 플래그 + `ONE_TIME_ABILITY_IDS` 배열(거래가 한꺼번에 소모시킬 대상 목록)
- **면역 체크**: `checkImmunity(state, targetPlayer)` — 철옹성(무한)과 부적(1회성)을 하나로 통합 판정. 새 "공격형" 증강 만들 때 재사용
- **pendingTarget 패턴**: 칸 선택이 필요한 능력은 전부 `{player, kind, need, selected}` 구조. 2단계가 필요하면(재배치) `sourceCell` 같은 필드를 추가해서 같은 리듀서 케이스 안에서 분기
- **prison 필터링**: `getActiveAugmentIds(state, player)`를 거쳐야만 프리즘 무효화가 반영됨. 새 프리즘 증강을 만들 때 `ownedAugments[player].map(a=>a.id)` 대신 이걸 써야 교도소가 먹힘

## 알려진 제약/후속 검토 거리

- `relocate`/`collapse`/`prison` 등 구조적으로 새로운 메커니즘은 실제 대국에서 뽑힐 때까지 라이브 테스트가 제한적이었음 (역병만 end-to-end로 직접 검증함)
- `역병`은 원안(승리 판정에서 그 돌만 영구 제외)이 아니라 "제거 + 칸 영구 봉쇄"로 단순화 구현됨 — 필요하면 원안대로 재구현 가능하지만 모든 win-check 함수를 고쳐야 함
- 온라인 모드는 각 클라이언트가 로컬로 리듀서를 돌리고 결과만 Supabase에 푸시하는 구조라, 이론상 네트워크 지연 시 레이스가 있을 수 있음 (턴제라 실제로는 거의 안 부딪힘, 지금까지 실제 버그 리포트는 없음)
- `.claude/launch.json`에 `npm run dev` 기준 미리보기 서버 설정이 있음 (포트 3000)

## 브랜치/원격 상태

- `master`가 `origin/master`와 동기화됨, 별도 브랜치 없음
- 사용자는 GitHub Desktop도 병행 사용 중 (세션 중간에 `app/page.js` 문구를 직접 커밋한 이력 있음 — `f290f85 Update layout.js`)
