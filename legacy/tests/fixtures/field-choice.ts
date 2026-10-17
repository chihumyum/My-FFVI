import type { FieldChoiceOp } from "../../src/core/field-choice.js";
import { EventState } from "../../src/core/event-state.js";
import { FieldGame, type FieldGameOptions } from "../../src/core/field.js";
import type { Op, Site } from "../../src/field/types.js";
import { checkpointFixture } from "./checkpoint-game.js";

export type ChoiceInstruction<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
export const choiceDefinition = (changes: Partial<FieldChoiceOp> = {}): FieldChoiceOp => ({
  kind: "choice", options: [{ key: "ONE", text: "First" }, { key: "TWO", text: "Second" }],
  initialIndex: 0, cancelIndex: null, anchor: "bottom-center", presentation: "multiple", retainMessage: false,
  ...changes,
});
export const choiceMessage = { kind: "message", key: "PROMPT", speaker: "Guide", text: "Choose a route." } satisfies ChoiceInstruction;
export const choiceExit: ChoiceInstruction = { kind: "exit" };
export const choiceWait: ChoiceInstruction = { kind: "wait", seconds: 0 };
export const selection = { category: "MessageSelection", index: 0 } as const;
export const choiceVariable = (index = 0) => ({ category: "MapLocalVariable" as const, index });
export const choiceAssign = (value: number, index = 0): ChoiceInstruction => ({ kind: "calc",
  left: choiceVariable(index), operator: "←", right: { kind: "immediate", value } });
export const copySelection: ChoiceInstruction = { kind: "calc", left: choiceVariable(), operator: "←",
  right: { kind: "variable", ref: selection } };
export function choiceFixture(instructions: ChoiceInstruction[], options: FieldGameOptions = {}) {
  const fixture = checkpointFixture();
  fixture.field.scripts.choice = instructions.map((op, index) => ({ ...op, index, script: "choice",
    source: { file: "synthetic", assetPath: "field-choice" } } as Op));
  const state = EventState.initialized(); state.write(selection, 9);
  const field = new FieldGame(fixture.field, state, undefined, undefined, options);
  return { ...fixture, content: fixture.field, field, state };
}
