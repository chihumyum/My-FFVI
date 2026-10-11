import { tableInteger } from "./table.js";
import type { ConditionReader } from "./conditions.js";

/** GetContentFlagList 0x4daa50 / predicate 0x4efc10: group membership only.
 * Preserve source order, repeated flags and unknown IDs for capability analysis. */
export function compileContentFlags(reader: ConditionReader, groupId: number) {
  const sources = reader.group("content_flag_group.csv", "group_id", groupId);
  const ids = sources.map((row) => tableInteger(row.values.content_flag_id));
  if (ids.some((id) => id < 1 || id > 0x7fffffff))
    throw new Error("Invalid content flag identity");
  return { ids, sources };
}
