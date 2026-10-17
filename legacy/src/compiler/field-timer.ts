import { z } from "zod";
import type { FieldTimerOp, FieldScenarioTimerOp } from "../core/field-timer.js";
import { fieldTimerUpdateStates } from "../core/field-timer.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

export const fieldTimerMnemonics = ["SetTimer", "FinishTimer"] as const;
export const fieldScenarioTimerSelectors = {
  "シドタイマー：HPチェック": "cid-hp", "シドタイマー：一時停止": "cid-suspend",
  "シドタイマー：タイマーチェック": "cid-check", "シドタイマー：再開": "cid-resume",
  "シャドウタイマー設定": "shadow-setup", "シャドウタイマー解除": "shadow-reset",
} as const;
export const fieldTimerSelectors = ["タイマー一時停止", "タイマー一時停止解除", "時間切れでスクリプト変更"] as const;

/** Current source immediate timer forms. Every meaningful selector and
 * callback name survives; host availability is a separate runtime check. */
export function compileFieldTimerInstruction(raw: unknown): FieldTimerOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || ![...fieldTimerMnemonics, "SysCall"].includes(String(instruction.mnemonic)))
    throw new Error("Expected source ordinary field timer instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (instruction.mnemonic === "SetTimer") {
    if (ints.slice(4).some(value => value !== 0) || reals.slice(1).some(value => value !== 0))
      throw new Error("Unsupported SetTimer reserved operands");
    const sourceSelectors = { display: ints[0]!, battle: ints[1]!, message: ints[2]!, event: ints[3]! };
    const updateStates = fieldTimerUpdateStates(sourceSelectors), seconds = Math.fround(reals[0]!);
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(Math.ceil(seconds * 1000)))
      throw new Error("Unsupported SetTimer positive Web-clock duration");
    // External.Timer collects all nonempty string slots, preserving order.
    const callbackScripts = strings.filter(value => value !== "");
    if (!callbackScripts.length || callbackScripts.some(value => value.trim() !== value))
      throw new Error("SetTimer requires source callback script names");
    return { kind: "field-timer", command: { kind: "set", seconds, displayUI: sourceSelectors.display === 0,
      updateStates, sourceSelectors, callbackScripts } };
  }
  if (ints.some(value => value !== 0) || reals.some(value => value !== 0) || strings.slice(1).some(value => value !== ""))
    throw new Error("Unsupported ordinary field timer reserved operands");
  if (instruction.mnemonic === "FinishTimer") {
    if (strings[0] !== "") throw new Error("Unsupported FinishTimer callback operand");
    return { kind: "field-timer", command: { kind: "finish" } };
  }
  const selector = strings[0];

  if (selector === "タイマー一時停止") return { kind: "field-timer", command: { kind: "pause" } };
  if (selector === "タイマー一時停止解除") return { kind: "field-timer", command: { kind: "resume" } };
  if (selector === "時間切れでスクリプト変更") return { kind: "field-timer", command: { kind: "change-script-if-expired" } };
  throw new Error("Unsupported ordinary field timer SysCall selector: " + selector);
}

export function compileFieldScenarioTimerInstruction(raw: unknown): FieldScenarioTimerOp {
  const instruction = record(raw), operands = record(instruction.operands);
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues), strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (instruction.type !== 1 || instruction.mnemonic !== "SysCall" || ints.some(value => value !== 0) || reals.some(value => value !== 0) ||
      strings.slice(1).some(value => value !== "") || !Object.hasOwn(fieldScenarioTimerSelectors, strings[0]!))
    throw new Error("Unsupported source scenario timer operands/selector");
  return {kind: "field-scenario-timer", command: fieldScenarioTimerSelectors[strings[0] as keyof typeof fieldScenarioTimerSelectors]};
}
