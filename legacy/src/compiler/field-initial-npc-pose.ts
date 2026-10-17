import { ActorAnimation } from "../core/actor-animation.js";
import { missingFieldNpcInitialPoses, missingFieldPoses } from "../core/character-media.js";
import type { Character, EntityGroup, FieldEntity } from "../field/types.js";

/** The legacy branch exists only to reconstruct pinned previous diagnostics.
 * It grants no runtime permission; actor creation and every later operation
 * retain their own source controller, direction and animation checks. */
export function compileFieldEntityPoseBlockers(entities: readonly FieldEntity[],
  characters: Readonly<Record<string, Character>>,
  npcContract: "source-initial-direction-v1" | "legacy-four-directions-v1" = "source-initial-direction-v1",
): EntityGroup["blockers"] {
  if (!["source-initial-direction-v1", "legacy-four-directions-v1"].includes(npcContract))
    throw new Error("Unknown NPC initial pose contract");
  const blockers: EntityGroup["blockers"] = [];
  for (const entity of entities) {
    if (!entity.asset) continue;
    const character = characters[entity.asset], npc = entity.kind === 6 || entity.kind === 17;
    if (npc && npcContract === "source-initial-direction-v1" && entity.direction === null) {
      blockers.push({ reason: "Invalid NPC initial pose " + entity.asset + ": Missing source direction", source: entity.source });
      continue;
    }
    const keys = entity.kind === 10 ? (character?.animations.Default ? [] : ["Default"])
      : npc && npcContract === "source-initial-direction-v1" ? missingFieldNpcInitialPoses(character, entity.direction!)
      : missingFieldPoses(character);
    for (const key of keys) blockers.push({ reason: `Missing character pose ${entity.asset}/${key}`, source: entity.source });
    if (npc && npcContract === "source-initial-direction-v1" && !keys.length && character) {
      try {
        const animation = new ActorAnimation(character);
        animation.look(entity.direction!);
        if (entity.npc?.turnAround) animation.look(entity.direction!);
      } catch (error) {
        blockers.push({ reason: "Invalid NPC initial pose " + entity.asset + ": " +
          (error instanceof Error ? error.message : String(error)), source: entity.source });
      }
    }
  }
  return blockers;
}
