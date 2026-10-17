import { EventState, type VariableRef } from "../../src/core/event-state.js";
import { FieldGame, type FieldGameOptions } from "../../src/core/field.js";
import type { Op, Site } from "../../src/field/types.js";
import { checkpointFixture } from "./checkpoint-game.js";

export type TransitionInstruction<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
export const transition = (targetScript: string, returnToCaller = false): TransitionInstruction =>
  ({ kind: "script-transition", targetScript, returnToCaller });
export const exit = { kind: "exit" } as const;
export const label = { kind: "nop" } as const;
export const wait = { kind: "wait", seconds: 0 } as const;
export const mapVar = (index = 0): VariableRef => ({ category: "MapLocalVariable", index });
export const localVar = (index = 0): VariableRef => ({ category: "ScriptLocalVariable", index });
export const selected: VariableRef = { category: "MessageSelection", index: 0 };
export const itemSelected: VariableRef = { category: "ItemSelection", index: 0 };
export const set = (ref: VariableRef, value: number): TransitionInstruction =>
  ({ kind: "calc", left: ref, operator: "←", right: { kind: "immediate", value } });
export const copy = (ref: VariableRef, from: VariableRef): TransitionInstruction =>
  ({ kind: "calc", left: ref, operator: "←", right: { kind: "variable", ref: from } });
export function transitionFixture(scripts: Record<string, TransitionInstruction[]>, options: FieldGameOptions = {}) {
  const content = checkpointFixture().field;
  content.scripts = Object.fromEntries(Object.entries(scripts).map(([script, instructions]) => [script,
    instructions.map((instruction, index) => ({ ...instruction, script, index,
      source: { file: "synthetic", assetPath: `transition/${script}` } } as Op))]));
  // Explicit controlled declarations, never a production missing-data fallback.
  content.scriptLocals = Object.fromEntries(Object.keys(scripts).map((name) => [name, null]));
  content.scriptTransitionMetadata = Object.fromEntries(Object.keys(scripts).map((name) => [name,
    { customAnimations: "none" as const }]));
  const state = EventState.initialized();
  return { content, state, create: () => new FieldGame(content, state, undefined, undefined, options) };
}
