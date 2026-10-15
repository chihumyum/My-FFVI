import { z } from "zod";
import { record } from "./content.js";
import { int32 } from "../core/script-integer.js";
import type { FieldBirdViewMoveOp } from "../core/field-bird-view-actors.js";
import { compileFieldScriptMotionInstruction } from "./field-script-motion.js";

/** MoveBirdView calls the ordinary Move only when i1 > 0. Its unused direction
 * can be outside Move's range (including a real source height-only selector4). */
export function compileFieldBirdViewMoveInstruction(raw: unknown): FieldBirdViewMoveOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 2 || instruction.mnemonic !== "MoveBirdView") throw new Error("Expected source MoveBirdView puppet instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (ints.slice(3).some(v => v !== 0) || reals.slice(2).some(v => v !== 0) || strings.slice(1).some(v => v !== ""))
    throw new Error("Unsupported MoveBirdView reserved operands");
  if (reals[1]! < 0) throw new Error("Negative MoveBirdView duration");
  const delegated = ints[1]! > 0 ? compileFieldScriptMotionInstruction({ ...instruction, mnemonic: "Move",
    operands: { iValues: ints, rValues: Array(8).fill(0), sValues: strings } }).command : null;
  if (delegated !== null && delegated.kind !== "move") throw new Error("Invalid MoveBirdView delegation");
  return { kind: "field-bird-view-move", command: { kind: "move-bird-view", heightRatio: reals[0]!, duration: reals[1]!, move: delegated } };
}
