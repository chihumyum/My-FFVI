import type { Evidence, FieldContent, FieldEntity } from "../field/types.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";

/** PropertyEvent.Gimmick selects scene 11 instead of 12. Both select entity
 * mask 3 and the same FieldMap update consumers. This is not a story flag. */
export type FieldEventActivationDefinition = {
  kind: "source-field-event-activation-v1";
  contentHash: string;
  group: string;
  script: string;
  gimmick: true;
  source: Evidence;
};
/** Only the source invocation identity is saved. Variables, tasks, motion,
 * camera and clocks remain in their existing owners. */
export type FieldEventActivationCheckpoint = {
  kind: "field-event-activation-checkpoint-v1";
  entityId: string;
  group: string;
  definitionHash: string;
};

export function validateFieldEventActivation(entity: FieldEntity): FieldEventActivationDefinition {
  const d = entity.eventActivation;
  if (!d) throw new Error("Source event activation definition is unavailable");
  checkpointKeys(d, "kind,contentHash,group,script,gimmick,source");
  if (d.kind !== "source-field-event-activation-v1" || !/^[a-f0-9]{64}$/.test(d.contentHash) ||
      typeof d.group !== "string" || !d.group || typeof d.script !== "string" || !d.script ||
      d.gimmick !== true || entity.kind !== 2 || entity.script !== d.script ||
      canonical(entity.source) !== canonical(d.source))
    throw new Error("Source event activation identity or selector changed");
  return d;
}

export function captureFieldEventActivation(entity: FieldEntity): FieldEventActivationCheckpoint {
  const d = validateFieldEventActivation(entity);
  return { kind: "field-event-activation-checkpoint-v1", entityId: entity.id,
    group: d.group, definitionHash: d.contentHash };
}

/** Content supplies the program and capability. A save can only select an
 * exact source invocation already declared by that map, including its group. */
export function restoreFieldEventActivation(raw: unknown, content: FieldContent,
  rootScript: string): FieldEventActivationCheckpoint {
  checkpointKeys(raw, "kind,entityId,group,definitionHash");
  const saved = structuredClone(raw) as FieldEventActivationCheckpoint;
  if (saved.kind !== "field-event-activation-checkpoint-v1" || typeof saved.entityId !== "string" || !saved.entityId ||
      typeof saved.group !== "string" || !saved.group || !/^[a-f0-9]{64}$/.test(saved.definitionHash))
    throw new Error("Invalid source event activation checkpoint");
  const group = content.map.groups?.[saved.group];
  // Default entities may also be projected directly on the map. Do not pick
  // an unrelated alias or first matching entity from another source group.
  const entities = group ? group.entities : content.map.entities.filter(e => e.eventActivation?.group === saved.group);
  const found = entities.filter(e => e.id === saved.entityId);
  if (found.length !== 1) throw new Error("Source event activation entity/group is missing or ambiguous");
  const d = validateFieldEventActivation(found[0]!);
  if (d.contentHash !== saved.definitionHash || d.script !== rootScript || d.group !== saved.group)
    throw new Error("Source event activation program binding changed");
  return saved;
}
