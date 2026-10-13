import { z } from "zod";
import type { BattleAISource } from "../core/battle-ai.js";
import type { BattleEventOp, BattleEventProgram, BattleEventValue } from "../core/battle-event.js";
import { isOperator } from "../core/script-integer.js";
import { isCategory, validVariable, type EventValue, type VariableRef } from "../core/event-state.js";

const integer = z.number().int().min(-0x80000000).max(0x7fffffff);
const flags = ["KeepBadStatusVisual", "KeepPlayerPuppet", "RidingVehicle", "SkipInitialize"] as const;
const sharedCategories = ["ScenarioFlag1", "ScenarioFlag2", "ScenarioFlag3", "ScenarioFlag4",
  "TreasureFlag1", "TreasureFlag2", "TreasureFlag3", "TreasureFlag4",
  "ScenarioVariable", "ScriptLocalVariable"];
const script = z.object({
  Name: z.string().min(1),
  Title: z.object({ main: z.string(), sub: z.string() }).strict(),
  Mnemonics: z.array(z.unknown()).min(1),
  Segments: z.array(z.object({ Label: z.string(), EntryPoint: integer, Count: integer }).strict()),
  ScriptLocal: z.array(z.string()),
  ScriptLocalValue: z.array(integer).nullable(),
  SystemFlag: z.record(z.string(), integer),
  Animations: z.array(z.unknown()),
}).strict();
const instruction = z.object({
  mnemonic: z.string(), type: integer,
  label: z.string().optional(), comment: z.string().optional(),
  operands: z.object({ iValues: z.array(integer), rValues: z.array(z.number().finite()),
    sValues: z.array(z.string()) }).strict(),
}).strict();

/** Battle-event compilation is distinct from monster AI. Preserve every source
 * PC; unknown hosts, operands and branches remain explicit blocked operations.
 * This compiler does not certify a native scheduler or grant owned effects. */
export function compileBattleEvent(raw: unknown, source: BattleAISource | null): BattleEventProgram {
  const data = script.parse(raw), blockers: string[] = [];
  const main = data.Segments.length === 1 && data.Segments[0]!.Label === "Main" ? data.Segments[0]! : null;
  // Other segment layouts need their own entry/range proof. The bounded Main
  // contract admits all of sc_b_2001 without special-casing its identity.
  if (!main || main.EntryPoint !== 0 || main.Count !== data.Mnemonics.length)
    blockers.push("unresolved battle-event Main segment");
  if (data.Animations.length) blockers.push("battle-event custom animations require a host");
  if (Object.keys(data.SystemFlag).length !== flags.length ||
      flags.some(name => data.SystemFlag[name] !== 0) ||
      Object.keys(data.SystemFlag).some(name => !(flags as readonly string[]).includes(name)))
    blockers.push("battle-event SystemFlag requires four explicitly supported zero flags");
  if (new Set(data.ScriptLocal).size !== data.ScriptLocal.length)
    blockers.push("ambiguous battle-event local labels");
  // Name is an authoring label, not the asset identity: several source assets
  // retain a copied script name. The encounter resolver binds script.csv to
  // the verified asset path; retain that independent provenance unchanged.
  const entry = 0, end = data.Mnemonics.length;
  // DataStorage.CreateScriptLocal uses a zero bank when the initial-value count
  // differs. Keep that existing shared source contract, including explicit null.
  const initialLocals = data.ScriptLocalValue?.length === data.ScriptLocal.length
    ? [...data.ScriptLocalValue] : data.ScriptLocal.map(() => 0);
  const local = (index: number | undefined): index is number =>
    index !== undefined && index >= 0 && index < data.ScriptLocal.length;
  const variable = (category: string | undefined, index: number | undefined): VariableRef | null => {
    if (category === undefined || index === undefined || !sharedCategories.includes(category) || !isCategory(category))
      return null;
    const ref = { category, index };
    return validVariable(ref) && (category !== "ScriptLocalVariable" || local(index)) ? ref : null;
  };
  const target = (index: number | undefined): index is number =>
    index !== undefined && index >= entry && index + 1 < end;
  const instructions = data.Mnemonics.map(raw => {
    const parsed = instruction.safeParse(raw);
    if (!parsed.success) return { mnemonic: "invalid", op: { kind: "blocked" as const,
      reason: "invalid battle-event instruction encoding" } };
    const m = parsed.data, i = m.operands.iValues, r = m.operands.rValues, s = m.operands.sValues;
    const blocked = (reason: string): BattleEventOp => ({ kind: "blocked", reason });
    let op: BattleEventOp = blocked(`unsupported battle-event instruction or operands: ${m.mnemonic}`);
    if (m.type !== 1) return { mnemonic: m.mnemonic, op };
    // Nop/Blank do not consume operands. Actual scripts retain formerly
    // authored arguments, so zero-only validation would change their meaning.
    if (m.mnemonic === "Nop" || m.mnemonic === "Blank") {
      const full = i.length === 8 && r.length === 8 && s.length === 8;
      const label = m.mnemonic === "Nop" && i.length === 0 && r.length === 0 && s.length === 0;
      return { mnemonic: m.mnemonic, op: full || label
        ? { kind: m.mnemonic === "Nop" ? "nop" as const : "blank" as const } : op };
    }
    const form = (ints: number[] = [], reals: number[] = [], strings: number[] = []) =>
      i.length === 8 && r.length === 8 && s.length === 8 &&
      i.every((v, n) => v === 0 || ints.includes(n)) &&
      r.every((v, n) => v === 0 || reals.includes(n)) &&
      s.every((v, n) => v === "" || strings.includes(n));
    if (form()) {
      if (m.mnemonic === "Exit") op = { kind: "exit" };
      if (m.mnemonic === "Return") op = { kind: "return" };
      if (m.mnemonic === "WaitToBattleStart") op = { kind: "wait-start" };
      if (m.mnemonic === "ExecBattleAI") op = { kind: "exec-ai" };
      if (m.mnemonic === "BattleSyncAction") op = { kind: "sync-action" };
      if (m.mnemonic === "SyncBattleAI") op = local(0) ? { kind: "sync-ai" }
        : blocked("SyncBattleAI requires ScriptLocalVariable[0]");
    }
    if (["Call", "Jump"].includes(m.mnemonic) && form([0]) && target(i[0]))
      op = { kind: m.mnemonic === "Call" ? "call" : "jump", target: i[0] };
    if (m.mnemonic === "BattleEndEnabled" && form([0]))
      op = { kind: "end-enabled", enabled: i[0] !== 0 };
    if (m.mnemonic === "BattlePause" && form([0])) op = { kind: "pause", enabled: i[0] !== 0 };
    if (m.mnemonic === "BattleInteractive" && form([0])) op = { kind: "interactive", enabled: i[0] !== 0 };
    if (m.mnemonic === "BattleSleepEnemy" && form([0])) op = { kind: "enemy-no-act", enabled: i[0] !== 0 };
    if (m.mnemonic === "BattleAddEnemy" && form([0, 1]) && i[0]! > 0 && i[1]! >= 1 && i[1]! <= 9)
      op = { kind: "add-enemy", monsterId: i[0]!, uniqueId: i[1]! };
    if (m.mnemonic === "SysCall" && form([], [], [0]) && s[0] === "プレイヤーの状況で戦闘終了")
      op = local(0) ? { kind: "players-ended" }
        : blocked("Player battle-end query requires ScriptLocalVariable[0]");
    // Format.rValues and Integrator.time are doubles in this build.
    if (m.mnemonic === "Wait" && form([], [0])) op = { kind: "wait", seconds: r[0]! };
    if (["SetFlag", "ResetFlag", "FlipFlag"].includes(m.mnemonic) && form([0], [], [0])) {
      const ref = variable(s[0], i[0]);
      if (ref) op = { kind: "variable-flag", ref,
        operation: m.mnemonic === "SetFlag" ? "set" : m.mnemonic === "ResetFlag" ? "reset" : "flip" };
    }
    if (["Calc", "Branch"].includes(m.mnemonic) &&
        form(m.mnemonic === "Branch" ? [0, 1, 2] : [0, 1], [], [0, 1, 2]) && isOperator(s[1]!)) {
      const left = variable(s[0], i[0]), rightRef = variable(s[2], i[1]);
      const right: EventValue | null = s[2] === "imm" ? { kind: "immediate", value: i[1]! }
        : rightRef ? { kind: "variable", ref: rightRef } : null;
      if (left && right && (m.mnemonic === "Calc" || target(i[2]))) {
        if (left.category === "ScriptLocalVariable" &&
            (right.kind === "immediate" || right.ref.category === "ScriptLocalVariable")) {
          const localRight: BattleEventValue = right.kind === "immediate" ? right : { kind: "local", index: right.ref.index };
          op = m.mnemonic === "Calc" ? { kind: "calc", index: left.index, operator: s[1], right: localRight }
            : { kind: "branch", index: left.index, operator: s[1], right: localRight, target: i[2]! };
        } else op = m.mnemonic === "Calc" ? { kind: "variable-calc", left, operator: s[1], right }
          : { kind: "variable-branch", left, operator: s[1], right, target: i[2]! };
      }
    }
    return { mnemonic: m.mnemonic, op };
  });
  return structuredClone({ kind: "battle-event-v1", source, entry, end,
    localNames: data.ScriptLocal, initialLocals, instructions, blockers });
}
