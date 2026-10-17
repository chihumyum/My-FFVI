import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { validateSourceMessageSequenceDocument, sourceMessageSequenceTextRuns, sourceMessageSequenceWait,
  type SourceMessageSequenceCommand, type SourceMessageSequenceDocument, type SourceMessageToken } from "../core/source-message-sequence.js";
import { record } from "./content.js";
import { compileFieldMessageTemplate } from "./message-template.js";

/** Ordered control protocol; no regex stripping of unimplemented controls. */
export function compileSourceMessageSequenceDocument(raw: string): SourceMessageSequenceDocument {
  if (typeof raw !== "string" || !raw || /\\(?!n)|\r/.test(raw)) throw new Error("Unsupported source sequence escape or empty text");
  const tokens: SourceMessageToken[] = [], pattern = /<[^<>]*>/g;
  let start = 0;
  const text = (value: string) => { if (value) tokens.push({ kind: "text", text: value.replaceAll("\\n", "\n") }); };
  for (const match of raw.matchAll(pattern)) {
    text(raw.slice(start, match.index));
    const control = match[0], wait = control.match(/^<WAIT([0-9a-f]*)>$/i);
    if (/^<CT>$/i.test(control)) tokens.push({ kind: "center" });
    else if (/^<PRESS>$/i.test(control)) tokens.push({ kind: "press" });
    else if (/^<(P|AUTO_P)>$/i.test(control)) tokens.push({ kind: "page", tag: /^<P>$/i.test(control) ? "P" : "AUTO_P" });
    else if (wait) {
      // Native C# suffix switch is case sensitive despite the tag regex.
      tokens.push({ kind: "wait", seconds: sourceMessageSequenceWait(wait[1]!), suffix: wait[1]! });
    } else throw new Error("Unsupported source sequence control: " + control);
    start = match.index! + control.length;
  }
  text(raw.slice(start));
  const document: SourceMessageSequenceDocument = { kind: "source-message-sequence-v1", tokens,
    alignment: tokens.some(token => token.kind === "center") ? "center" : "left" };
  validateSourceMessageSequenceDocument(document); return document;
}
export function compileSourceMessageSequenceInstruction(raw: unknown, messages: Record<string, unknown>,
  context?: { nextMnemonic: string | null }, characterNames?: unknown):
  { kind: "source-message"; command: SourceMessageSequenceCommand | { kind: "finish-wait" } } {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || !["Msg", "MsgFinishWait"].includes(String(instruction.mnemonic)))
    throw new Error("Expected ordinary source Msg/MsgFinishWait instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (instruction.mnemonic === "MsgFinishWait") {
    if (ints.some(value => value !== 0) || reals.some(value => value !== 0) || strings.some(value => value !== ""))
      throw new Error("Unsupported source MsgFinishWait operand shape");
    return { kind: "source-message", command: { kind: "finish-wait" } };
  }
  if (![0, 3].includes(ints[0]!) || ![0, 1, 2].includes(ints[1]!) || ints.slice(3).some(value => value !== 0) ||
      reals.slice(1).some(value => value !== 0) || strings.slice(1).some(value => value !== ""))
    throw new Error("Unsupported ordinary source sequence window or reserved operands");
  if (!context || typeof context.nextMnemonic !== "string" || !context.nextMnemonic)
    throw new Error("Source Msg sequence requires the following source mnemonic");
  const key = strings[0]!, text = record(messages.story_mes_zhc ?? {})[key],
    speaker = record(messages.story_cha_zhc ?? {})[key];
  if (!key || typeof text !== "string" || typeof speaker !== "string") throw new Error("Missing localized message or speaker");
  if (/[<>\\\r\n\u0000-\u001f\u007f]/.test(speaker)) throw new Error("Unsupported source sequence speaker control");
  const document = compileSourceMessageSequenceDocument(text);
  if (document.tokens.some(token => token.kind === "page" && token.tag === "AUTO_P") &&
      document.tokens.some(token => token.kind === "press"))
    throw new Error("Automatic source message with PRESS requires an external input callback host");
  const template = compileFieldMessageTemplate(sourceMessageSequenceTextRuns(document), speaker, characterNames);
  return { kind: "source-message", command: { kind: "sequence", key, speaker, document,
    layout: { window: ints[0] === 0 ? "frame" : "none", anchor: (["top", "middle", "bottom"] as const)[ints[1]!]! },
    seconds: reals[0]!, bypassSpeed: ints[2] !== 0,
    after: context.nextMnemonic === "Msg" ? "message" : context.nextMnemonic === "Select" ? "choice" : "close",
    ...(template ? { template } : {}) } };
}
