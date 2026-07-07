// 착수음: 외부 음원 파일 없이 Web Audio API로 "딱" 소리를 그때그때 합성해서 재생
// (노이즈 클릭 + 저음 툭 소리를 같이 섞어서 바둑판에 돌 놓는 느낌을 냄)

let audioCtx = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

export function playStoneSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const clickDuration = 0.07;

  // 짧게 감쇠하는 화이트 노이즈 -> 딱 부딪히는 타격감
  const bufferSize = Math.floor(ctx.sampleRate * clickDuration);
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) ** 3;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 2200;
  bandpass.Q.value = 1.1;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.7, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + clickDuration);

  noise.connect(bandpass);
  bandpass.connect(noiseGain);
  noiseGain.connect(ctx.destination);

  // 낮은 톤의 짧은 "툭" -> 나무 판에 돌 닿는 울림
  const thudDuration = 0.09;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(170, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + thudDuration);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.35, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + thudDuration);

  osc.connect(oscGain);
  oscGain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + clickDuration);
  osc.start(now);
  osc.stop(now + thudDuration);
}

export function countTotalStones(board) {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell !== 0) count++;
    }
  }
  return count;
}
