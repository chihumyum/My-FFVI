import type { Evidence } from "../field/types.js";
import type { FieldEventActivationDefinition } from "../core/field-event-activation.js";
import { hash } from "./content.js";

/** The complete observed Gimmick RunScript subfamily. Other action IDs,
 * transportation observers and link callbacks retain their independent gates. */
export function compileFieldEventActivation(group: string, p: Record<string, unknown>,
  script: string | null, source: Evidence): FieldEventActivationDefinition | null {
  if (p.object_type !== 2 || p.gimmick !== true) return null;
  if (!group || p.action_id !== 2 || !script || !Number.isSafeInteger(p.script_id) || Number(p.script_id) <= 0 ||
      (p.link_object_id ?? 0) !== 0 || (p.target_transportation_ids ?? "") !== "" ||
      (p.direction ?? 0) !== 0 || (p.ignore_route_link_object_id ?? -1) !== -1 ||
      (p.se_id ?? 0) !== 0 || (p.birdview_puppet ?? false) !== false)
    throw new Error("Unsupported gimmick event activation selector");
  const body = { kind: "source-field-event-activation-v1" as const, group, script,
    gimmick: true as const, source: structuredClone(source) };
  return { ...body, contentHash: hash(body) };
}
