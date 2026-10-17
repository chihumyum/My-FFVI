import { checkpointKeys } from "./checkpoint-validation.js";
import { parseBattleEventMessageBinding, type BattleEventMessageBinding } from "./battle-event-message.js";
import type { SourceMessageState } from "./source-message.js";

export const WEB_FIELD_MESSAGE_WINDOW_READY = "web-field-message-window-ready-v1";
export type FieldEmptyMessageOp = {
  kind: "field-empty-message-stop";
  key: string;
  reason: "empty-input" | "missing-static-row";
  binding: Extract<BattleEventMessageBinding, { kind: "battle-event-message-binding-v2" }>;
  operands: { iValues: number[]; rValues: number[]; sValues: string[] };
};
export function validateFieldEmptyMessage(op: FieldEmptyMessageOp): void {
  checkpointKeys(op, "kind,key,reason,binding,operands");
  checkpointKeys(op.operands, "iValues,rValues,sValues");
  const binding = parseBattleEventMessageBinding(op.binding), raw = op.operands;
  if (op.kind !== "field-empty-message-stop" || typeof op.key !== "string" ||
      binding.kind !== "battle-event-message-binding-v2" ||
      !["empty-input", "missing-static-row"].includes(op.reason) ||
      (op.reason === "empty-input") !== (op.key === "") ||
      !Array.isArray(raw.iValues) || raw.iValues.length !== 8 || Array.from(raw.iValues).some(n => !Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff) ||
      !Array.isArray(raw.rValues) || raw.rValues.length !== 8 || Array.from(raw.rValues).some(n => typeof n !== "number" || !Number.isFinite(n)) ||
      !Array.isArray(raw.sValues) || raw.sValues.length !== 8 || Array.from(raw.sValues).some(n => typeof n !== "string") || raw.sValues[0] !== op.key)
    throw new Error("Invalid source Field empty-message Stop evidence");
}

/** Measured Web controller publication, not Unity's Integrator MessageReady. */
export type FieldMessageWindowMeasurement = {
  kind: "web-field-message-window-surface-v1";
  surface: object;
  initialized: boolean;
  owner: SourceMessageState | null;
  generation: object | null;
};
type Query = () => FieldMessageWindowMeasurement;
const creation = Symbol("field-message-window-ready");
function measurement(value: FieldMessageWindowMeasurement): FieldMessageWindowMeasurement {
  checkpointKeys(value, "kind,surface,initialized,owner,generation");
  if (value.kind !== "web-field-message-window-surface-v1" || !value.surface || typeof value.surface !== "object" ||
      typeof value.initialized !== "boolean" || value.owner !== null && typeof value.owner !== "object" ||
      value.generation !== null && typeof value.generation !== "object" || (value.owner === null) !== (value.generation === null))
    throw new Error("Unknown Web Field message-window measurement");
  return { ...value };
}
class FieldMessageWindowReadyAuthority {
  readonly policy = WEB_FIELD_MESSAGE_WINDOW_READY;
  readonly #query: Query;
  constructor(key: symbol, query: Query) {
    if (key !== creation || typeof query !== "function") throw new Error("Message readiness requires explicit Web controller measurement");
    this.#query = query; Object.freeze(this);
  }
  static prepare(authority: unknown, owner: SourceMessageState) {
    if (!authority || typeof authority !== "object" || !(#query in authority))
      throw new Error("Missing genuine Web Field message-window readiness authority");
    const revision = owner.mutationRevision, first = measurement(authority.#query());
    if (!Number.isSafeInteger(revision) || owner.mutationRevision !== revision)
      throw new Error("Message readiness host changed its actual source owner");
    const ready = first.initialized && first.owner === owner;
    return { ready, validate: () => {
      const next = measurement(authority.#query());
      if (owner.mutationRevision !== revision || next.surface !== first.surface || next.owner !== first.owner ||
          next.generation !== first.generation || next.initialized !== first.initialized)
        throw new Error("Stale Web Field message-window readiness lease");
    } };
  }
}
Object.freeze(FieldMessageWindowReadyAuthority); Object.freeze(FieldMessageWindowReadyAuthority.prototype);
export type WebFieldMessageWindowReady = FieldMessageWindowReadyAuthority;
export function createWebFieldMessageWindowReady(query: Query): WebFieldMessageWindowReady {
  return new FieldMessageWindowReadyAuthority(creation, query);
}
export function prepareWebFieldMessageWindowReady(authority: WebFieldMessageWindowReady | undefined, owner: SourceMessageState) {
  return FieldMessageWindowReadyAuthority.prepare(authority, owner);
}
