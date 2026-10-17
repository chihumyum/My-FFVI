import { compileBattleAI } from "../../src/compiler/battle-ai.js";

export type SyntheticAIInstruction = [string, number[]?, number[]?, string[]?];
export function aiSource(ops: SyntheticAIInstruction[]) {
  return {
    Segments: [{ Label: "Main", EntryPoint: 0, Count: ops.length }],
    ScriptLocal: [],
    ScriptLocalValue: [],
    SystemFlag: {},
    Animations: [],
    Mnemonics: ops.map(
      ([mnemonic, iValues = [], rValues = [], sValues = []]) => ({
        mnemonic,
        type: 1,
        operands: { iValues, rValues, sValues },
      }),
    ),
  };
}
export function syntheticAI(ops: SyntheticAIInstruction[]) {
  return compileBattleAI(aiSource(ops), null);
}
export function cyclingAI(abilities: number[]) {
  return syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ...abilities.map((id): SyntheticAIInstruction => ["Act", [id], [100]]),
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
}
