import { FIELD_POSE } from "./actor-animation.js";
import type { Character, Direction } from "../field/types.js";

/** NPC Chara.Init looks only in its actual source direction. Every authored
 * next key is still a prerequisite: the same stopped key can advance on the
 * controller's second Look, and later playback follows the same chain. This
 * does not authorize another direction or synthesize missing source media. */
export function missingFieldNpcInitialPoses(character: Character | undefined, direction: Direction): string[] {
  const missing = new Set<string>(), visited = new Set<string>();
  let key = FIELD_POSE[direction];
  if (key === undefined) throw new Error("Unknown NPC initial direction");
  while (key && !visited.has(key)) {
    visited.add(key);
    const animation = character?.animations[key];
    if (!animation) { missing.add(key); break; }
    if (!animation.frames.length || animation.frames.some(frame => !character?.sprites[frame.sprite])) missing.add(key);
    key = animation.next;
  }
  return [...missing];
}

/** These are the poses consumed by the current four-direction field renderer. */
export function missingFieldPoses(
  character: Character | undefined,
  mounted = false,
): string[] {
  const missing = new Set<string>();
  for (const key of mounted
    ? ["Default", "WalkB", "RideL", "RideR"]
    : ["Default", "WalkB", "WalkL", "WalkR"]) {
    const animation = character?.animations[key];
    if (!animation) {
      missing.add(key);
      continue;
    }
    for (const name of [key, ...(animation.next ? [animation.next] : [])]) {
      const a = character?.animations[name];
      if (
        !a ||
        !a.frames.length ||
        a.frames.some((f) => !character?.sprites[f.sprite])
      )
        missing.add(name);
    }
  }
  return [...missing];
}
