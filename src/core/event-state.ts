import { checkpointKeys } from "./checkpoint-validation.js";
import {
  int32,
  integerOperation as eventOperation,
  type Operator,
} from "./script-integer.js";
export {
  int32,
  isOperator,
  operators,
  integerOperation as eventOperation,
  type Operator,
} from "./script-integer.js";

/** Source DataStorage semantics. Unknown checkpoint values are kept distinct from initialized zeroes. */
export const categories = [
  "ScenarioFlag1",
  "ScenarioFlag2",
  "ScenarioFlag3",
  "ScenarioFlag4",
  "TreasureFlag1",
  "TreasureFlag2",
  "TreasureFlag3",
  "TreasureFlag4",
  "ScenarioVariable",
  "AreaLocalVariable",
  "MapLocalVariable",
  "ScriptLocalVariable",
  "MessageSelection",
  "ItemSelection",
] as const;
export type Category = (typeof categories)[number];
export type VariableRef = { category: Category; index: number };
export type EventValue =
  { kind: "immediate"; value: number } | { kind: "variable"; ref: VariableRef };
export type EventControlOp =
  | { kind: "jump"; target: number }
  | { kind: "calc"; left: VariableRef; operator: Operator; right: EventValue }
  | {
      kind: "branch";
      left: VariableRef;
      operator: Operator;
      right: EventValue;
      target: number;
    }
  | { kind: "flag"; ref: VariableRef; operation: "set" | "reset" | "flip" };
type Value = number | null;
export type EventStateSnapshot = {
  formatVersion: 1;
  kind: "event-variables";
  scenario: Value[];
  treasure: Value[];
  global: Value[];
  area: Value[];
  map: Value[];
  script: Value[] | null;
  scriptLabels: string[] | null;
  selected: Value;
  itemSelected: Value;
  currentMapId: Value;
};
export type ScriptLocals = { labels: string[]; values: number[] | null };
export function isCategory(name: string): name is Category {
  return (categories as readonly string[]).includes(name);
}
export function validVariable(ref: VariableRef): boolean {
  if (
    !isCategory(ref.category) ||
    !Number.isInteger(ref.index) ||
    ref.index < -2147483648 ||
    ref.index > 2147483647
  )
    return false;
  const c = categories.indexOf(ref.category);
  if (c < 8) {
    const bit = (c % 4) * 256 + ref.index;
    return bit >= 0 && bit < 1024;
  }
  if (c >= 12) return true; // Source selection registers ignore the index operand.
  return ref.index >= 0 && (c === 11 || ref.index < (c === 8 ? 16 : 8));
}
function blank(value: Value): EventStateSnapshot {
  return {
    formatVersion: 1,
    kind: "event-variables",
    scenario: Array(1024).fill(value),
    treasure: Array(1024).fill(value),
    global: Array(16).fill(value),
    area: Array(8).fill(value),
    map: Array(8).fill(value),
    script: null,
    scriptLabels: null,
    selected: value,
    itemSelected: value,
    currentMapId: null,
  };
}
function validateSnapshot(raw: EventStateSnapshot): EventStateSnapshot {
  checkpointKeys(
    raw,
    "formatVersion,kind,scenario,treasure,global,area,map,script,scriptLabels,selected,itemSelected,currentMapId",
  );
  if (raw?.formatVersion !== 1 || raw.kind !== "event-variables")
    throw new Error("Unsupported event-state snapshot");
  const check = (v: unknown, bit = false) => {
    if (v !== null) {
      int32(v);
      if (bit && v !== 0 && v !== 1) throw new Error("Invalid flag value");
    }
  };
  for (const [key, length, bit] of [
    ["scenario", 1024, true],
    ["treasure", 1024, true],
    ["global", 16, false],
    ["area", 8, false],
    ["map", 8, false],
  ] as const) {
    if (!Array.isArray(raw[key]) || raw[key].length !== length)
      throw new Error("Invalid event-state bank: " + key);
    for (const v of raw[key]) check(v, bit);
  }
  if (raw.script === null) {
    if (raw.scriptLabels !== null) throw new Error("Mismatched script labels");
  } else {
    if (
      !Array.isArray(raw.script) ||
      !Array.isArray(raw.scriptLabels) ||
      raw.script.length !== raw.scriptLabels.length ||
      raw.scriptLabels.some((v) => typeof v !== "string")
    )
      throw new Error("Invalid script variables");
    for (const v of raw.script) check(v);
  }
  check(raw.selected);
  check(raw.itemSelected);
  check(raw.currentMapId);
  return structuredClone(raw);
}
export class UnknownEventValue extends Error {
  constructor(readonly ref: VariableRef) {
    super(`未知事件状态 ${ref.category}[${ref.index}]`);
  }
}
export class EventState {
  private data: EventStateSnapshot;
  constructor(snapshot?: EventStateSnapshot) {
    this.data = snapshot ? validateSnapshot(snapshot) : blank(null);
  }
  /** Call only for a real initialized state, never to fill gaps in a mid-game checkpoint. */
  static initialized(): EventState {
    return new EventState(blank(0));
  }
  snapshot(): EventStateSnapshot {
    return structuredClone(this.data);
  }
  private address(
    ref: VariableRef,
  ):
    | { bank: Value[]; index: number; flag: boolean }
    | { selection: "selected" | "itemSelected" } {
    if (!validVariable(ref))
      throw new Error(`Invalid event address ${ref.category}[${ref.index}]`);
    const c = categories.indexOf(ref.category);
    if (c < 8)
      return {
        bank: c < 4 ? this.data.scenario : this.data.treasure,
        index: (c % 4) * 256 + ref.index,
        flag: true,
      };
    if (c >= 12) return { selection: c === 12 ? "selected" : "itemSelected" };
    const bank = [
      this.data.global,
      this.data.area,
      this.data.map,
      this.data.script,
    ][c - 8];
    if (!bank || ref.index >= bank.length)
      throw new Error(
        `Uninitialized or invalid event bank ${ref.category}[${ref.index}]`,
      );
    return { bank, index: ref.index, flag: false };
  }
  read(ref: VariableRef): number {
    const a = this.address(ref),
      value = "selection" in a ? this.data[a.selection] : a.bank[a.index];
    if (value == null) throw new UnknownEventValue(ref);
    return value;
  }
  write(ref: VariableRef, value: number): void {
    int32(value);
    const a = this.address(ref);
    if ("selection" in a) this.data[a.selection] = value;
    else a.bank[a.index] = a.flag ? Number(value !== 0) : value;
  }
  beginScript(locals: ScriptLocals | null): void {
    // Integrator.Execute skips CreateScriptLocal when the source omits ScriptLocal.
    if (locals === null) return;
    if (
      !Array.isArray(locals.labels) ||
      locals.labels.some((x) => typeof x !== "string")
    )
      throw new Error("Invalid script-local labels");
    const values =
      locals.values?.length === locals.labels.length
        ? locals.values.map(int32)
        : locals.labels.map(() => 0);
    this.data.scriptLabels = [...locals.labels];
    this.data.script = values;
    this.data.selected = 0;
    this.data.itemSelected = 0;
  }
  clearMap(mapId: number): void {
    this.data.currentMapId = int32(mapId);
    this.data.map.fill(0);
    this.data.selected = 0;
    this.data.itemSelected = 0;
  }
  clearArea(mapId: number): void {
    this.clearMap(mapId);
    this.data.area.fill(0);
  }
  resolve(value: EventValue): number {
    return value.kind === "immediate"
      ? int32(value.value)
      : this.read(value.ref);
  }
  evaluate(left: VariableRef, operator: Operator, right: EventValue): number {
    this.address(left); // Assignment can establish an unknown cell, but cannot create an invalid one.
    return eventOperation(
      operator === "←" ? 0 : this.read(left),
      operator,
      this.resolve(right),
    );
  }
  flagView(): Record<string, Record<string, boolean>> {
    const out: Record<string, Record<string, boolean>> = {};
    for (const [offset, bank] of [
      [0, this.data.scenario],
      [4, this.data.treasure],
    ] as const)
      bank.forEach((v, i) => {
        if (v !== null)
          (out[categories[offset + Math.floor(i / 256)]!] ??= {})[i % 256] =
            v !== 0;
      });
    return out;
  }
}
/** Mutates only the owning task PC and shared event variables. False means this is a host instruction. */
export function executeEventControl(
  op: { kind: string },
  state: EventState,
  cursor: { pc: number },
  length: number,
): boolean {
  const jump = (target: number) => {
    if (!Number.isInteger(target) || target < 0 || target >= length)
      throw new Error("Invalid event jump target");
    cursor.pc = target;
  };
  switch (op.kind) {
    case "jump":
      jump((op as Extract<EventControlOp, { kind: "jump" }>).target);
      return true;
    case "flag": {
      const o = op as Extract<EventControlOp, { kind: "flag" }>;
      state.write(
        o.ref,
        o.operation === "set"
          ? 1
          : o.operation === "reset"
            ? 0
            : Number(state.read(o.ref) === 0),
      );
      return true;
    }
    case "calc": {
      const o = op as Extract<EventControlOp, { kind: "calc" }>;
      state.write(o.left, state.evaluate(o.left, o.operator, o.right));
      return true;
    }
    case "branch": {
      const o = op as Extract<EventControlOp, { kind: "branch" }>;
      if (state.evaluate(o.left, o.operator, o.right) === 1) jump(o.target);
      return true;
    }
    default:
      return false;
  }
}
