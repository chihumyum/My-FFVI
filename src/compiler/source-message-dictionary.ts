import { hash, record } from "./content.js";
import { BATTLE_MESSAGE_DICTIONARIES, parseBattleEventMessageBinding, type BattleEventMessageBinding } from "../core/battle-event-message.js";
export type SourceMessageDictionaryInput = { messages: Record<string, unknown>; characterNames?: unknown;
  binding?: BattleEventMessageBinding };
/** One copied MessageManager body dictionary. Speakers are a separate lookup.
 * Legacy callers retain their explicit story-row requirement. */
export function createSourceMessageDictionary(input: SourceMessageDictionaryInput) {
  const binding = input.binding ? parseBattleEventMessageBinding(input.binding) : null,
    messages = structuredClone(input.messages), characterNames = structuredClone(input.characterNames);
  const bodies = new Map<string, { text: string; dictionary: "story_mes_zhc" | "system_zhc" | "etc_text_zhc" }>();
  if (binding?.kind === "battle-event-message-binding-v2") {
    for (const row of binding.sources) {
      const table = BATTLE_MESSAGE_DICTIONARIES[row.role], values = row.role === "character-names" ? characterNames : record(messages[table]);
      if (hash(values) !== row.contentHash || (Array.isArray(values) ? values.length : Object.keys(record(values)).length) !== row.rowCount)
        throw new Error("Battle message dictionary content/source mismatch: " + table);
      if (row.role !== "character-names" && Object.entries(record(values)).some(([key, value]) => !key || typeof value !== "string"))
        throw new Error("Invalid battle message dictionary: " + table);
    }
    for (const dictionary of ["story_mes_zhc", "system_zhc", "etc_text_zhc"] as const)
      for (const [key, text] of Object.entries(record(messages[dictionary]))) {
        if (bodies.has(key)) throw new Error("Duplicate battle message body key across dictionaries: " + key);
        bodies.set(key, { text: text as string, dictionary });
      }
  }
  const body = (key: string) => {
    if (binding?.kind !== "battle-event-message-binding-v2") throw new Error("Catalog names require the complete source message dictionary binding");
    const found = bodies.get(key);
    if (!key || !found) throw new Error("Missing source battle message body: " + key);
    return { ...found };
  };
  return { binding, characterNames, body, message(key: string) {
    if (binding?.kind === "battle-event-message-binding-v2") {
      const { text } = body(key), speakers = record(messages.story_cha_zhc);
      return { text, speaker: Object.hasOwn(speakers, key) ? speakers[key] as string : "" };
    }
    const text = record(messages.story_mes_zhc ?? {})[key], speaker = record(messages.story_cha_zhc ?? {})[key];
    if (!key || typeof text !== "string" || typeof speaker !== "string")
      throw new Error("Missing source battle message body/speaker (v1 requires explicit story rows)");
    return { text, speaker };
  } };
}
