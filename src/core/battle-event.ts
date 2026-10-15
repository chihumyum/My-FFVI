import { WEB_BATTLE_BRANCH_EXECUTION, validateBattleBranchExecutionPolicy, parseBattleSourceInstruction, classifyDeferredBattleInstruction, type WebBattleBranchExecution, type BattleSourceInstruction, type BattleDeferredInstructionCategory } from './battle-branch-execution.js';
import {parseBattleEventEffectOp,type BattleEventEffectOp} from './battle-event-effect.js';
import { readBattleEnemyMode } from './battle-gau.js';
import { parseScriptedBattleAction, type ScriptedBattleAction } from "./scripted-battle-action.js";
import type { BattleAISource } from "./battle-ai.js";
import { int32, integerOperation, isOperator, type Operator } from "./script-integer.js";
import { checkpointInteger, checkpointKeys, checkpointNumber, checkpointRecord } from "./checkpoint-validation.js";
import { validVariable, type EventValue, type VariableRef } from "./event-state.js";
import { parseBattleEventMessageOp, parseBattleEventMessageBinding,
  type BattleEventMessageOp, type BattleEventMessageBinding } from "./battle-event-message.js";
import { pollSourceMessageTask, type SourceMessageTaskCursor, type SourceMessageSequenceStatus } from "./source-message-sequence.js";

/** BattleGame owns every unit, AI core, action queue, permission, and RNG. This
 * interpreter owns only a detached continuation and script-local integers. */
export type BattleEventValue =
  | { kind: "immediate"; value: number }
  | { kind: "local"; index: number };
export type BattleEventOp =
  | ScriptedBattleAction
  | BattleEventEffectOp
  | BattleEventMessageOp
  | { kind: "ui-visibility"; visible: boolean }
  | { kind: "stop-auto" | "force-return" | "remove-all-actions" }
  | { kind: "cursed-shield-check" | "shadow-secede-lot" }
  | { kind: "set-gau-mode" }
  | { kind: "get-enemy-mode"; uniqueId:number; expected:number }
  | { kind: "nop" | "blank" | "exit" | "return" | "wait-start" | "exec-ai" | "sync-ai" | "sync-action" | "players-ended" }
  | { kind: "call" | "jump"; target: number }
  | { kind: "calc"; index: number; operator: Operator; right: BattleEventValue }
  | { kind: "branch"; index: number; operator: Operator; right: BattleEventValue; target: number }
  | { kind: "variable-calc"; left: VariableRef; operator: Operator; right: EventValue }
  | { kind: "variable-branch"; left: VariableRef; operator: Operator; right: EventValue; target: number }
  | { kind: "variable-flag"; ref: VariableRef; operation: "set" | "reset" | "flip" }
  | { kind: "wait"; seconds: number }
  | { kind: "add-enemy"; monsterId: number; uniqueId: number }
  | { kind: "add-player"; sourceId: number }
  /** Explicit Web selection. Native ChangePlayerParty has no group operand. */
  | { kind: "change-player-group"; group: 0 | 1 | 2 }
  | { kind: "change-enemy-party"; partyId: number; hidden: boolean }
  | { kind: "end-enabled" | "pause" | "interactive" | "enemy-no-act"; enabled: boolean }
  | { kind: "blocked"; reason: string };
export type BattleEventProgram = {
  kind: "battle-event-v1" | "battle-event-v2";
  branchExecution?: { policy: WebBattleBranchExecution; sourceProgram: { Name:string; Title:{main:string;sub:string}; Mnemonics:BattleSourceInstruction[]; Segments:{Label:string;EntryPoint:number;Count:number}[]; ScriptLocal:string[]; ScriptLocalValue:number[]|null; SystemFlag:Record<string,number>; Animations:unknown[] }; deferred: {pc:number;category:BattleDeferredInstructionCategory;reason:string}[] };
  source: BattleAISource | null;
  /** Entry is inclusive; end is exclusive. Jump targets name the label before
   * the next executed instruction, as in Internal.Main.Call/Return. */
  entry: number;
  end: number;
  localNames: string[];
  initialLocals: number[];
  instructions: { mnemonic: string; op: BattleEventOp }[];
  blockers: string[];
  /** Optional only for the explicit message family. Old program shape stays
   * unchanged; source text and name-table objects retain physical provenance. */
  messageBinding?: BattleEventMessageBinding;
};
export type BattleEventWait =
  | { kind: "message-prepare"; clock: number }
  | { kind: "message"; clock: number; cursor: SourceMessageTaskCursor }
  | { kind: "blank" | "start" | "action" | "script-action" | "enemy-party-entry" | "player-group-entry" | "battle-effect"; clock: number }
  | { kind: "time"; clock: number; entryTimeSeconds: number }
  | { kind: "enemy-entry" | "player-entry"; clock: number; previousNoAct: boolean };
export type BattleEventState = {
  pc: number;
  stack: number[];
  locals: number[];
  status: "running" | "waiting" | "exited";
  wait: BattleEventWait | null;
  /** Host clock identity also bounds loops that cross request boundaries. */
  clock: number | null;
  clockInstructions: number;
};
export type BattleEventContext = {
  clock: number;
  /** The host's existing simulation time, not a VM-owned countdown. */
  timeSeconds: number;
  started: boolean;
  aiCoreAlive: boolean;
  actionStaging: boolean;
  /** Only the shared banks are delegated. ScriptLocalVariable remains owned
   * by this VM; the battle host supplies its current transactional read view. */
  variables?: { read(ref: VariableRef): number };
  /** A source query of the current players, not an HP-derived VM cache. */
  playersEnded?: boolean;
  /** Joining completion belongs to the content/host entry operation, not to
   * the executor's action queues. The VM remembers the previous enemy gate. */
  enemyEntry?: { noAct: boolean; completed: boolean };
  enemyPartyEntry?: { completed: boolean };
  /** Native AddFellow waits on IsEndAct, separately from AddEnemy loading. */
  playerEntry?: { noAct: boolean; completed: boolean };
  playerGroupEntry?: { completed: boolean };
  messageStatus?: SourceMessageSequenceStatus;
  battleEffectsFinished?:boolean;
  enemyModes?:readonly {uniqueId:number;mode:number}[];
};
export type BattleEventRequest =
  | (ScriptedBattleAction & { pc: number })
  | { kind: "ui-visibility"; pc: number; visible: boolean }
  | { kind: "stop-auto" | "force-return" | "remove-all-actions"; pc: number }
  | { kind: "cursed-shield-check" | "shadow-secede-lot"; pc:number }
  | { kind: "set-gau-mode"; pc:number }
  | (Extract<BattleEventEffectOp,{kind:"play-battle-effect"}> & {pc:number})
  | { kind: "message"; pc: number; operation: BattleEventMessageOp }
  | { kind: "message-page-input"; pc: number; ticket: number }
  | { kind: "message-complete"; pc: number; ticket: number; close: boolean }
  | { kind: "exec-ai" | "sync-ai"; pc: number }
  | { kind: "write-variable"; pc: number; ref: VariableRef; value: number }
  | { kind: "add-enemy"; pc: number; monsterId: number; uniqueId: number }
  | { kind: "add-player"; pc: number; sourceId: number }
  | { kind: "change-player-group"; pc: number; group: 0 | 1 | 2 }
  | { kind: "change-enemy-party"; pc: number; partyId: number; hidden: boolean }
  | { kind: "end-enabled" | "pause" | "interactive" | "enemy-no-act"; pc: number; enabled: boolean };
export type BattleEventAdvance = {
  state: BattleEventState;
  /** At most one request. Prepare/apply it inside the BattleGame frame, then
   * resume with fresh context in that same clock. Never drain stale context. */
  requests: BattleEventRequest[];
  visited: number[];
};
/** A successful shared-window publication binds its ticket to this exact VM
 * request. Negative Msg goes Next immediately; synchronous Msg waits without
 * replaying its source operation on subsequent clocks. */
export function acknowledgeBattleEventMessage(program: BattleEventProgram, current: BattleEventState,
  pc: number, cursor: SourceMessageTaskCursor | null): BattleEventState {
  const state = parseState(current), op = program.instructions[pc]?.op;
  if (state.pc !== pc || state.status !== "waiting" || state.wait?.kind !== "message-prepare" ||
      op?.kind !== "message" || op.command.kind !== "sequence")
    throw new BattleEventError(program.source, pc, "Stale battle message publication request");
  if (op.command.seconds < 0) {
    if (cursor !== null) throw new BattleEventError(program.source, pc, "Asynchronous battle Msg cannot retain a wrapper cursor");
    state.pc++; state.status = "running"; state.wait = null;
  } else {
    const value = parseMessageCursor(cursor);
    if (value.after !== op.command.after) throw new BattleEventError(program.source, pc, "Battle message continuation changed");
    state.wait = { kind: "message", clock: state.wait.clock, cursor: value };
  }
  return state;
}
export class BattleEventError extends Error {
  constructor(readonly source: BattleAISource | null, readonly pc: number, readonly reason: string,
    readonly attemptedVisited: readonly number[] = [], readonly rawInstruction:BattleSourceInstruction|null=null) {
    super(`Battle event ${source?.assetPath ?? "synthetic"}#/Mnemonics/${pc}: ${reason}`);
    this.name = "BattleEventError";
  }
}

// Core is loaded directly as browser ESM. Keep runtime validation local and
// reconstruct each accepted object rather than depending on a Node schema host.
function record(raw: unknown, keys: string): Record<string, unknown> {
  checkpointKeys(raw, keys);
  return raw as Record<string, unknown>;
}
function text(raw: unknown, empty = false): string {
  if (typeof raw !== "string" || !empty && raw.length === 0)
    throw new Error("Invalid battle event text");
  return raw;
}
function integer(raw: unknown, minimum = 0, maximum = 2147483647): number {
  if (typeof raw !== "number") throw new Error("Invalid battle event integer");
  checkpointInteger(raw, minimum, maximum);
  return raw;
}
function finite(raw: unknown, minimum = -Number.MAX_VALUE): number {
  if (typeof raw !== "number") throw new Error("Invalid battle event number");
  checkpointNumber(raw, minimum, Number.MAX_VALUE);
  return raw;
}
function boolean(raw: unknown): boolean {
  if (typeof raw !== "boolean") throw new Error("Invalid battle event boolean");
  return raw;
}
function array<T>(raw: unknown, parse: (value: unknown, index: number) => T): T[] {
  if (!Array.isArray(raw)) throw new Error("Invalid battle event array");
  // Array.from visits sparse entries too; missing data is not an empty slot.
  return Array.from(raw, parse);
}
function parseValue(raw: unknown): BattleEventValue {
  checkpointRecord(raw);
  const value = raw as Record<string, unknown>;
  if (value.kind === "immediate") {
    checkpointKeys(value, "kind,value");
    return { kind: "immediate", value: int32(value.value) };
  }
  if (value.kind === "local") {
    checkpointKeys(value, "kind,index");
    return { kind: "local", index: integer(value.index) };
  }
  throw new Error("Invalid battle event operand");
}
function parseVariable(raw: unknown): VariableRef {
  const value = record(raw, "category,index"), category = text(value.category);
  if (!/^(?:Scenario|Treasure)Flag[1-4]$/.test(category) &&
      category !== "ScenarioVariable" && category !== "ScriptLocalVariable")
    throw new Error(`Unsupported battle event variable category: ${category}`);
  const ref: VariableRef = { category: category as VariableRef["category"], index: int32(value.index) };
  // Flags use the shared 1024-bit bank, including valid signed index aliases.
  // Local bank length is checked against this particular program below.
  if (!validVariable(ref)) throw new Error(`Invalid battle event variable: ${category}[${ref.index}]`);
  return ref;
}
function parseEventValue(raw: unknown): EventValue {
  checkpointRecord(raw);
  const value = raw as Record<string, unknown>;
  if (value.kind === "immediate") {
    checkpointKeys(value, "kind,value");
    return { kind: "immediate", value: int32(value.value) };
  }
  if (value.kind === "variable") {
    checkpointKeys(value, "kind,ref");
    return { kind: "variable", ref: parseVariable(value.ref) };
  }
  throw new Error("Invalid battle event variable operand");
}
function parseOp(raw: unknown): BattleEventOp {
  checkpointRecord(raw);
  const value = raw as Record<string, unknown>, kind = value.kind;
  switch (kind) {
    case "ui-visibility":
      checkpointKeys(value, "kind,visible");
      return { kind, visible: boolean(value.visible) };
    case "stop-auto": case "force-return": case "remove-all-actions":
    case "cursed-shield-check": case "shadow-secede-lot":
    case "set-gau-mode":
      checkpointKeys(value, "kind");
      return { kind };
    case "get-enemy-mode":
      checkpointKeys(value,"kind,uniqueId,expected");
      return {kind,uniqueId:integer(value.uniqueId,1,9),expected:integer(value.expected,-0x80000000)};
    case "script-action": return parseScriptedBattleAction(value);
    case "play-battle-effect":case "sync-battle-effect": return parseBattleEventEffectOp(value);
    case "message": return parseBattleEventMessageOp(raw);
    case "nop": case "blank": case "exit": case "return":
    case "wait-start": case "exec-ai": case "sync-ai": case "sync-action": case "players-ended":
      checkpointKeys(value, "kind");
      return { kind };
    case "call": case "jump":
      checkpointKeys(value, "kind,target");
      return { kind, target: integer(value.target) };
    case "calc": case "branch": {
      checkpointKeys(value, kind === "calc" ? "kind,index,operator,right" : "kind,index,operator,right,target");
      const operator = text(value.operator);
      if (!isOperator(operator)) throw new Error("Invalid battle event operator");
      const common = { index: integer(value.index), operator, right: parseValue(value.right) };
      return kind === "calc" ? { kind, ...common } : { kind, ...common, target: integer(value.target) };
    }
    case "variable-calc": case "variable-branch": {
      checkpointKeys(value, kind === "variable-calc" ? "kind,left,operator,right" : "kind,left,operator,right,target");
      const operator = text(value.operator);
      if (!isOperator(operator)) throw new Error("Invalid battle event operator");
      const common = { left: parseVariable(value.left), operator, right: parseEventValue(value.right) };
      return kind === "variable-calc" ? { kind, ...common } : { kind, ...common, target: integer(value.target) };
    }
    case "variable-flag": {
      checkpointKeys(value, "kind,ref,operation");
      const operation = value.operation;
      if (operation !== "set" && operation !== "reset" && operation !== "flip")
        throw new Error("Invalid battle event flag operation");
      return { kind, ref: parseVariable(value.ref), operation };
    }
    case "wait":
      checkpointKeys(value, "kind,seconds");
      return { kind, seconds: finite(value.seconds) };
    case "add-enemy":
      checkpointKeys(value, "kind,monsterId,uniqueId");
      return { kind, monsterId: integer(value.monsterId, 1), uniqueId: integer(value.uniqueId, 1, 9) };
    case "add-player":
      checkpointKeys(value, "kind,sourceId");
      return { kind, sourceId: integer(value.sourceId, 1) };
    case "change-player-group":
      checkpointKeys(value, "kind,group");
      return { kind, group: integer(value.group, 0, 2) as 0 | 1 | 2 };
    case "change-enemy-party":
      checkpointKeys(value, "kind,partyId,hidden");
      return { kind, partyId: integer(value.partyId, 1), hidden: boolean(value.hidden) };
    case "end-enabled": case "pause": case "interactive": case "enemy-no-act":
      checkpointKeys(value, "kind,enabled");
      return { kind, enabled: boolean(value.enabled) };
    case "blocked":
      checkpointKeys(value, "kind,reason");
      return { kind, reason: text(value.reason) };
    default: throw new Error("Invalid battle event instruction");
  }
}
function parseSource(raw: unknown): BattleAISource | null {
  if (raw === null) return null;
  const value = record(raw, "sourceSetHash,battleSourceSetHash,file,sha256,assetPath,serializedFile,objectId");
  const hash = (raw: unknown) => {
    const value = text(raw);
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid battle event source hash");
    return value;
  };
  const objectId = text(value.objectId);
  if (!/^(?:0|-?[1-9]\d*)$/.test(objectId) || BigInt(objectId)<-(1n<<63n) || BigInt(objectId)>=(1n<<63n)) throw new Error("Invalid battle event source object identity");
  return { sourceSetHash: hash(value.sourceSetHash), battleSourceSetHash: hash(value.battleSourceSetHash),
    file: text(value.file), sha256: hash(value.sha256), assetPath: text(value.assetPath),
    serializedFile: text(value.serializedFile), objectId };
}

/** Structural parsing deliberately retains blockers, so failed source programs
 * remain inspectable. Execution is a separate, full-program admission check. */
export function parseBattleEventProgram(raw: unknown): BattleEventProgram {
  checkpointRecord(raw);
  const value = record(raw, "kind,source,entry,end,localNames,initialLocals,instructions,blockers" +
    (Object.hasOwn(raw as object, "messageBinding") ? ",messageBinding" : "") +
    ((raw as {kind?:unknown}).kind === "battle-event-v2" ? ",branchExecution" : ""));
  if (value.kind !== "battle-event-v1" && value.kind !== "battle-event-v2") throw new Error("Invalid battle event program kind");
  const source = parseSource(value.source);
  const program: BattleEventProgram = {
    kind: value.kind, source, entry: integer(value.entry), end: integer(value.end),
    localNames: array(value.localNames, name => text(name, true)), initialLocals: array(value.initialLocals, int32),
    instructions: array(value.instructions, (raw, pc) => {
      try {
        const instruction = record(raw, "mnemonic,op");
        return { mnemonic: text(instruction.mnemonic), op: parseOp(instruction.op) };
      } catch (error) {
        throw new BattleEventError(source, pc, error instanceof Error ? error.message : String(error));
      }
    }), blockers: array(value.blockers, value => text(value)),
    ...(Object.hasOwn(value, "messageBinding") ? { messageBinding: parseBattleEventMessageBinding(value.messageBinding) } : {}),
  };
  const fail = (pc: number, reason: string): never => { throw new BattleEventError(program.source, pc, reason); };
  if (program.kind === "battle-event-v2") {
    if (!source) fail(program.entry,"Branch execution requires the complete original source identity");
    if(program.messageBinding&&program.messageBinding.parentSourceSetHash!==source!.sourceSetHash)fail(program.entry,"Branch message binding belongs to another source import");
    const policy=record(value.branchExecution,"policy,sourceProgram,deferred");
    if(policy.policy!==WEB_BATTLE_BRANCH_EXECUTION)fail(program.entry,"Unknown battle program branch execution policy");
    const original=record(policy.sourceProgram,"Name,Title,Mnemonics,Segments,ScriptLocal,ScriptLocalValue,SystemFlag,Animations"),title=record(original.Title,"main,sub");
    const sourceInstructions=array(original.Mnemonics,parseBattleSourceInstruction),
      deferred=array(policy.deferred,(raw):{pc:number;category:BattleDeferredInstructionCategory;reason:string}=>{const v=record(raw,"pc,category,reason");if(v.category!=="unimplemented-instruction"&&v.category!=="unimplemented-selector")throw new Error("Unknown runtime battle dependency category");return {pc:integer(v.pc),category:v.category,reason:text(v.reason)};}),
      segments=array(original.Segments,raw=>{const v=record(raw,"Label,EntryPoint,Count");return {Label:text(v.Label),EntryPoint:integer(v.EntryPoint),Count:integer(v.Count)};}),
      sourceNames=array(original.ScriptLocal,v=>text(v,true)),sourceValues=original.ScriptLocalValue===null?null:array(original.ScriptLocalValue,int32),
      sourceFlags=record(original.SystemFlag,"KeepBadStatusVisual,KeepPlayerPuppet,RidingVehicle,SkipInitialize"),animations=array(original.Animations,v=>v);
    if(program.entry!==0||program.end!==program.instructions.length||segments.length!==1||segments[0]!.Label!=="Main"||segments[0]!.EntryPoint!==0||segments[0]!.Count!==program.instructions.length)
      fail(program.entry,"Branch execution requires the complete original Main range");
    if(animations.length||Object.values(sourceFlags).some(v=>v!==0))fail(program.entry,"Branch execution cannot grant source animations or SystemFlag applicability");
    const initial=sourceValues?.length===sourceNames.length?sourceValues:sourceNames.map(()=>0);
    if(new Set(sourceNames).size!==sourceNames.length||JSON.stringify(sourceNames)!==JSON.stringify(program.localNames)||JSON.stringify(initial)!==JSON.stringify(program.initialLocals))
      fail(program.entry,"Original battle local bank/initial values do not match");
    if(sourceInstructions.length!==program.instructions.length)fail(program.entry,"Original battle instruction/body length mismatch");
    if(new Set(deferred.map(row=>row.pc)).size!==deferred.length)fail(program.entry,"Duplicate runtime battle dependency PC");
    const expected:{pc:number;category:BattleDeferredInstructionCategory;reason:string}[]=[];
    for(const [pc,raw]of sourceInstructions.entries()){
      const typed=program.instructions[pc]!;
      if(raw.mnemonic!==typed.mnemonic)fail(pc,"Original battle instruction name/PC mismatch");
      const category=classifyDeferredBattleInstruction(raw);
      if(category&&typed.op.kind!=='blocked')fail(pc,"Opaque original battle instruction cannot be replaced by a typed operation");
      if(typed.op.kind==='blocked'&&category)expected.push({pc,category,reason:typed.op.reason});
      // Raw control-flow/local operands must remain valid even when a bad
      // instruction was retained as blocked rather than decoded by the compiler.
      const ints=raw.operands.iValues,strings=raw.operands.sValues;
      if((raw.mnemonic==='Call'||raw.mnemonic==='Jump'||raw.mnemonic==='Branch')&&
        ((raw.mnemonic==='Branch'?ints[2]:ints[0])!<program.entry||(raw.mnemonic==='Branch'?ints[2]:ints[0])!+1>=program.end))
        fail(pc,"Original battle target label leaves the complete program range");
      const refs=raw.mnemonic==='Calc'||raw.mnemonic==='Branch'?[[strings[0],ints[0]],[strings[2],ints[1]]]:
        ['SetFlag','ResetFlag','FlipFlag'].includes(raw.mnemonic)?[[strings[0],ints[0]]]:[];
      if(refs.some(([category,index])=>category==='ScriptLocalVariable'&&(typeof index!=='number'||index<0||index>=program.localNames.length)))
        fail(pc,"Original script-local index is outside the declared bank");
    }
    if(JSON.stringify(expected)!==JSON.stringify(deferred))fail(program.entry,"Runtime battle dependencies differ from exact original blocked sites");
    program.branchExecution={policy:WEB_BATTLE_BRANCH_EXECUTION,sourceProgram:{Name:text(original.Name),Title:{main:text(title.main,true),sub:text(title.sub,true)},Mnemonics:sourceInstructions,Segments:segments,
      ScriptLocal:sourceNames,ScriptLocalValue:sourceValues,SystemFlag:sourceFlags as Record<string,number>,Animations:animations},deferred};
  }

  if (program.source && program.instructions.some(({ op }) => op.kind === "message") && !program.messageBinding)
    fail(program.entry, "Source battle messages require their physical localization/name binding");
  if (program.entry >= program.end || program.end > program.instructions.length)
    fail(program.entry, "invalid program range");
  if (program.initialLocals.length !== program.localNames.length)
    fail(program.entry, "script-local names and values do not match");
  for (const [pc, { op }] of program.instructions.entries()) {
    if ((op.kind==="call"||op.kind==="jump"||op.kind==="branch"||op.kind==="variable-branch") && (op.target < program.entry || op.target + 1 >= program.end))
      fail(pc, "target label has no instruction inside the program range");
    if ((op.kind === "calc" || op.kind === "branch") &&
        (op.index >= program.localNames.length || op.right.kind === "local" && op.right.index >= program.localNames.length))
      fail(pc, "script-local index is outside the declared bank");
    const refs = op.kind === "variable-flag" ? [op.ref]
      : op.kind === "variable-calc" || op.kind === "variable-branch"
        ? [op.left, ...(op.right.kind === "variable" ? [op.right.ref] : [])] : [];
    if (refs.some(ref => ref.category === "ScriptLocalVariable" && ref.index >= program.localNames.length))
      fail(pc, "script-local index is outside the declared bank");
    if (op.kind === "sync-ai" && program.localNames.length === 0)
      fail(pc, "SyncBattleAI requires ScriptLocalVariable[0]");
    if (op.kind === "players-ended" && program.localNames.length === 0)
      fail(pc, "players-ended requires ScriptLocalVariable[0]");
    if(op.kind==='get-enemy-mode'&&program.localNames.length<2)fail(pc,'GetEnemyMode requires ScriptLocalVariable[1]');
    if(op.kind==='set-gau-mode'&&program.localNames.length<3)fail(pc,'SetGauMode requires ScriptLocalVariable[2]');
    if(op.kind==='shadow-secede-lot'&&program.localNames.length<4)fail(pc,'Shadow lottery requires ScriptLocalVariable[3]');
  }
  return program;
}

export function assertBattleEventExecutable(program: BattleEventProgram, policy?:WebBattleBranchExecution): void {
  validateBattleBranchExecutionPolicy(policy);
  const parsed = parseBattleEventProgram(program);
  if (parsed.blockers.length)
    throw new BattleEventError(parsed.source, parsed.entry, parsed.blockers.join("; "));
  for (const [pc, { op }] of parsed.instructions.entries())
    if (op.kind === "blocked" && !(policy===WEB_BATTLE_BRANCH_EXECUTION && parsed.kind==="battle-event-v2" && parsed.branchExecution!.deferred.some(site=>site.pc===pc)))
      throw new BattleEventError(parsed.source, pc, op.reason);
}

export function createBattleEventState(program: BattleEventProgram, policy?:WebBattleBranchExecution): BattleEventState {
  assertBattleEventExecutable(program,policy);
  return {
    pc: program.entry,
    stack: [],
    locals: [...program.initialLocals],
    status: "running",
    wait: null,
    clock: null,
    clockInstructions: 0,
  };
}

/** A Web safety bound, not a claim about the native interpreter's capacity. It
 * spans all request/resume segments in one host clock, preventing an Exec loop
 * from evading the same protection as a purely local Jump loop. */
export const BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT = 4096;
const clockNumber = (raw: unknown) => integer(raw, 0, Number.MAX_SAFE_INTEGER);
function parseWait(raw: unknown): BattleEventWait | null {
  if (raw === null) return null;
  checkpointRecord(raw);
  const value = raw as Record<string, unknown>, kind = value.kind;
  if (kind === "message-prepare") {
    checkpointKeys(value, "kind,clock"); return { kind, clock: clockNumber(value.clock) };
  }
  if (kind === "message") {
    checkpointKeys(value, "kind,clock,cursor"); return { kind, clock: clockNumber(value.clock), cursor: parseMessageCursor(value.cursor) };
  }
  if (kind === "blank" || kind === "start" || kind === "action" || kind === "script-action" || kind === "enemy-party-entry" || kind === "player-group-entry" || kind === "battle-effect") {
    checkpointKeys(value, "kind,clock");
    return { kind, clock: clockNumber(value.clock) };
  }
  if (kind === "time") {
    checkpointKeys(value, "kind,clock,entryTimeSeconds");
    return { kind, clock: clockNumber(value.clock), entryTimeSeconds: finite(value.entryTimeSeconds, 0) };
  }
  if (kind === "enemy-entry" || kind === "player-entry") {
    checkpointKeys(value, "kind,clock,previousNoAct");
    return { kind, clock: clockNumber(value.clock), previousNoAct: boolean(value.previousNoAct) };
  }
  throw new Error("Invalid battle event wait kind");
}
function parseMessageCursor(raw: unknown): SourceMessageTaskCursor {
  const c = record(raw, "ticket,pageSeconds,after,anchorTime,finalTimerStarted");
  if (!["message", "choice", "close"].includes(String(c.after))) throw new Error("Invalid battle message continuation");
  const pageSeconds = c.pageSeconds === null ? null : finite(c.pageSeconds, Number.MIN_VALUE);
  return { ticket: integer(c.ticket, 1, Number.MAX_SAFE_INTEGER), pageSeconds,
    after: c.after as SourceMessageTaskCursor["after"], anchorTime: finite(c.anchorTime, 0), finalTimerStarted: boolean(c.finalTimerStarted) };
}
function parseState(raw: unknown): BattleEventState {
  const value = record(raw, "pc,stack,locals,status,wait,clock,clockInstructions"), status = value.status;
  if (status !== "running" && status !== "waiting" && status !== "exited")
    throw new Error("Invalid battle event status");
  return { pc: integer(value.pc), stack: array(value.stack, value => integer(value)), locals: array(value.locals, int32),
    status, wait: parseWait(value.wait), clock: value.clock === null ? null : clockNumber(value.clock),
    clockInstructions: integer(value.clockInstructions, 0, BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT) };
}
function parseContext(raw: unknown): BattleEventContext {
  checkpointRecord(raw);
  const fields = raw as Record<string, unknown>;
  const value = record(raw, "clock,timeSeconds,started,aiCoreAlive,actionStaging" +
    (Object.hasOwn(fields, "variables") ? ",variables" : "") +
    (Object.hasOwn(fields, "playersEnded") ? ",playersEnded" : "") +
    (Object.hasOwn(fields, "enemyEntry") ? ",enemyEntry" : "") +
    (Object.hasOwn(fields, "enemyPartyEntry") ? ",enemyPartyEntry" : "") +
    (Object.hasOwn(fields, "playerEntry") ? ",playerEntry" : "") +
    (Object.hasOwn(fields, "playerGroupEntry") ? ",playerGroupEntry" : "") +
    (Object.hasOwn(fields, "messageStatus") ? ",messageStatus" : "") +
    (Object.hasOwn(fields,"battleEffectsFinished") ? ",battleEffectsFinished" : "") +
    (Object.hasOwn(fields,'enemyModes') ? ',enemyModes' : ''));
  let variables: BattleEventContext["variables"];
  if (Object.hasOwn(value, "variables")) {
    const port = record(value.variables, "read");
    if (typeof port.read !== "function") throw new Error("Invalid battle event variable provider");
    const owner = port as { read(ref: VariableRef): number }, read = owner.read;
    variables = { read: ref => read.call(owner, ref) };
  }
  let enemyEntry: BattleEventContext["enemyEntry"];
  if (Object.hasOwn(value, "enemyEntry")) {
    const entry = record(value.enemyEntry, "noAct,completed");
    enemyEntry = { noAct: boolean(entry.noAct), completed: boolean(entry.completed) };
  }
  let enemyPartyEntry: BattleEventContext["enemyPartyEntry"];
  if (Object.hasOwn(value, "enemyPartyEntry")) {
    const entry = record(value.enemyPartyEntry, "completed");
    enemyPartyEntry = { completed: boolean(entry.completed) };
  }
  let playerEntry: BattleEventContext["playerEntry"];
  if (Object.hasOwn(value, "playerEntry")) {
    const entry = record(value.playerEntry, "noAct,completed");
    playerEntry = { noAct: boolean(entry.noAct), completed: boolean(entry.completed) };
  }
  let playerGroupEntry: BattleEventContext["playerGroupEntry"];
  if (Object.hasOwn(value, "playerGroupEntry")) {
    const entry = record(value.playerGroupEntry, "completed");
    playerGroupEntry = { completed: boolean(entry.completed) };
  }
  let messageStatus: SourceMessageSequenceStatus | undefined;
  if (Object.hasOwn(value, "messageStatus")) {
    const status = record(value.messageStatus, "ticket,complete,endWaiting,newPageInputWaiting,playing");
    messageStatus = { ticket: integer(status.ticket, 1, Number.MAX_SAFE_INTEGER), complete: boolean(status.complete),
      endWaiting: boolean(status.endWaiting), newPageInputWaiting: boolean(status.newPageInputWaiting), playing: boolean(status.playing) };
  }
  const enemyModes=Object.hasOwn(value,'enemyModes')?array(value.enemyModes,row=>{
    const r=record(row,'uniqueId,mode');return {uniqueId:integer(r.uniqueId,1,9),mode:int32(r.mode)};
  }):undefined;
  return { clock: clockNumber(value.clock), timeSeconds: finite(value.timeSeconds, 0),
    started: boolean(value.started), aiCoreAlive: boolean(value.aiCoreAlive), actionStaging: boolean(value.actionStaging),
    ...(variables ? { variables } : {}),
    ...(enemyEntry ? { enemyEntry } : {}),
    ...(enemyPartyEntry ? { enemyPartyEntry } : {}),
    ...(playerEntry ? { playerEntry } : {}),
    ...(playerGroupEntry ? { playerGroupEntry } : {}),
    ...(messageStatus ? { messageStatus } : {}),
    ...(enemyModes ? {enemyModes} : {}),
    ...(Object.hasOwn(value,"battleEffectsFinished")?{battleEffectsFinished:boolean(value.battleEffectsFinished)}:{}),
    ...(Object.hasOwn(value, "playersEnded") ? { playersEnded: boolean(value.playersEnded) } : {}) };
}

/** Advance one source clock until it yields, exits, or needs the battle host.
 * Shared reads are synchronous; writes are returned as requests. A thrown
 * error leaves the input state untouched. The
 * host must transact all returned requests and resumed segments in its tick. */
export function advanceBattleEvent(
  program: BattleEventProgram,
  current: BattleEventState,
  context: BattleEventContext,
  policy?:WebBattleBranchExecution,
): BattleEventAdvance {
  const attemptedVisited:number[]=[];
  let failurePc = current.pc;
  const fail = (reason: string, pc = failurePc): never => {
    throw new BattleEventError(program.source, pc, reason,[...attemptedVisited],program.kind==="battle-event-v2"?structuredClone(program.branchExecution?.sourceProgram.Mnemonics[pc]??null):null);
  };
  const guarded = <T>(operation: () => T): T => {
    try { return operation(); }
    catch (error) {
      if (error instanceof BattleEventError) throw error;
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
  guarded(() => assertBattleEventExecutable(program,policy));
  const state = guarded(() => parseState(current));
  context = guarded(() => parseContext(context));
  const inRange = (pc: number) => pc >= program.entry && pc < program.end;
  if (state.locals.length !== program.initialLocals.length)
    fail("script-local state does not match the declared bank");
  if (state.stack.some((pc) => !inRange(pc))) fail("Call stack leaves the program range");
  if ((state.status === "waiting") !== (state.wait !== null)) fail("inconsistent event wait state");
  if (state.clock === null && (state.clockInstructions !== 0 || state.wait !== null))
    fail("unclocked event has a continuation");
  if (state.clock !== null && context.clock < state.clock) fail("host clock moved backwards");
  if (state.wait && state.wait.clock !== state.clock) fail("wait and event clocks disagree");
  if (state.status === "exited") {
    if (state.pc <= program.entry || state.pc > program.end || program.instructions[state.pc - 1]?.op.kind !== "exit")
      fail("exited event has no matching Exit");
    return { state, requests: [], visited: [] };
  }
  if (!inRange(state.pc)) fail("PC outside the program range");
  if (state.wait) {
    const expected = { blank: "blank", start: "wait-start", action: "sync-action", "script-action":"script-action", time: "wait",
      "enemy-entry": "add-enemy", "enemy-party-entry": "change-enemy-party",
      "player-entry": "add-player", "player-group-entry": "change-player-group",
      "message-prepare": "message", "message": "message", "battle-effect":"sync-battle-effect" }[state.wait.kind];
    if (state.wait.kind === "battle-effect" ? !["play-battle-effect","sync-battle-effect"].includes(program.instructions[state.pc]?.op.kind??"") : program.instructions[state.pc]?.op.kind !== expected) fail("wait does not match its instruction");
    if (state.wait.clock === context.clock) return { state, requests: [], visited: [] };
  }
  if (state.clock !== context.clock) {
    state.clock = context.clock;
    state.clockInstructions = 0;
  }
  const requests: BattleEventRequest[] = [], visited: number[] = [];
  const result = (): BattleEventAdvance => ({ state, requests, visited });
  const next = () => { state.pc++; state.status = "running"; state.wait = null; };
  const yieldClock = (kind: "blank" | "start" | "action") => {
    state.status = "waiting";
    state.wait = { kind, clock: context.clock };
    return result();
  };
  const local = (index: number): number => {
    guarded(() => int32(index));
    const value = state.locals[index];
    if (index < 0 || value === undefined) return fail("script-local index outside the current bank", state.pc);
    return value;
  };
  const value = (operand: BattleEventValue) => operand.kind === "immediate"
    ? guarded(() => int32(operand.value)) : local(operand.index);
  const variableProvider = () => {
    if (!context.variables) return fail("Missing battle event variable provider", state.pc);
    return context.variables;
  };
  const readVariable = (ref: VariableRef): number => {
    if (ref.category === "ScriptLocalVariable") return local(ref.index);
    const result = guarded(() => variableProvider().read({ ...ref }));
    if (result == null) return fail(`Unknown battle event variable ${ref.category}[${ref.index}]`, state.pc);
    return guarded(() => int32(result));
  };
  const eventValue = (operand: EventValue): number => operand.kind === "immediate"
    ? guarded(() => int32(operand.value)) : readVariable(operand.ref);
  const writeVariable = (ref: VariableRef, value: number, pc: number): boolean => {
    guarded(() => int32(value));
    if (ref.category === "ScriptLocalVariable") {
      if (ref.index < 0 || ref.index >= state.locals.length)
        return fail("script-local index outside the current bank", pc);
      state.locals[ref.index] = value;
      next();
      return false;
    }
    // Even an assignment/set/reset needs an attached shared-state context,
    // but it never reads the old cell. The host performs the write itself.
    variableProvider();
    next();
    requests.push({ kind: "write-variable", pc, ref: { ...ref }, value });
    return true;
  };
  const jump = (target: number) => {
    if (!inRange(target) || !inRange(target + 1)) fail("jump leaves the program range", state.pc);
    state.pc = target + 1;
    state.status = "running";
    state.wait = null;
  };
  const seen = new Set<string>();
  while (true) {
    if (!inRange(state.pc)) fail("PC outside the program range; no implicit Exit", state.pc);
    const signature = JSON.stringify([state.pc, state.stack, state.locals, state.wait]);
    if (seen.has(signature)) fail("event repeats without yielding or making progress", state.pc);
    seen.add(signature);
    if (state.clockInstructions >= BATTLE_EVENT_CLOCK_INSTRUCTION_LIMIT)
      fail("event exceeded the Web instruction budget for one host clock", state.pc);
    state.clockInstructions++;
    const pc = state.pc, op = program.instructions[pc]!.op;
    failurePc = pc;
    visited.push(pc); attemptedVisited.push(pc);
    switch (op.kind) {
      case "ui-visibility":
        next(); requests.push({ kind: op.kind, visible: op.visible, pc }); return result();
      case "stop-auto": case "force-return": case "remove-all-actions":
        next(); requests.push({ kind: op.kind, pc }); return result();
      case "play-battle-effect": {
        if(state.wait?.kind!=="battle-effect") {
          if(op.wait){state.status="waiting";state.wait={kind:"battle-effect",clock:context.clock};}else next();
          requests.push({...structuredClone(op),pc});return result();
        }
        if(typeof context.battleEffectsFinished!=="boolean")return fail("Missing global battle effect completion provider",pc);
        if(!context.battleEffectsFinished){state.wait.clock=context.clock;return result();}next();break;
      }
      case "sync-battle-effect":
        if(typeof context.battleEffectsFinished!=="boolean")return fail("Missing global battle effect completion provider",pc);
        if(!context.battleEffectsFinished){state.status="waiting";state.wait={kind:"battle-effect",clock:context.clock};return result();}next();break;
      case "message": {
        if (op.command.kind === "close") {
          next(); requests.push({ kind: "message", pc, operation: structuredClone(op) }); return result();
        }
        if (state.wait?.kind === "message-prepare") return fail("Battle message publication was not acknowledged", pc);
        if (state.wait?.kind !== "message") {
          state.status = "waiting"; state.wait = { kind: "message-prepare", clock: context.clock };
          requests.push({ kind: "message", pc, operation: structuredClone(op) }); return result();
        }
        if (!context.messageStatus) return fail("Missing battle message manager status", pc);
        const polled = guarded(() => pollSourceMessageTask(state.wait!.kind === "message" ? state.wait!.cursor : fail("Missing battle message cursor"),
          context.messageStatus!, context.timeSeconds * 1000));
        const ticket = state.wait.cursor.ticket;
        if (polled.flow === "next") {
          next(); requests.push({ kind: "message-complete", pc, ticket, close: polled.action === "close" }); return result();
        }
        state.wait = { kind: "message", clock: context.clock, cursor: polled.cursor };
        if (polled.action === "page-input") requests.push({ kind: "message-page-input", pc, ticket });
        return result();
      }
      case "nop": next(); break;
      case "exit": next(); state.status = "exited"; return result();
      case "jump": jump(op.target); break;
      case "call":
        if (!inRange(pc + 1)) fail("Call has no return instruction", pc);
        state.stack.push(pc + 1);
        jump(op.target);
        break;
      case "return": {
        const target = state.stack.pop();
        if (target === undefined) fail("Return has no matching Call", pc);
        state.pc = target!;
        state.status = "running";
        state.wait = null;
        break;
      }
      case "calc":
        state.locals[op.index] = guarded(() => integerOperation(op.operator === "←" ? 0 : local(op.index), op.operator, value(op.right)));
        next();
        break;
      case "branch": {
        const condition = guarded(() => integerOperation(op.operator === "←" ? 0 : local(op.index), op.operator, value(op.right)));
        // Internal.Main.ComparisonOperation callback 0x2ca840 branches only
        // for exactly 1, including when authored with an arithmetic operator.
        if (condition === 1) jump(op.target); else next();
        break;
      }
      case "variable-calc": {
        const calculated = guarded(() => integerOperation(op.operator === "←" ? 0 : readVariable(op.left),
          op.operator, eventValue(op.right)));
        if (writeVariable(op.left, calculated, pc)) return result();
        break;
      }
      case "variable-branch": {
        const condition = guarded(() => integerOperation(op.operator === "←" ? 0 : readVariable(op.left),
          op.operator, eventValue(op.right)));
        if (condition === 1) jump(op.target); else next();
        break;
      }
      case "variable-flag": {
        const flag = op.operation === "set" ? 1 : op.operation === "reset" ? 0 : Number(readVariable(op.ref) === 0);
        if (writeVariable(op.ref, flag, pc)) return result();
        break;
      }
      case "players-ended":
        if (typeof context.playersEnded !== "boolean") return fail("Missing battle event players-ended provider", pc);
        local(0);
        if (context.playersEnded) state.locals[0] = -1;
        next();
        break;
      case 'get-enemy-mode':
        state.locals[1]=guarded(()=>readBattleEnemyMode(op.uniqueId,op.expected,local(1),context.enemyModes));next();break;
      case 'cursed-shield-check':
        next();requests.push({kind:op.kind,pc});return result();
      case 'shadow-secede-lot':
        local(3);next();requests.push({kind:op.kind,pc});return result();
      case 'set-gau-mode':
        local(2);next();requests.push({kind:'set-gau-mode',pc});return result();
      case "sync-ai":
        local(0);
        state.locals[0] = Number(!context.aiCoreAlive);
        next();
        // The host commits the same pure alive projection used for context:
        // retiring ended AI cores and disabling progress are not VM-local.
        requests.push({ kind: "sync-ai", pc });
        return result();
      case "wait-start":
        if (!context.started) return yieldClock("start");
        next();
        break;
      case "script-action":
        if(state.wait?.kind==="script-action"){
          if(context.actionStaging){state.wait.clock=context.clock;return result();}
          next();break;
        }
        if(op.asynchronous)next();
        else{state.status="waiting";state.wait={kind:"script-action",clock:context.clock};}
        requests.push({...structuredClone(op),pc});
        return result();
      case "sync-action":
        if (context.actionStaging) return yieldClock("action");
        next();
        break;
      case "exec-ai":
        next();
        requests.push({ kind: "exec-ai", pc });
        return result();
      case "add-enemy": {
        if (!context.enemyEntry) return fail("Missing battle enemy entry provider", pc);
        if (state.wait?.kind !== "enemy-entry") {
          state.status = "waiting";
          state.wait = { kind: "enemy-entry", clock: context.clock, previousNoAct: context.enemyEntry.noAct };
          requests.push({ kind: "add-enemy", pc, monsterId: op.monsterId, uniqueId: op.uniqueId });
          return result();
        }
        if (!context.enemyEntry.completed) {
          state.wait.clock = context.clock;
          return result();
        }
        const previousNoAct = state.wait.previousNoAct;
        next();
        requests.push({ kind: "enemy-no-act", pc, enabled: previousNoAct });
        return result();
      }
      case "add-player": {
        if (!context.playerEntry) return fail("Missing battle owned player entry provider", pc);
        if (state.wait?.kind !== "player-entry") {
          state.status = "waiting";
          state.wait = { kind: "player-entry", clock: context.clock, previousNoAct: context.playerEntry.noAct };
          requests.push({ kind: "add-player", pc, sourceId: op.sourceId });
          return result();
        }
        if (!context.playerEntry.completed) {
          state.wait.clock = context.clock;
          return result();
        }
        const previousNoAct = state.wait.previousNoAct;
        next();
        requests.push({ kind: "enemy-no-act", pc, enabled: previousNoAct });
        return result();
      }
      case "change-player-group": {
        if (!context.playerGroupEntry) return fail("Missing battle player group provider", pc);
        if (state.wait?.kind !== "player-group-entry") {
          state.status = "waiting";
          state.wait = { kind: "player-group-entry", clock: context.clock };
          requests.push({ kind: "change-player-group", pc, group: op.group });
          return result();
        }
        if (!context.playerGroupEntry.completed) {
          state.wait.clock = context.clock;
          return result();
        }
        next();
        break;
      }
      case "change-enemy-party": {
        if (!context.enemyPartyEntry) return fail("Missing battle enemy party entry provider", pc);
        if (state.wait?.kind !== "enemy-party-entry") {
          state.status = "waiting";
          state.wait = { kind: "enemy-party-entry", clock: context.clock };
          requests.push({ kind: "change-enemy-party", pc, partyId: op.partyId, hidden: op.hidden });
          return result();
        }
        if (!context.enemyPartyEntry.completed) {
          state.wait.clock = context.clock;
          return result();
        }
        next();
        break;
      }
      case "end-enabled": case "pause": case "interactive": case "enemy-no-act":
        next();
        requests.push({ kind: op.kind, enabled: op.enabled, pc });
        return result();
      case "blank":
        if (state.wait?.kind !== "blank") return yieldClock("blank");
        next();
        break;
      case "wait":
        if (state.wait?.kind !== "time") {
          // Internal.Wait always records the entry time and repeats once,
          // including finite zero or negative source durations.
          state.status = "waiting";
          state.wait = { kind: "time", clock: context.clock, entryTimeSeconds: context.timeSeconds };
          return result();
        }
        if (context.timeSeconds < state.wait.entryTimeSeconds)
          return fail("host time moved before Wait entry", pc);
        if (context.timeSeconds - state.wait.entryTimeSeconds < op.seconds) {
          state.wait.clock = context.clock;
          return result();
        }
        next();
        break;
      case "blocked":
        return fail(op.reason, pc);
    }
  }
}
