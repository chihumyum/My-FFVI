import { record } from "./content.js";

export const sourceStandaloneWaitSelector = "PC版のみミリ秒指定で待機";

/** This Windows source build registers this MainCore call, reading map-local
 * variable 7 at execution time. Format's reserved operands do not carry time. */
export function compileFieldStandaloneWaitInstruction(raw: unknown): { kind: "standalone-wait" } {
  const value = record(raw), operands = record(value.operands);
  if (value.type !== 1 || value.mnemonic !== "SysCall")
    throw new Error("Unsupported standalone wait instruction domain");
  for (const [key, empty] of [["iValues", 0], ["rValues", 0], ["sValues", ""]] as const) {
    const values = operands[key];
    if (!Array.isArray(values) || values.length !== 8 || Object.keys(values).length !== 8 ||
        Reflect.ownKeys(values).length !== 9)
      throw new Error("Unsupported standalone wait selector or reserved operands");
    for (let index = 0; index < 8; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        throw new Error("Standalone wait requires data operands");
      if (descriptor.value !== (key === "sValues" && index === 0 ? sourceStandaloneWaitSelector : empty))
        throw new Error("Unsupported standalone wait selector or reserved operands");
    }
  }
  return { kind: "standalone-wait" };
}
