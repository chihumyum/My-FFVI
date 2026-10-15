import { sourceCustomAnimationAt, sourceCustomAnimationByName, projectSourceCustomAnimation,
  type SourceActorAnimationAuthority, type SourceCustomAnimationRef } from "./source-script-animations.js";
import { canonical } from "./canonical.js";
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
  /** References only; frames and resource URLs come from trusted content. */
  sourceCustomCache?: { kind: "source-actor-custom-animation-cache-v1"; catalogHash: string;
    entries: { name: string; ref: SourceCustomAnimationRef }[] };
};
const f = Math.fround;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Source SpriteAnimLastFieldEntity semantics; seconds and arithmetic are float32.
 * No renderer, shared mutable animation asset, or wall-clock dependency.
 */
export class ActorAnimation {
  private state: ActorPlayback | null = null;
  private customAuthority: SourceActorAnimationAuthority | null = null;
  private custom = new Map<string, { ref: SourceCustomAnimationRef; animation: Animation }>();
  constructor(readonly character: Character) {}

  clone(): ActorAnimation {
    const copy = new ActorAnimation(this.character);
    copy.state = this.state && { ...this.state };
    copy.customAuthority = this.customAuthority;
    copy.custom = new Map(this.custom);
    return copy;
  }
  snapshot(): Readonly<ActorPlayback> | null {
    if (!this.state && this.custom.size) throw new Error("Custom animation cache has no stable playback state");
    return this.state && { ...this.state, ...(this.custom.size ? { sourceCustomCache: {
      kind: "source-actor-custom-animation-cache-v1" as const, catalogHash: this.customAuthority!.catalog.contentHash,
      entries: [...this.custom].map(([name, value]) => ({ name, ref: { ...value.ref } })),
    } } : {}) };
  }
  /** Selective source materialization is prepared on a cloned owner together
   * with playback. An uncompiled base key must never become a custom override. */
  prepareSourceCustomKey(key: string, currentAsset: string | null, authority: SourceActorAnimationAuthority): void {
    if (!Object.keys(this.character.animations).length)
      throw new Error("Source custom animation requires a verified ordinary base sprite projection");
    if (!Array.isArray(authority.baseKeys) || authority.baseKeys.some(k => typeof k !== "string" || !k) ||
        new Set(authority.baseKeys).size !== authority.baseKeys.length ||
        Object.keys(this.character.animations).some(k => !authority.baseKeys.includes(k)))
      throw new Error("Source custom animation lacks the complete actual base namespace");
    if (this.customAuthority && (this.customAuthority.catalog.contentHash !== authority.catalog.contentHash ||
        canonical(this.customAuthority.baseKeys) !== canonical(authority.baseKeys)))
      throw new Error("Actual actor custom animation authority changed");
    if (Object.hasOwn(this.character.animations, key)) return;
    if (authority.baseKeys.includes(key)) throw new Error("Uncompiled native base animation cannot use a source custom override: " + key);
    if (this.custom.has(key)) return;
    if (currentAsset === null) throw new Error("Current source custom animation asset is unavailable");
    const ref = sourceCustomAnimationByName(authority.catalog, currentAsset, key);
    if (!ref) throw new Error("Source custom animation key is unavailable: " + key);
    const animation = projectSourceCustomAnimation(sourceCustomAnimationAt(authority.catalog, ref), this.character.sprites);
    this.customAuthority = { catalog: authority.catalog, baseKeys: [...authority.baseKeys] };
    this.custom.set(key, { ref, animation });
  }
  /** Validate a detached candidate from this already trusted live component.
   * Unlike restore(save), this carries only the authority held by this exact
   * existing instance; replacement assets must create a new component. */
  validatedClone(): ActorAnimation {
    const next = new ActorAnimation(this.character);
    next.restore(this.snapshot(), this.customAuthority ?? undefined);
    return next;
  }
  restore(snapshot: ActorPlayback | null, authority?: SourceActorAnimationAuthority): void {
    if (snapshot === null) {
      if (this.custom.size) throw new Error("Cannot discard an existing custom animation cache by a null playback restore");
      this.state = null;
      return;
    }
    const cached = Object.hasOwn(snapshot, "sourceCustomCache");
    checkpointKeys(snapshot, "key,mode,elapsed,duration,flip,playing,loops" + (cached ? ",sourceCustomCache" : ""));
    const prepared = new ActorAnimation(this.character);
    if (cached) {
      const saved = snapshot.sourceCustomCache;
      if (!saved || !authority) throw new Error("Saved custom animation cache requires trusted source content");
      checkpointKeys(saved, "kind,catalogHash,entries");
      if (saved.kind !== "source-actor-custom-animation-cache-v1" || saved.catalogHash !== authority.catalog.contentHash ||
          !Array.isArray(saved.entries) || !saved.entries.length || Reflect.ownKeys(saved.entries).length !== saved.entries.length + 1) throw new Error("Changed saved custom animation catalog");
      for (const row of Array.from(saved.entries)) {
        checkpointKeys(row, "name,ref");
        if (typeof row.name !== "string" || prepared.custom.has(row.name)) throw new Error("Duplicate saved custom animation key");
        const raw = sourceCustomAnimationAt(authority.catalog, row.ref), first = sourceCustomAnimationByName(authority.catalog, row.ref.assetId, row.name);
        if (raw.name !== row.name || first?.index !== row.ref.index || authority.baseKeys.includes(row.name))
          throw new Error("Saved custom animation namespace/first-match identity changed");
        prepared.prepareSourceCustomKey(row.name, row.ref.assetId, authority);
      }
    }
    // Validate the whole candidate before changing this playback/cache owner.
    prepared.restorePlayback(snapshot);
    this.state = prepared.state; this.custom = prepared.custom; this.customAuthority = prepared.customAuthority;
  }
  private restorePlayback(snapshot: ActorPlayback): void {
    if (typeof snapshot.key !== "string")
      throw new Error("Invalid saved actor animation key");
    this.chain(snapshot.key);
    this.animation(snapshot.key);
    checkpointInteger(snapshot.loops);
    checkpointNumber(snapshot.elapsed);
    checkpointNumber(snapshot.duration, this.zeroCustom(snapshot.key) ? 0 : Number.MIN_VALUE);
    if (
      ![0, 1, 3].includes(snapshot.mode) ||
      typeof snapshot.flip !== "boolean" ||
      typeof snapshot.playing !== "boolean" ||
      f(snapshot.duration) !== snapshot.duration ||
      f(snapshot.elapsed) !== snapshot.elapsed
    )
      throw new Error("Invalid actor animation checkpoint");
    const { sourceCustomCache: ignored, ...playback } = snapshot;
    this.state = { ...playback };
  }
  get hasSourceCustomAnimations(): boolean { return this.custom.size > 0; }
  get playing(): boolean {
    return this.state?.playing ?? false;
  }

  private animation(key: string): Animation {
    const a = Object.hasOwn(this.character.animations,key) ? this.character.animations[key] : this.custom.get(key)?.animation;
    if (!a) throw new Error(`Missing actor animation ${key}`);
    if (
      !a.frames.length ||
      !Number.isFinite(f(a.duration)) ||
      (f(a.duration) < 0 || f(a.duration) === 0 && !this.zeroCustom(key))
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
  private zeroCustom(key: string): boolean {
    return !Object.hasOwn(this.character.animations, key) && this.custom.get(key)?.animation.duration === 0;
  }
  private baseAnimation(key: string): Animation {
    if (!Object.hasOwn(this.character.animations, key)) throw new Error("Missing actor animation " + key + " in source base namespace");
    return this.animation(key);
  }
  private chain(key: string): void {
    const visited = new Set<string>();
    let first = true;
    while (key && !visited.has(key)) {
      visited.add(key);
      key = (first ? this.animation(key) : this.baseAnimation(key)).next;
      first = false;
    }
  }
  private start(key: string, mode: number | null, scale: number): void {
    this.chain(key);
    let a = this.animation(key);
    // SetupAnimCommon alternates only when the requested key is the current asset's name.
    if (this.state?.key === key && a.next) {
      key = a.next;
      a = this.baseAnimation(key);
    }
    const duration = f(f(a.duration) * f(scale));
    if (!Number.isFinite(duration) || duration < 0 || duration === 0 && !this.zeroCustom(key))
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
  /** Source PlayByPlayMode keeps the authored mode, on this same clock. */
  playSource(key: string): void { this.start(key, null, 1); }
  /** Entity PlayAnimation with a null time scale, without Puppet's preceding Cue. */
  playEntity(key: string, loop: boolean): void {
    this.start(key, loop ? 1 : 0, 1);
  }
  /** A later Puppet repeat invokes Entity.PlayAnimation directly, without
   * repeating the first-clock Cue(-1). The same actor owns all playback. */
  replayEntity(key: string, speed: number): void {
    speed = f(speed);
    const scale = f(1 / speed);
    if (!(speed > 0) || !Number.isFinite(speed) || !(scale > 0) || !Number.isFinite(scale))
      throw new Error("Invalid actor animation repeat speed");
    const next = this.clone();
    next.start(key, 0, scale);
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
  move(direction: Direction, secondsPerCell: number, animationKey?: string): void {
    if (!Number.isFinite(secondsPerCell) || secondsPerCell <= 0)
      throw new Error("Invalid actor movement animation speed");
    const key = animationKey ?? FIELD_POSE[direction];
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
    const next = this.baseAnimation(a.next);
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
      s.duration === 0 ? 0 : Math.floor(f(f(s.elapsed / s.duration) * a.frames.length)),
    );
    const frame = a.frames[index]!;
    return { ...frame, flip: frame.flip !== s.flip };
  }
}
