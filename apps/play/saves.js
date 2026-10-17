// Browser-owned save slots; the original quick/autosave keys remain compatible.
const mode = (boost) => (boost ? "story-test" : "normal");
export class SaveLibrary {
  constructor() {
    this.database = null;
  }
  async open() {
    if (!this.database)
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open("ffvi-pr-saves", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("slots", { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    return this.database;
  }
  async operation(write, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("slots", write ? "readwrite" : "readonly");
      const request = action(transaction.objectStore("slots"));
      let value;
      request.onsuccess = () => {
        value = request.result;
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || Error("存档写入已取消"));
    });
  }
  async list(boost) {
    const records = await this.operation(false, (store) => store.getAll());
    return records.filter((row) => row.mode === mode(boost)).sort((a, b) => a.slot - b.slot);
  }
  async save(game, slot, location = "当前地点") {
    if (game.busy || game.over) throw Error("剧情或战斗进行中，请稍后保存。");
    const snapshot = structuredClone(game.snapshot());
    const record = {
      id: `${mode(game.testBoost)}:${slot}`,
      slot,
      mode: mode(game.testBoost),
      savedAt: Date.now(),
      map: location,
      party: game.party.map((u) => ({ name: u.name, id: u.id, level: u.level })),
      time: game.time,
      snapshot,
    };
    await this.operation(true, (store) => store.put(record));
    // Existing retry/continue and autosave keep their established single-slot API.
    localStorage.setItem(game.testBoost ? "ffvi-play-test" : "ffvi-play", JSON.stringify(snapshot));
    return record;
  }
  async load(boost, slot) {
    return (
      (await this.operation(false, (store) => store.get(`${mode(boost)}:${slot}`)))?.snapshot ||
      null
    );
  }
}
export function renderSaveSlots(records, { write, boost, quick }, createElement, choose) {
  const rows = [];
  const text = (tag, value) => {
    const n = createElement(tag);
    n.textContent = value;
    return n;
  };
  const button = (label, run) => {
    const n = text("button", label);
    n.onclick = run;
    return n;
  };
  if (quick && !write) rows.push(button("自动存档 / 最近继续", () => choose("quick")));
  for (let slot = 1; slot <= 12; slot++) {
    const record = records.find((row) => row.slot === slot),
      card = createElement("fieldset");
    card.append(
      text("legend", `${String(slot).padStart(2, "0")}  ${record ? record.map : "空存档"}`),
    );
    if (record)
      card.append(
        text(
          "p",
          `${record.party.map((u) => `${u.name} Lv${u.level}`).join(" / ")}\n${new Date(record.savedAt).toLocaleString("zh-CN")}   ${Math.floor(record.time / 3600)}:${String(Math.floor(record.time / 60) % 60).padStart(2, "0")}`,
        ),
      );
    if (write || record)
      card.append(
        button(
          write ? (record ? `覆盖存档 ${slot}` : `写入存档 ${slot}`) : `读取存档 ${slot}`,
          () => choose(slot),
        ),
      );
    rows.push(card);
  }
  return rows;
}
