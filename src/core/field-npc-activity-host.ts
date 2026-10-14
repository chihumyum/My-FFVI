import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { parseFieldNpcActivitySource, parseFrameworkNpcActivityDeclaration, validateFrameworkNpcActivityBinding,
  type FrameworkNpcActivityBinding, type FieldNpcActivityDiagnostic } from "./field-npc-activity-source.js";
import { parseNpcActivityProgram } from "./field-npc-activity.js";
import { validateFieldNativeNpc } from "./field-native-npc.js";
import type { FieldContent } from "../field/types.js";

export type FieldNpcActivityHost = {
  kind: "framework-npc-area-host-v1";
  policy: "framework-npc-area-v1";
  sourceMapHash: string;
  sourceSetHash: string;
  parentSourceSetHash: string;
  bindings: FrameworkNpcActivityBinding[];
  diagnostics: FieldNpcActivityDiagnostic[];
  limitations: string[];
  nativeRulesVerified: false;
};

/** Source diagnostics remain intact. Only this explicitly declared host may
 * admit its exact source object's Area movement requirement. */
export function fieldNpcGroupBlockers(group: NonNullable<FieldContent["map"]["groups"]>[string],
  host?: FieldNpcActivityHost) {
  return group.blockers.filter(blocker => {
    if (!host || blocker.reason !== "Unsupported NPC movement controller 2") return true;
    const matches = host.bindings.filter(binding => binding.definition.group === group.name &&
      canonical(binding.source.source) === canonical(blocker.source));
    if (matches.length !== 1) return true;
    validateFrameworkNpcActivityBinding(matches[0]!);
    const definition = matches[0]!.definition;
    return !group.entities.some(entity => entity.id === definition.entityId && entity.npc?.moveType === 2 &&
      canonical(entity.source) === canonical(definition.source));
  });
}

/** Hash-checked content chooses a Web host separately from the retained source
 * blockers. Saved progress never supplies definitions or this declaration. */
export function bindFieldNpcActivities(content: FieldContent): Map<string, FrameworkNpcActivityBinding> {
  const host = content.frameworkNpcActivity, result = new Map<string, FrameworkNpcActivityBinding>();
  if (!host) return result;
  checkpointKeys(host, "kind,policy,sourceMapHash,sourceSetHash,parentSourceSetHash,bindings,diagnostics,limitations,nativeRulesVerified");
  if (host.kind !== "framework-npc-area-host-v1" || host.policy !== "framework-npc-area-v1" ||
      host.nativeRulesVerified !== false || content.developmentProfile?.npcActivity !== host.policy ||
      host.sourceMapHash !== content.developmentProfile.sourceContentHash ||
      host.sourceSetHash !== content.sourceSetHash || host.parentSourceSetHash !== content.parentSourceSetHash ||
      !content.cameraHost || !content.map.groups || !Array.isArray(host.bindings))
    throw new Error("Unbound framework NPC content host");
  for (const raw of host.bindings) {
    validateFrameworkNpcActivityBinding(raw);
    const binding = structuredClone(raw), source = parseFieldNpcActivitySource(binding.source),
      declaration = parseFrameworkNpcActivityDeclaration(binding.declaration), definition = binding.definition,
      program = parseNpcActivityProgram(binding.program);
    validateFieldNativeNpc(definition);
    const entity = content.map.groups[definition.group]?.entities.find(e => e.id === definition.entityId);
    if (definition.controller !== "area" || declaration.sourceHash !== source.contentHash ||
        source.sourceSetHash !== host.sourceSetHash || source.parentSourceSetHash !== host.parentSourceSetHash ||
        source.mapId !== content.map.identity?.mapId || source.entityId !== definition.entityId ||
        source.group !== definition.group || definition.activitySourceHash !== source.contentHash ||
        canonical(source.mapRange) !== canonical(content.cameraHost.mapRange) ||
        canonical(program) !== canonical(definition.program) || !entity || entity.npc?.moveType !== 2 ||
        entity.kind !== definition.objectType || entity.asset !== definition.asset.asset ||
        entity.layer !== definition.geometry.layer || canonical(entity.source) !== canonical(definition.source) ||
        result.has(definition.entityId))
      throw new Error("Framework NPC binding changed its source entity or program");
    result.set(definition.entityId, binding);
  }
  return result;
}
