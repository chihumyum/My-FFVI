import type { Character } from "../field/types.js";

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
