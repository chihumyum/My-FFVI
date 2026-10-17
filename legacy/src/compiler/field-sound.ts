import { z } from "zod";
import type { FieldSoundCommand, FieldSoundOp } from "../core/field-sound-command.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

export type { FieldSoundCommand, FieldSoundOp } from "../core/field-sound-command.js";
export const fieldSoundMnemonics = ["PlaySE", "StopSE", "SyncSE", "ReadySE"] as const;

/** This decodes the control protocol. It does not grant a media asset, a local
 * variable bank, or a playback provider. Source type 1 and 2 dispatch here. */
export function compileFieldSoundInstruction(raw: unknown): FieldSoundOp {
  const instruction = record(raw), operands = record(instruction.operands),
    mnemonic = z.string().parse(instruction.mnemonic);
  if (![1, 2].includes(instruction.type as number) ||
      !(fieldSoundMnemonics as readonly string[]).includes(mnemonic))
    throw new Error("Expected source field sound instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  const usedInts = mnemonic === "PlaySE" ? 3 : 1,
    usedReals = mnemonic === "PlaySE" ? 3 : mnemonic === "StopSE" ? 1 : 0;
  if (ints.slice(usedInts).some(value => value !== 0) ||
      reals.slice(usedReals).some(value => value !== 0) ||
      strings.some(value => value !== ""))
    throw new Error("Unsupported sound reserved operands");
  // Native PlaySe / Stop parameters are Singles; reject overflow rather than
  // allowing an infinite runtime duration. No rounding of IDs or slot indices.
  const seconds = (value: number): number => {
    const converted = Math.fround(value);
    if (!Number.isFinite(converted) || converted < 0)
      throw new Error("Unsupported sound duration");
    return converted;
  };
  let command: FieldSoundCommand;
  if (mnemonic === "PlaySE") {
    if (ints[0]! <= 0) throw new Error("Sound requires a positive source identity");
    const pan = Math.fround(reals[2]!);
    if (!Number.isFinite(pan) || pan < -1 || pan > 1)
      throw new Error("Unsupported sound pan");
    command = { kind: "play", soundId: ints[0]!, asynchronous: ints[1] !== 0,
      handleSlot: ints[2]! < 0 ? null : ints[2]!,
      fadeSeconds: seconds(reals[0]!), seekSeconds: seconds(reals[1]!), pan };
  } else if (mnemonic === "ReadySE") {
    if (ints[0]! <= 0) throw new Error("Sound readiness requires a positive source identity");
    command = { kind: "ready", soundId: ints[0]! };
  } else {
    if (ints[0]! < 0) throw new Error("Sound handle slot must be nonnegative");
    command = mnemonic === "StopSE"
      ? { kind: "stop", handleSlot: ints[0]!, fadeSeconds: seconds(reals[0]!) }
      : { kind: "sync", handleSlot: ints[0]! };
  }
  return { kind: "field-sound", command };
}
