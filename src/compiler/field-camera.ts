import { z } from "zod";
import type { FieldCameraMapRange, FieldCameraMotionOp, FieldCameraOp } from "../core/field-camera.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

export const fieldCameraSelectors = ["カメラターゲット変更：プレイヤー", "カメラターゲット変更：カメラ"] as const;
/** Exact SystemCall.Current selector bindings. No actor operand, duration,
 * interpolation or implicit field-transport dependency is invented here. */
export function compileFieldCameraInstruction(raw: unknown): FieldCameraOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || instruction.mnemonic !== "SysCall")
    throw new Error("Expected source field camera system call");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (!fieldCameraSelectors.includes(strings[0] as typeof fieldCameraSelectors[number]) ||
      ints.some((v) => v !== 0) || reals.some((v) => v !== 0) || strings.slice(1).some((v) => v !== ""))
    throw new Error("Unsupported source field camera operand shape");
  return { kind: "field-camera", command: { target: strings[0] === fieldCameraSelectors[0] ? "player" : "dummy" } };
}

/** This decoder is for the host's resolved source actor 0 only. Ordinary actor
 * SetPos/Lerp and nonempty animation callbacks need their own effect hosts. */
export function compileFieldCameraMotionInstruction(raw: unknown): FieldCameraMotionOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 2 || !["SetPos", "Lerp"].includes(String(instruction.mnemonic)))
    throw new Error("Expected source camera puppet motion");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32);
  const reals = z.array(z.number().finite()).length(8).parse(operands.rValues);
  const strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.slice(2).some((v) => v !== 0) || strings.some((v) => v !== "") ||
      reals.slice(instruction.mnemonic === "SetPos" ? 0 : 2).some((v) => v !== 0))
    throw new Error("Unsupported camera motion: requires absolute coordinates, unchanged layer and empty animation");
  return { kind: "field-camera-motion", command: instruction.mnemonic === "SetPos"
    ? { kind: "set-position", x: ints[0]!, y: ints[1]!, layer: 0 }
    : { kind: "lerp", x: ints[0]!, y: ints[1]!, layer: 0, duration: reals[0]!, arcHeight: reals[1]! } };
}

/** MapAssetLoader.EntityLoadingCompleteStep seeds the complete tile-map range;
 * ParseMapRange then uses the first type27 object in the exact layer/object order.
 * This is source first-match behavior, not a guessed semantic asset preference. */
export function compileFieldCameraMapRange(rawTilemap: unknown, rawDefaultEntities: unknown): FieldCameraMapRange {
  const tilemap = record(rawTilemap), entities = record(rawDefaultEntities);
  if (int32(tilemap.tilewidth) !== 16 || int32(tilemap.tileheight) !== 16)
    throw new Error("Camera source conversion requires the bound 16-pixel tile geometry");
  const dimensions = (width: number, height: number): void => {
    if (width <= 0 || height <= 0) throw new Error("Invalid camera source map range");
  };
  const fallback = { x: 0, y: 0, width: int32(tilemap.width), height: int32(tilemap.height) };
  dimensions(fallback.width, fallback.height);
  for (const rawLayer of z.array(z.unknown()).parse(entities.layers)) {
    const layer = record(rawLayer);
    for (const rawObject of z.array(z.unknown()).parse(layer.objects)) {
      const object = record(rawObject);
      const types = z.array(z.unknown()).parse(object.properties).map(record)
        .filter((p) => p.name === "object_type");
      if (types.length !== 1 || types[0]!.type !== "int")
        throw new Error("Unresolved camera map object_type property");
      if (int32(types[0]!.value) !== 27) continue;
      const divide = (v: unknown): number => Math.trunc(int32(v) / 16) || 0;
      const range = { x: divide(object.x), y: divide(object.y),
        width: divide(object.width), height: divide(object.height) };
      dimensions(range.width, range.height);
      return range;
    }
  }
  return fallback;
}
