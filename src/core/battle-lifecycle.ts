import type { BattleAISource } from "./battle-ai.js";
import { parseBattleEventProgram, assertBattleEventExecutable, type BattleEventProgram } from "./battle-event.js";
import { checkpointKeys } from "./checkpoint-validation.js";

/** Every newly compiled encounter declares its event lane. An omission keeps
 * the exact source identity; it is never represented as an absent script. */
export type BattleLifecycle = { kind: "battle-lifecycle-v1" } & (
  | { mode: "none" }
  | { mode: "script"; scriptId: number; program: BattleEventProgram }
  | { mode: "development-omission"; scriptId: number; source: BattleAISource; reason: string }
);

function identity(id: unknown): asserts id is number {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || id > 0x7fffffff)
    throw new Error("Invalid battle lifecycle script identity");
}
function sourceIdentity(raw: unknown): BattleAISource {
  checkpointKeys(raw, "sourceSetHash,battleSourceSetHash,file,sha256,assetPath,serializedFile,objectId");
  const source = raw as BattleAISource;
  if (Object.values(source).some(value => typeof value !== "string" || !value.length) ||
      !/^-?(?:0|[1-9]\d*)$/.test(source.objectId) || BigInt(source.objectId) < -(1n << 63n) ||
      BigInt(source.objectId) >= (1n << 63n)) throw new Error("Invalid battle lifecycle source identity");
  return structuredClone(source);
}

/** Validate executable catalog content, not a compiler's partially decoded
 * program. Source import/byte verification is the caller's separate duty. */
export function parseBattleLifecycle(raw: unknown): BattleLifecycle {
  if (!raw || typeof raw !== "object" || !("kind" in raw) || raw.kind !== "battle-lifecycle-v1" || !("mode" in raw))
    throw new Error("Invalid battle lifecycle definition");
  if (raw.mode === "none") {
    checkpointKeys(raw, "kind,mode");
    return { kind: "battle-lifecycle-v1", mode: "none" };
  }
  if (raw.mode === "script") {
    checkpointKeys(raw, "kind,mode,scriptId,program");
    const value = raw as Extract<BattleLifecycle, { mode: "script" }>;
    identity(value.scriptId);
    const program = parseBattleEventProgram(value.program);
    assertBattleEventExecutable(program);
    if (program.source !== null) program.source = sourceIdentity(program.source);
    return { kind: "battle-lifecycle-v1", mode: "script", scriptId: value.scriptId, program };
  }
  if (raw.mode === "development-omission") {
    checkpointKeys(raw, "kind,mode,scriptId,source,reason");
    const value = raw as Extract<BattleLifecycle, { mode: "development-omission" }>;
    identity(value.scriptId);
    if (typeof value.reason !== "string" || !value.reason.trim()) throw new Error("Missing battle lifecycle omission reason");
    return { kind: "battle-lifecycle-v1", mode: "development-omission", scriptId: value.scriptId,
      source: sourceIdentity(value.source), reason: value.reason };
  }
  throw new Error("Unsupported battle lifecycle mode");
}
