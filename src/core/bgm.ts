import type { Evidence } from "../field/types.js";

export type BgmTrack = {
  file: string;
  sha256: string;
  sampleRate: number;
  frames: number;
  channels: number;
  loop: { start: number; end: number } | null;
  source: Evidence;
  tableSource: Evidence;
};
export type BgmMedia = {
  sourceSetHash: string;
  tracks: Record<string, BgmTrack>;
};
export type BgmVoice = {
  id: number;
  track: number;
  started: number;
  seek: number;
  fadeIn: number;
  stop: { at: number; duration: number; gain: number } | null;
};
export type BgmSnapshot = {
  time: number;
  nextId: number;
  channels: [number | null, number | null];
  voices: BgmVoice[];
};
export function bgmGain(voice: BgmVoice, time: number): number {
  if (voice.stop)
    return voice.stop.duration === 0
      ? 0
      : voice.stop.gain *
          Math.max(0, 1 - (time - voice.stop.at) / voice.stop.duration);
  return voice.fadeIn === 0
    ? 1
    : Math.min(1, (time - voice.started) / voice.fadeIn);
}
export function bgmPosition(
  voice: BgmVoice,
  time: number,
  track: BgmTrack,
): number {
  const seconds = voice.seek + (time - voice.started) / 1000;
  const loop = track.loop;
  if (!loop || seconds < loop.end / track.sampleRate) return seconds;
  const start = loop.start / track.sampleRate;
  return (
    start + ((seconds - start) % ((loop.end - loop.start) / track.sampleRate))
  );
}

/** Shared deterministic BGM state. The browser projects it; asynchronous callbacks never change the VM. */
export class BgmState {
  private value: BgmSnapshot;
  constructor(snapshot?: BgmSnapshot) {
    this.value = snapshot
      ? structuredClone(snapshot)
      : { time: 0, nextId: 1, channels: [null, null], voices: [] };
  }
  snapshot(): BgmSnapshot {
    return structuredClone(this.value);
  }
  get time() {
    return this.value.time;
  }
  get voices(): readonly BgmVoice[] {
    return this.value.voices;
  }
  private channel(channel: number) {
    if (channel !== 0 && channel !== 1)
      throw new Error("Unsupported BGM channel");
    return channel;
  }
  play(
    trackId: number,
    channel: number,
    fadeSeconds: number,
    seek: number,
    media?: BgmMedia,
  ) {
    this.channel(channel);
    const track = media?.tracks[trackId];
    if (!track) throw new Error("Missing BGM media " + trackId);
    if (
      ![fadeSeconds, seek].every((n) => Number.isFinite(n) && n >= 0) ||
      seek >= track.frames / track.sampleRate
    )
      throw new Error("Unsupported BGM fade or seek");
    const current = this.value.voices.find(
      (v) => v.id === this.value.channels[channel],
    );
    // Native PlayOnStaticChannel reuses the same track when no explicit seek was requested.
    if (current?.track === trackId && seek === 0) return current.id;
    this.stop(channel, 0.5);
    const voice: BgmVoice = {
      id: this.value.nextId++,
      track: trackId,
      started: this.time,
      seek,
      fadeIn: fadeSeconds * 1000,
      stop: null,
    };
    this.value.voices.push(voice);
    this.value.channels[channel] = voice.id;
    return voice.id;
  }
  stop(channel: number, seconds: number) {
    this.channel(channel);
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error("Unsupported BGM stop fade");
    const voice = this.value.voices.find(
      (v) => v.id === this.value.channels[channel],
    );
    if (voice)
      voice.stop = {
        at: this.time,
        duration: seconds * 1000,
        gain: bgmGain(voice, this.time),
      };
    this.value.channels[channel] = null;
    this.prune();
  }
  advance(ms: number, media?: BgmMedia) {
    if (!Number.isFinite(ms) || ms < 0)
      throw new Error("Invalid BGM elapsed time");
    this.value.time += ms;
    this.prune(media);
  }
  private prune(media?: BgmMedia) {
    this.value.voices = this.value.voices.filter((v) => {
      if (v.stop && this.time >= v.stop.at + v.stop.duration) return false;
      const track = media?.tracks[v.track];
      return (
        !track ||
        track.loop !== null ||
        v.seek + (this.time - v.started) / 1000 <
          track.frames / track.sampleRate
      );
    });
    for (const channel of [0, 1] as const)
      if (!this.value.voices.some((v) => v.id === this.value.channels[channel]))
        this.value.channels[channel] = null;
  }
}
