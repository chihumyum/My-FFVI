import {parseWorldAutoMoveCommand,type WorldAutoMoveCommand} from './field-world-auto-move.js';
import type { FieldContent, Site } from '../field/types.js';
import { canonical } from './canonical.js';
import { checkpointKeys, checkpointInteger } from './checkpoint-validation.js';

/** A declared flat Web controller. No native aircraft, 3D movement or RT host. */
export const WEB_FLAT_WORLD_AUTO_TASKS = 'web-flat-world-auto-tasks-v1' as const;
export type WebFlatWorldAutoTasks = typeof WEB_FLAT_WORLD_AUTO_TASKS;
export type WorldAutoChannel = 'rotation' | 'flightAltitude' | 'upDown';
export type WorldAutoValues = Record<WorldAutoChannel, number>;
export type WorldAutoBinding = { mapId: number; fieldContentHash: string };
export type WorldAutoPose = WorldAutoValues & {
  kind: 'web-flat-world-auto-pose-v1'; policy: WebFlatWorldAutoTasks; binding: WorldAutoBinding;
};
export type FieldWorldAutoCommand = WorldAutoMoveCommand | { kind: 'start' } | {
  kind: 'add-scalar'; channel: WorldAutoChannel; seconds: number;
  /** null reads the camera's current scalar immediately when added. */
  start: number | null; value: number;
};
export type FieldWorldAutoOp = { kind: 'field-world-auto-task'; command: FieldWorldAutoCommand };
type WorldAutoTaskBase={ticket:number;site:Site;seconds:number;elapsed:number;started:boolean};
export type WorldAutoTask=WorldAutoTaskBase&({channel:WorldAutoChannel;start:number;value:number}|{channel:'movement';movement:WorldAutoMoveCommand});
export type WorldAutoQueue = { nextTicket: number; revision: number; tasks: WorldAutoTask[] };
const f = Math.fround;
const channels: WorldAutoChannel[] = ['rotation', 'flightAltitude', 'upDown'];
export function validateWorldAutoTaskPolicy(raw: unknown): asserts raw is WebFlatWorldAutoTasks | undefined {
  if (raw !== undefined && raw !== WEB_FLAT_WORLD_AUTO_TASKS) throw new Error('Unknown Web world auto-task policy');
}
function scalar(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isFinite(f(raw)) || f(raw) !== raw)
    throw new Error('Invalid world auto-task float32 scalar');
  return raw;
}
export function parseFieldWorldAutoCommand(raw: FieldWorldAutoCommand): FieldWorldAutoCommand {
  if(raw?.kind==='add-movement')return parseWorldAutoMoveCommand(raw);
  checkpointKeys(raw, raw?.kind === 'start' ? 'kind' : 'kind,channel,seconds,start,value');
  if (raw.kind === 'start') return { kind: 'start' };
  if (raw.kind !== 'add-scalar' || !channels.includes(raw.channel)) throw new Error('Unknown world auto-task command');
  return { kind: 'add-scalar', channel: raw.channel, seconds: scalar(raw.seconds),
    start: raw.start === null ? null : scalar(raw.start), value: scalar(raw.value) };
}
export function parseWorldAutoBinding(raw: WorldAutoBinding): WorldAutoBinding {
  checkpointKeys(raw, 'mapId,fieldContentHash'); checkpointInteger(raw.mapId, 1);
  if (typeof raw.fieldContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.fieldContentHash)) throw new Error('Invalid world auto-task content binding');
  return { ...raw };
}
export function worldAutoBinding(content: FieldContent, policy: WebFlatWorldAutoTasks | undefined): WorldAutoBinding | undefined {
  validateWorldAutoTaskPolicy(policy);
  if (policy === undefined || content.developmentProfile?.worldAutoTasks !== WEB_FLAT_WORLD_AUTO_TASKS) return undefined;
  if (content.developmentProfile.kind !== 'framework-development-v1' || !content.cameraHost ||
      !content.map.identity?.mapId) throw new Error('World auto tasks require trusted current flat content and its camera');
  return parseWorldAutoBinding({ mapId: content.map.identity.mapId, fieldContentHash: content.contentHash });
}
export function parseWorldAutoPose(raw: WorldAutoPose, binding?: WorldAutoBinding): WorldAutoPose {
  checkpointKeys(raw, 'kind,policy,binding,rotation,flightAltitude,upDown');
  if (raw.kind !== 'web-flat-world-auto-pose-v1' || raw.policy !== WEB_FLAT_WORLD_AUTO_TASKS)
    throw new Error('Unknown world auto-task pose policy');
  const source = parseWorldAutoBinding(raw.binding);
  if (binding && canonical(source) !== canonical(parseWorldAutoBinding(binding))) throw new Error('World auto-task pose belongs to another field');
  return { kind: raw.kind, policy: raw.policy, binding: source,
    rotation: scalar(raw.rotation), flightAltitude: scalar(raw.flightAltitude), upDown: scalar(raw.upDown) };
}
/** Explicit Web initial flat pose, not a claim about native camera defaults. */
export function createWorldAutoPose(binding: WorldAutoBinding): WorldAutoPose {
  return { kind: 'web-flat-world-auto-pose-v1', policy: WEB_FLAT_WORLD_AUTO_TASKS,
    binding: parseWorldAutoBinding(binding), rotation: 0, flightAltitude: 0, upDown: 0 };
}
export function createWorldAutoQueue(): WorldAutoQueue { return { nextTicket: 1, revision: 0, tasks: [] }; }
export function addWorldAutoCommand(queue: WorldAutoQueue, pose: WorldAutoPose, raw: FieldWorldAutoCommand, site: Site): WorldAutoQueue {
  parseWorldAutoPose(pose); const command = parseFieldWorldAutoCommand(raw), next = structuredClone(queue);
  if (command.kind === 'start') {
    // Start never consumes/clears the list. Explicit Web rule: already running
    // tasks keep their elapsed time; every newly appended task starts together.
    for (const task of next.tasks) task.started = true;
  } else if(command.kind==='add-movement'){
    next.tasks.push({ticket:next.nextTicket++,site:structuredClone(site),channel:'movement',movement:command,seconds:command.seconds,elapsed:0,started:false});
  } else {
    const start = command.start ?? pose[command.channel];
    // Fail before queue publication if even the eventual endpoint overflows.
    scalar(command.channel === 'rotation' ? f(start + command.value) : command.value);
    next.tasks.push({ ticket: next.nextTicket++, site: structuredClone(site), channel: command.channel,
      seconds: command.seconds, start, value: command.value, elapsed: 0, started: false });
  }
  next.revision++; return next;
}
export function advanceWorldAutoQueue(queue: WorldAutoQueue, current: WorldAutoPose): { queue: WorldAutoQueue; pose: WorldAutoPose; completed: number[];movements:{ticket:number;command:WorldAutoMoveCommand;rotation:number}[] } {
  const next = structuredClone(queue), pose = parseWorldAutoPose(current), completed: number[] = [],movements:{ticket:number;command:WorldAutoMoveCommand;rotation:number}[]=[];
  for (const task of next.tasks) {
    if (!task.started) continue;
    // Source coroutine tests before its next delta. Zero/negative duration does
    // not invoke a setter or force an endpoint, but still terminates on a tick.
    if (task.elapsed >= task.seconds) { completed.push(task.ticket); continue; }
    task.elapsed = scalar(f(task.elapsed + f(.01)));
    if(task.channel==='movement'){if(!task.movement)throw Error('Missing world auto-movement command');movements.push({ticket:task.ticket,command:parseWorldAutoMoveCommand(task.movement),rotation:pose.rotation});continue;}
    const ratio = f(Math.max(0, Math.min(1, f(task.elapsed / task.seconds))));
    pose[task.channel] = scalar(task.channel === 'rotation' ? f(f(ratio * task.value) + task.start)
      : f(task.start + f(f(task.value - task.start) * ratio)));
  }
  next.tasks = next.tasks.filter(task => !completed.includes(task.ticket));
  if (queue.tasks.some(task => task.started)) next.revision++;
  return { queue: next, pose, completed,movements };
}
/** Declared Canvas projection: source-angle rotation, bounded exponential zoom
 * from altitude, and source-pixel vertical offset. No 3D camera/RT simulation. */
export function projectFlatWorldAutoPose(raw: WorldAutoPose): { radians: number; scale: number; offsetY: number } {
  const pose = parseWorldAutoPose(raw);
  return { radians: (pose.rotation % 360) * Math.PI / 180,
    scale: 2 ** -Math.max(-8, Math.min(8, pose.flightAltitude)), offsetY: -pose.upDown };
}
