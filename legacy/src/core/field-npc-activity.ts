import type { Direction, Point } from "../field/types.js";
import type { FieldMoveAreaRect } from "./field-move-area.js";
import { canonical } from "./canonical.js";
import { createFieldRandom, drawFieldRandom } from "./field-random.js";

/** An explicit Web Area controller. The source rectangle, speed and interval
 * inputs are preserved; its random stream, scheduling and collision handshake
 * do not claim Unity Random, Guid ordering or raycast equivalence. */
export type FieldNpcActivityProgram = {
  policy: "framework-npc-area-v1";
  actorId: string;
  group: string;
  definitionHash: string;
  moveArea: FieldMoveAreaRect;
  layer: number;
  updateAttribute: 2 | 10;
  sourceSpeedEnum: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  baseIntervalMs: number;
  moveSteps: number;
  firstInterval: boolean;
};
export type FieldNpcActivityPending = { commandId: number; revision: number; direction: Direction };
export type FieldNpcActivityState = {
  kind: "field-npc-activity-state-v1";
  actorId: string;
  definitionHash: string;
  generation: number;
  revision: number;
  waitMs: number;
  direction: Direction | null;
  remainingSteps: number;
  rngState: number;
  rngDraws: number;
  commandId: number;
  pending: FieldNpcActivityPending | null;
  holder: { eventId: string; revision: number } | null;
};
export type FieldNpcActivityTicket = {
  actorId: string; definitionHash: string; generation: number; commandId: number; revision: number;
};
export type FieldNpcActivityLease = {
  actorId: string; definitionHash: string; generation: number; eventId: string; revision: number;
};
export type FieldNpcActivityInput = {
  worldPosition: Point;
  direction: Direction;
  motionActive: boolean;
  dtMs: number;
  updateMask: number;
  /** The field projects the four adjacent cells using its actual map/layer.
   * The controller must not reconstruct them by adding a guessed pixel size. */
  destinations: Record<Direction, Point>;
};
export type FieldNpcActivityIntent = {
  direction: Direction; steps: 1; sourceSpeedEnum: FieldNpcActivityProgram["sourceSpeedEnum"];
};
export type FieldNpcActivityProposal = {
  readonly intent: Readonly<FieldNpcActivityIntent> | null;
  /** Private candidate only, never a second Actor or motion owner. */
  readonly nextState: Readonly<FieldNpcActivityState>;
};
export type FieldNpcActivitySettlement = { state: FieldNpcActivityState; ticket: FieldNpcActivityTicket | null };
export type FieldNpcActivityCheckpoint = { kind: "field-npc-activity-checkpoint-v1"; state: FieldNpcActivityState };

const directions: readonly Direction[] = ["up", "right", "down", "left"];
const seconds = [0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16, 0.096, 0.08] as const;
const maximum = Number.MAX_SAFE_INTEGER;
type RecordValue = Record<string, unknown>;
function record(value: unknown, keys: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error("Invalid NPC activity record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string") ||
      Object.keys(descriptors).sort().join(",") !== keys.split(",").sort().join(",") ||
      Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, "value")))
    throw new Error("Invalid NPC activity fields");
  return value as RecordValue;
}
function integer(value: unknown, min: number, max = maximum): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("Invalid NPC activity integer");
  return value;
}
function number(value: unknown, min = -maximum, max = maximum): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error("Invalid NPC activity number");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Missing NPC activity identity");
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid NPC activity definition hash");
  return value;
}
function direction(value: unknown): Direction {
  if (!directions.includes(value as Direction)) throw new Error("Invalid NPC activity direction");
  return value as Direction;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid NPC activity boolean");
  return value;
}
function point(value: unknown): Point {
  const row = record(value, "x,y");
  return { x: number(row.x), y: number(row.y) };
}
function area(value: unknown): FieldMoveAreaRect {
  const row = record(value, "x,y,width,height");
  const result = { x: number(row.x), y: number(row.y), width: number(row.width, 0), height: number(row.height, 0) };
  number(result.x + result.width); number(result.y - result.height);
  return result;
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function bump(state: FieldNpcActivityState): void { state.revision = integer(state.revision + 1, 1); }

export function parseFieldNpcActivityProgram(raw: unknown): FieldNpcActivityProgram {
  const row = record(raw, "policy,actorId,group,definitionHash,moveArea,layer,updateAttribute,sourceSpeedEnum,baseIntervalMs,moveSteps,firstInterval");
  if (row.policy !== "framework-npc-area-v1" || row.updateAttribute !== 2 && row.updateAttribute !== 10)
    throw new Error("Unsupported NPC activity policy or update attribute");
  return {
    policy: row.policy, actorId: text(row.actorId), group: text(row.group), definitionHash: hash(row.definitionHash),
    moveArea: area(row.moveArea), layer: integer(row.layer, 0, 4), updateAttribute: row.updateAttribute,
    sourceSpeedEnum: integer(row.sourceSpeedEnum, 0, 8) as FieldNpcActivityProgram["sourceSpeedEnum"],
    baseIntervalMs: number(row.baseIntervalMs, 0, 0x7fffffff), moveSteps: integer(row.moveSteps, 1, 0x7fffffff),
    firstInterval: bool(row.firstInterval),
  };
}
export const parseNpcActivityProgram = parseFieldNpcActivityProgram;
export function validateFieldNpcActivityProgram(program: FieldNpcActivityProgram): void { parseFieldNpcActivityProgram(program); }

/** Existing native GetFieldSpriteMoveSecondsPerCell enum branches (38d7f0).
 * This does not extend Puppet Move's different compiler admission. */
export function sourceNpcSecondsPerCell(sourceSpeedEnum: number, magnification = 1): number {
  const value = seconds[integer(sourceSpeedEnum, 0, 8)]!;
  const scale = Math.fround(number(magnification, Number.MIN_VALUE));
  const result = Math.fround(Math.fround(value) / scale);
  if (!(scale > 0) || !Number.isFinite(scale) || !(result > 0) || !Number.isFinite(result))
    throw new Error("Invalid NPC move magnification");
  return result;
}

/** Source WithinRange (576a30): Rect.y is its northern edge, both ends inclusive. */
export function fieldNpcAreaContains(rectangle: FieldMoveAreaRect, world: Point): boolean {
  const rect = area(rectangle), p = point(world);
  return rect.x <= p.x && p.x <= rect.x + rect.width && rect.y - rect.height <= p.y && p.y <= rect.y;
}

export function parseNpcActivityState(program: FieldNpcActivityProgram, raw: unknown): FieldNpcActivityState {
  const def = parseFieldNpcActivityProgram(program);
  const row = record(raw, "kind,actorId,definitionHash,generation,revision,waitMs,direction,remainingSteps,rngState,rngDraws,commandId,pending,holder");
  if (row.kind !== "field-npc-activity-state-v1" || row.actorId !== def.actorId || row.definitionHash !== def.definitionHash)
    throw new Error("NPC activity state belongs to a different definition");
  const state: FieldNpcActivityState = {
    kind: row.kind, actorId: def.actorId, definitionHash: def.definitionHash,
    generation: integer(row.generation, 1), revision: integer(row.revision, 0), waitMs: number(row.waitMs, 0),
    direction: row.direction === null ? null : direction(row.direction), remainingSteps: integer(row.remainingSteps, 0, def.moveSteps),
    rngState: integer(row.rngState, 1, 0xffffffff), rngDraws: integer(row.rngDraws, 0), commandId: integer(row.commandId, 0),
    pending: null, holder: null,
  };
  if ((state.direction === null) !== (state.remainingSteps === 0)) throw new Error("Invalid NPC activity burst");
  if (row.pending !== null) {
    const pending = record(row.pending, "commandId,revision,direction");
    state.pending = { commandId: integer(pending.commandId, 1), revision: integer(pending.revision, 1, state.revision), direction: direction(pending.direction) };
    if (state.pending.commandId !== state.commandId || state.pending.direction !== state.direction)
      throw new Error("NPC activity command disagrees with its burst");
  }
  if (row.holder !== null) {
    const holder = record(row.holder, "eventId,revision");
    state.holder = { eventId: text(holder.eventId), revision: integer(holder.revision, 1, state.revision) };
  }
  return state;
}
function sample(state: FieldNpcActivityState, max: number): number {
  const random = { kind: "web-field-random-v1" as const, state: state.rngState, draws: state.rngDraws };
  const value = drawFieldRandom(random, 0, max);
  state.rngState = random.state; state.rngDraws = random.draws;
  return value;
}
function interval(program: FieldNpcActivityProgram, state: FieldNpcActivityState): number {
  sample(state, 0x7fffffff);
  // The 0.8..1.2 envelope is source-backed; the per-actor xorshift sample and
  // double arithmetic here are the explicit Web policy, not native parity.
  return program.baseIntervalMs * (0.8 + 0.4 * state.rngState / 0x100000000);
}
export function createNpcActivity(program: FieldNpcActivityProgram, options: {
  generation: number; seed: number; initialDelayMs: number;
}): FieldNpcActivityState {
  const def = parseFieldNpcActivityProgram(program);
  const row = record(options, "generation,seed,initialDelayMs");
  const seed = createFieldRandom(integer(row.seed, 1, 0xffffffff));
  const delay = number(row.initialDelayMs, 0, 0x7fffffff);
  if (!def.firstInterval && delay !== 0) throw new Error("NPC without first interval cannot receive an initial lag");
  const state: FieldNpcActivityState = {
    kind: "field-npc-activity-state-v1", actorId: def.actorId, definitionHash: def.definitionHash,
    generation: integer(row.generation, 1), revision: 0, waitMs: 0, direction: null, remainingSteps: 0,
    rngState: seed.state, rngDraws: seed.draws, commandId: 0, pending: null, holder: null,
  };
  state.waitMs = interval(def, state) + delay;
  return frozen(state);
}
function input(raw: FieldNpcActivityInput): FieldNpcActivityInput {
  const row = record(raw, "worldPosition,direction,motionActive,dtMs,updateMask,destinations");
  const dest = record(row.destinations, "up,right,down,left");
  return {
    worldPosition: point(row.worldPosition), direction: direction(row.direction), motionActive: bool(row.motionActive),
    dtMs: number(row.dtMs, 0), updateMask: integer(row.updateMask, 0, 0x7fffffff),
    destinations: { up: point(dest.up), right: point(dest.right), down: point(dest.down), left: point(dest.left) },
  };
}
type Prepared = {
  program: string; state: string; input: string; owner: FieldNpcActivityState;
  next: FieldNpcActivityState; intent: FieldNpcActivityIntent | null;
  outcome?: "idle" | "started" | "blocked"; settled?: FieldNpcActivitySettlement;
};
const proposals = new WeakMap<FieldNpcActivityProposal, Prepared>();

/** At most one adjacent-cell intent per call. Unknown collision/media providers
 * must leave the proposal uncommitted. A blocked host outcome consumes only
 * this private random candidate and waits; it never teleports or uses BFS. */
export function prepareNpcActivity(program: FieldNpcActivityProgram, currentState: FieldNpcActivityState,
  currentInput: FieldNpcActivityInput): FieldNpcActivityProposal {
  const def = parseFieldNpcActivityProgram(program), state = parseNpcActivityState(def, currentState), host = input(currentInput);
  const before = canonical(state);
  let intent: FieldNpcActivityIntent | null = null;
  if (state.holder === null && host.dtMs > 0 && (host.updateMask & def.updateAttribute) !== 0) {
    if ((state.pending !== null) !== host.motionActive) throw new Error("NPC activity and host motion ownership disagree");
    if (!state.pending) {
      if (!fieldNpcAreaContains(def.moveArea, host.worldPosition))
        throw new Error("NPC return to its move area requires an explicit provider");
      if (state.remainingSteps === 0) {
        state.waitMs = Math.max(0, state.waitMs - host.dtMs);
        if (state.waitMs === 0) {
          state.waitMs = interval(def, state);
          const candidates = [...directions];
          while (candidates.length) {
            const selected = candidates.splice(sample(state, candidates.length - 1), 1)[0]!;
            if (fieldNpcAreaContains(def.moveArea, host.destinations[selected])) {
              state.direction = selected; state.remainingSteps = def.moveSteps;
              break;
            }
          }
        }
      }
      if (state.direction !== null) {
        if (fieldNpcAreaContains(def.moveArea, host.destinations[state.direction]))
          intent = { direction: state.direction, steps: 1, sourceSpeedEnum: def.sourceSpeedEnum };
        else { state.direction = null; state.remainingSteps = 0; }
      }
    }
  }
  if (intent !== null || canonical(state) !== before) bump(state);
  const next = frozen(state), candidate = frozen({ intent, nextState: next });
  proposals.set(candidate, {
    program: canonical(def), state: before, input: canonical(host), owner: currentState, next, intent,
  });
  return candidate;
}
export function validateNpcActivityProposal(program: FieldNpcActivityProgram, proposal: FieldNpcActivityProposal,
  currentState: FieldNpcActivityState, currentInput: FieldNpcActivityInput): void {
  const proof = proposals.get(proposal);
  if (!proof || proof.owner !== currentState || proof.program !== canonical(parseFieldNpcActivityProgram(program)) ||
      proof.state !== canonical(parseNpcActivityState(program, currentState)) || proof.input !== canonical(input(currentInput)) ||
      proposal.nextState !== proof.next || proposal.intent !== proof.intent)
    throw new Error("Stale or foreign NPC activity proposal");
}
function ticket(state: FieldNpcActivityState): FieldNpcActivityTicket | null {
  return state.pending === null ? null : frozen({ actorId: state.actorId, definitionHash: state.definitionHash,
    generation: state.generation, commandId: state.pending.commandId, revision: state.pending.revision });
}
/** Idempotent for the same unpublished proposal/outcome. The containing Field
 * transaction must validate against its current owner again before publishing
 * both this state and its single Actor.motion. No callback is invoked here. */
export function settleNpcActivity(program: FieldNpcActivityProgram, proposal: FieldNpcActivityProposal,
  outcome: "idle" | "started" | "blocked", currentState: FieldNpcActivityState,
  currentInput: FieldNpcActivityInput): FieldNpcActivitySettlement {
  validateNpcActivityProposal(program, proposal, currentState, currentInput);
  const proof = proposals.get(proposal)!;
  if (outcome !== "idle" && outcome !== "started" && outcome !== "blocked" ||
      (proof.intent === null) !== (outcome === "idle")) throw new Error("Invalid NPC activity settlement");
  if (proof.settled) {
    if (proof.outcome !== outcome) throw new Error("NPC activity proposal already has a different outcome");
    return proof.settled;
  }
  const state = parseNpcActivityState(program, proof.next);
  if (outcome === "started") {
    state.commandId = integer(state.commandId + 1, 1);
    state.pending = { commandId: state.commandId, revision: state.revision, direction: proof.intent!.direction };
  } else if (outcome === "blocked") { state.direction = null; state.remainingSteps = 0; }
  const result = frozen({ state: frozen(state), ticket: outcome === "started" ? ticket(state) : null });
  proof.outcome = outcome; proof.settled = result;
  return result;
}
function matchTicket(state: FieldNpcActivityState, value: FieldNpcActivityTicket): void {
  const row = record(value, "actorId,definitionHash,generation,commandId,revision");
  if (state.holder !== null || state.pending === null || row.actorId !== state.actorId ||
      row.definitionHash !== state.definitionHash || row.generation !== state.generation ||
      row.commandId !== state.pending.commandId || row.revision !== state.pending.revision)
    throw new Error("Stale or paused NPC activity completion");
}
export function completeNpcActivity(program: FieldNpcActivityProgram, currentState: FieldNpcActivityState,
  completion: FieldNpcActivityTicket): FieldNpcActivityState {
  const state = parseNpcActivityState(program, currentState);
  matchTicket(state, completion); bump(state);
  state.pending = null; state.remainingSteps--;
  if (state.remainingSteps === 0) state.direction = null;
  return frozen(state);
}
export function acquireNpcActivity(program: FieldNpcActivityProgram, currentState: FieldNpcActivityState,
  eventId: string): { state: FieldNpcActivityState; lease: FieldNpcActivityLease } {
  const state = parseNpcActivityState(program, currentState);
  text(eventId);
  if (state.holder !== null) throw new Error("NPC activity is already held by an event");
  bump(state);
  state.holder = { eventId, revision: state.revision };
  const lease = { actorId: state.actorId, definitionHash: state.definitionHash, generation: state.generation,
    eventId, revision: state.revision };
  // The existing pending command is deliberately retained. Field pauses its
  // actual motion/animation; acquisition cannot rewind or replace that owner.
  return frozen({ state: frozen(state), lease: frozen(lease) });
}
export function releaseNpcActivity(program: FieldNpcActivityProgram, currentState: FieldNpcActivityState,
  lease: FieldNpcActivityLease): FieldNpcActivitySettlement {
  const state = parseNpcActivityState(program, currentState);
  const row = record(lease, "actorId,definitionHash,generation,eventId,revision");
  if (!state.holder || row.actorId !== state.actorId || row.definitionHash !== state.definitionHash ||
      row.generation !== state.generation || row.eventId !== state.holder.eventId || row.revision !== state.holder.revision)
    throw new Error("Stale or foreign NPC event lease");
  bump(state); state.holder = null;
  // Resume only a still-current command. Its old callback can no longer
  // complete it, including a callback queued before acquisition.
  if (state.pending) state.pending.revision = state.revision;
  return frozen({ state: frozen(state), ticket: ticket(state) });
}
export function captureNpcActivity(program: FieldNpcActivityProgram, currentState: FieldNpcActivityState): FieldNpcActivityCheckpoint {
  const state = parseNpcActivityState(program, currentState);
  if (state.holder !== null) throw new Error("Event-held NPC activity cannot be checkpointed");
  // A pending command is metadata, not evidence of a motion. The field codec
  // must bind it to this exact actor's authorized single-cell motion.
  return { kind: "field-npc-activity-checkpoint-v1", state };
}
export function restoreNpcActivity(program: FieldNpcActivityProgram, raw: unknown,
  options: { generation: number }): FieldNpcActivitySettlement {
  const row = record(raw, "kind,state");
  if (row.kind !== "field-npc-activity-checkpoint-v1") throw new Error("Unsupported NPC activity checkpoint");
  const state = parseNpcActivityState(program, row.state);
  if (state.holder !== null) throw new Error("Event-held NPC activity cannot be restored");
  record(options, "generation");
  state.generation = integer(options.generation, state.generation + 1);
  bump(state);
  if (state.pending) state.pending.revision = state.revision;
  return frozen({ state: frozen(state), ticket: ticket(state) });
}
