import type {
  AudioMedia,
  AudioTrack,
  StaticAudioState,
} from "./static-audio.js";
import { int32 } from "./script-integer.js";

export type AudioReadinessOp =
  { kind: "bgm-ready"; track: number } | { kind: "bgm-sync"; channel: 0 | 1 };

/** Read-only observation of a source-bound, verified and decoded asset. Loading
 * belongs to the host's preparation path, never to this polling instruction. */
export type AudioReadinessPort = {
  isReady(track: AudioTrack): boolean;
};

export function audioReadinessTrack(
  trackId: number,
  media?: AudioMedia,
): AudioTrack {
  if (int32(trackId) <= 0) throw new Error("Invalid BGM readiness identity");
  const track = media?.tracks[trackId];
  if (!track) throw new Error("Missing BGM readiness media " + trackId);
  return structuredClone(track);
}

/** PollingCommon returns Next immediately for a true predicate and Repeat for
 * false. It neither starts a voice nor retains a voice identity across polls. */
export function pollAudioReadiness(
  op: AudioReadinessOp,
  bgm: StaticAudioState,
  media?: AudioMedia,
  port?: AudioReadinessPort,
): "next" | "wait" {
  if (op.kind === "bgm-ready") {
    const track = audioReadinessTrack(op.track, media);
    if (!port || typeof port.isReady !== "function")
      throw new Error("Missing BGM resource readiness provider");
    const ready = port.isReady(track);
    if (typeof ready !== "boolean")
      throw new Error("Invalid BGM resource readiness observation");
    return ready ? "next" : "wait";
  }
  if (op.kind !== "bgm-sync" || (op.channel !== 0 && op.channel !== 1))
    throw new Error("Unsupported BGM synchronization channel");
  const snapshot = bgm.snapshot(),
    id = snapshot.channels[op.channel];
  if (id === null) return "next";
  const voice = snapshot.voices.find((candidate) => candidate.id === id);
  if (!voice || voice.stop !== null)
    throw new Error("Invalid BGM synchronization channel ownership");
  audioReadinessTrack(voice.track, media);
  // The deterministic audio owner removes a finished voice from its channel.
  // Loading and pause are not Finished; detached fade tails are not this slot.
  // Do not inspect the browser clock or duplicate the owner's lifetime rules.
  return "wait";
}
