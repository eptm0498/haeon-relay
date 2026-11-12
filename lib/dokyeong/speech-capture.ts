const PRE_ROLL_MS = 300;
const END_SILENCE_MS = 1100;
const KEEP_TAIL_MS = 220;
const MAX_TURN_MS = 25_000;

export function speechRms(frame: Float32Array) {
  let energy = 0, sum = 0;
  for (const value of frame) { energy += value * value; sum += value; }
  const mean = sum / frame.length;
  return Math.sqrt(Math.max(0, energy / frame.length - mean * mean));
}

export function speechThresholds(noise: number, playing: boolean) {
  return playing
    ? { start: Math.max(0.025, noise * 3), hold: Math.max(0.003, noise * 1.45), onsetMs: 120 }
    : { start: Math.max(0.0035, noise * 1.9), hold: Math.max(0.0023, noise * 1.3), onsetMs: 60 };
}

export class SpeechTurnBuffer {
  private noise = 0.0025;
  private preRoll: Float32Array[] = [];
  private frames: Float32Array[] = [];
  private onset = 0;
  private elapsed = 0;
  private quiet = 0;
  private playing = false;

  private readonly sampleRate: number;

  constructor(sampleRate: number) { this.sampleRate = sampleRate; }

  get recording() { return this.frames.length > 0; }

  push(frame: Float32Array, playing: boolean): { started?: true; completed?: Float32Array[] } {
    if (!frame.length) return {};
    const ms = frame.length / this.sampleRate * 1000;
    const level = speechRms(frame);
    const thresholds = speechThresholds(this.noise, playing);
    if (this.recording) {
      this.frames.push(frame);
      this.elapsed += ms;
      this.quiet = level >= thresholds.hold ? 0 : this.quiet + ms;
      if (this.quiet < END_SILENCE_MS && this.elapsed < MAX_TURN_MS) return {};
      const keep = Math.max(0, this.quiet - KEEP_TAIL_MS);
      const completed = this.frames.slice(0, this.frames.length - Math.floor(keep / ms));
      this.frames = [];
      this.elapsed = this.quiet = this.onset = 0;
      return { completed };
    }

    // Don't carry audio detected during playback into the next quiet speech turn.
    if (playing !== this.playing) {
      this.preRoll = [];
      this.onset = 0;
      this.playing = playing;
    }
    this.preRoll.push(frame);
    if (this.preRoll.length > Math.ceil(PRE_ROLL_MS / ms)) this.preRoll.shift();
    if (!playing && level < thresholds.start) this.noise = 0.985 * this.noise + 0.015 * level;
    this.onset = level >= thresholds.start ? this.onset + ms : Math.max(0, this.onset - ms * 2);
    if (this.onset < thresholds.onsetMs) return {};
    this.frames = this.preRoll;
    this.preRoll = [];
    this.elapsed = this.onset;
    return { started: true };
  }
}

/** Pack mono PCM as WAV; box-filter higher input rates to bound upload size. */
export function encodeSpeechWav(frames: Float32Array[], inputRate: number) {
  const outputRate = Math.min(24_000, inputRate);
  const inputLength = frames.reduce((length, frame) => length + frame.length, 0);
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(inputLength / ratio);
  const buffer = new ArrayBuffer(44 + outputLength * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, outputRate, true);
  view.setUint32(28, outputRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, outputLength * 2, true);
  let frameIndex = 0, offset = 0, sample = 0;
  for (let out = 0; out < outputLength; out++) {
    const end = Math.floor((out + 1) * ratio);
    const start = sample;
    let sum = 0;
    while (sample < end) {
      sum += frames[frameIndex][offset++];
      sample++;
      if (offset === frames[frameIndex].length) { frameIndex++; offset = 0; }
    }
    const pcm = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(44 + out * 2, pcm < 0 ? pcm * 32768 : pcm * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
