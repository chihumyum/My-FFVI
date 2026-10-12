import { z } from "zod";
import type { FieldManualMessage, FieldMessage } from "../field/types.js";
import { int32 } from "../core/script-integer.js";
import { record } from "./content.js";

/** Script messages and NPC Talk actions share the same localized message source. */
export function compileMessage(
  key: string,
  messages: Record<string, unknown>,
): FieldMessage {
  const text = record(messages.story_mes_zhc ?? {})[key],
    speaker = record(messages.story_cha_zhc ?? {})[key];
  if (!key || typeof text !== "string" || typeof speaker !== "string")
    throw new Error("Missing localized message or speaker");
  if (/<|\\(?!n)/.test(text) || /<|\\/.test(speaker))
    throw new Error("Message contains an unsupported inline control");
  return { key, text: text.replaceAll("\\n", "\n"), speaker };
}

/** Source Msg's ordinary controller: frame/no-frame, manual completion, and
 * explicit P pages. Source font wrapping is not inferred from Web text width. */
export function compileManualMessageInstruction(
  raw: unknown,
  messages: Record<string, unknown>,
  context?: { nextMnemonic: string | null },
): { kind: "message"; manual: FieldManualMessage } & FieldMessage {
  const instruction = record(raw), operands = record(instruction.operands);
  if (instruction.mnemonic !== "Msg" || instruction.type !== 1)
    throw new Error("Expected ordinary source Msg instruction");
  const ints = z.array(z.unknown()).length(8).parse(operands.iValues).map(int32),
    reals = z.array(z.number().finite()).length(8).parse(operands.rValues),
    strings = z.array(z.string()).length(8).parse(operands.sValues);
  if (![0, 3].includes(ints[0]!) || ![0, 1, 2].includes(ints[1]!) ||
      ints.slice(2).some(value => value !== 0) || reals.some(value => value !== 0) ||
      strings.slice(1).some(value => value !== ""))
    throw new Error("Unsupported ordinary source Msg window or timing operands");
  if (!context || typeof context.nextMnemonic !== "string" || !context.nextMnemonic)
    throw new Error("Ordinary source Msg requires the following source mnemonic");
  const key = strings[0]!, text = record(messages.story_mes_zhc ?? {})[key],
    speaker = record(messages.story_cha_zhc ?? {})[key];
  if (!key || typeof text !== "string" || typeof speaker !== "string")
    throw new Error("Missing localized message or speaker");
  // NewPageTagRegex is <(?i)P(?-i)>. Other controls remain explicit blockers;
  // stripping them would change input, timing or runtime substitution.
  const pages = text.split(/<P>/i).map(page => page.replaceAll("\\n", "\n"));
  if (pages.some(page => !page || /<|\\|[\u0000-\u0009\u000b-\u001f\u007f]/.test(page)) ||
      /<|\\|[\u0000-\u001f\u007f]/.test(speaker))
    throw new Error("Ordinary source Msg contains an unsupported inline control or empty page");
  return { kind: "message", key, speaker, text: pages[0]!, manual: {
    pages, window: ints[0] === 0 ? "frame" : "none",
    anchor: (["top", "middle", "bottom"] as const)[ints[1]!]!,
    after: context.nextMnemonic === "Msg" ? "message" : context.nextMnemonic === "Select" ? "choice" : "close",
  } };
}
