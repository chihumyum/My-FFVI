import { z } from "zod";
import type { AudioReadinessOp } from "../core/audio-readiness.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

/** Exact immediate forms; resource availability remains a runtime dependency. */
export function compileAudioReadinessInstruction(
  raw: unknown,
): AudioReadinessOp {
  const instruction = record(raw),
    operands = record(instruction.operands);
  if (
    instruction.type !== 1 ||
    (instruction.mnemonic !== "ReadyBGM" && instruction.mnemonic !== "SyncBGM")
  )
    throw new Error("Expected source BGM readiness instruction");
  const ints = z
      .array(z.unknown())
      .length(8)
      .parse(operands.iValues)
      .map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (
    ints.slice(1).some((value) => value !== 0) ||
    reals.some((value) => value !== 0) ||
    strings.some((value) => value !== "")
  )
    throw new Error("Unsupported BGM readiness operand shape");
  const value = ints[0]!;
  if (instruction.mnemonic === "ReadyBGM") {
    if (value <= 0) throw new Error("Invalid BGM readiness identity");
    return { kind: "bgm-ready", track: value };
  }
  if (value !== 0 && value !== 1)
    throw new Error("Unsupported BGM synchronization channel");
  return { kind: "bgm-sync", channel: value };
}
