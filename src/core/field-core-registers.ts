import { checkpointKeys } from "./checkpoint-validation.js";
import { int32 } from "./script-integer.js";
import type { FieldContent } from "../field/types.js";

/** Core.GeneralRegisters, never Format.Operands or EventState.ScriptLocal.
 * The surrounding Task owns this immutable value; this module owns no state. */
export type FieldCoreRegisters = {
  kind: "field-core-registers-v1";
  i: readonly number[];
  r: readonly number[];
  s: readonly (string | null)[];
};

function dense(raw: unknown, length: number): asserts raw is unknown[] {
  if (!Array.isArray(raw) || raw.length !== length || Reflect.ownKeys(raw).length !== length + 1 ||
      Object.getOwnPropertySymbols(raw).length || Object.keys(raw).length !== length)
    throw new Error("Invalid Core register array");
  for (let index = 0; index < length; index++) {
    const field = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!field || !("value" in field) || !field.enumerable)
      throw new Error("Invalid Core register array field");
  }
}

export function parseFieldCoreRegisters(raw: unknown): FieldCoreRegisters {
  checkpointKeys(raw, "kind,i,r,s");
  if (Reflect.ownKeys(raw as object).length !== 4 || Object.getOwnPropertySymbols(raw as object).length)
    throw new Error("Invalid Core register fields");
  for (const key of ["kind", "i", "r", "s"]) {
    const field = Object.getOwnPropertyDescriptor(raw, key);
    if (!field || !("value" in field) || !field.enumerable) throw new Error("Invalid Core register data field");
  }
  const value = raw as FieldCoreRegisters;
  if (value.kind !== "field-core-registers-v1") throw new Error("Unknown Core register version");
  dense(value.i, 8); dense(value.r, 4); dense(value.s, 4);
  const i = Array.from(value.i, int32);
  const r = Array.from(value.r, (item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) throw new Error("Invalid Core real register");
    return item;
  });
  const s = Array.from(value.s, (item) => {
    if (item !== null && typeof item !== "string") throw new Error("Invalid Core string register");
    return item;
  });
  return Object.freeze({ kind: "field-core-registers-v1", i: Object.freeze(i), r: Object.freeze(r), s: Object.freeze(s) });
}

/** New arrays and Core.Reset clear all slots. Native string[] defaults null. */
export function initialFieldCoreRegisters(): FieldCoreRegisters {
  return parseFieldCoreRegisters({ kind: "field-core-registers-v1", i: Array(8).fill(0), r: Array(4).fill(0), s: Array(4).fill(null) });
}

/** A projection only. The Task publishes it after the actual actor's last
 * fallible fence, in the same owned-condition transaction. */
export function projectFieldCoreI0(current: FieldCoreRegisters, writes: readonly number[]): FieldCoreRegisters {
  const before = parseFieldCoreRegisters(current);
  if (!Array.isArray(writes)) throw new Error("Missing Core i0 writes");
  const next = [...before.i];
  for (let index = 0; index < writes.length; index++) {
    const field = Object.getOwnPropertyDescriptor(writes, String(index));
    if (!field || !("value" in field)) throw new Error("Sparse Core i0 writes");
    next[0] = int32(field.value);
  }
  return parseFieldCoreRegisters({ ...before, i: next });
}

/** Source-backed opcode adapters may replace only the slots that their
 * actual consumer writes. Omitted fields preserve the prior bank. */
export function projectFieldCoreSlots(current: FieldCoreRegisters,
  writes: { i?: Readonly<Record<string, number>>; r?: Readonly<Record<string, number>> }): FieldCoreRegisters {
  const before = parseFieldCoreRegisters(current), i = [...before.i], r = [...before.r];
  for (const [key, value] of Object.entries(writes.i ?? {})) {
    const index = Number(key);
    if (String(index) !== key || !Number.isInteger(index) || index < 0 || index >= 8)
      throw new Error("Unknown Core integer register");
    i[index] = int32(value);
  }
  for (const [key, value] of Object.entries(writes.r ?? {})) {
    const index = Number(key);
    if (String(index) !== key || !Number.isInteger(index) || index < 0 || index >= 4 || !Number.isFinite(value))
      throw new Error("Unknown Core real register");
    r[index] = value;
  }
  return parseFieldCoreRegisters({ ...before, i, r });
}

/** Trusted compiled programs determine whether an event continuation needs
 * this codec. A save cannot grant the content an extra register consumer. */
export function fieldUsesCoreRegisters(content: Pick<FieldContent, "scripts">): boolean {
  return Object.values(content.scripts).some(program => program.some(op =>
    op.kind === "source-character-naming" && op.command.completion === "first-join-level" ||
    op.kind === "field-skybox-scroll" || op.kind === "standalone-wait" ||
    op.kind === "owned-condition" && op.command.kind === "remove-condition" && op.command.conditionType === 0 ||
    op.kind === "animation-play" && op.repeatCount !== undefined));
}
