export const slotPattern = /^(normal|story-test):(auto|[1-9]|1[0-2])$/;
export function validateRecord(record, id = record?.id) {
  if (!record || !slotPattern.test(id) || record.id !== id) throw Error("无效的存档槽");
  const [mode, slot] = id.split(":");
  if (
    record.mode !== mode ||
    String(record.slot) !== slot ||
    !Number.isFinite(record.savedAt) ||
    !Number.isFinite(record.time) ||
    typeof record.map !== "string" ||
    record.map.length > 300 ||
    !Array.isArray(record.party) ||
    record.party.length > 20 ||
    !record.snapshot ||
    typeof record.snapshot !== "object" ||
    !Number.isInteger(record.snapshot.mapId) ||
    !!record.snapshot.testBoost !== (mode === "story-test")
  )
    throw Error("存档格式不正确，普通与强化存档不能混用");
  // Transport metadata is never stored inside a game snapshot.
  return Object.fromEntries(
    ["id", "mode", "slot", "savedAt", "time", "map", "party", "snapshot"].map((key) => [
      key,
      record[key],
    ]),
  );
}
