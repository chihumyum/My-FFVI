import { z } from "zod";
import { enemyVariableCount } from "../core/enemy-behavior.js";
import { isOperator } from "../core/script-integer.js";
import { compileBattleEventBranch } from "./battle-event-context.js";
import type {
  BattleAIProgram,
  BattleAIOp,
  BattleAISource,
} from "../core/battle-ai.js";

const integer = z.number().int().min(-0x80000000).max(0x7fffffff);
const instruction = z.object({
  mnemonic: z.string(),
  type: integer.optional(),
  operands: z.object({
    iValues: z.array(integer),
    rValues: z.array(z.number().finite()),
    sValues: z.array(z.string()),
  }),
});
const script = z.object({
  Mnemonics: z.array(z.unknown()).min(1),
  Segments: z.array(
    z.object({ Label: z.string(), EntryPoint: integer, Count: integer }),
  ),
  ScriptLocal: z.array(z.string()),
  ScriptLocalValue: z.array(integer).nullable().optional(),
  SystemFlag: z.record(z.string(), integer),
  Animations: z.array(z.unknown()),
});

/** Preserve PCs and provenance. Unsupported operands/instructions survive as
 * explicit stops, so a successful decode is not executable AI coverage. */
export function compileBattleAI(
  raw: unknown,
  source: BattleAISource | null,
): BattleAIProgram {
  const data = script.parse(raw);
  const main = data.Segments.filter((s) => s.Label === "Main");
  const segment = main.length === 1 ? main[0]! : null;
  const entry = segment?.EntryPoint ?? 0;
  const end = entry + (segment?.Count ?? data.Mnemonics.length);
  const blockers: string[] = [];
  if (
    !segment ||
    data.Segments.length !== 1 ||
    entry < 0 ||
    end <= entry ||
    end > data.Mnemonics.length
  )
    blockers.push("unresolved AI entry segment");
  if (data.ScriptLocal.length || data.ScriptLocalValue?.length)
    blockers.push("AI script locals are not implemented");
  if (
    Object.entries(data.SystemFlag).some(
      ([name, value]) =>
        value !== 0 ||
        ![
          "KeepBadStatusVisual",
          "KeepPlayerPuppet",
          "RidingVehicle",
          "SkipInitialize",
        ].includes(name),
    ) ||
    data.Animations.length
  )
    blockers.push("unresolved AI script flags or animations");
  const instructions = data.Mnemonics.map((raw) => {
    const parsed = instruction.safeParse(raw);
    if (!parsed.success)
      return {
        mnemonic: "invalid",
        op: {
          kind: "blocked",
          reason: "invalid AI instruction encoding",
        } as BattleAIOp,
      };
    const m = parsed.data,
      i = m.operands.iValues,
      r = m.operands.rValues,
      s = m.operands.sValues;
    const blocked = (reason: string): BattleAIOp => ({
      kind: "blocked",
      reason,
    });
    const form = (used: number[], strings: number[] = []) =>
      i.every((v, n) => v === 0 || used.includes(n)) &&
      r.every((v) => v === 0) &&
      s.every((v, n) => v === "" || strings.includes(n));
    const jump = (target: number | undefined): target is number =>
      target !== undefined && target >= entry && target < end;
    const variable = (index: number | undefined): index is number =>
      index !== undefined && index < enemyVariableCount;
    let op: BattleAIOp = blocked(
      `unsupported AI instruction or operands: ${m.mnemonic}`,
    );
    if (m.type === 1) {
      const eventBranch = compileBattleEventBranch(m.mnemonic, m.operands, { entry, end });
      if (eventBranch) op = eventBranch;
      if (form([])) {
        if (m.mnemonic === "Nop") op = { kind: "nop" };
        if (m.mnemonic === "SyncAI") op = { kind: "sync" };
        if (m.mnemonic === "Exit") op = { kind: "exit" };
        if (m.mnemonic === "EndTable") op = { kind: "end-table" };
        if (m.mnemonic === "ModeCount") op = { kind: "mode-count" };
      }
      if (m.mnemonic === "JumpBattleAI" && form([0]) && jump(i[0]))
        op = { kind: "jump", target: i[0] };
      if (m.mnemonic === "StartTable" && form([0]))
        op = { kind: "start-table", tableId: i[0] ?? null };
      if (
        m.mnemonic === "VariableAssign" &&
        form([0, 1]) &&
        variable(i[0]) &&
        i[1] !== undefined
      )
        op = { kind: "variable-assign", index: i[0], value: i[1] };
      if (
        m.mnemonic === "ValueCalc" &&
        form([0, 1], [0]) &&
        variable(i[0]) &&
        i[1] !== undefined &&
        s[0] !== undefined &&
        isOperator(s[0])
      )
        op = {
          kind: "variable-calc",
          index: i[0],
          value: i[1],
          operator: s[0],
        };
      if (
        m.mnemonic === "IsVariableComparison" &&
        form([0, 1, 2], [0]) &&
        variable(i[0]) &&
        i[1] !== undefined &&
        jump(i[2]) &&
        s[0] !== undefined &&
        isOperator(s[0])
      )
        op = {
          kind: "variable-branch",
          index: i[0],
          value: i[1],
          operator: s[0],
          target: i[2],
        };
      if (
        ["IsCheckHp", "IsCheckMp"].includes(m.mnemonic) &&
        form([0, 1], [0]) &&
        i[0] !== undefined &&
        jump(i[1]) &&
        s[0] !== undefined &&
        isOperator(s[0])
      )
        op = {
          kind: "resource-branch",
          resource: m.mnemonic === "IsCheckHp" ? "hp" : "mp",
          value: i[0],
          operator: s[0],
          target: i[1],
        };
      if (m.mnemonic === "ModeSet" && form([0]) && i[0] !== undefined)
        op = { kind: "mode-set", value: i[0] };
      if (
        ["IsModeSelecting", "IsNotModeSelecting"].includes(m.mnemonic) &&
        form([0, 1]) &&
        i[0] !== undefined &&
        jump(i[1])
      )
        op = {
          kind: "mode-branch",
          value: i[0],
          equal: m.mnemonic === "IsModeSelecting",
          target: i[1],
        };
      if (
        ["IsRecevieAbility", "IsRecevieAbilitySystem", "IsReceiveCommand", "IsCheckReceiveCommand"].includes(m.mnemonic) &&
        form([0, 1]) &&
        i[0] !== undefined &&
        jump(i[1])
      )
        op = {
          kind: "received-ability-branch",
          // The two command keys bind the same 0x826290 consumer. Its
          // IActSelectEnemy slot 30 returns the received Ability.TypeId,
          // independently of the player's selected command master ID.
          field: m.mnemonic === "IsRecevieAbility" ? "id"
            : m.mnemonic === "IsRecevieAbilitySystem" ? "systemId" : "typeId",
          value: i[0],
          target: i[1],
        };
      if (
        m.mnemonic === "IsMyCondition" &&
        form([0, 1]) &&
        i[0] !== undefined &&
        i[0] > 0 &&
        jump(i[1])
      )
        op = { kind: "condition", conditionId: i[0], target: i[1] };
      if (
        m.mnemonic === "IsLevelCheck" &&
        form([0, 1, 2]) &&
        [1, 2].includes(i[0]!) &&
        i[1] !== undefined &&
        i[1] >= 0 &&
        jump(i[2])
      )
        op = {
          kind: "level",
          side: i[0] === 1 ? "player" : "enemy",
          minimum: i[1],
          target: i[2],
        };
      if (
        ["Act", "CounterAct"].includes(m.mnemonic) &&
        i.length &&
        i.every((id) => id > 0) &&
        s.every((v) => v === "") &&
        (!r.length ||
          (r.length === i.length &&
            r.every((w) => w >= 0 && Number.isFinite(Math.fround(w))) &&
            Number.isFinite(
              r.map(Math.fround).reduce((a, b) => Math.fround(a + b), 0),
            ) &&
            r.some((w) => Math.fround(w) > 0)))
      )
        op = {
          kind: m.mnemonic === "Act" ? "act" : "counter-act",
          abilities: i,
          weights: r,
        };
      if (
        m.mnemonic === "CounterActReceiveCommand" &&
        i.length >= 2 && i[0]! >= 0 && i.slice(1).every(id => id > 0) &&
        s.length === 0 && r.length === i.length && r[0] === 0 &&
        r.every(weight => weight >= 0 && Number.isFinite(Math.fround(weight))) &&
        Number.isFinite(r.map(Math.fround).reduce((sum, weight) => Math.fround(sum + weight), 0)) &&
        r.some(weight => Math.fround(weight) > 0)
      )
        // GetIndex(bc,1) 0x821bf0 uses the entire weighted array, ignoring
        // startIndex in its weighted path. The proven zero first weight is
        // the selector placeholder; removing only that zero preserves every
        // candidate, f32 draw boundary and the final-slot fallback.
        op = { kind: "counter-received-command", receivedTypeId: i[0]!, targeting: "automatic",
          abilities: i.slice(1), weights: r.slice(1) };
      if (
        m.mnemonic === "LoopAct" &&
        i.length &&
        i.every((id) => id > 0) &&
        new Set(i).size === i.length &&
        r.length === i.length &&
        r.every(
          (n) => Math.trunc(n) >= -0x80000000 && Math.trunc(n) <= 0x7fffffff,
        ) &&
        s.every((value) => value === "")
      )
        op = { kind: "loop-act", abilities: i, counts: r.map(Math.trunc) };
    }
    return { mnemonic: m.mnemonic, op };
  });
  return {
    kind: "battle-ai-v4",
    source,
    entry,
    end,
    instructions,
    blockers,
  };
}

export function battleAIAbilities(program: BattleAIProgram): number[] {
  return [
    ...new Set(
      program.instructions.flatMap(({ op }) =>
        op.kind === "act" || op.kind === "loop-act" || op.kind === "counter-act" || op.kind === "counter-received-command"
          ? op.abilities
          : [],
      ),
    ),
  ];
}
