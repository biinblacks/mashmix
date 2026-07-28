/**
 * Structural alignment for mashups.
 *
 * Beat-matching alone isn't enough: dropping vocals in at 0:00 lands them over
 * an intro rather than a verse. These helpers find the beat grid, the downbeat,
 * where the intro ends, and where singing actually starts, so the vocal can be
 * placed at a phrase boundary the way a DJ would.
 *
 * Assumes 4/4, which covers essentially all pop, dance and hip-hop.
 */

const BEATS_PER_BAR = 4;
const BARS_PER_PHRASE = 8;

export interface Envelope {
  values: Float32Array;
  /** envelope samples per second */
  rate: number;
  /**
   * Frames between an envelope index and the moment it describes. Energy
   * windows are centred later than their start sample, and a difference
   * envelope lags by a further frame; without this the whole grid sits early.
   */
  offsetFrames: number;
}

/** Convert an envelope index to the time it actually describes. */
export function timeOf(env: Envelope, index: number): number {
  return (index + env.offsetFrames) / env.rate;
}

/** Convert a time to the envelope index describing it. */
export function indexAt(env: Envelope, seconds: number): number {
  return Math.round(seconds * env.rate - env.offsetFrames);
}

function shortTimeEnergy(samples: Float32Array, hop: number): Float32Array {
  const win = hop * 2;
  const frames = Math.max(0, Math.floor((samples.length - win) / hop));
  const energy = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < win; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / win);
  }
  return energy;
}

/** Half-wave rectified energy difference — peaks on note and drum attacks. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number, hop = 256): Envelope {
  const energy = shortTimeEnergy(samples, hop);
  const values = new Float32Array(Math.max(0, energy.length - 1));
  for (let f = 1; f < energy.length; f++) {
    const diff = energy[f] - energy[f - 1];
    values[f - 1] = diff > 0 ? diff : 0;
  }
  return { values, rate: sampleRate / hop, offsetFrames: 2 };
}

/** Smoothed loudness per frame, used for intro and silence detection. */
export function loudnessEnvelope(samples: Float32Array, sampleRate: number, hop = 256): Envelope {
  return { values: shortTimeEnergy(samples, hop), rate: sampleRate / hop, offsetFrames: 1 };
}

/** Moving average, so percussive gaps don't read as silence. */
export function smooth(env: Envelope, seconds: number): Envelope {
  const width = Math.max(1, Math.round(seconds * env.rate));
  const out = new Float32Array(env.values.length);
  let running = 0;

  for (let i = 0; i < env.values.length; i++) {
    running += env.values[i];
    if (i >= width) running -= env.values[i - width];
    out[i] = running / Math.min(i + 1, width);
  }

  return { values: out, rate: env.rate, offsetFrames: env.offsetFrames };
}

function percentile(values: ArrayLike<number>, p: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Find where the beat grid sits in time: the offset of the first beat, in
 * seconds, given a known tempo. Tries every candidate phase and keeps the one
 * where onsets line up best.
 */
export function detectBeatPhase(env: Envelope, bpm: number): number {
  if (!bpm || env.values.length === 0) return 0;

  const beatSeconds = 60 / bpm;
  const beatFrames = beatSeconds * env.rate;
  const candidates = Math.max(1, Math.round(beatFrames));

  let bestPhase = 0;
  let bestScore = -Infinity;

  for (let phase = 0; phase < candidates; phase++) {
    let score = 0;
    let count = 0;
    for (let pos = phase; pos < env.values.length; pos += beatFrames) {
      score += env.values[Math.round(pos)] ?? 0;
      count++;
    }
    if (count > 0) score /= count;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  const phaseSeconds = timeOf(env, bestPhase);
  // Keep the answer inside the first beat
  return ((phaseSeconds % beatSeconds) + beatSeconds) % beatSeconds;
}

/**
 * Of the four beats in a bar, work out which one is the downbeat (beat 1) by
 * checking which lands on the strongest accents.
 */
export function detectDownbeatOffset(env: Envelope, bpm: number, beatPhaseSeconds: number): number {
  if (!bpm || env.values.length === 0) return beatPhaseSeconds;

  const beatSeconds = 60 / bpm;
  const barSeconds = beatSeconds * BEATS_PER_BAR;
  const totalSeconds = timeOf(env, env.values.length - 1);

  let bestBeat = 0;
  let bestScore = -Infinity;

  for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
    const start = beatPhaseSeconds + beat * beatSeconds;
    let score = 0;
    let count = 0;
    for (let t = start; t < totalSeconds; t += barSeconds) {
      score += env.values[indexAt(env, t)] ?? 0;
      count++;
    }
    if (count > 0) score /= count;
    if (score > bestScore) {
      bestScore = score;
      bestBeat = beat;
    }
  }

  return beatPhaseSeconds + bestBeat * beatSeconds;
}

/**
 * First moment the signal rises meaningfully above its noise floor.
 * For a vocal stem this is where singing starts; the rest is near-silence.
 * Works on smoothed loudness so gaps between words don't end the search early.
 */
export function detectFirstSound(loudness: Envelope, relativeThreshold = 0.15): number {
  const smoothed = smooth(loudness, 0.25);
  const { values } = smoothed;
  if (values.length === 0) return 0;

  const loud = percentile(values, 0.9);
  if (loud === 0) return 0;

  const threshold = loud * relativeThreshold;
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= threshold) return Math.max(0, timeOf(smoothed, i));
  }
  return 0;
}

/**
 * Where the intro ends: the first bar whose level reaches a decent fraction of
 * the track's typical bar, i.e. where the arrangement fills out.
 */
export function detectIntroEnd(loudness: Envelope, barSeconds: number, gridStart: number): number {
  const { values } = loudness;
  if (values.length === 0 || barSeconds <= 0) return gridStart;

  const totalSeconds = timeOf(loudness, values.length - 1);

  // Average level per bar
  const barLevels: number[] = [];
  const barStarts: number[] = [];
  for (let start = gridStart; start < totalSeconds; start += barSeconds) {
    let sum = 0;
    let count = 0;
    const end = Math.min(start + barSeconds, totalSeconds);
    for (let t = start; t < end; t += 1 / loudness.rate) {
      sum += values[indexAt(loudness, t)] ?? 0;
      count++;
    }
    if (count > 0) {
      barLevels.push(sum / count);
      barStarts.push(start);
    }
  }

  if (barLevels.length === 0) return gridStart;

  // Compare against a typical bar rather than the frame-level median, which
  // silence between hits would drag toward zero.
  const typical = percentile(barLevels, 0.5);
  const target = typical * 0.5;

  for (let i = 0; i < barLevels.length; i++) {
    if (barLevels[i] >= target) return barStarts[i];
  }

  return gridStart;
}

export interface Alignment {
  /** Seconds into the output where the vocal should begin */
  vocalStartSeconds: number;
  /** Seconds to skip from the start of the vocal stem */
  vocalTrimSeconds: number;
  barSeconds: number;
  introEndSeconds: number;
  /** Bars of instrumental before the vocal enters */
  barsBeforeVocal: number;
}

export interface AlignmentInput {
  instrumental: Float32Array;
  vocals: Float32Array;
  sampleRate: number;
  instrumentalBpm: number;
  vocalsBpm: number;
}

/**
 * Decide where the vocal enters.
 *
 * The vocal is trimmed back to the start of the bar containing its first sung
 * note, then dropped onto the first 8-bar phrase boundary of the instrumental
 * at or after the intro — the same placement a DJ would pick by ear.
 */
export function computeAlignment(input: AlignmentInput): Alignment {
  const { instrumental, vocals, sampleRate, instrumentalBpm, vocalsBpm } = input;

  const beatSeconds = instrumentalBpm > 0 ? 60 / instrumentalBpm : 0;
  const barSeconds = beatSeconds * BEATS_PER_BAR;
  const phraseSeconds = barSeconds * BARS_PER_PHRASE;

  if (barSeconds <= 0) {
    return {
      vocalStartSeconds: 0,
      vocalTrimSeconds: 0,
      barSeconds: 0,
      introEndSeconds: 0,
      barsBeforeVocal: 0,
    };
  }

  const instOnsets = onsetEnvelope(instrumental, sampleRate);
  const instLoudness = loudnessEnvelope(instrumental, sampleRate);
  const vocalOnsets = onsetEnvelope(vocals, sampleRate);
  const vocalLoudness = loudnessEnvelope(vocals, sampleRate);

  const instBeatPhase = detectBeatPhase(instOnsets, instrumentalBpm);
  const instDownbeat = detectDownbeatOffset(instOnsets, instrumentalBpm, instBeatPhase);
  const introEnd = detectIntroEnd(instLoudness, barSeconds, instDownbeat);

  // Snap the entry to a phrase boundary on the instrumental's own grid
  const barsIntoTrack = Math.max(0, (introEnd - instDownbeat) / barSeconds);
  const phraseIndex = Math.ceil(barsIntoTrack / BARS_PER_PHRASE - 0.001);
  const vocalStartSeconds = instDownbeat + phraseIndex * phraseSeconds;

  // Trim the vocal back to the bar its first sung note falls in, so the phrase
  // isn't clipped mid-word
  const vocalBpm = vocalsBpm > 0 ? vocalsBpm : instrumentalBpm;
  const vocalBarSeconds = (60 / vocalBpm) * BEATS_PER_BAR;
  const vocalBeatPhase = detectBeatPhase(vocalOnsets, vocalBpm);
  const vocalDownbeat = detectDownbeatOffset(vocalOnsets, vocalBpm, vocalBeatPhase);
  const vocalFirstSound = detectFirstSound(vocalLoudness);

  let vocalTrimSeconds: number;
  if (vocalFirstSound > vocalDownbeat && vocalBarSeconds > 0) {
    const barsIn = Math.floor((vocalFirstSound - vocalDownbeat) / vocalBarSeconds);
    vocalTrimSeconds = vocalDownbeat + barsIn * vocalBarSeconds;
  } else {
    vocalTrimSeconds = vocalDownbeat;
  }
  vocalTrimSeconds = Math.max(0, vocalTrimSeconds);

  // Never trim away the whole stem
  const vocalDuration = vocals.length / sampleRate;
  if (vocalTrimSeconds > vocalDuration - 5) vocalTrimSeconds = 0;

  return {
    vocalStartSeconds,
    vocalTrimSeconds,
    barSeconds,
    introEndSeconds: introEnd,
    barsBeforeVocal: Math.round((vocalStartSeconds - instDownbeat) / barSeconds),
  };
}

export const PHRASE_BARS = BARS_PER_PHRASE;
export const BEATS_IN_BAR = BEATS_PER_BAR;
