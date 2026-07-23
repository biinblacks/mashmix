/**
 * Camelot Wheel harmonic mixing logic.
 * Standard DJ notation: 1A-12A (minor keys), 1B-12B (major keys).
 * Compatible keys: same number (any letter within reason), adjacent numbers
 * same letter, or same number opposite letter (relative major/minor).
 */

const CAMELOT_WHEEL_SIZE = 12;

export interface KeyRelation {
  compatible: boolean;
  relation:
    | "same"
    | "adjacent"
    | "relative_major_minor"
    | "energy_boost"
    | "energy_drop"
    | "incompatible";
  score: number; // 0-100
}

/** Parse Camelot notation like "8A" into { number: 8, letter: 'A' } */
function parseCamelot(key: string): { number: number; letter: "A" | "B" } | null {
  const match = key.trim().match(/^(\d{1,2})([AB])$/i);
  if (!match) return null;
  const number = parseInt(match[1], 10);
  const letter = match[2].toUpperCase() as "A" | "B";
  if (number < 1 || number > 12) return null;
  return { number, letter };
}

function wheelDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, CAMELOT_WHEEL_SIZE - diff);
}

export function getKeyRelation(keyA: string, keyB: string): KeyRelation {
  const a = parseCamelot(keyA);
  const b = parseCamelot(keyB);

  if (!a || !b) {
    return { compatible: false, relation: "incompatible", score: 0 };
  }

  // Exact same key
  if (a.number === b.number && a.letter === b.letter) {
    return { compatible: true, relation: "same", score: 100 };
  }

  // Relative major/minor (same number, different letter) - always compatible
  if (a.number === b.number && a.letter !== b.letter) {
    return { compatible: true, relation: "relative_major_minor", score: 90 };
  }

  const dist = wheelDistance(a.number, b.number);

  // Adjacent on the wheel, same letter - very compatible (energy shift)
  if (dist === 1 && a.letter === b.letter) {
    const isBoost =
      (b.number === a.number + 1) || (a.number === 12 && b.number === 1);
    return {
      compatible: true,
      relation: isBoost ? "energy_boost" : "energy_drop",
      score: 80,
    };
  }

  // Adjacent, different letter - still workable but weaker
  if (dist === 1 && a.letter !== b.letter) {
    return { compatible: true, relation: "adjacent", score: 55 };
  }

  return { compatible: false, relation: "incompatible", score: 15 };
}

/** BPM compatibility: same tempo, or exact double/half time */
export function getBpmCompatibility(bpmA: number, bpmB: number): {
  compatible: boolean;
  score: number;
  relationship: "same" | "double_time" | "half_time" | "incompatible";
} {
  const tolerance = 0.06; // 6% tolerance, matches typical DJ time-stretch range

  const ratio = bpmA / bpmB;

  const withinTolerance = (target: number) =>
    Math.abs(ratio - target) / target <= tolerance;

  if (withinTolerance(1)) {
    const diffPct = Math.abs(bpmA - bpmB) / bpmA;
    return { compatible: true, score: 100 - diffPct * 500, relationship: "same" };
  }
  if (withinTolerance(2)) {
    return { compatible: true, score: 70, relationship: "double_time" };
  }
  if (withinTolerance(0.5)) {
    return { compatible: true, score: 70, relationship: "half_time" };
  }

  return { compatible: false, score: 0, relationship: "incompatible" };
}

export interface TrackForMatching {
  id: string;
  file_name: string;
  bpm: number;
  musical_key: string;
}

export interface MatchResult {
  trackAId: string;
  trackBId: string;
  compatibilityScore: number;
  bpmDiff: number;
  keyRelation: string;
}

/**
 * Compute a combined compatibility score (0-100) for a pair of tracks.
 * Weighted: 55% key compatibility, 45% BPM compatibility.
 * Both must clear a minimum bar to be considered a suggestion at all.
 */
export function computeCompatibility(
  trackA: TrackForMatching,
  trackB: TrackForMatching
): MatchResult | null {
  const bpmResult = getBpmCompatibility(trackA.bpm, trackB.bpm);
  const keyResult = getKeyRelation(trackA.musical_key, trackB.musical_key);

  if (!bpmResult.compatible && !keyResult.compatible) {
    return null;
  }

  const score = Math.round(keyResult.score * 0.55 + bpmResult.score * 0.45);

  // Require at least a moderate score to bother suggesting
  if (score < 40) return null;

  return {
    trackAId: trackA.id,
    trackBId: trackB.id,
    compatibilityScore: score,
    bpmDiff: Math.round(Math.abs(trackA.bpm - trackB.bpm) * 10) / 10,
    keyRelation: keyResult.relation,
  };
}

/** Find all viable mashup pairs from a list of analyzed tracks, best first */
export function findAllMatches(tracks: TrackForMatching[]): MatchResult[] {
  const results: MatchResult[] = [];

  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const match = computeCompatibility(tracks[i], tracks[j]);
      if (match) results.push(match);
    }
  }

  return results.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
}
