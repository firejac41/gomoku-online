const FEEDBACK_URL =
  "https://github.com/firejac41/gomoku-online/issues/new?template=feedback.yml";

// 어느 화면에서든 버그/피드백을 바로 GitHub 이슈로 남길 수 있는 고정 버튼
export default function FeedbackButton() {
  return (
    <a
      href={FEEDBACK_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="feedbackButton"
      title="버그 제보 / 피드백 보내기"
    >
      🐛 피드백
    </a>
  );
}
