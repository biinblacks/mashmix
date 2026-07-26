/**
 * Browser-based audio analysis: BPM + musical key (Camelot notation).
 *
 * Runs entirely in the user's browser via Web Audio API, so no Python service,
 * no GPU server, and no per-track API cost. The file never leaves the client
 * for this step.
 */

export interface AudioAnalysis {
  bpm: number;
  camelotKey: string;
  keyName: string;
  keyConfidence: number;
  energy: number;
  durationSeconds: number;
}

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// (root index in PITCH_CLASSES, isMajor) -> Camelot code
const CAMELOT_TABLE: Record<string, string> = {
  "0-true": "8B", "0-false": "5A",
  "1-true": "3B", "1-false": "12A",
  "2-true": "10B", "2-false": "7A",
  "3-true": "5B", "3-false": "2A",
  "4-true": "12B", "4-false": "9A",
  "5-true": "7B", "5-false": "4A",
  "6-true": "2B", "6-false": "11A",
  "7-true": "9B", "7-false": "6A",
  "8-true": "4B", "8-false": "1A",
  "9-true": "11B", "9-false": "8A",
  "10-true": "6B", "10-false": "3A",
  "11-true": "1B", "11-false": "10A",
};

/** In-place iterative radix-2 FFT. Arrays must have power-of-two length. */
function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let k = 0; k < len / 2; k++) {
        const uReal = real[i + k];
        const uImag = imag[i + k];
        const vReal = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag;
        const vImag = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal;
        real[i + k] = uReal + vReal;
        imag[i + k] = uImag + vImag;
        real[i + k + len / 2] = uReal - vReal;
        imag[i + k + len / 2] = uImag - vImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function rotate(arr: number[], by: number): number[] {
  const n = arr.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = arr[(i - by + n * 2) % n];
  return out;
}

/** Estimate tempo from an onset-strength envelope via autocorrelation. */
export function detectBpm(samples: Float32Array, sampleRate: number): number {
  const hop = 128;
  const win = 512;
  const frameCount = Math.floor((samples.length - win) / hop);
  if (frameCount < 8) return 0;

  // Short-time energy
  const energy = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < win; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / win);
  }

  // Onset strength = positive energy difference (half-wave rectified)
  const onset = new Float32Array(frameCount - 1);
  for (let f = 1; f < frameCount; f++) {
    const diff = energy[f] - energy[f - 1];
    onset[f - 1] = diff > 0 ? diff : 0;
  }

  // Remove DC so autocorrelation is not dominated by the mean
  let mean = 0;
  for (let i = 0; i < onset.length; i++) mean += onset[i];
  mean /= onset.length;
  for (let i = 0; i < onset.length; i++) onset[i] -= mean;

  const envRate = sampleRate / hop; // envelope samples per second
  const minBpm = 70;
  const maxBpm = 180;
  const minLag = Math.floor((60 / maxBpm) * envRate);
  const maxLag = Math.ceil((60 / minBpm) * envRate);

  let bestLag = -1;
  let bestScore = -Infinity;
  const scores = new Float32Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag && lag < onset.length; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < onset.length; i++) sum += onset[i] * onset[i + lag];
    const score = sum / (onset.length - lag);
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return 0;

  // Parabolic interpolation around the peak for sub-sample precision
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = scores[bestLag - 1];
    const y1 = scores[bestLag];
    const y2 = scores[bestLag + 1];
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) {
      const shift = (0.5 * (y0 - y2)) / denom;
      if (Math.abs(shift) < 1) refinedLag = bestLag + shift;
    }
  }

  const bpm = (60 * envRate) / refinedLag;
  return Math.round(bpm * 10) / 10;
}

/** Estimate musical key from an averaged chroma vector. */
export function detectKey(samples: Float32Array, sampleRate: number): {
  camelot: string;
  keyName: string;
  confidence: number;
} {
  const fftSize = 8192;
  const hop = fftSize;
  const chroma = new Array<number>(12).fill(0);

  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)); // Hann
  }

  const frames = Math.floor((samples.length - fftSize) / hop);
  if (frames < 1) return { camelot: "8B", keyName: "C major", confidence: 0 };

  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);

  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) {
      real[i] = samples[start + i] * window[i];
      imag[i] = 0;
    }
    fft(real, imag);

    for (let bin = 1; bin < fftSize / 2; bin++) {
      const freq = (bin * sampleRate) / fftSize;
      if (freq < 55 || freq > 2000) continue;
      const magnitude = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
      const midi = 12 * Math.log2(freq / 440) + 69;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += magnitude;
    }
  }

  let bestScore = -Infinity;
  let bestRoot = 0;
  let bestIsMajor = true;

  for (let shift = 0; shift < 12; shift++) {
    const majorScore = pearson(chroma, rotate(MAJOR_PROFILE, shift));
    const minorScore = pearson(chroma, rotate(MINOR_PROFILE, shift));
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestRoot = shift;
      bestIsMajor = true;
    }
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestRoot = shift;
      bestIsMajor = false;
    }
  }

  return {
    camelot: CAMELOT_TABLE[`${bestRoot}-${bestIsMajor}`] ?? "8B",
    keyName: `${PITCH_CLASSES[bestRoot]} ${bestIsMajor ? "major" : "minor"}`,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}

/** Decode an audio file and extract tempo, key, and loudness. */
export async function analyzeAudioFile(file: File): Promise<AudioAnalysis> {
  const arrayBuffer = await file.arrayBuffer();
  const targetRate = 11025;

  // Decode straight into a low-rate context: the browser resamples during
  // decoding, so a 15MB MP3 never expands to a full-rate PCM buffer in memory.
  let decoded: AudioBuffer;
  try {
    const offline = new OfflineAudioContext(1, 1, targetRate);
    decoded = await offline.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      void ctx.close();
    }
  }

  const durationSeconds = decoded.duration;
  const sourceRate = decoded.sampleRate;

  // Mix down to mono
  const channelCount = decoded.numberOfChannels;
  const length = decoded.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channelCount; ch++) {
    const data = decoded.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channelCount;
  }

  // If the browser ignored the context rate, downsample manually
  let samples = mono;
  let rate = sourceRate;
  if (sourceRate > targetRate * 1.5) {
    const ratio = sourceRate / targetRate;
    const downLength = Math.floor(length / ratio);
    const down = new Float32Array(downLength);
    for (let i = 0; i < downLength; i++) down[i] = mono[Math.floor(i * ratio)];
    samples = down;
    rate = targetRate;
  }

  // Tempo from the first 60s, key from the first 120s (accuracy/speed tradeoff)
  const bpmSlice = samples.subarray(0, Math.min(samples.length, rate * 60));
  const keySlice = samples.subarray(0, Math.min(samples.length, rate * 120));

  const bpm = detectBpm(bpmSlice, rate);
  const key = detectKey(keySlice, rate);

  // Rough 0-1 loudness score
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  const rms = Math.sqrt(sumSquares / samples.length);
  const energy = Math.round(Math.min(1, rms / 0.3) * 1000) / 1000;

  return {
    bpm,
    camelotKey: key.camelot,
    keyName: key.keyName,
    keyConfidence: Math.round(key.confidence * 1000) / 1000,
    energy,
    durationSeconds: Math.round(durationSeconds * 10) / 10,
  };
}

/** Strip diacritics and unsafe characters so Supabase Storage accepts the key. */
export function sanitizeStorageName(fileName: string): string {
  const withoutDiacritics = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");

  const safe = withoutDiacritics.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return safe.length > 0 ? safe : "track";
}
