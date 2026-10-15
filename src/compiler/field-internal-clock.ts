import { record } from "./content.js";

/** The exact Internal dictionary owns both mnemonic forms for main and puppet
 * cores. Nop never reads operands; disabled editor instructions can therefore
 * retain stale operands or omit them. Blank only reads IsFirstClock. Unknown
 * names and instruction domains do not acquire either behavior. */
export function compileFieldInternalClockInstruction(raw: unknown): { kind: "nop" | "blank" } {
  const value = record(raw);
  if (value.type !== 1 && value.type !== 2) throw new Error("Unsupported internal field instruction domain");
  if (value.mnemonic === "Nop") return { kind: "nop" };
  if (value.mnemonic === "Blank") return { kind: "blank" };
  throw new Error("Unknown internal clock instruction");
}
