/**
 * Structural segmentation, roughly what Mixed In Key calls "cue points":
 * finds where a track changes section (intro / verse / drop / breakdown / outro)
 * without any external model, using a technique from music-information-retrieval
 * literature (Foote, 2000): build a self-similarity matrix from timbre/chroma
 * features, correlate a checkerboard kernel along its diagonal to get a
 * "novelty curve", and pick the peaks as boundaries.
 */

import { fft } from "./analyze";

export interface Section {
  startSeconds: number;
  endSeconds: number;
  label: string;
  /** 0-1 relative loudness, used to pick the label */
  energy: number;
}

const FRAME_SIZE = 4096;
const HOP = 2048; // 50% overlap
const NUM_CHROMA_BINS = 12;

/** Per-frame chroma (pitch-class energy) and loudness, used as the feature vector for segmentation. */
function extractFrameFeatures(
  samples: Float32Array,
  sampleRate: number
): { chroma: Float32Array[]; loudness: Float32Array; frameRate: number } {
  const window = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
  }

  const frameCount = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP));
  const chroma: Float32Array[] = [];
  const loudness = new Float32Array(frameCount);

  const real = new Float32Array(FRAME_SIZE);
  const imag = new Float32Array(FRAME_SIZE);

  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP;
    let energySum = 0;

    for (let i = 0; i < FRAME_SIZE; i++) {
      const s = samples[start + i];
      real[i] = s * window[i];
      imag[i] = 0;
      energySum += s * s;
    }
    loudness[f] = Math.sqrt(energySum / FRAME_SIZE);

    fft(real, imag);

    const bins = new Float32Array(NUM_CHROMA_BINS);
    for (let bin = 1; bin < FRAME_SIZE / 2; bin++) {
      const freq = (bin * sampleRate) / FRAME_SIZE;
      if (freq < 80 || freq > 4000) continue;
      const magnitude = Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
      const midi = 12 * Math.log2(freq / 440) + 69;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      bins[pc] += magnitude;
    }

    // L2-normalize so loud and quiet passages with the same timbre look alike
    let norm = 0;
    for (let i = 0; i < NUM_CHROMA_BINS; i++) norm += bins[i] * bins[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < NUM_CHROMA_BINS; i++) bins[i] /= norm;

    chroma.push(bins);
  }

  return { chroma, loudness, frameRate: sampleRate / HOP };
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are already unit-normalized
}

/**
 * Correlate a checkerboard kernel along the self-similarity diagonal.
 * High values mean "everything before this frame sounds different from
 * everything after it" — i.e. a section boundary.
 */
function timbralNovelty(chroma: Float32Array[], kernelFrames: number): Float32Array {
  const n = chroma.length;
  const novelty = new Float32Array(n);
  const half = kernelFrames;

  for (let center = half; center < n - half; center++) {
    let score = 0;
    for (let i = -half; i < half; i++) {
      for (let j = -half; j < half; j++) {
        const a = center + i;
        const b = center + j;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const sim = cosineSimilarity(chroma[a], chroma[b]);
        const sign = i < 0 === j < 0 ? 1 : -1;
        score += sign * sim;
      }
    }
    novelty[center] = score;
  }

  return normalize01(novelty);
}

/**
 * Contrast between average loudness just before vs just after each frame.
 * Catches energy-driven transitions (a chorus falling into a quiet outro)
 * that timbral similarity alone can miss when pitch content overlaps.
 */
function loudnessNovelty(loudness: Float32Array, windowFrames: number): Float32Array {
  const n = loudness.length;
  const novelty = new Float32Array(n);

  for (let center = windowFrames; center < n - windowFrames; center++) {
    let before = 0;
    let after = 0;
    for (let i = 1; i <= windowFrames; i++) {
      before += loudness[center - i];
      after += loudness[center + i];
    }
    before /= windowFrames;
    after /= windowFrames;
    novelty[center] = Math.abs(after - before);
  }

  return normalize01(novelty);
}

function normalize01(values: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  if (max === 0) return values;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / max;
  return out;
}

/** Combined novelty curve: timbral change and loudness contrast both count. */
function noveltyCurve(
  chroma: Float32Array[],
  loudness: Float32Array,
  kernelFrames: number
): Float32Array {
  const timbral = timbralNovelty(chroma, kernelFrames);
  const energy = loudnessNovelty(loudness, kernelFrames);

  const combined = new Float32Array(timbral.length);
  for (let i = 0; i < combined.length; i++) {
    combined[i] = Math.max(timbral[i], energy[i] * 0.9);
  }
  return normalize01(combined);
}

function pickPeaks(curve: Float32Array, minSpacing: number, threshold: number): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < curve.length - 1; i++) {
    if (curve[i] < threshold) continue;
    if (curve[i] < curve[i - 1] || curve[i] < curve[i + 1]) continue;
    if (peaks.length > 0 && i - peaks[peaks.length - 1] < minSpacing) {
      if (curve[i] > curve[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  return peaks;
}

function labelSection(energy: number, quietLevel: number, loudLevel: number, isFirst: boolean, isLast: boolean): string {
  if (isFirst && energy <= quietLevel * 1.3) return "Intro";
  if (isLast && energy <= quietLevel * 1.3) return "Outro";
  if (energy <= quietLevel * 1.15) return "Breakdown";
  if (energy >= loudLevel * 0.9) return "Drop / Chorus";
  return "Build-up";
}

/**
 * Detect structural sections in an audio signal.
 * @param minSectionSeconds Minimum section length (defaults to ~8 bars at typical tempo)
 */
export function detectSections(
  samples: Float32Array,
  sampleRate: number,
  minSectionSeconds = 12
): Section[] {
  const { chroma, loudness, frameRate } = extractFrameFeatures(samples, sampleRate);
  if (chroma.length < 8) {
    const total = samples.length / sampleRate;
    return [{ startSeconds: 0, endSeconds: total, label: "Full track", energy: 1 }];
  }

  const kernelFrames = Math.max(2, Math.round((minSectionSeconds / 2) * frameRate));
  const novelty = noveltyCurve(chroma, loudness, kernelFrames);
  const minSpacingFrames = Math.round(minSectionSeconds * frameRate);

  // Threshold relative to the curve's own distribution rather than a fixed value
  const sorted = Float32Array.from(novelty).sort();
  const threshold = sorted[Math.floor(sorted.length * 0.85)] || 0.3;

  const peakFrames = pickPeaks(novelty, minSpacingFrames, Math.max(0.15, threshold));
  const boundaryFrames = [0, ...peakFrames, chroma.length - 1];

  const totalSeconds = samples.length / sampleRate;
  const sortedLoud = Float32Array.from(loudness).sort();
  const quietLevel = sortedLoud[Math.floor(sortedLoud.length * 0.25)] || 0;
  const loudLevel = sortedLoud[Math.floor(sortedLoud.length * 0.85)] || 1;

  const sections: Section[] = [];
  for (let i = 0; i < boundaryFrames.length - 1; i++) {
    const startFrame = boundaryFrames[i];
    const endFrame = boundaryFrames[i + 1];

    let energySum = 0;
    let count = 0;
    for (let f = startFrame; f < endFrame; f++) {
      energySum += loudness[f];
      count++;
    }
    const avgEnergy = count > 0 ? energySum / count : 0;
    const relativeEnergy = loudLevel > 0 ? Math.min(1, avgEnergy / loudLevel) : 0;

    sections.push({
      startSeconds: (startFrame * HOP) / sampleRate,
      endSeconds: i === boundaryFrames.length - 2 ? totalSeconds : (endFrame * HOP) / sampleRate,
      label: labelSection(avgEnergy, quietLevel, loudLevel, i === 0, i === boundaryFrames.length - 2),
      energy: Math.round(relativeEnergy * 100) / 100,
    });
  }

  return sections;
}
