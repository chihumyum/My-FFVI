import { record } from './content.js';
import { int32 } from '../core/event-state.js';
import type { Op, Site } from '../field/types.js';

function data(raw: unknown): Record<string, unknown> {
  const value = record(raw);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string') ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !d.enumerable || !('value' in d)))
    throw new Error('PlayAnim requires plain source operand data');
  return value;
}
function dense(raw: unknown): unknown[] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length !== 8 || Reflect.ownKeys(raw).length !== 9)
    throw new Error('PlayAnim source protocol requires three dense eight-slot arrays');
  return Array.from({ length: 8 }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('PlayAnim requires dense own operand data');
    return descriptor.value;
  });
}
/** Puppet.PlayAnim's finite-repeat domain. Source i0/flip and r1/time-limit
 * are not inferred; nonzero r2 still requires the captured native timer host.
 * Short source arrays remain outside this newly recovered protocol. */
export function compileFieldFiniteAnimationInstruction(raw: unknown): Omit<Extract<Op, { kind: 'animation-play' }>, keyof Site> {
  const instruction = data(raw), operands = data(instruction.operands);
  if (instruction.mnemonic !== 'PlayAnim' || instruction.type !== 2)
    throw new Error('Expected Puppet PlayAnim');
  if (Object.keys(operands).sort().join(',') !== 'iValues,rValues,sValues') throw new Error('Unknown PlayAnim operand fields');
  const integers = dense(operands.iValues).map(int32), reals = dense(operands.rValues), strings = dense(operands.sValues);
  if (integers[0] !== 0 || integers[1]! <= 1 || integers.slice(2).some(value => value !== 0) ||
      reals.some(value => typeof value !== 'number' || !Number.isFinite(value)) || reals.slice(1).some(value => value !== 0) ||
      strings.some(value => typeof value !== 'string') || strings.slice(1).some(value => value !== ''))
    throw new Error('Unsupported PlayAnim finite-repeat/flip/time-limit/delay or reserved source operands');
  const speed = Math.fround((reals[0] as number) || 1), scale = Math.fround(1 / speed);
  if (!(speed > 0) || !Number.isFinite(speed) || !(scale > 0) || !Number.isFinite(scale)) throw new Error('Invalid PlayAnim source playback speed');
  return { kind: 'animation-play', animation: strings[0] as string, speed, loop: false, repeatCount: integers[1]! };
}
