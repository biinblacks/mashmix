import { computeAlignment } from "./align";

/**
 * Builds a finished mashup: the instrumental of one track with the vocals of
 * another, tempo-matched and mixed down to a single downloadable file.
 *
 * Runs entirely in the browser via OfflineAudioContext — no server rendering,
 * no ffmpeg, no extra service.
 */

export interface MashupBuildOptions {
  instrumental: ArrayBuffer;
  vocals: ArrayBuffer;
  /** Tempo of the instrumental track, in BPM */
  instrumentalBpm: number;
  /** Tempo of the vocal track, in BPM */
  vocalsBpm: number;
  /** 0-1, relative loudness of the vocal against the instrumental */
  vocalGain?: number;
  /**
   * Place the vocal on a musical phrase boundary after the intro instead of
   * starting both stems at 0:00. On by default.
   */
  autoAlign?: boolean;
}

export interface MashupResult {
  blob: Blob;
  durationSeconds: number;
  /** Playback rate applied to the vocals to line the tempos up */
  vocalRate: number;
  /** Seconds of instrumental before the vocal enters */
  vocalStartSeconds: number;
  /** Bars of instrumental before the vocal enters */
  barsBeforeVocal: number;
}

/**
 * Work out how much to speed up or slow down the vocals.
 * Handles double- and half-time pairings, and never stretches further than a
 * DJ would on a pitch fader (about ±6%).
 */
export function computeVocalRate(instrumentalBpm: number, vocalsBpm: number): number {
  if (!instrumentalBpm || !vocalsBpm) return 1;

  let rate = instrumentalBpm / vocalsBpm;

  // Fold double/half time into the same tempo range
  while (rate > 1.35) rate /= 2;
  while (rate < 0.7) rate *= 2;

  // Refuse to mangle the track if the tempos really don't line up
  if (rate > 1.12 || rate < 0.89) return 1;

  return rate;
}

/** Encode an AudioBuffer as a 16-bit PCM WAV file. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channelCount = buffer.numberOfChannels;
  const sampleCount = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;

  const dataLength = sampleCount * channelCount * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataLength));

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true); // byte rate
  view.setUint16(32, channelCount * bytesPerSample, true); // block align
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < channelCount; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    for (let ch = 0; ch < channelCount; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: "audio/wav" });
}

export async function buildMashup(options: MashupBuildOptions): Promise<MashupResult> {
  const {
    instrumental,
    vocals,
    instrumentalBpm,
    vocalsBpm,
    vocalGain = 1.0,
    autoAlign = true,
  } = options;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const decodeCtx = new AudioCtx();
  let instrumentalBuffer: AudioBuffer;
  let vocalsBuffer: AudioBuffer;
  try {
    [instrumentalBuffer, vocalsBuffer] = await Promise.all([
      decodeCtx.decodeAudioData(instrumental.slice(0)),
      decodeCtx.decodeAudioData(vocals.slice(0)),
    ]);
  } finally {
    void decodeCtx.close();
  }

  const vocalRate = computeVocalRate(instrumentalBpm, vocalsBpm);

  const sampleRate = instrumentalBuffer.sampleRate;
  const channelCount = Math.max(instrumentalBuffer.numberOfChannels, vocalsBuffer.numberOfChannels);

  // Work out where the vocal should enter. Analysis runs on a mono, decimated
  // copy — the beat grid doesn't need full bandwidth and this keeps it quick.
  let vocalStartSeconds = 0;
  let vocalTrimSeconds = 0;
  let barsBeforeVocal = 0;

  if (autoAlign) {
    const alignment = computeAlignment({
      instrumental: toAnalysisSignal(instrumentalBuffer),
      vocals: toAnalysisSignal(vocalsBuffer),
      sampleRate: ANALYSIS_RATE,
      instrumentalBpm,
      vocalsBpm,
    });
    vocalStartSeconds = alignment.vocalStartSeconds;
    vocalTrimSeconds = alignment.vocalTrimSeconds;
    barsBeforeVocal = alignment.barsBeforeVocal;
  }

  const vocalPlaybackDuration = (vocalsBuffer.duration - vocalTrimSeconds) / vocalRate;
  const totalDuration = Math.max(
    instrumentalBuffer.duration,
    vocalStartSeconds + vocalPlaybackDuration
  );

  const ctx = new OfflineAudioContext(
    channelCount,
    Math.ceil(totalDuration * sampleRate),
    sampleRate
  );

  // Instrumental: the tempo everything else is matched to
  const instrumentalSource = ctx.createBufferSource();
  instrumentalSource.buffer = instrumentalBuffer;
  const instrumentalGain = ctx.createGain();
  instrumentalGain.gain.value = 0.85; // leave headroom so the mix doesn't clip
  instrumentalSource.connect(instrumentalGain).connect(ctx.destination);
  instrumentalSource.start(0);

  // Vocals: resampled to line up with the instrumental's tempo, the same way a
  // DJ nudges a pitch fader
  const vocalsSource = ctx.createBufferSource();
  vocalsSource.buffer = vocalsBuffer;
  vocalsSource.playbackRate.value = vocalRate;
  const vocalsGainNode = ctx.createGain();
  vocalsGainNode.gain.value = vocalGain;
  vocalsSource.connect(vocalsGainNode).connect(ctx.destination);
  // Third argument skips the stem's lead-in so the phrase starts cleanly
  vocalsSource.start(vocalStartSeconds, vocalTrimSeconds);

  const rendered = await ctx.startRendering();

  return {
    blob: encodeWav(rendered),
    durationSeconds: Math.round(rendered.duration * 10) / 10,
    vocalRate: Math.round(vocalRate * 1000) / 1000,
    vocalStartSeconds: Math.round(vocalStartSeconds * 10) / 10,
    barsBeforeVocal,
  };
}

const ANALYSIS_RATE = 11025;

/** Mono, decimated copy of a buffer for beat-grid analysis. */
function toAnalysisSignal(buffer: AudioBuffer): Float32Array {
  const channelCount = buffer.numberOfChannels;
  const ratio = buffer.sampleRate / ANALYSIS_RATE;
  const outLength = Math.floor(buffer.length / ratio);
  const out = new Float32Array(outLength);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < channelCount; ch++) channels.push(buffer.getChannelData(ch));

  for (let i = 0; i < outLength; i++) {
    const src = Math.floor(i * ratio);
    let sum = 0;
    for (let ch = 0; ch < channelCount; ch++) sum += channels[ch][src];
    out[i] = sum / channelCount;
  }

  return out;
}
