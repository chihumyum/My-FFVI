import { z } from "zod";
import type { NpcProperties } from "../field/types.js";
import { compileInteraction } from "./interaction.js";

const bool = (value: unknown) => z.boolean().parse(value ?? false);

/** Native Wait controller; other controllers stay explicit blockers. */
export function compileNpc(
  p: Record<string, unknown>,
  script: string | null,
  tables: Record<string, unknown>,
  messages: Record<string, unknown>,
): { npc: NpcProperties; blockers: string[] } {
  const { properties, blockers: interactionBlockers } = compileInteraction(
    p,
    script,
    tables,
    messages,
  );
  const blockers: string[] = [];
  const moveType = z
    .number()
    .int()
    .parse(p.move_type ?? 0);
  if (moveType !== 0)
    blockers.push("Unsupported NPC movement controller " + moveType);
  if (bool(p.all_layers) || bool(p.birdview_puppet))
    blockers.push("Unsupported cross-layer or birdview NPC");
  if (bool(p.affected)) blockers.push("Unsupported NPC screen-effect stencil");
  blockers.push(
    ...interactionBlockers.map((reason) =>
      reason === "Unsupported contact encounter"
        ? "Unsupported NPC contact encounter"
        : reason.replace(
            /^Unsupported interaction:/,
            "Unsupported actor interaction:",
          ),
    ),
  );
  // Wait.HitPlayer is an empty native method. Pushed/route/idling properties do not make it wander.
  return {
    npc: {
      ...properties,
      moveType,
      collision: z.boolean().parse(p.collision ?? true),
      pushed: bool(p.pushed),
      eyeContact: bool(p.eye_contact),
      turnAround: bool(p.turn_around),
    },
    blockers,
  };
}
