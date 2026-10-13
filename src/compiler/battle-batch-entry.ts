import { z } from "zod";
import { hash } from "./content.js";
import type { SourceBattleEncounter } from "./battle-encounters.js";
import { createBattleFormationPlan } from "../core/battle-formations.js";
import type { BattleEncounterRuntimeInput } from "./battle-encounter-runtime.js";

const identity = z.number().int().positive().max(0x7fffffff);
const label = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const omission = z.object({ id: identity, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1) }).strict();
const policy = z.object({ kind: z.literal("framework-battle-batch-entry-v1"), id: label,
  formations: z.object({ kind: z.literal("framework-battle-formations-v1"), id: label,
    weights: z.tuple(Array.from({ length: 6 }, () => z.number().int().min(0).max(0xffffffff)) as
      [z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber]) }).strict(),
  scripts: z.array(omission), flagGroups: z.array(omission),
}).strict();
export type BattleBatchEntryPolicy = z.infer<typeof policy>;

/** Authored entry only. A digest binds each omission to complete source data;
 * this policy never grants execution of the omitted source script or flags. */
export function parseBattleBatchEntryPolicy(raw: unknown): BattleBatchEntryPolicy {
  const parsed = policy.parse(raw);
  for (const entries of [parsed.scripts, parsed.flagGroups])
    if (new Set(entries.map(entry => entry.id)).size !== entries.length)
      throw new Error("Duplicate battle batch entry omission");
  // The existing common formation contract owns allowed columns and weights.
  createBattleFormationPlan([1, 1, 1, 1, 1, 1], parsed.formations);
  return structuredClone(parsed);
}

/** Resolve against the actual selected descriptors before any catalog publish.
 * A missing, unused, conflicting or changed binding fails the whole batch. */
export function compileBattleBatchEntryPolicy(raw: unknown,
  encounters: readonly Pick<SourceBattleEncounter, "patterns" | "metadata" | "script">[],
): BattleEncounterRuntimeInput["development"] {
  const parsed = parseBattleBatchEntryPolicy(raw);
  const bind = <T>(entries: typeof parsed.scripts, select: (id: number) => T[], label: string): T[] =>
    entries.map(entry => {
      const matches = select(entry.id);
      if (!matches.length || matches.some(value => hash(value) !== entry.sourceHash))
        throw new Error("Missing, changed or conflicting battle batch " + label + ": " + entry.id);
      return structuredClone(matches[0]!);
    });
  const scripts = bind(parsed.scripts, id => encounters.filter(encounter => encounter.metadata.scriptId === id)
    .flatMap(encounter => encounter.script ? [encounter.script] : []), "script");
  const flagGroups = bind(parsed.flagGroups, id => encounters.filter(encounter => encounter.metadata.battleFlagGroupId === id)
    .map(encounter => encounter.metadata.battleFlags), "flag group");
  for (const encounter of encounters)
    createBattleFormationPlan(encounter.patterns, parsed.formations);
  return { formations: parsed.formations,
    scripts: scripts.map((script, index) => ({ id: parsed.scripts[index]!.id,
      source: script.source, reason: parsed.scripts[index]!.reason })),
    flagGroups: flagGroups.map((rows, index) => ({ id: parsed.flagGroups[index]!.id,
      rows, reason: parsed.flagGroups[index]!.reason })),
  };
}
