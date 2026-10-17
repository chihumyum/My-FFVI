import { record } from './content.js';
/** Bound Internal dictionary instructions read only the exact mnemonic. The
 * caller supplies its evidenced source type domain; old operand banks are not
 * normalized, validated, copied into the operation or interpreted. */
export function compileInternalClockInstruction(raw: unknown, admittedTypes: readonly number[]): { kind: 'nop' | 'blank' } {
  const instruction = record(raw);
  if (!admittedTypes.includes(instruction.type as number)) throw Error('Unsupported internal clock instruction domain');
  if (instruction.mnemonic === 'Nop') return { kind: 'nop' };
  if (instruction.mnemonic === 'Blank') return { kind: 'blank' };
  throw Error('Unknown internal clock instruction');
}
