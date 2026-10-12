import { z } from "zod";
import type { FieldTransportationCommand, FieldTransportationOp } from "../core/field-transportation-command.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

export type { FieldTransportationCommand, FieldTransportationOp } from "../core/field-transportation-command.js";
export const fieldTransportationMnemonics = ["SetVehicle", "RideVehicleNPC"] as const;

/** Exact Current.cctor string -> delegate bindings. These preserve the native
 * collision/background/view arguments, rather than guessing from the labels. */
const changes = {
  "乗り物に乗る：船": { transportationId: 2, isBackground: false, viewType: 0 },
  "乗り物に乗る：チョコボ": { transportationId: 3, isBackground: false, viewType: 1 },
  "乗り物に乗る：チョコボ(アニメ・BGMなし)": { transportationId: 3, isBackground: true, viewType: 1 },
  "乗り物に乗る：ブラックジャック号": { transportationId: 4, isBackground: false, viewType: 0 },
  "乗り物に乗る：ブラックジャック号(アニメ・BGMなし)": { transportationId: 4, isBackground: true, viewType: 0 },
  "乗り物に乗る：ファルコン号": { transportationId: 5, isBackground: false, viewType: 0 },
  "乗り物に乗る：ファルコン号(アニメ・BGMなし)": { transportationId: 5, isBackground: true, viewType: 0 },
  "乗り物に乗る：魔導アーマー": { transportationId: 6, isBackground: false, viewType: 0 },
  "乗り物に乗る：トランスティナ": { transportationId: 7, isBackground: true, viewType: 0 },
  "乗り物に乗る：鳥": { transportationId: 8, isBackground: true, viewType: 0 },
  "乗り物から降りる": { transportationId: 1, isBackground: false, viewType: 0 },
  "乗り物から降りる(アニメ・BGMなし)": { transportationId: 1, isBackground: true, viewType: 0 },
} as const;
export const fieldTransportationSelectors: readonly string[] = Object.freeze(Object.keys(changes));
const directions = [1, 2, 4, 8] as const;

/** Decode source operands only. IDs, actor bindings, player layer, parking,
 * timestamps, release flags and all map/visual side effects belong to the
 * transactional host. An admitted syntax is not a complete lifecycle provider. */
export function compileFieldTransportationInstruction(raw: unknown): FieldTransportationOp {
  const instruction = record(raw), operands = record(instruction.operands), mnemonic = z.string().parse(instruction.mnemonic);
  if (instruction.type !== 1 || ![...fieldTransportationMnemonics, "SysCall"].includes(mnemonic))
    throw new Error("Expected source field transportation instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (reals.some(value => value !== 0))
    throw new Error("Unsupported transportation real operands");
  let command: FieldTransportationCommand;
  if (mnemonic === "SysCall") {
    const selector = strings[0]!;
    if (!Object.hasOwn(changes, selector) || ints.some(value => value !== 0) || strings.slice(1).some(value => value !== ""))
      throw new Error("Unsupported transportation selector or reserved operands");
    command = { kind: "change", ...changes[selector as keyof typeof changes], changeCollisionEnable: true };
  } else {
    if (strings.some(value => value !== ""))
      throw new Error("Unsupported transportation string operands");
    const transportationId = ints[0]!;
    if (transportationId <= 0) throw new Error("Transportation instruction requires a positive source identity");
    if (mnemonic === "RideVehicleNPC") {
      if (ints.slice(2).some(value => value !== 0))
        throw new Error("Unsupported NPC transportation reserved operands");
      command = { kind: "ride-npc", transportationId, actorSelector: ints[1]! };
    } else {
      const layer = ints[4]!, direction = directions[ints[5]!];
      if (ints[1]! <= 0 || layer < 0 || layer > 4 || direction === undefined || ints.slice(6).some(value => value !== 0))
        throw new Error("Unsupported transportation placement map, layer or direction");
      command = { kind: "place", transportationId, stayMapId: ints[1]!,
        position: { x: Math.fround(ints[2]!), y: Math.fround(ints[3]!) },
        layer: layer === 0 ? { kind: "player" } : { kind: "unity", value: (layer + 8) as 9 | 10 | 11 | 12 },
        direction };
    }
  }
  return { kind: "field-transportation", command };
}
