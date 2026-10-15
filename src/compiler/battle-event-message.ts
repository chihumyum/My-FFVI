import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { hash, record } from "./content.js";
import { compileSourceMessageSequenceDocument } from "./source-message-sequence.js";
import { sourceMessageSequenceTextRuns } from "../core/source-message-sequence.js";
import { compileFieldMessageTemplate } from "./message-template.js";
import { BATTLE_MESSAGE_DICTIONARIES, parseBattleEventMessageBinding, type BattleEventMessageBinding, type BattleEventMessageOp } from "../core/battle-event-message.js";
export type BattleEventMessageInput = { messages: Record<string, unknown>; characterNames?: unknown;
  binding?: BattleEventMessageBinding };
/** Prepare once per complete program. The immutable copied dictionaries make
 * per-instruction lookups independent of later input mutation, while every v2
 * table and full name table is checked against its complete content binding. */
export function createBattleEventMessageCompiler(input: BattleEventMessageInput) {
  const binding = input.binding ? parseBattleEventMessageBinding(input.binding) : null,
    messages = structuredClone(input.messages), characterNames = structuredClone(input.characterNames);
  let lookup: (key: string) => {text:string; speaker:string};
  if (binding?.kind === "battle-event-message-binding-v2") {
    for (const row of binding.sources) {
      const table = BATTLE_MESSAGE_DICTIONARIES[row.role], values = row.role === "character-names" ? characterNames : record(messages[table]);
      if (hash(values) !== row.contentHash || (Array.isArray(values) ? values.length : Object.keys(record(values)).length) !== row.rowCount)
        throw new Error("Battle message dictionary content/source mismatch: " + table);
      if (row.role !== "character-names" && Object.entries(record(values)).some(([key,value]) => !key || typeof value !== "string"))
        throw new Error("Invalid battle message dictionary: " + table);
    }
    const bodies = new Map<string,string>(), speakers = record(messages.story_cha_zhc);
    for (const table of ["story_mes_zhc", "system_zhc", "etc_text_zhc"])
      for (const [key,text] of Object.entries(record(messages[table]))) {
        if (bodies.has(key)) throw new Error("Duplicate battle message body key across dictionaries: " + key);
        bodies.set(key,text as string);
      }
    lookup = key => {
      if (!key || !bodies.has(key)) throw new Error("Missing source battle message body: " + key);
      // Both complete native speaker getters warn and return String.Empty when
      // absent. Only this source-bound v2 dictionary contract grants that path.
      return {text:bodies.get(key)!, speaker:Object.hasOwn(speakers,key) ? speakers[key] as string : ""};
    };
  } else lookup = key => {
    const text = record(messages.story_mes_zhc ?? {})[key], speaker = record(messages.story_cha_zhc ?? {})[key];
    if (!key || typeof text !== "string" || typeof speaker !== "string")
      throw new Error("Missing source battle message body/speaker (v1 requires explicit story rows)");
    return {text,speaker};
  };
  return (raw:unknown,nextMnemonic:string|null) => compileMessage(raw,lookup,characterNames,nextMnemonic);
}
export function compileBattleEventMessage(raw:unknown,input:BattleEventMessageInput,nextMnemonic:string|null):BattleEventMessageOp {
  return createBattleEventMessageCompiler(input)(raw,nextMnemonic);
}
/** WindowParams 0x2bd1c0 maps source 1/2 to the same Battle window, with
 * left/right speaker. All three use MessageWindowClient/MessageWindowManager. */
function compileMessage(raw: unknown, lookup:(key:string)=>{text:string;speaker:string}, characterNames:unknown,
  nextMnemonic: string | null): BattleEventMessageOp {
  const value = record(raw), operands = record(value.operands);
  if (value.type !== 1 || !["Msg", "MsgClose"].includes(String(value.mnemonic)))
    throw new Error("Expected battle event Msg/MsgClose");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (value.mnemonic === "MsgClose") {
    if (ints.some(v => v !== 0) || reals.some(v => v !== 0) || strings.some(v => v !== ""))
      throw new Error("Unsupported battle event MsgClose operands");
    return { kind: "message", command: { kind: "close" }, presentation: null };
  }
  if (![0, 1, 2].includes(ints[0]!) || ![0, 1, 2].includes(ints[1]!) || ints.slice(3).some(v => v !== 0) ||
      reals.slice(1).some(v => v !== 0) || strings.slice(1).some(v => v !== ""))
    throw new Error("Unsupported battle event Msg window or reserved operands");
  if (typeof nextMnemonic !== "string" || !nextMnemonic) throw new Error("Battle event Msg requires its following source mnemonic");
  const key = strings[0]!, {text,speaker} = lookup(key);
  if (/[<>\\\r\n\u0000-\u001f\u007f]/.test(speaker)) throw new Error("Unsupported battle event speaker control");
  const document = compileSourceMessageSequenceDocument(text);
  if (document.tokens.some(t => t.kind === "page" && t.tag === "AUTO_P") && document.tokens.some(t => t.kind === "press"))
    throw new Error("Automatic battle event message with PRESS requires an input callback host");
  const template = compileFieldMessageTemplate(sourceMessageSequenceTextRuns(document), speaker, characterNames);
  return { kind: "message", command: { kind: "sequence", key, speaker, document,
    layout: { window: "frame", anchor: (["top", "middle", "bottom"] as const)[ints[1]!]! },
    seconds: reals[0]!, bypassSpeed: ints[2] !== 0,
    after: nextMnemonic === "Msg" ? "message" : nextMnemonic === "Select" ? "choice" : "close",
    ...(template ? { template } : {}) },
    presentation: { sourceWindow: ints[0] as 0 | 1 | 2, speakerAnchor: ints[0] === 2 ? "right" : "left" } };
}
