import { record, hash } from "./content.js";
import { int32 } from "../core/script-integer.js";
import type { FieldPuppetActorCatalog, FieldPuppetScriptContext } from "../core/field-puppet-actors.js";

const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("Missing source puppet provider array");
  return value;
};
const positive = (value: unknown): number => {
  const n = int32(value);
  if (n <= 0) throw new Error("Invalid source puppet provider identity");
  return n;
};
const bool = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new Error("Unknown source puppet provider boolean");
  return value;
};

/** JsonUtility defaults are not used as proof for absent source fields. Every
 * flag consumed by Integrator.Execute must be explicitly present in Format. */
export function compileFieldPuppetScriptContext(rawScript: unknown, rawMisc: unknown): FieldPuppetScriptContext {
  const script = record(rawScript), flags = record(script.SystemFlag), misc = record(rawMisc);
  return {
    skipInitialize: int32(flags.SkipInitialize) !== 0,
    keepPlayerPuppet: int32(flags.KeepPlayerPuppet) !== 0,
    keepBadStatusVisual: int32(flags.KeepBadStatusVisual) !== 0,
    ridingVehicle: int32(flags.RidingVehicle) !== 0,
    characteristics: bool(misc.characteristics),
    scriptHash: hash(script), miscHash: hash(misc),
  };
}

/** Input comes from the caller's verified same-source snapshot. Full source
 * object digests bind flags/mappings; no development checkpoint is consulted. */
export function compileFieldPuppetActorCatalog(rawMisc: unknown): FieldPuppetActorCatalog {
  const misc = record(rawMisc);
  const corpsOrder = array(misc.corps_order).map(int32);
  if (corpsOrder.length !== 4 || new Set(corpsOrder).size !== 4 || corpsOrder.some((n) => n < 0 || n > 3))
    throw new Error("Unresolved source puppet Corps ordering");
  const residents = array(misc.resident_characters).map((raw) => {
    const row = record(raw);
    return { assetId: positive(row.asset_id), characterStatusId: positive(row.character_id), isCorps: bool(row.is_corps) };
  });
  if (new Set(residents.map((r) => r.assetId)).size !== residents.length)
    throw new Error("Ambiguous source puppet resident mapping");
  const conditionChanges = array(misc.change_character_condition_list).map((raw) => {
    const row = record(raw);
    return { type: positive(row.condition_type), residentCharacterId: positive(row.field_character_asset_cid) };
  });
  return { kind: "field-puppet-actors-v1", memberCount: 4, characteristics: bool(misc.characteristics),
    corpsOrder, residents, conditionChanges, miscHash: hash(misc) };
}
