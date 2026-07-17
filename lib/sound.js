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

// 증강 등장음: 증강 선택 카드 3(4)장이 뜨는 순간 재생. 상승 아르페지오(도-미-솔) + 마지막 음에 겹치는 반짝임(하이패스 노이즈)
export function playAugmentSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  const noteGap = 0.09;
  const noteDuration = 0.22;

  notes.forEach((freq, i) => {
    const start = now + i * noteGap;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, start);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.32, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + noteDuration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + noteDuration);
  });

  // 마지막 음에 겹치는 스파클(반짝임)
  const sparkleStart = now + (notes.length - 1) * noteGap;
  const sparkleDuration = 0.35;
  const bufferSize = Math.floor(ctx.sampleRate * sparkleDuration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) ** 2;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 6000;

  const sparkleGain = ctx.createGain();
  sparkleGain.gain.setValueAtTime(0.18, sparkleStart);
  sparkleGain.gain.exponentialRampToValueAtTime(0.0001, sparkleStart + sparkleDuration);

  noise.connect(highpass);
  highpass.connect(sparkleGain);
  sparkleGain.connect(ctx.destination);
  noise.start(sparkleStart);
  noise.stop(sparkleStart + sparkleDuration);
}

// 내 턴 알림음: 상대 턴/AI 턴이 끝나고 내 차례가 된 순간 재생. 착수음(딱)이나 증강 등장음(아르페지오)과는
// 확실히 구분되도록, 짧게 두 번 울리는 맑은 벨 소리(사인파 두 개 겹침) 사용
export function playYourTurnSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const chimes = [
    { start: 0, freq: 880 },
    { start: 0.16, freq: 1108.73 },
  ];

  for (const { start, freq } of chimes) {
    const chimeStart = now + start;
    const duration = 0.3;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, chimeStart);

    const overtone = ctx.createOscillator();
    overtone.type = "sine";
    overtone.frequency.setValueAtTime(freq * 2, chimeStart);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, chimeStart);
    gain.gain.exponentialRampToValueAtTime(0.3, chimeStart + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, chimeStart + duration);

    const overtoneGain = ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.0001, chimeStart);
    overtoneGain.gain.exponentialRampToValueAtTime(0.08, chimeStart + 0.01);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, chimeStart + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    overtone.connect(overtoneGain);
    overtoneGain.connect(ctx.destination);

    osc.start(chimeStart);
    osc.stop(chimeStart + duration);
    overtone.start(chimeStart);
    overtone.stop(chimeStart + duration);
  }
}

// 액티브 능력 사용음: 능력 버튼을 눌러 실제로 효과가 적용된 순간(쿨다운/1회용 소진 등으로 막힌 경우는 제외) 재생.
// 착수음(딱)/증강 등장음(아르페지오)/내 턴 알림(벨)과 확실히 구분되도록, 상승하는 사각파 스윕 + 마무리 노이즈 찰칵으로 "발동감"을 냄
export function playAbilitySound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;
  const duration = 0.18;

  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + duration);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1200, now);
  filter.frequency.exponentialRampToValueAtTime(4000, now + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);

  // 스윕 끝에 겹치는 짧은 하이패스 노이즈로 "찰칵" 마무리감 추가
  const clickDuration = 0.05;
  const bufferSize = Math.floor(ctx.sampleRate * clickDuration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) ** 2;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 5000;

  const noiseGain = ctx.createGain();
  const clickStart = now + duration - 0.02;
  noiseGain.gain.setValueAtTime(0.15, clickStart);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, clickStart + clickDuration);

  noise.connect(highpass);
  highpass.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(clickStart);
  noise.stop(clickStart + clickDuration);
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
