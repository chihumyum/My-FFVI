import type { FieldMessage } from "../field/types.js";
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
