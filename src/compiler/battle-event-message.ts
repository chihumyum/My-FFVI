import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";
import { createSourceMessageDictionary, type SourceMessageDictionaryInput } from "./source-message-dictionary.js";
import { compileSourceMessageSequenceDocument } from "./source-message-sequence.js";
import { sourceMessageSequenceTextRuns } from "../core/source-message-sequence.js";
import { compileFieldMessageTemplate } from "./message-template.js";
import { type BattleEventMessageOp } from "../core/battle-event-message.js";
export type BattleEventMessageInput = SourceMessageDictionaryInput;
/** Prepare the shared dictionary once per complete source program. */
export function createBattleEventMessageCompiler(input: BattleEventMessageInput) {
  const dictionary = createSourceMessageDictionary(input);
  return (raw:unknown,nextMnemonic:string|null) => compileMessage(raw,dictionary.message,dictionary.characterNames,nextMnemonic);
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
