import type { FieldContent, Op } from "../field/types.js";
import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";

export const SOURCE_AUTO_SAVE = "source-auto-save-v1" as const;
export const WEB_AUTO_SAVE_POLICY = "web-field-autosave-barrier-v1" as const;
export type FieldEventSaveOp = { kind: "event-save"; sourceAutoSave?: typeof SOURCE_AUTO_SAVE };

/** Source AutoSave first synchronizes native puppets/player/camera, then yields;
 * its next clock calls Save(autoSlot.id, null, false) and immediately advances.
 * This declared Web policy instead keeps the current field owners and waits for
 * the existing durable-save ACK. Native actor synchronization, slot identity,
 * storage failure and load re-entry are not granted by this policy. */
export const WEB_AUTO_SAVE_LIMITATIONS = Object.freeze([
  "Native first-clock player/camera synchronization is not reproduced; existing Web field owners are saved.",
  "Native AutoSlot identity is not reused; the existing Web current/previous storage namespace is used.",
  "Web persistence waits for success ACK and supports retry; native AutoSave advances without checking completion.",
  "Web post-ACK VM continuation is supported; native persisted PC, Call stack and load re-entry remain unknown.",
]);

/** Trusted content, never saved execution data, grants the deliberate variant.
 * Authored legacy barriers keep their existing admission and save format. */
export function assertFieldEventSaveAdmission(content: FieldContent,
  op: Extract<Op, { kind: "event-save" }>): void {
  if (!Object.hasOwn(op, "sourceAutoSave")) return;
  checkpointKeys(op, "kind,script,index,source,sourceAutoSave");
  if (op.sourceAutoSave !== SOURCE_AUTO_SAVE) throw new Error("Unknown source AutoSave instruction contract");
  if (content.developmentProfile?.kind !== "framework-development-v1" ||
      content.developmentProfile.autoSave !== WEB_AUTO_SAVE_POLICY)
    throw new Error("Source AutoSave requires its explicit Web save-barrier content policy");
  const matches = content.scripts[op.script]?.filter(candidate => candidate.index === op.index) ?? [];
  if (matches.length !== 1 || canonical(matches[0]) !== canonical(op))
    throw new Error("Source AutoSave instruction differs from its trusted program");
}
