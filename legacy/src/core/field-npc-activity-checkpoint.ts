import {
  captureNpcActivity, parseFieldNpcActivityProgram, parseNpcActivityState,
  restoreNpcActivity, sourceNpcSecondsPerCell,
  type FieldNpcActivityCheckpoint, type FieldNpcActivityProgram,
  type FieldNpcActivitySettlement, type FieldNpcActivityState,
} from "./field-npc-activity.js";
import type { FieldNativeAutonomousMotionBinding } from "./field-native-checkpoint.js";
import type { FieldActorMotion } from "./field-script-motion.js";

/** Controller metadata only. Actor.motion and native position belong to the
 * containing field/native checkpoint; a saved row cannot supply a program. */
export type FieldNpcActivitiesCheckpoint = {
  kind: "field-npc-activities-checkpoint-v1";
  activities: Record<string, FieldNpcActivityCheckpoint>;
};
export type FieldNpcActivityCheckpointRecord = {
  program: FieldNpcActivityProgram;
  state: FieldNpcActivityState;
  actor: { readonly motion: FieldActorMotion | null };
};
export type RestoredFieldNpcActivities = {
  activities: Record<string, FieldNpcActivitySettlement>;
  autonomousMotions: Record<string, FieldNativeAutonomousMotionBinding>;
};

function record(raw: unknown, fields?: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid NPC activities checkpoint record");
  const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(raw);
  const expected = fields?.split(",");
  if (keys.some(key => typeof key !== "string" || !key) ||
      Object.values(descriptors).some(d => !d.enumerable || !("value" in d)) ||
      expected && (keys.length !== expected.length || expected.some(key => !Object.hasOwn(descriptors, key))))
    throw new Error("Invalid NPC activities checkpoint fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, d.value]));
}
function generation(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1)
    throw new Error("Invalid NPC activities checkpoint generation");
  return raw;
}
function programs(raw: Readonly<Record<string, FieldNpcActivityProgram>>): Map<string, FieldNpcActivityProgram> {
  return new Map(Object.entries(record(raw)).map(([id, value]) => {
    const program = parseFieldNpcActivityProgram(value);
    if (program.actorId !== id) throw new Error("NPC activities program key differs from its actor identity");
    return [id, program];
  }));
}
function binding(program: FieldNpcActivityProgram, state: FieldNpcActivityState): FieldNativeAutonomousMotionBinding | null {
  return state.pending === null ? null : {
    definitionHash: program.definitionHash, sourceSpeedEnum: program.sourceSpeedEnum,
    commandId: state.pending.commandId, secondsPerCell: sourceNpcSecondsPerCell(program.sourceSpeedEnum),
  };
}

/** Correlate metadata with the existing motion register. Native XY, layer,
 * direction and actual moving flag are checked by the native codec, which
 * consumes the same trusted binding rather than another motion copy. */
function checkMotion(program: FieldNpcActivityProgram, state: FieldNpcActivityState, actor: unknown): void {
  if (!actor || typeof actor !== "object" || Array.isArray(actor))
    throw new Error("NPC activities checkpoint is missing its field actor");
  // Native actors legitimately expose position/animation accessors. Only their
  // single own motion register is read here; unrelated accessors are not read.
  const descriptor = Object.getOwnPropertyDescriptor(actor, "motion");
  if (!descriptor || !("value" in descriptor)) throw new Error("Invalid NPC activities motion register");
  const currentMotion: unknown = descriptor.value;
  if (currentMotion === undefined || (state.pending !== null) !== (currentMotion !== null))
    throw new Error("NPC activity pending command and actor motion disagree");
  if (currentMotion === null) return;
  const motion = record(currentMotion, "from,to,elapsed,duration,manual");
  const from = record(motion.from, "x,y"), to = record(motion.to, "x,y");
  for (const point of [from, to]) for (const value of Object.values(point)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < -0x80000000 ||
        value > 0x7fffffff || Math.fround(value) !== value)
      throw new Error("Invalid NPC activities motion grid coordinate");
  }
  const dx = (to.x as number) - (from.x as number), dy = (to.y as number) - (from.y as number);
  const direction = dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
  if (motion.manual !== false || Math.abs(dx) + Math.abs(dy) !== 1 || dx !== 0 && dy !== 0 ||
      direction !== state.pending!.direction)
    throw new Error("NPC activities motion differs from its pending cardinal command");
  const duration = sourceNpcSecondsPerCell(program.sourceSpeedEnum) * 1000;
  if (motion.duration !== duration || typeof motion.elapsed !== "number" ||
      !Number.isSafeInteger(motion.elapsed) || motion.elapsed < 0 || motion.elapsed >= duration || motion.elapsed % 10 !== 0)
    throw new Error("NPC activities motion timing differs from its trusted program");
}

/** The host supplies its complete active controller domain and exact actors.
 * This helper neither discovers actors nor grants runtime instance authority. */
export function captureFieldNpcActivities(
  records: Readonly<Record<string, FieldNpcActivityCheckpointRecord>>,
): FieldNpcActivitiesCheckpoint {
  const rows = Object.entries(record(records)).map(([id, raw]) => {
    const fields = record(raw, "program,state,actor"), program = parseFieldNpcActivityProgram(fields.program);
    if (program.actorId !== id) throw new Error("NPC activities program key differs from its actor identity");
    const saved = captureNpcActivity(program, fields.state as FieldNpcActivityState);
    checkMotion(program, saved.state, fields.actor);
    return [id, saved] as const;
  });
  return { kind: "field-npc-activities-checkpoint-v1", activities: Object.fromEntries(rows) };
}

/** Restore only the exact trusted active domain. New completion tickets are
 * rebound without initialization, random draws, position writes or movement.
 * The outer field must jointly restore native motion with autonomousMotions
 * and bind tickets to its fresh exact Field/Actor instance authority. */
export function restoreFieldNpcActivities(
  trustedPrograms: Readonly<Record<string, FieldNpcActivityProgram>>,
  raw: unknown,
  options: { generation: number },
): RestoredFieldNpcActivities {
  const definitions = programs(trustedPrograms), fields = record(raw, "kind,activities");
  if (fields.kind !== "field-npc-activities-checkpoint-v1") throw new Error("Unknown NPC activities checkpoint");
  const saved = record(fields.activities), floor = generation(record(options, "generation").generation);
  if (Object.keys(saved).length !== definitions.size || [...definitions.keys()].some(id => !Object.hasOwn(saved, id)))
    throw new Error("NPC activities checkpoint domain differs from its trusted active programs");
  const activities: [string, FieldNpcActivitySettlement][] = [], motions: [string, FieldNativeAutonomousMotionBinding][] = [];
  for (const [id, program] of definitions) {
    const row = record(saved[id], "kind,state"), state = parseNpcActivityState(program, row.state);
    const nextGeneration = generation(Math.max(floor, state.generation + 1));
    const restored = restoreNpcActivity(program, row, { generation: nextGeneration });
    activities.push([id, restored]);
    const motion = binding(program, restored.state);
    if (motion) motions.push([id, motion]);
  }
  return { activities: Object.fromEntries(activities), autonomousMotions: Object.fromEntries(motions) };
}
