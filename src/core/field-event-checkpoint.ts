import type { FieldContent, Op } from "../field/types.js";
import { canonical } from "./canonical.js";
import { checkpointIds, checkpointInteger, checkpointKeys, checkpointNumber } from "./checkpoint-validation.js";
import { validateScriptLocalFrameSnapshot, type EventStateSnapshot, type ScriptLocalFrameSnapshot } from "./event-state.js";
import { validateFieldPuppetScriptContext } from "./field-puppet-actors.js";
import type { FieldTaskRange } from "./field-task-control.js";
import { assertFieldEventSaveAdmission } from "./field-auto-save.js";

export type FieldEventCheckpoint = {
  kind: "field-event-continuation-v1";
  contentHash: string;
  /** Web program-array address, which need not equal the source Site.index. */
  barrier: { script: string; pc: number };
  main: {
    id: number; script: string; pc: number; stack: number[]; actor: string;
    sourceEntityId: number | null; range: FieldTaskRange;
  };
  eventRootScript: string;
  scriptHook: {
    script: string; pc: number; range: FieldTaskRange; locals: ScriptLocalFrameSnapshot;
  } | null;
  puppetLifecycle: {
    name: string; leaderId: number | null; assignments: boolean[]; finished: false;
  } | null;
  cameraEventActive: boolean;
  entryTaskStarted: boolean;
};
export type FieldEventCheckpointInput = Omit<FieldEventCheckpoint, "kind" | "contentHash">;
export type FieldEventCheckpointContext = {
  content: FieldContent;
  /** Already part of the outer save; never duplicated as a second variable owner. */
  eventState: EventStateSnapshot;
  actorIds: readonly string[];
  nextTask: number;
  time: number;
  entrySynchronized?: boolean | null;
  /** A trusted host may narrow its barrier policy. Save data cannot supply it. */
  isBarrier?: (op: Op) => boolean;
};

function name(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Missing event continuation identity");
}
function instructions(content: FieldContent, script: string): Op[] {
  name(script);
  const ops = Object.hasOwn(content.scripts, script) ? content.scripts[script] : undefined;
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > 0x7fffffff)
    throw new Error("Event continuation script is not bound to content");
  return ops;
}
function address(pc: number, ops: readonly Op[]): Op {
  checkpointInteger(pc, 0, ops.length - 1);
  const op = ops[pc];
  if (!op || typeof op.kind !== "string") throw new Error("Missing event continuation instruction");
  return op;
}
function mainRange(range: FieldTaskRange, ops: readonly Op[]): void {
  checkpointKeys(range, "min,max");
  if (range.min !== 0 || range.max !== ops.length - 1)
    throw new Error("Event continuation main range differs from its source program");
}
function declaration(content: FieldContent, script: string, required: boolean) {
  const hasDeclaration = content.scriptLocals && Object.hasOwn(content.scriptLocals, script);
  if (!hasDeclaration) {
    if (required) throw new Error("Missing script transition local declaration");
    return null;
  }
  const locals = content.scriptLocals![script];
  if (locals === undefined) throw new Error("Unknown script-local declaration");
  return locals;
}
function validateBank(content: FieldContent, script: string,
  labels: string[] | null, values: (number | null)[] | null, required: boolean): void {
  validateScriptLocalFrameSnapshot({ kind: "detached", labels, values });
  const declared = declaration(content, script, required);
  if (declared !== null && canonical(labels) !== canonical(declared.labels))
    throw new Error("Event continuation script-local labels differ from source");
}
function transitionMetadata(content: FieldContent, script: string): void {
  if (content.scriptTransitionMetadata?.[script]?.customAnimations !== "none")
    throw new Error("Event continuation custom-animation context is unavailable");
}

/** A hook may survive direct ChangeScript replacements. Establish whether the
 * saved alias relationship is possible without executing flags or any program.
 * This is structural validation, not a claim that a story path is reachable. */
function localFramePath(content: FieldContent, first: string, current: string, detached: boolean): boolean {
  const pending = [{ script: first, changed: false }], visited = new Set<string>();
  while (pending.length) {
    const next = pending.pop()!;
    if (!Object.hasOwn(content.scripts, next.script) ||
        content.scriptTransitionMetadata?.[next.script]?.customAnimations !== "none" ||
        !content.scriptLocals || !Object.hasOwn(content.scriptLocals, next.script)) continue;
    const changed = next.changed || declaration(content, next.script, true) !== null;
    const key = JSON.stringify([next.script, changed]);
    if (visited.has(key)) continue;
    visited.add(key);
    if (next.script === current && changed === detached) return true;
    for (const op of instructions(content, next.script))
      if (op.kind === "script-transition" && !op.returnToCaller)
        pending.push({ script: op.targetScript, changed });
  }
  return false;
}

/** Only captures a host-established barrier. FieldGame must independently
 * reject concurrent tasks, active movement, windows, effects and wait registers.
 * It restores lastClock to field.time so the next ordinary tick resumes once. */
export function captureFieldEventCheckpoint(input: FieldEventCheckpointInput,
  context: FieldEventCheckpointContext): FieldEventCheckpoint {
  checkpointKeys(input, "barrier,main,eventRootScript,scriptHook,puppetLifecycle,cameraEventActive,entryTaskStarted");
  return restoreFieldEventCheckpoint({ ...input, kind: "field-event-continuation-v1",
    contentHash: context.content.contentHash }, context);
}

/** Validates addresses against trusted programs and returns data only. Never
 * executes a barrier, begins a script, grants an item, or initializes actors. */
export function restoreFieldEventCheckpoint(raw: unknown,
  context: FieldEventCheckpointContext): FieldEventCheckpoint {
  checkpointKeys(raw, "kind,contentHash,barrier,main,eventRootScript,scriptHook,puppetLifecycle,cameraEventActive,entryTaskStarted");
  const saved = structuredClone(raw) as FieldEventCheckpoint;
  name(context.content.contentHash);
  if (saved.kind !== "field-event-continuation-v1" || saved.contentHash !== context.content.contentHash)
    throw new Error("Event continuation content/version mismatch");
  checkpointInteger(context.nextTask, 1);
  checkpointNumber(context.time);
  checkpointIds(context.actorIds);
  checkpointKeys(saved.barrier, "script,pc");
  checkpointKeys(saved.main, "id,script,pc,stack,actor,sourceEntityId,range");
  const main = saved.main, ops = instructions(context.content, main.script);
  checkpointInteger(main.id, 1, context.nextTask - 1);
  name(main.actor);
  // FieldGame's one main core always uses the player alias. Puppet entity
  // bindings belong to separate slots and cannot be injected into this codec.
  if (main.actor !== "-1001" || !context.actorIds.includes(main.actor) || main.sourceEntityId !== null)
    throw new Error("Event continuation main actor binding changed");
  mainRange(main.range, ops);
  address(main.pc, ops);
  if (saved.barrier.script !== main.script || main.pc !== saved.barrier.pc + 1)
    throw new Error("Event continuation must follow its consumed barrier");
  const barrier = address(saved.barrier.pc, ops);
  if ((barrier as { kind: string }).kind !== "event-save" ||
      (context.isBarrier && context.isBarrier(barrier) !== true))
    throw new Error("Event continuation barrier is not admitted by trusted content");
  assertFieldEventSaveAdmission(context.content, barrier as Extract<Op, { kind: "event-save" }>);
  if (!Array.isArray(main.stack)) throw new Error("Invalid event continuation Call stack");
  for (const pc of main.stack) {
    address(pc, ops);
    const call = address(pc - 1, ops);
    if (call.kind !== "call") throw new Error("Event continuation stack entry has no source Call");
    address(call.target, ops); address(call.target + 1, ops);
  }
  instructions(context.content, saved.eventRootScript);
  validateBank(context.content, main.script, context.eventState.scriptLabels, context.eventState.script, false);
  if (saved.eventRootScript !== main.script) {
    transitionMetadata(context.content, saved.eventRootScript);
    transitionMetadata(context.content, main.script);
  }
  if (saved.scriptHook !== null) {
    const hook = saved.scriptHook;
    checkpointKeys(hook, "script,pc,range,locals");
    const caller = instructions(context.content, hook.script);
    mainRange(hook.range, caller); address(hook.pc, caller);
    const transition = address(hook.pc - 1, caller);
    if (transition.kind !== "script-transition" || !transition.returnToCaller)
      throw new Error("Event continuation hook has no source returning ChangeScript");
    transitionMetadata(context.content, hook.script);
    transitionMetadata(context.content, main.script);
    hook.locals = validateScriptLocalFrameSnapshot(hook.locals);
    const detached = hook.locals.kind === "detached";
    if (!localFramePath(context.content, transition.targetScript, main.script, detached))
      throw new Error("Event continuation hook local-bank alias conflicts with source transitions");
    validateBank(context.content, hook.script,
      hook.locals.kind === "current" ? context.eventState.scriptLabels : hook.locals.labels,
      hook.locals.kind === "current" ? context.eventState.script : hook.locals.values, true);
  }
  const lifecycle = saved.puppetLifecycle;
  const scriptContext = context.content.scriptPuppetContexts?.[saved.eventRootScript];
  if (context.content.scriptPuppetContexts !== undefined) {
    if (!lifecycle || !scriptContext) throw new Error("Event continuation puppet lifecycle is unavailable");
    validateFieldPuppetScriptContext(scriptContext);
  } else if (lifecycle !== null) throw new Error("Event continuation cannot grant a puppet lifecycle host");
  if (lifecycle) {
    checkpointKeys(lifecycle, "name,leaderId,assignments,finished");
    if (lifecycle.name !== saved.eventRootScript || lifecycle.finished !== false ||
        !Array.isArray(lifecycle.assignments) || lifecycle.assignments.length !== 5 ||
        Array.from(lifecycle.assignments).some((value) => typeof value !== "boolean"))
      throw new Error("Invalid event continuation puppet lifecycle");
    if (lifecycle.leaderId !== null) checkpointInteger(lifecycle.leaderId, -1004, -1001);
    if (scriptContext!.skipInitialize !== (lifecycle.leaderId === null))
      throw new Error("Event continuation puppet leader differs from source initialization");
  }
  if (typeof saved.cameraEventActive !== "boolean" || saved.cameraEventActive !== !!context.content.cameraHost)
    throw new Error("Event continuation camera lifecycle differs from its host");
  if (typeof saved.entryTaskStarted !== "boolean") throw new Error("Invalid event continuation entry lifecycle");
  if (context.content.entry.synchronization) {
    if (typeof context.entrySynchronized !== "boolean" || !saved.entryTaskStarted)
      throw new Error("Event continuation source map entry has not been scheduled");
  } else if (saved.entryTaskStarted || (context.entrySynchronized !== undefined && context.entrySynchronized !== null))
    throw new Error("Event continuation cannot grant source map entry synchronization");
  return saved;
}
