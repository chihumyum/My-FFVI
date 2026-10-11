import type { Animation, Character, Direction, Frame } from "../field/types.js";
import {
  checkpointKeys,
  checkpointInteger,
  checkpointNumber,
} from "./checkpoint-validation.js";

export const FIELD_POSE: Record<Direction, string> = {
  up: "WalkB",
  right: "WalkR",
  down: "Default",
  left: "WalkL",
};
export type ActorPlayback = {
  key: string;
  mode: number;
  elapsed: number;
  duration: number;
  flip: boolean;
  playing: boolean;
  loops: number;
};
const f = Math.fround;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Source SpriteAnimLastFieldEntity semantics; seconds and arithmetic are float32.
 * No renderer, shared mutable animation asset, or wall-clock dependency.
 */
export class ActorAnimation {
  private state: ActorPlayback | null = null;
  constructor(readonly character: Character) {}

  clone(): ActorAnimation {
    const copy = new ActorAnimation(this.character);
    copy.state = this.state && { ...this.state };
    return copy;
  }
  snapshot(): Readonly<ActorPlayback> | null {
    return this.state && { ...this.state };
  }
  restore(snapshot: ActorPlayback | null): void {
    if (snapshot === null) {
      this.state = null;
      return;
    }
    checkpointKeys(snapshot, "key,mode,elapsed,duration,flip,playing,loops");
    if (typeof snapshot.key !== "string")
      throw new Error("Invalid saved actor animation key");
    this.chain(snapshot.key);
    this.animation(snapshot.key);
    checkpointInteger(snapshot.loops);
    checkpointNumber(snapshot.elapsed);
    checkpointNumber(snapshot.duration, Number.MIN_VALUE);
    if (
      ![0, 1, 3].includes(snapshot.mode) ||
      typeof snapshot.flip !== "boolean" ||
      typeof snapshot.playing !== "boolean" ||
      f(snapshot.duration) !== snapshot.duration ||
      f(snapshot.elapsed) !== snapshot.elapsed
    )
      throw new Error("Invalid actor animation checkpoint");
    this.state = { ...snapshot };
  }
  get playing(): boolean {
    return this.state?.playing ?? false;
  }

  private animation(key: string): Animation {
    const a = this.character.animations[key];
    if (!a) throw new Error(`Missing actor animation ${key}`);
    if (
      !a.frames.length ||
      !Number.isFinite(f(a.duration)) ||
      f(a.duration) <= 0
    )
      throw new Error(`Invalid actor animation duration/frames ${key}`);
    if (![0, 1, 3].includes(a.mode))
      throw new Error(`Unsupported actor animation mode ${a.mode}: ${key}`);
    const first = a.frames[0]!;
    for (const frame of a.frames) {
      if (!this.character.sprites[frame.sprite])
        throw new Error(
          `Missing actor animation sprite ${key}/${frame.sprite}`,
        );
      if (
        ![frame.x, frame.y, frame.alpha].every(Number.isFinite) ||
        frame.alpha < 0 ||
        frame.alpha > 1
      )
        throw new Error(`Invalid actor animation frame ${key}`);
      // Native ReflectFrameData interpolates alpha. Its interpolation needs a separate recovery.
      if (frame.alpha !== first.alpha)
        throw new Error(
          `Unsupported actor animation alpha interpolation ${key}`,
        );
    }
    return a;
  }
  private chain(key: string): void {
    const visited = new Set<string>();
    while (key && !visited.has(key)) {
      visited.add(key);
      key = this.animation(key).next;
    }
  }
  private start(key: string, mode: number | null, scale: number): void {
    this.chain(key);
    let a = this.animation(key);
    // SetupAnimCommon alternates only when the requested key is the current asset's name.
    if (this.state?.key === key && a.next) {
      key = a.next;
      a = this.animation(key);
    }
    const duration = f(f(a.duration) * f(scale));
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Invalid scaled actor animation duration");
    this.state = {
      key,
      mode: mode ?? a.mode,
      duration,
      elapsed: 0,
      flip: a.flip,
      playing: true,
      loops: 0,
    };
  }
  cue(key: string, position: number): void {
    if (!Number.isFinite(f(position)))
      throw new Error("Invalid actor animation cue");
    this.start(key, 0, 1);
    this.stop(position < 0 ? 1 : position);
  }
  /** Puppet first cues the requested animation at -1, then plays it. */
  play(key: string, loop: boolean, speed: number): void {
    speed = f(speed);
    const scale = f(1 / speed);
    if (
      !(speed > 0) ||
      !Number.isFinite(speed) ||
      !(scale > 0) ||
      !Number.isFinite(scale)
    )
      throw new Error("Invalid actor animation speed");
    // Commit both source calls together, so an invalid second selection leaves the actor unchanged.
    const next = this.clone();
    next.cue(key, -1);
    next.start(key, loop ? 1 : 0, scale);
    this.state = next.state;
  }
  stop(position = 1): void {
    if (!Number.isFinite(f(position)))
      throw new Error("Invalid actor animation stop");
    if (!this.state?.playing) return;
    this.state.playing = false;
    this.state.elapsed = f(this.state.duration * clamp(f(position)));
  }
  private same(key: string): boolean {
    return (
      !!this.state &&
      (this.state.key === key || this.animation(this.state.key).next === key)
    );
  }
  look(direction: Direction): void {
    const key = FIELD_POSE[direction];
    if (this.same(key) && this.playing) return;
    this.cue(key, -1);
  }
  move(direction: Direction, secondsPerCell: number): void {
    if (!Number.isFinite(secondsPerCell) || secondsPerCell <= 0)
      throw new Error("Invalid actor movement animation speed");
    const key = FIELD_POSE[direction];
    const scale = f(Math.max(1, f(f(secondsPerCell) / f(0.48))));
    if (!Number.isFinite(scale))
      throw new Error("Invalid actor movement animation speed");
    if (this.same(key) && this.state?.playing) {
      const duration = f(f(this.animation(this.state.key).duration) * scale);
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error("Invalid scaled actor animation duration");
      this.state.duration = duration;
    } else this.start(key, null, scale);
  }
  private next(): void {
    const s = this.state!;
    const a = this.animation(s.key);
    if (!a.next) return;
    const next = this.animation(a.next);
    const duration = f(f(s.duration / f(a.duration)) * f(next.duration));
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Invalid next actor animation duration");
    s.duration = duration;
    if (s.flip === a.flip) s.flip = next.flip;
    if (s.mode === a.mode) s.mode = next.mode;
    s.key = a.next;
  }
  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0)
      throw new Error("Invalid actor animation elapsed time");
    const s = this.state;
    if (!s?.playing || s.mode === 3) return;
    s.elapsed = f(s.elapsed + f(milliseconds / 1000));
    // Native completion is strictly greater, with at most one loop transition per update.
    if (s.elapsed > s.duration) {
      if (s.mode === 0) this.stop();
      else {
        s.elapsed = f(s.elapsed - s.duration);
        this.next();
        s.loops++;
      }
    }
  }
  linkToMovement(progress: number): void {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1)
      throw new Error("Invalid actor movement progress");
    const s = this.state;
    if (!s?.playing || s.mode !== 3) return;
    const scale = Math.max(
      1,
      f(s.duration / f(this.animation(s.key).duration)),
    );
    let elapsed = f(f(s.duration * f(progress)) * scale);
    if (!Number.isFinite(elapsed))
      throw new Error("Invalid actor movement animation time");
    while (elapsed > s.duration) {
      const next = f(elapsed - s.duration);
      if (next === elapsed)
        throw new Error("Actor movement animation time cannot advance");
      elapsed = next;
    }
    if (elapsed < s.elapsed) this.next();
    s.elapsed = elapsed;
  }
  frame(): Frame {
    const s = this.state;
    if (!s) throw new Error("Actor animation has not been selected");
    const a = this.animation(s.key);
    const index = Math.min(
      a.frames.length - 1,
      Math.floor(f(f(s.elapsed / s.duration) * a.frames.length)),
    );
    const frame = a.frames[index]!;
    return { ...frame, flip: frame.flip !== s.flip };
  }
}
