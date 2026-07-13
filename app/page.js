import Link from "next/link";
import { AUGMENTS, pickRandom } from "@/lib/gomokuEngine";

// 장식용 컨베이어 벨트에 띄울 증강 카드 - 매 페이지 로드마다 무작위로 새로 뽑힘 (실제 게임 뽑기와 무관)
// PC: 좌우 세로 벨트(왼쪽 아래→위, 오른쪽 위→아래) / 모바일: 위아래 가로 벨트(위쪽 좌→우, 아래쪽 우→좌)
function ConveyorColumn({ side, augments }) {
  // 애니메이션이 자연스럽게 끊김 없이 순환하도록 같은 목록을 두 번 이어붙임
  const looped = [...augments, ...augments];
  return (
    <div className={"homeConveyor " + side} aria-hidden="true">
      <div className="conveyorTrack">
        {looped.map((augment, i) => (
          <div key={augment.id + "-" + i} className={"conveyorCard tier-" + augment.tier}>
            {augment.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConveyorRow({ position, augments }) {
  const looped = [...augments, ...augments];
  return (
    <div className={"homeConveyorH " + position} aria-hidden="true">
      <div className="conveyorTrackH">
        {looped.map((augment, i) => (
          <div key={augment.id + "-" + i} className={"conveyorCardH tier-" + augment.tier}>
            {augment.name}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  const leftAugments = pickRandom(AUGMENTS, 14);
  const rightAugments = pickRandom(AUGMENTS, 14);
  const topAugments = pickRandom(AUGMENTS, 16);
  const bottomAugments = pickRandom(AUGMENTS, 16);

  return (
    <main className="homePage">
      <div className="homeBgGrid" aria-hidden="true" />
      <div className="homeGlow" aria-hidden="true" />
      <div className="homeStoneBlur black" aria-hidden="true" />
      <div className="homeStoneBlur white" aria-hidden="true" />
      <ConveyorColumn side="left" augments={leftAugments} />
      <ConveyorColumn side="right" augments={rightAugments} />
      <ConveyorRow position="top" augments={topAugments} />
      <ConveyorRow position="bottom" augments={bottomAugments} />

      <h1 className="homeTitle">증강 오목</h1>
      <p className="homeSubtitle">렌주룰 + 4턴마다 증강 선택</p>

      <div className="homeButtons">
        <Link href="/singleplayer" className="homeButton">
          <span className="homeButtonIcon">🤖</span>
          <span className="homeButtonText">
            <strong>싱글플레이</strong>
            <span>컴퓨터(AI)와 1대1</span>
          </span>
        </Link>
        <Link href="/local" className="homeButton">
          <span className="homeButtonIcon">🎮</span>
          <span className="homeButtonText">
            <strong>로컬 대전</strong>
            <span>한 화면에서 번갈아 두기</span>
          </span>
        </Link>
        <Link href="/online" className="homeButton">
          <span className="homeButtonIcon">🔗</span>
          <span className="homeButtonText">
            <strong>온라인 대전</strong>
            <span>링크로 초대</span>
          </span>
        </Link>
        <Link href="/online/quick" className="homeButton">
          <span className="homeButtonIcon">⚡</span>
          <span className="homeButtonText">
            <strong>온라인 대전</strong>
            <span>매치메이킹으로 빠른 매칭</span>
          </span>
        </Link>
      </div>
    </main>
  );
}
