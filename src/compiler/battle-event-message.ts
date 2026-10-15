import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";
import { compileSourceMessageSequenceDocument } from "./source-message-sequence.js";
import { sourceMessageSequenceTextRuns } from "../core/source-message-sequence.js";
import { compileFieldMessageTemplate } from "./message-template.js";
import type { BattleEventMessageBinding, BattleEventMessageOp } from "../core/battle-event-message.js";
export type BattleEventMessageInput = { messages: Record<string, unknown>; characterNames?: unknown;
  binding?: BattleEventMessageBinding };
/** WindowParams 0x2bd1c0 maps source 1/2 to the same Battle window, with
 * left/right speaker. All three use MessageWindowClient/MessageWindowManager;
 * this is not a field-op adapter or an admission of unrelated battle opcodes. */
export function compileBattleEventMessage(raw: unknown, input: BattleEventMessageInput,
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
  const key = strings[0]!, text = record(input.messages.story_mes_zhc ?? {})[key],
    speaker = record(input.messages.story_cha_zhc ?? {})[key];
  if (!key || typeof text !== "string" || typeof speaker !== "string")
    throw new Error("Missing source battle message body/speaker (system-message routing is unassessed)");
  if (/[<>\\\r\n\u0000-\u001f\u007f]/.test(speaker)) throw new Error("Unsupported battle event speaker control");
  const document = compileSourceMessageSequenceDocument(text);
  if (document.tokens.some(t => t.kind === "page" && t.tag === "AUTO_P") && document.tokens.some(t => t.kind === "press"))
    throw new Error("Automatic battle event message with PRESS requires an input callback host");
  const template = compileFieldMessageTemplate(sourceMessageSequenceTextRuns(document), speaker, input.characterNames);
  return { kind: "message", command: { kind: "sequence", key, speaker, document,
    layout: { window: "frame", anchor: (["top", "middle", "bottom"] as const)[ints[1]!]! },
    seconds: reals[0]!, bypassSpeed: ints[2] !== 0,
    after: nextMnemonic === "Msg" ? "message" : nextMnemonic === "Select" ? "choice" : "close",
    ...(template ? { template } : {}) },
    presentation: { sourceWindow: ints[0] as 0 | 1 | 2, speakerAnchor: ints[0] === 2 ? "right" : "left" } };
}
