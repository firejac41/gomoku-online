import Link from "next/link";

export default function HomePage() {
  return (
    <main className="homePage">
      <div className="homeBgGrid" aria-hidden="true" />
      <div className="homeGlow" aria-hidden="true" />
      <div className="homeStoneBlur black" aria-hidden="true" />
      <div className="homeStoneBlur white" aria-hidden="true" />

      <h1 className="homeTitle">증강 오목</h1>
      <p className="homeSubtitle">렌주룰 + 4턴마다 증강 선택 — 로그라이크 오목</p>

      <div className="homeButtons">
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
