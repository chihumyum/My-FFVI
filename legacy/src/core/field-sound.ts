import {
  checkpointInteger,
  checkpointKeys,
  checkpointNumber,
} from "./checkpoint-validation.js";
import type { FieldSoundCommand } from "./field-sound-command.js";
import { int32 } from "./script-integer.js";
import {
  audioGain,
  type AudioMedia,
  type AudioTrack,
  type AudioVoice,
} from "./static-audio.js";

export type SoundVoice = AudioVoice & { pan: number };
export type SoundSnapshot = {
  kind: "field-sound-state-v1";
  time: number;
  /** 0x80000000 is the exhausted sentinel, never a published play handle. */
  nextId: number;
  voices: SoundVoice[];
};

const maxHandle = 0x7fffffff;

function milliseconds(seconds: number): number {
  checkpointNumber(seconds);
  const value = seconds * 1000;
  checkpointNumber(value);
  return value;
}

function soundTrack(id: number, media?: AudioMedia): AudioTrack {
  if (int32(id) <= 0) throw new Error("Invalid field sound identity");
  const track = media?.tracks[id];
  if (!track) throw new Error("Missing field sound media " + id);
  checkpointInteger(track.sampleRate, 1);
  checkpointInteger(track.frames, 1);
  checkpointInteger(track.channels, 1);
  if (typeof track.file !== "string" || track.file.length === 0 ||
      typeof track.sha256 !== "string" || track.sha256.length === 0)
    throw new Error("Invalid field sound media identity");
  if (track.loop !== null) {
    checkpointKeys(track.loop, "start,end");
    checkpointInteger(track.loop.start, 0, track.frames - 1);
    checkpointInteger(track.loop.end, track.loop.start + 1, track.frames);
  }
  if (track.gain !== undefined) checkpointNumber(track.gain);
  if (track.gainRamp !== undefined && track.gainRamp !== null) {
    checkpointKeys(track.gainRamp, "from,to,durationMs");
    checkpointNumber(track.gainRamp.from);
    checkpointNumber(track.gainRamp.to);
    checkpointNumber(track.gainRamp.durationMs);
    if (track.gainRamp.durationMs === 0)
      throw new Error("Invalid field sound gain ramp duration");
  }
  return track;
}

function finished(voice: SoundVoice, time: number, track: AudioTrack): boolean {
  return (voice.stop !== null && time >= voice.stop.at + voice.stop.duration) ||
    (track.loop === null &&
      voice.seek + (time - voice.started) / 1000 >= track.frames / track.sampleRate);
}

function validateSnapshot(snapshot: SoundSnapshot, media?: AudioMedia): void {
  checkpointKeys(snapshot, "kind,time,nextId,voices");
  if (snapshot.kind !== "field-sound-state-v1")
    throw new Error("Unsupported field sound checkpoint");
  checkpointNumber(snapshot.time);
  checkpointInteger(snapshot.nextId, 1, maxHandle + 1);
  if (!Array.isArray(snapshot.voices)) throw new Error("Invalid field sound voices");
  const ids = new Set<number>();
  for (const voice of snapshot.voices) {
    checkpointKeys(voice, "id,track,started,seek,fadeIn,stop,pan");
    checkpointInteger(voice.id, 1, Math.min(maxHandle, snapshot.nextId - 1));
    if (ids.has(voice.id)) throw new Error("Duplicate field sound handle");
    ids.add(voice.id);
    const track = soundTrack(voice.track, media);
    checkpointNumber(voice.started, 0, snapshot.time);
    checkpointNumber(voice.seek);
    checkpointNumber(voice.fadeIn);
    checkpointNumber(voice.started + voice.fadeIn);
    checkpointNumber(voice.pan, -1, 1);
    if (voice.seek >= track.frames / track.sampleRate)
      throw new Error("Invalid field sound seek position");
    if (voice.stop !== null) {
      checkpointKeys(voice.stop, "at,duration,gain");
      checkpointNumber(voice.stop.at, voice.started, snapshot.time);
      checkpointNumber(voice.stop.duration);
      checkpointNumber(voice.stop.at + voice.stop.duration);
      checkpointNumber(voice.stop.gain, 0, 1);
    }
    if (finished(voice, snapshot.time, track))
      throw new Error("Finished field sound retained in checkpoint");
  }
}

/** Dynamic SE instance owner. Local handle slots belong to EventState, and
 * browser readiness/callbacks never advance this clock or finish its voices.
 * Linear gain and duration-based completion are the shared Web audio adapter;
 * they do not claim the native mixer's curve or callback timing. */
export class FieldSoundState {
  private value: SoundSnapshot = {
    kind: "field-sound-state-v1",
    time: 0,
    nextId: 1,
    voices: [],
  };

  snapshot(): SoundSnapshot { return structuredClone(this.value); }

  static restore(snapshot: SoundSnapshot, media?: AudioMedia): FieldSoundState {
    validateSnapshot(snapshot, media);
    const restored = new FieldSoundState();
    restored.value = structuredClone(snapshot);
    return restored;
  }

  get time(): number { return this.value.time; }
  get voices(): readonly SoundVoice[] { return structuredClone(this.value.voices); }

  play(command: Extract<FieldSoundCommand, { kind: "play" }>, media?: AudioMedia): number {
    checkpointKeys(command, "kind,soundId,asynchronous,handleSlot,fadeSeconds,seekSeconds,pan");
    if (command.kind !== "play" || typeof command.asynchronous !== "boolean")
      throw new Error("Invalid field sound play command");
    if (command.handleSlot !== null && int32(command.handleSlot) < 0)
      throw new Error("Invalid field sound local handle slot");
    const track = soundTrack(command.soundId, media), fadeIn = milliseconds(command.fadeSeconds);
    checkpointNumber(command.seekSeconds);
    checkpointNumber(command.pan, -1, 1);
    checkpointNumber(this.time + fadeIn);
    if (command.seekSeconds >= track.frames / track.sampleRate)
      throw new Error("Invalid field sound seek position");
    validateSnapshot(this.value, media);
    if (this.value.nextId > maxHandle) throw new Error("Field sound handle space exhausted");
    const voice: SoundVoice = {
      id: this.value.nextId,
      track: command.soundId,
      started: this.time,
      seek: command.seekSeconds,
      fadeIn,
      stop: null,
      pan: command.pan,
    };
    // No static-channel reuse: another play of the same resource is another instance.
    this.value = { ...this.value, nextId: voice.id + 1, voices: [...this.value.voices, voice] };
    return voice.id;
  }

  stop(handle: number, fadeSeconds: number): void {
    int32(handle);
    const duration = milliseconds(fadeSeconds);
    checkpointNumber(this.time + duration);
    const voice = this.value.voices.find(candidate => candidate.id === handle);
    if (!voice) return;
    // The source control layer forwards repeated Stop requests. Rebase the Web
    // adapter's fade at its present gain; do not release a ScriptLocalVariable slot.
    const stop = { at: this.time, duration, gain: audioGain(voice, this.time) };
    this.value = { ...this.value, voices: duration === 0
      ? this.value.voices.filter(candidate => candidate.id !== handle)
      : this.value.voices.map(candidate => candidate.id === handle ? { ...candidate, stop } : candidate) };
  }

  isPlaying(handle: number): boolean {
    int32(handle);
    // A stopping dynamic instance is still playing until it is Finished.
    return this.value.voices.some(voice => voice.id === handle);
  }

  advance(ms: number, media?: AudioMedia): void {
    checkpointNumber(ms);
    const time = this.time + ms;
    checkpointNumber(time);
    validateSnapshot(this.value, media);
    const voices = this.value.voices.filter(voice => !finished(voice, time, soundTrack(voice.track, media)));
    // Missing/invalid dependencies never advance time or partially expire instances.
    this.value = { ...this.value, time, voices };
  }
}
