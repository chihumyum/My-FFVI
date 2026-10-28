import { tr, dateLocale } from "../../src/play/i18n.js";
// Browser-owned save slots; the original quick/autosave keys remain compatible.
import { quickSaveKey, saveDatabaseName } from "./identity.js";
const mode = (boost) => (boost ? "story-test" : "normal");
const slotId = /^(normal|story-test):(auto|[1-9]|1[0-2])$/;
const quickKey = quickSaveKey;
const payload = (record) =>
  Object.fromEntries(
    ["id", "mode", "slot", "savedAt", "map", "party", "time", "snapshot"].map((key) => [
      key,
      record[key],
    ]),
  );
export class SaveLibrary {
  constructor({ cloud } = {}) {
    this.database = null;
    this.cloud = cloud;
    this.account = cloud?.serverId || localStorage.getItem("ffvi-cloud-account");
    this.status = {
      state: cloud?.enabled ? "connecting" : "local",
      get message() {
        return cloud?.enabled
          ? tr("saves.connecting_to_cloud_saves")
          : tr("saves.local_saves_only_export_a_backup");
      },
    };
    this.listeners = new Set();
    this.syncing = null;
    this.session = null;
    this.sessionRevisions = new Map();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }
  notify(state, message) {
    this.status = {
      state,
      get message() {
        return typeof message === "object" ? tr(message.key, message.values) : message;
      },
    };
    for (const fn of this.listeners) fn(this.status);
  }
  async open() {
    if (!this.database)
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(saveDatabaseName(), 1);
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
      transaction.onabort = () =>
        reject(transaction.error || Error(tr("saves.save_write_cancelled")));
    });
  }
  async list(boost) {
    const records = await this.operation(false, (store) => store.getAll());
    return records
      .filter((row) => slotId.test(row.id) && row.mode === mode(boost))
      .sort((a, b) => a.slot - b.slot);
  }
  async all() {
    return this.operation(false, (store) => store.getAll());
  }
  async mutate(id, update) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("slots", "readwrite"),
        store = tx.objectStore("slots"),
        request = store.get(id);
      let value;
      request.onsuccess = () => {
        value = update(request.result, store);
        if (value) store.put(value);
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error(tr("saves.save_write_cancelled")));
    });
  }
  archive(record, store) {
    if (record)
      store.put({
        ...record,
        sourceId: record.id,
        id: `backup:${crypto.randomUUID()}`,
        archivedAt: Date.now(),
      });
  }
  async beginSession(boost) {
    this.session = crypto.randomUUID();
    this.sessionMode = mode(boost);
    this.sessionRevisions = new Map(
      (await this.all())
        .filter((row) => slotId.test(row.id) && row.sync?.account === this.account)
        .map((row) => [row.id, row.sync.revision]),
    );
    if (this.loadedBase?.account === this.account)
      this.sessionRevisions.set(this.loadedBase.id, this.loadedBase.revision);
    this.loadedBase = null;
  }
  async write(record, fromGame = false) {
    const value = await this.mutate(record.id, (before, store) => {
      if (before?.sync?.conflict) this.archive(before, store);
      return {
        ...payload(record),
        sync: {
          account: this.account,
          revision:
            fromGame && this.sessionMode === record.mode
              ? this.sessionRevisions.get(record.id) || 0
              : before?.sync?.account === this.account
                ? before.sync.revision
                : 0,
          session: fromGame ? this.session : null,
          dirty: true,
          mutation: crypto.randomUUID(),
          conflict: before?.sync?.conflict,
        },
      };
    });
    this.schedule();
    return value;
  }
  async save(game, slot, location = tr("app.current_location")) {
    if (game.busy || game.over)
      throw Error(tr("saves.story_or_battle_in_progress_please_save_later"));
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
    await this.write(record, true);
    if (slot !== "auto")
      await this.write({ ...record, id: `${record.mode}:auto`, slot: "auto" }, true);
    // Existing retry/continue and autosave keep their established single-slot API.
    localStorage.setItem(quickKey(game.testBoost), JSON.stringify(snapshot));
    return record;
  }
  async autosave(game, location) {
    return this.save(game, "auto", location);
  }
  async quick(boost) {
    return (
      (await this.load(boost, "auto")) ||
      JSON.parse(localStorage.getItem(quickKey(boost)) || "null")
    );
  }
  async load(boost, slot) {
    const record = await this.operation(false, (store) => store.get(`${mode(boost)}:${slot}`));
    if (record?.sync)
      this.loadedBase = {
        id: record.id,
        account: record.sync.account,
        revision: record.sync.revision,
      };
    return record?.snapshot || null;
  }
  schedule() {
    if (!this.cloud?.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 700);
  }
  async initialize() {
    // One-time import of pre-cloud quick saves; never replace an existing slot.
    for (const boost of [false, true]) {
      const snapshot = JSON.parse(localStorage.getItem(quickKey(boost)) || "null");
      if (snapshot && !(await this.load(boost, "auto")))
        await this.write({
          id: `${mode(boost)}:auto`,
          mode: mode(boost),
          slot: "auto",
          savedAt: Date.now(),
          map: tr("saves.map_value", { v0: snapshot.mapId }),
          party: [],
          time: snapshot.time || 0,
          snapshot,
        });
    }
    return this.sync();
  }
  async sync() {
    if (!this.cloud?.enabled) return;
    if (this.syncing) return this.syncing;
    this.syncing = this.synchronize()
      .catch((error) => {
        this.notify(error.status === 401 ? "login" : "offline", {
          key: "saves.value_local_progress_retained_retry_when_online",
          values: { v0: error.message },
        });
      })
      .finally(() => {
        this.syncing = null;
      });
    return this.syncing;
  }
  async synchronize() {
    this.notify("syncing", { key: "saves.syncing_saves" });
    await this.cloud.connect();
    this.account = this.cloud.serverId;
    localStorage.setItem("ffvi-cloud-account", this.account);
    const remote = await this.cloud.list(),
      rows = await this.all();
    const ids = new Set([
      ...remote.map((row) => row.id),
      ...rows.filter((row) => slotId.test(row.id)).map((row) => row.id),
    ]);
    for (const id of ids) {
      let local = await this.operation(false, (store) => store.get(id));
      const summary = remote.find((row) => row.id === id);
      if (local?.sync?.conflict) continue;
      if (
        local &&
        !summary &&
        ((local.sync?.account && local.sync.account !== this.account) || local.sync?.revision > 0)
      ) {
        await this.mutate(id, (current) => ({
          ...current,
          sync: { ...current.sync, conflict: { id, revision: 0, record: null } },
        }));
        continue;
      }
      if (
        summary &&
        (!local || local.sync?.account !== this.account || local.sync.revision !== summary.revision)
      ) {
        const cloud = await this.cloud.get(id);
        await this.mutate(id, (current) => {
          if (current?.sync?.conflict) return;
          // Timestamp ordering is deliberately irrelevant. An old offline device
          // cannot overwrite another device's newer progress.
          if (
            current &&
            (current.sync?.dirty !== false ||
              current.sync?.account !== this.account ||
              current.sync?.revision > cloud.revision)
          ) {
            if (JSON.stringify(payload(current)) !== JSON.stringify(cloud.record))
              return { ...current, sync: { ...current.sync, conflict: cloud } };
          }
          const clean = {
            ...cloud.record,
            sync: { account: this.account, revision: cloud.revision, dirty: false },
          };
          if (clean.slot === "auto")
            localStorage.setItem(
              quickKey(clean.mode === "story-test"),
              JSON.stringify(clean.snapshot),
            );
          return clean;
        });
      }
      local = await this.operation(false, (store) => store.get(id));
      if (!local || local.sync?.conflict || local.sync?.dirty === false) continue;
      const mutation = local.sync?.mutation || crypto.randomUUID();
      const result = await this.cloud.put(
        payload(local),
        local.sync?.account === this.account ? local.sync.revision || 0 : 0,
        mutation,
      );
      if (!result.conflict && local.sync?.session === this.session)
        this.sessionRevisions.set(id, result.value.revision);
      await this.mutate(id, (current) => {
        if (!current) return;
        if (result.conflict)
          return { ...current, sync: { ...current.sync, conflict: result.value } };
        // A new local save may arrive while this upload is in flight. Advance its
        // base revision but leave that newer snapshot queued for the next pass.
        return {
          ...current,
          sync: {
            ...current.sync,
            account: this.account,
            revision: result.value.revision,
            dirty: current.sync?.mutation !== local.sync?.mutation,
          },
        };
      });
    }
    const after = (await this.all()).filter((row) => slotId.test(row.id));
    const conflicts = after.filter((row) => row.sync?.conflict).length,
      pending = after.filter((row) => row.sync?.dirty && !row.sync.conflict).length;
    this.notify(
      conflicts ? "conflict" : pending ? "pending" : "synced",
      conflicts
        ? {
            key: "saves.value_save_conflicts_both_versions_retained_open_cloud_",
            values: { v0: conflicts },
          }
        : pending
          ? { key: "saves.value_local_saves_waiting_to_upload", values: { v0: pending } }
          : {
              key: "saves.synced_value",
              values: { v0: new Date().toLocaleTimeString(dateLocale()) },
            },
    );
    if (pending) this.schedule();
  }
  async resolve(id, choice) {
    const local = await this.operation(false, (store) => store.get(id));
    if (!local?.sync?.conflict) return;
    if (choice === "cloud") {
      const cloud = await this.cloud.get(id);
      await this.mutate(id, (current, store) => {
        // Do not discard a save written while the request was in flight.
        this.archive(current, store);
        return {
          ...cloud.record,
          sync: { account: this.account, revision: cloud.revision, dirty: false },
        };
      });
      if (cloud.record.slot === "auto")
        localStorage.setItem(
          quickKey(cloud.record.mode === "story-test"),
          JSON.stringify(cloud.record.snapshot),
        );
    } else if (choice === "local") {
      const result = await this.cloud.put(
        payload(local),
        local.sync.conflict.revision,
        crypto.randomUUID(),
      );
      if (!result.conflict && local.sync?.session === this.session)
        this.sessionRevisions.set(id, result.value.revision);
      await this.mutate(id, (current, store) => {
        if (result.conflict)
          return { ...current, sync: { ...current.sync, conflict: result.value } };
        this.archive(
          { ...local.sync.conflict.record, label: tr("saves.cloud_version_before_conflict") },
          store,
        );
        return {
          ...current,
          sync: {
            account: this.account,
            revision: result.value.revision,
            session: current.sync?.session,
            dirty: current.sync?.mutation !== local.sync?.mutation,
          },
        };
      });
    }
    await this.sync();
  }
  async export() {
    return {
      format: "ffvi-reweb-saves",
      version: 1,
      exportedAt: new Date().toISOString(),
      records: await this.all(),
    };
  }
  async import(backup) {
    if (
      backup?.format !== "ffvi-reweb-saves" ||
      backup.version !== 1 ||
      !Array.isArray(backup.records) ||
      backup.records.length > 10000
    )
      throw Error(tr("saves.not_a_valid_ffvi_save_backup"));
    const records = backup.records.filter((row) => slotId.test(row.id));
    for (const row of records) {
      if (
        !Number.isInteger(row.snapshot?.mapId) ||
        !Array.isArray(row.party) ||
        !Number.isFinite(row.savedAt) ||
        !Number.isFinite(row.time) ||
        row.id !== `${row.mode}:${row.slot}` ||
        !!row.snapshot.testBoost !== (row.mode === "story-test")
      )
        throw Error(tr("saves.backup_contains_invalid_saves_nothing_imported"));
    }
    for (const row of records) {
      await this.mutate(row.id, (before, store) => {
        this.archive(before, store);
        return {
          ...payload(row),
          sync: {
            account: this.account,
            revision: before?.sync?.account === this.account ? before.sync.revision : 0,
            dirty: true,
            mutation: crypto.randomUUID(),
            conflict: before?.sync?.conflict,
          },
        };
      });
      if (row.slot === "auto")
        localStorage.setItem(quickKey(row.mode === "story-test"), JSON.stringify(row.snapshot));
    }
    this.schedule();
    return records.length;
  }
  async restore(id, revision) {
    const historical = await this.cloud.get(id, revision);
    await this.mutate(id, (before, store) => {
      this.archive(before, store);
      return before;
    });
    await this.write(historical.record);
    await this.sync();
  }
}
export function renderSaveSlots(
  records,
  { write, boost, quick, display = (record) => record },
  createElement,
  choose,
) {
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
  if (quick && !write)
    rows.push(button(tr("saves.autosave_most_recent_progress"), () => choose("quick")));
  for (let slot = 1; slot <= 12; slot++) {
    const record = display(records.find((row) => row.slot === slot)),
      card = createElement("fieldset");
    card.append(
      text(
        "legend",
        `${String(slot).padStart(2, "0")}  ${record ? record.map : tr("saves.empty_slot")}`,
      ),
    );
    if (record)
      card.append(
        text(
          "p",
          `${record.party.map((u) => `${u.name} Lv${u.level}`).join(" / ")}\n${new Date(record.savedAt).toLocaleString(dateLocale())}   ${Math.floor(record.time / 3600)}:${String(Math.floor(record.time / 60) % 60).padStart(2, "0")}`,
        ),
      );
    if (write || record)
      card.append(
        button(
          write
            ? record
              ? tr("saves.overwrite_slot_value", { v0: slot })
              : tr("saves.write_slot_value", { v0: slot })
            : tr("saves.load_slot_value", { v0: slot }),
          () => choose(slot),
        ),
      );
    rows.push(card);
  }
  return rows;
}
