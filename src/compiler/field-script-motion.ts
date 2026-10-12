import { z } from "zod";
import type { FieldScriptMotionOp } from "../core/field-script-motion.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

export const fieldScriptMotionMnemonics = ["Move", "Lerp"] as const;
const directions = ["up", "right", "down", "left"] as const;

/** Decode source operands without selecting an actor or assuming that Lerp is a
 * camera command. The current puppet binding and its capabilities belong to the
 * runtime. In particular, a decoded layer/animation is not a host capability. */
export function compileFieldScriptMotionInstruction(raw: unknown): FieldScriptMotionOp {
  const instruction = record(raw);
  if (instruction.type !== 2 ||
      !fieldScriptMotionMnemonics.includes(instruction.mnemonic as typeof fieldScriptMotionMnemonics[number]))
    throw new Error("Expected source Move or Lerp puppet instruction");
  const operands = record(instruction.operands),
    ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.slice(3).some((value) => value !== 0) ||
      reals.slice(instruction.mnemonic === "Move" ? 0 : 2).some((value) => value !== 0) ||
      strings.slice(1).some((value) => value !== ""))
    throw new Error("Unsupported scripted motion reserved operands");
  if (instruction.mnemonic === "Move") {
    const direction = directions[ints[0]!], steps = ints[1]!, selector = ints[2]!;
    if (!direction) throw new Error("Unsupported source Move direction");
    if (steps < 0) throw new Error("Negative source Move steps are not supported");
    // Puppet.speeds is the seven-element source array [0,1,2,3,4,5,6].
    // GetSpeedID returns a nullable default for every selector <= -1.
    if (selector > 6) throw new Error("Source Move speed selector exceeds the source table");
    return { kind: "field-script-motion", command: {
      kind: "move", direction, steps, speedId: selector < 0 ? null : selector,
      animation: strings[0]!,
    } };
  }
  const layer = ints[2]!, duration = reals[0]!;
  if (layer < 0 || layer > 3) throw new Error("Unsupported source Lerp layer request");
  // A negative source duration does not mean asynchronous completion. It would
  // retain a non-completing interpolation; this host subset rejects it explicitly.
  if (duration < 0) throw new Error("Negative source Lerp duration is not supported");
  return { kind: "field-script-motion", command: {
    kind: "lerp", x: ints[0]!, y: ints[1]!, layer: layer as 0 | 1 | 2 | 3,
    duration, arcHeight: reals[1]!, animation: strings[0]!,
  } };
}
