import { compileBattleEvent } from "../../src/compiler/battle-event.js";
import { fixture } from "./battle-content.js";
import { checkpointFixture } from "./checkpoint-game.js";
import { createWebFieldMessageSequencePort } from "../../src/core/source-message-sequence.js";
import { WEB_BATTLE_EVENT_MESSAGE_POLICY } from "../../src/core/battle-event-message.js";
import type { BattleEventProgram } from "../../src/core/battle-event.js";
export const authoredMessageSource = { sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64),
  file: "authored.bundle", sha256: "c".repeat(64), assetPath: "authored/battle-message", serializedFile: "authored", objectId: "9007199254740993" };
export const messageRaw = (mnemonic: string, seconds = 0, key = "AUTHORED", window = 1) => ({ type: 1, mnemonic,
  operands: { iValues: [mnemonic === "Msg" ? window : 0, mnemonic === "Msg" ? 2 : 0,0,0,0,0,0,0],
    rValues: [seconds,0,0,0,0,0,0,0], sValues: [mnemonic === "Msg" ? key : "","","","","","","",""] } });
export function battleMessageProgram(raw: ReturnType<typeof messageRaw>[] = [messageRaw("Msg"), messageRaw("MsgClose"), messageRaw("ExecBattleAI"),
  messageRaw("Blank"), messageRaw("SyncBattleAI"), messageRaw("Nop"), messageRaw("BattleSyncAction"), messageRaw("Wait",.04), messageRaw("Exit")]): BattleEventProgram {
  const program = compileBattleEvent({ Name: "authored", Title: { main: "", sub: "" }, Mnemonics: raw,
    Segments: [{ Label: "Main", EntryPoint: 0, Count: raw.length }], ScriptLocal: ["BattleAIFlag"], ScriptLocalValue: [0],
    SystemFlag: { KeepBadStatusVisual: 0, KeepPlayerPuppet: 0, RidingVehicle: 0, SkipInitialize: 0 }, Animations: [] }, authoredMessageSource,
    { messages: { story_mes_zhc: { AUTHORED: "First page.<P>Second page.<PRESS>", ASYNC: "Asynchronous message." },
      story_cha_zhc: { AUTHORED: "Authored speaker", ASYNC: "Right speaker" } }, binding: {
        kind: "battle-event-message-binding-v1", sourceSetHash: "a".repeat(64), parentSourceSetHash: "d".repeat(64),
        sources: (["body", "speaker", "character-names"] as const).map(role => ({ role, source: {
          file: "authored.bundle", assetPath: "authored/" + role, objectId: "9007199254740993", serializedFile: "authored", sha256: "c".repeat(64) } })) } });
  if (raw.length === 9 && raw[2]!.mnemonic === "ExecBattleAI")
    program.instructions[5]!.op = { kind: "branch", index: 0, operator: "＝", right: { kind: "immediate", value: 0 }, target: 2 };
  return program;
}
export function battleMessageContent(program = battleMessageProgram()) {
  const content = fixture();
  content.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 9000, program };
  content.battleEvents = { conditions: content.conditions.rules.definitions.map(({ id, type }) =>
    ({ id, type, attackTarget: type === 5 ? 1 : 0, gameOverTarget: type === 5 ? 1 : 0 })) };
  return content;
}
export function battleMessageSessionFixture(program = battleMessageProgram()) {
  const data = checkpointFixture(), content = battleMessageContent(program);
  data.battle.common.battleEvents = content.battleEvents!;
  data.battle.encounters[1000]!.lifecycle = content.lifecycle!;
  return { ...data, runtime: { battleHandoff: "prepared" as const, battleEventMessages: WEB_BATTLE_EVENT_MESSAGE_POLICY,
    sourceMessageSequence: createWebFieldMessageSequencePort() } };
}
