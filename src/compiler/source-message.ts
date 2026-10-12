import { z } from "zod";
import { int32 } from "../core/script-integer.js";
import { validateSourceMessageDocument, type SourceMessageDocument, type SourceMessageOp } from "../core/source-message.js";
import { record } from "./content.js";

/** WaitContent.Parse has an explicit switch, not a general hexadecimal parser.
 * 00 and unknown suffixes take its one-second fallback. Keep unknown tags gated. */
const waits: Readonly<Record<string, number>> = Object.freeze({
  "": 1, "00": 1, "01": .25, "02": .5, "03": .75, "04": 1,
  "05": 1.25, "06": 1.5, "07": 1.75, "08": 2, "09": 2.25,
  "0a": 2.5, "0b": 2.75, "0c": 3, "0d": 3.25, "0e": 3.5, "0f": 3.75,
  "10": 4, "11": 4.25, "12": 4.5, "13": 4.75, "14": 5, "15": 5.25,
  "16": 5.5, "18": 6, "19": 6.25, "1a": 6.5, "1c": 7, "20": 8,
  "24": 9, "28": 10, "2a": 10.5, "3c": 15, "50": 20, "78": 30, "ff": 63.75,
});

/** Common one-page automatic subtitle capability. Controls are decoded before
 * text is rendered. No key/script/map identity controls admission. */
export function compileSourceMessageDocument(raw: string): SourceMessageDocument {
  if (typeof raw !== "string" || !raw || /\\(?!n)|\r/.test(raw))
    throw new Error("Unsupported source message escape or empty text");
  const auto = /<AUTO_P>$/i;
  if (!auto.test(raw)) throw new Error("Source message requires automatic page/input host");
  let text = raw.replace(auto, "").replaceAll("\\n", "\n"), tailWaitSeconds: number | null = null;
  const wait = text.match(/<WAIT([0-9a-f]*)>$/i);
  if (wait) {
    // Regex matching is case-insensitive, but the captured suffix is compared
    // by an ordinary case-sensitive C# switch. Do not turn WAITFF into WAITff.
    const suffix = wait[1]!;
    if (!Object.hasOwn(waits, suffix)) throw new Error("Unsupported source message wait suffix");
    tailWaitSeconds = waits[suffix]!; text = text.slice(0, wait.index);
  }
  const centered = /<CT>/i.test(text);
  text = text.replaceAll(/<CT>/gi, "");
  const result: SourceMessageDocument = { kind: "source-message-document-v1", text,
    alignment: centered ? "center" : "left", autoPage: true, tailWaitSeconds };
  validateSourceMessageDocument(result);
  return result;
}

/** Strict opcode routing. The caller may keep its older plain-dialogue route;
 * this decoder never turns unsupported window/timing parameters into a default. */
export function compileSourceMessageInstruction(raw: unknown, messages: Record<string, unknown>): SourceMessageOp {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.type !== 1 || !["Msg", "MsgClose"].includes(String(instruction.mnemonic)))
    throw new Error("Expected source Msg or MsgClose instruction");
  const ints = z.array(z.unknown()).min(2).max(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).min(1).max(8).parse(operands.rValues),
    strings = z.array(z.string()).min(1).max(8).parse(operands.sValues);
  if (instruction.mnemonic === "MsgClose") {
    if (ints.some(v => v !== 0) || reals.some(v => v !== 0) || strings.some(v => v !== ""))
      throw new Error("Unsupported source MsgClose operand shape");
    return { kind: "source-message", command: { kind: "close" } };
  }
  if (ints[0] !== 3 || ![0, 1, 2].includes(ints[1]!) || ints.slice(2).some(v => v !== 0) ||
      reals[0]! >= 0 || reals.slice(1).some(v => v !== 0) || strings.slice(1).some(v => v !== ""))
    throw new Error("Unsupported source Msg window or timing operands");
  const key = strings[0]!, text = record(messages.story_mes_zhc ?? {})[key],
    speaker = record(messages.story_cha_zhc ?? {})[key];
  if (!key || typeof text !== "string" || typeof speaker !== "string")
    throw new Error("Missing source localized message or speaker");
  if (speaker !== "") throw new Error("Source message speaker media and name substitution are unresolved");
  return { kind: "source-message", command: { kind: "play", key, speaker,
    layout: { window: "none", anchor: (["top", "middle", "bottom"] as const)[ints[1]!]! },
    document: compileSourceMessageDocument(text), seconds: reals[0]! } };
}
