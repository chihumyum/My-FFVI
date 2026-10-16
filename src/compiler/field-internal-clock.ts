import { record } from "./content.js";
import { compileInternalClockInstruction } from "./internal-clock.js";

/** The exact Internal dictionary owns both mnemonic forms for main and puppet
 * cores. Nop never reads operands; disabled editor instructions can therefore
 * retain stale operands or omit them. Blank only reads IsFirstClock. Unknown
 * names and instruction domains do not acquire either behavior. */
export function compileFieldInternalClockInstruction(raw: unknown): { kind: "nop" | "blank" } {
  if (![1, 2].includes(record(raw).type as number))
    throw new Error("Unsupported internal field instruction domain");
  return compileInternalClockInstruction(raw, [1, 2]);
}
