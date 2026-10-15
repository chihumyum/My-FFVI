import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";
import type { FieldBgmControlOp } from "../core/field-bgm-control.js";
export type { FieldBgmControlOp } from "../core/field-bgm-control.js";

export const fieldBgmControlMnemonics = ["PauseBGM", "ReplayBgm"] as const;

/** Source control protocol from the fixed-build PauseBGM/ReplayBgm wrappers.
 * Pause i1 is a suspend boolean, not asynchronous playback. Replay always
 * uses primary 0, retaining its first-clock track across a stop/start barrier.
 * Native mixer fade curves and controller scheduling remain explicit Web
 * policy; unknown operands are never silently dropped. */
export function compileFieldBgmControlInstruction(raw: unknown): FieldBgmControlOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || !(fieldBgmControlMnemonics as readonly unknown[]).includes(instruction.mnemonic))
    throw new Error("Expected source BGM control instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  const pause = instruction.mnemonic === "PauseBGM";
  if (ints.slice(pause ? 2 : 0).some(value => value !== 0) || reals.slice(1).some(value => value !== 0) ||
      strings.some(value => value !== "")) throw new Error("Unsupported BGM control reserved operands");
  const fade = Math.fround(reals[0]!);
  if (!Number.isFinite(fade) || fade < 0) throw new Error("Unsupported BGM control fade");
  const policy = "web-static-audio-control-v1" as const;
  if (!pause) return { kind: "bgm-replay", channel: 0, fade, policy };
  if (ints[0] !== 0 && ints[0] !== 1) throw new Error("Unsupported BGM control channel");
  // The wrapper tests nonzero; the corpus contains only explicit zero/one.
  // Other values retain a reviewed-form gap instead of widening admission.
  if (ints[1] !== 0 && ints[1] !== 1) throw new Error("Unsupported BGM pause boolean shape");
  return { kind: "bgm-pause", channel: ints[0], paused: ints[1] === 1, fade, policy };
}
