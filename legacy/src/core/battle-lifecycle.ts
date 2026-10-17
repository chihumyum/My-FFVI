import { WEB_BATTLE_BRANCH_EXECUTION, type WebBattleBranchExecution } from './battle-branch-execution.js';
import type { BattleAISource } from "./battle-ai.js";
import { parseBattleEventProgram, assertBattleEventExecutable, type BattleEventProgram } from "./battle-event.js";
import { checkpointKeys } from "./checkpoint-validation.js";

/** Every newly compiled encounter declares its event lane. An omission keeps
 * the exact source identity; it is never represented as an absent script. */
export type BattleLifecycle = ({ kind: "battle-lifecycle-v1" } & (
  | { mode: "none" }
  | { mode: "script"; scriptId: number; program: BattleEventProgram }
  | { mode: "development-omission"; scriptId: number; source: BattleAISource; reason: string }
)) | {kind:"battle-lifecycle-v2";mode:"script";scriptId:number;program:BattleEventProgram;branchExecution:WebBattleBranchExecution};

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
  if (!raw || typeof raw !== "object" || !("kind" in raw) || !["battle-lifecycle-v1","battle-lifecycle-v2"].includes(String(raw.kind)) || !("mode" in raw))
    throw new Error("Invalid battle lifecycle definition");
  if (raw.kind === "battle-lifecycle-v2" && raw.mode!=="script") throw new Error("Branch lifecycle requires its complete source script");
  if (raw.mode === "none") {
    checkpointKeys(raw, "kind,mode");
    return { kind: "battle-lifecycle-v1", mode: "none" };
  }
  if (raw.mode === "script") {
    const v2=raw.kind==="battle-lifecycle-v2";
    checkpointKeys(raw, "kind,mode,scriptId,program"+(v2?",branchExecution":""));
    const value = raw as Extract<BattleLifecycle, { mode: "script" }>;
    identity(value.scriptId);
    const program = parseBattleEventProgram(value.program);
    if(v2){
      const policy=(value as Extract<BattleLifecycle,{kind:"battle-lifecycle-v2"}>).branchExecution;
      if(policy!==WEB_BATTLE_BRANCH_EXECUTION||program.kind!=="battle-event-v2"||!program.source)throw new Error("Missing source battle branch content policy");
      assertBattleEventExecutable(program,policy);program.source=sourceIdentity(program.source);
      return {kind:"battle-lifecycle-v2",mode:"script",scriptId:value.scriptId,program,branchExecution:policy};
    }
    if(program.kind!=="battle-event-v1")throw new Error("Legacy battle lifecycle cannot grant branch execution");
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
