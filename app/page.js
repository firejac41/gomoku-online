import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 text-center px-4">
      <h1 className="text-3xl font-bold">증강 오목</h1>
      <p className="opacity-80">렌주룰 + 4턴마다 증강체 선택</p>
      <div className="flex flex-col gap-4 mt-4">
        <Link href="/local" className="bigButton">로컬 대전 (한 화면에서 번갈아 두기)</Link>
        <Link href="/online" className="bigButton">온라인 대전 (링크로 초대)</Link>
        <Link href="/online/quick" className="bigButton">온라인 대전 (매치메이킹)</Link>
      </div>
    </main>
  );
}
