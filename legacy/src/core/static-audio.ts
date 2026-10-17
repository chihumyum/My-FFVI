import type { Evidence } from "../field/types.js";
import {
  checkpointKeys,
  checkpointInteger,
  checkpointNumber,
} from "./checkpoint-validation.js";

export type AudioTrack = {
  file: string;
  sha256: string;
  sampleRate: number;
  frames: number;
  channels: number;
  loop: { start: number; end: number } | null;
  gain?: number;
  gainRamp?: { from: number; to: number; durationMs: number } | null;
  source: Evidence;
  tableSource: Evidence;
};
export type AudioMedia = {
  sourceSetHash: string;
  tracks: Record<string, AudioTrack>;
};
export type AudioVoice = {
  id: number;
  track: number;
  started: number;
  seek: number;
  fadeIn: number;
  stop: { at: number; duration: number; gain: number } | null;
  pause?: { at: number; duration: number; gain: number };
  resumeEnvelope?: { at: number; duration: number; from: number };
};
export type AudioSnapshot = {
  time: number;
  nextId: number;
  channels: [number | null, number | null];
  voices: AudioVoice[];
  formatVersion?: 2;
  policy?: "web-static-audio-control-v1";
};
export type StaticAudioReplay = Readonly<{ kind: "static-audio-replay-v1"; track: number; channel: number; fade: number }>;
/** Suspension fades before freezing the voice's own sample clock. Other
 * channels and the owning field clock continue; this is an explicit Web policy. */
function voiceTime(voice: AudioVoice, time: number): number {
  return voice.pause ? Math.min(time, voice.pause.at + voice.pause.duration) : time;
}
export function audioVoicePlaying(voice: AudioVoice, time: number): boolean {
  return !voice.pause || time < voice.pause.at + voice.pause.duration;
}
export function audioGain(
  voice: AudioVoice,
  time: number,
  track?: AudioTrack,
): number {
  const elapsed = Math.max(0, voiceTime(voice, time) - voice.started);
  const ramp = track?.gainRamp;
  const assetGain =
    (track?.gain ?? 1) *
    (ramp
      ? ramp.from +
        (ramp.to - ramp.from) * Math.min(1, elapsed / ramp.durationMs)
      : 1);
  if (voice.stop)
    return voice.stop.duration === 0
      ? 0
      : assetGain *
          voice.stop.gain *
          Math.max(0, 1 - (time - voice.stop.at) / voice.stop.duration);
  if (voice.pause && time >= voice.pause.at)
    return voice.pause.duration === 0 ? 0 : voice.pause.gain * Math.max(0, 1 - (time - voice.pause.at) / voice.pause.duration);
  const resumed = voice.resumeEnvelope;
  const multiplier = resumed ? resumed.from + (1 - resumed.from) *
    (resumed.duration === 0 ? 1 : Math.min(1, Math.max(0, time - resumed.at) / resumed.duration)) : 1;
  return assetGain * (voice.fadeIn === 0 ? 1 : Math.min(1, elapsed / voice.fadeIn)) * multiplier;
}
export function audioPosition(
  voice: AudioVoice,
  time: number,
  track: AudioTrack,
): number {
  const seconds = voice.seek + (voiceTime(voice, time) - voice.started) / 1000;
  const loop = track.loop;
  if (!loop || seconds < loop.end / track.sampleRate) return seconds;
  const start = loop.start / track.sampleRate;
  return (
    start + ((seconds - start) % ((loop.end - loop.start) / track.sampleRate))
  );
}

/** Shared deterministic static-channel audio state. The browser projects it; asynchronous callbacks never change the VM. */
export class StaticAudioState {
  private value: AudioSnapshot;
  private generations = [0, 0];
  private replays = new WeakMap<StaticAudioReplay, { generation: number; at: number; consumed: boolean }>();
  constructor(snapshot?: AudioSnapshot) {
    this.value = snapshot
      ? structuredClone(snapshot)
      : { time: 0, nextId: 1, channels: [null, null], voices: [] };
  }
  snapshot(): AudioSnapshot {
    return structuredClone(this.value);
  }
  static restore(
    snapshot: AudioSnapshot,
    media?: AudioMedia,
  ): StaticAudioState {
    const controlled = snapshot.formatVersion !== undefined || snapshot.policy !== undefined;
    checkpointKeys(snapshot, "time,nextId,channels,voices" + (controlled ? ",formatVersion,policy" : ""));
    if (controlled && (snapshot.formatVersion !== 2 || snapshot.policy !== "web-static-audio-control-v1"))
      throw new Error("Unsupported static audio control policy");
    checkpointNumber(snapshot.time);
    checkpointInteger(snapshot.nextId, 1);
    if (
      !Array.isArray(snapshot.channels) ||
      snapshot.channels.length !== 2 ||
      !Array.isArray(snapshot.voices)
    )
      throw new Error("Invalid audio checkpoint");
    const ids = new Set<number>();
    for (const voice of snapshot.voices) {
      checkpointKeys(voice, "id,track,started,seek,fadeIn,stop" +
        (voice.pause !== undefined ? ",pause" : "") + (voice.resumeEnvelope !== undefined ? ",resumeEnvelope" : ""));
      if (!controlled && (voice.pause !== undefined || voice.resumeEnvelope !== undefined))
        throw new Error("Undeclared static audio control state");
      checkpointInteger(voice.id, 1, snapshot.nextId - 1);
      checkpointInteger(voice.track, 0, 0x7fffffff);
      const track = media?.tracks[voice.track];
      if (!track || ids.has(voice.id))
        throw new Error("Missing or duplicate saved audio dependency");
      ids.add(voice.id);
      checkpointNumber(voice.started, 0, snapshot.time);
      checkpointNumber(voice.seek);
      checkpointNumber(voice.fadeIn);
      if (voice.pause) {
        checkpointKeys(voice.pause, "at,duration,gain");
        checkpointNumber(voice.pause.at, voice.started, snapshot.time);
        checkpointNumber(voice.pause.duration); checkpointNumber(voice.pause.gain);
      }
      if (voice.resumeEnvelope) {
        checkpointKeys(voice.resumeEnvelope, "at,duration,from");
        checkpointNumber(voice.resumeEnvelope.at, voice.started, snapshot.time);
        checkpointNumber(voice.resumeEnvelope.duration); checkpointNumber(voice.resumeEnvelope.from, 0, 1);
      }
      if (voice.seek >= track.frames / track.sampleRate)
        throw new Error("Invalid saved audio position");
      if (voice.stop !== null) {
        checkpointKeys(voice.stop, "at,duration,gain");
        checkpointNumber(voice.stop.at, voice.started, snapshot.time);
        checkpointNumber(voice.stop.duration);
        checkpointNumber(voice.stop.gain);
      }
    }
    for (const id of snapshot.channels) {
      if (id === null) continue;
      checkpointInteger(id, 1);
      if (!snapshot.voices.some((v) => v.id === id && v.stop === null))
        throw new Error("Missing saved audio channel voice");
    }
    const channels = snapshot.channels.filter((id) => id !== null);
    if (new Set(channels).size !== channels.length)
      throw new Error("Aliased saved audio channels");
    return new StaticAudioState(snapshot);
  }
  get time() {
    return this.value.time;
  }
  get voices(): readonly AudioVoice[] {
    return this.value.voices;
  }
  private channel(channel: number) {
    if (channel !== 0 && channel !== 1)
      throw new Error("Unsupported audio channel");
    return channel;
  }
  play(
    trackId: number,
    channel: number,
    fadeSeconds: number,
    seek: number,
    media?: AudioMedia,
  ) {
    this.channel(channel);
    const track = media?.tracks[trackId];
    if (!track) throw new Error("Missing audio media " + trackId);
    if (
      ![fadeSeconds, seek].every((n) => Number.isFinite(n) && n >= 0) ||
      seek >= track.frames / track.sampleRate
    )
      throw new Error("Unsupported audio fade or seek");
    const current = this.value.voices.find(
      (v) => v.id === this.value.channels[channel],
    );
    // Native PlayOnStaticChannel reuses the same track when no explicit seek was requested.
    if (current?.track === trackId && seek === 0) {
      if (current.pause) this.pause(channel, false, fadeSeconds, media);
      return current.id;
    }
    this.stop(channel, 0.5);
    const voice: AudioVoice = {
      id: this.value.nextId++,
      track: trackId,
      started: this.time,
      seek,
      fadeIn: fadeSeconds * 1000,
      stop: null,
    };
    this.value.voices.push(voice);
    this.value.channels[channel] = voice.id;
    this.generations[channel]!++;
    return voice.id;
  }
  stop(channel: number, seconds: number) {
    this.channel(channel);
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error("Unsupported audio stop fade");
    const voice = this.value.voices.find(
      (v) => v.id === this.value.channels[channel],
    );
    if (voice)
      voice.stop = {
        at: this.time,
        duration: seconds * 1000,
        gain: audioGain(voice, this.time),
      };
    this.value.channels[channel] = null;
    this.generations[channel]!++;
    this.prune();
  }
  /** PauseBGM is a bool-controlled suspend/resume operation, not a wait flag. */
  pause(channel: number, paused: boolean, seconds: number, media?: AudioMedia): number | null {
    this.channel(channel);
    if (typeof paused !== "boolean" || !Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(seconds * 1000))
      throw new Error("Unsupported audio pause request");
    const voice = this.value.voices.find(v => v.id === this.value.channels[channel]);
    if (!voice) { this.generations[channel]!++; return null; }
    const track = media?.tracks[voice.track];
    if (!track) throw new Error("Missing audio media " + voice.track);
    if (paused === (voice.pause !== undefined)) return voice.id;
    this.value.formatVersion = 2; this.value.policy = "web-static-audio-control-v1";
    if (paused) {
      const gain = audioGain(voice, this.time, track);
      voice.pause = { at: this.time, duration: seconds * 1000, gain };
    } else {
      const suspended = voice.pause!, gain = audioGain(voice, this.time, track);
      voice.started += Math.max(0, this.time - suspended.at - suspended.duration);
      delete voice.pause; delete voice.resumeEnvelope;
      const base = audioGain(voice, this.time, track);
      voice.resumeEnvelope = { at: this.time, duration: seconds * 1000, from: base === 0 ? 0 : Math.min(1, gain / base) };
    }
    this.generations[channel]!++;
    return voice.id;
  }
  /** ReplayBgm stops the primary channel at its first clock and starts from
   * seek zero at the following clock. The bounded handle belongs to this bus;
   * it is not another owner, a saved instruction, or a media authority. */
  beginReplay(channel: number, seconds: number, media?: AudioMedia): StaticAudioReplay | null {
    this.channel(channel);
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(seconds * 1000))
      throw new Error("Unsupported audio replay fade");
    const voice = this.value.voices.find(v => v.id === this.value.channels[channel]);
    if (!voice) return null;
    if (!media?.tracks[voice.track]) throw new Error("Missing audio media " + voice.track);
    const token = Object.freeze({ kind: "static-audio-replay-v1" as const, track: voice.track, channel, fade: seconds });
    this.value.formatVersion = 2; this.value.policy = "web-static-audio-control-v1";
    this.stop(channel, 0);
    this.replays.set(token, { generation: this.generations[channel]!, at: this.time, consumed: false });
    return token;
  }
  finishReplay(token: StaticAudioReplay, media?: AudioMedia): number {
    const bound = this.replays.get(token);
    if (!bound || bound.consumed || bound.generation !== this.generations[token.channel])
      throw new Error("Stale or consumed audio replay");
    if (this.time <= bound.at) throw new Error("Audio replay requires the following logical clock");
    // play validates the media before touching the channel. A failed load can
    // be retried with the same handle without a second stop or consumed ID.
    const id = this.play(token.track, token.channel, token.fade, 0, media);
    bound.consumed = true;
    return id;
  }
  advance(ms: number, media?: AudioMedia) {
    if (!Number.isFinite(ms) || ms < 0)
      throw new Error("Invalid audio elapsed time");
    this.value.time += ms;
    this.prune(media);
  }
  private prune(media?: AudioMedia) {
    this.value.voices = this.value.voices.filter((v) => {
      if (v.stop && this.time >= v.stop.at + v.stop.duration) return false;
      const track = media?.tracks[v.track];
      return (
        !track ||
        track.loop !== null ||
        v.seek + (voiceTime(v, this.time) - v.started) / 1000 <
          track.frames / track.sampleRate
      );
    });
    for (const channel of [0, 1] as const)
      if (!this.value.voices.some((v) => v.id === this.value.channels[channel]))
        this.value.channels[channel] = null;
  }
}
