import { DatabaseSync, backup } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, chmod, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { slotPattern, validateRecord } from "./save-schema.mjs";
export { slotPattern, validateRecord } from "./save-schema.mjs";

export async function openStore(directory, { password } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configFile = path.join(directory, "owner.json");
  let config;
  try {
    config = JSON.parse(await readFile(configFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const initial = password || randomBytes(24).toString("base64url");
    if (initial.length < 12) throw Error("密码至少需要 12 个字符");
    const salt = randomBytes(24).toString("hex");
    config = {
      serverId: randomBytes(24).toString("hex"),
      salt,
      hash: scryptSync(initial, salt, 64).toString("hex"),
    };
    await writeFile(configFile, JSON.stringify(config) + "\n", { mode: 0o600, flag: "wx" });
    if (!password)
      await writeFile(
        path.join(directory, "first-login.txt"),
        `FFVI 私人站点初始密码（登录后请妥善保存此文件）\n${initial}\n`,
        { mode: 0o600, flag: "wx" },
      );
  }
  const file = path.join(directory, "saves.sqlite"),
    db = new DatabaseSync(file, { timeout: 5000 });
  await chmod(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS saves (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, record TEXT NOT NULL, updated INTEGER NOT NULL, mutation TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (id TEXT NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  `);
  const decode = (row) =>
    row && {
      id: row.id,
      revision: row.revision,
      updatedAt: row.updated,
      record: JSON.parse(row.record),
    };
  return {
    db,
    config,
    async verify(password) {
      if (typeof password !== "string" || password.length > 1024) return false;
      const current = JSON.parse(await readFile(configFile, "utf8"));
      return timingSafeEqual(
        scryptSync(password, current.salt, 64),
        Buffer.from(current.hash, "hex"),
      );
    },
    async password(value) {
      if (value.length < 12 || value.length > 1024) throw Error("密码需要 12–1024 个字符");
      config.salt = randomBytes(24).toString("hex");
      config.hash = scryptSync(value, config.salt, 64).toString("hex");
      const temporary = configFile + ".new";
      await writeFile(temporary, JSON.stringify(config) + "\n", { mode: 0o600 });
      await rename(temporary, configFile);
      await unlink(path.join(directory, "first-login.txt")).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      db.exec("DELETE FROM sessions");
    },
    list() {
      return db
        .prepare("SELECT id,revision,updated FROM saves ORDER BY id")
        .all()
        .map((row) => ({ id: row.id, revision: row.revision, updatedAt: row.updated }));
    },
    get(id) {
      return decode(db.prepare("SELECT * FROM saves WHERE id=?").get(id));
    },
    history(id) {
      return db
        .prepare("SELECT revision,updated FROM history WHERE id=? ORDER BY revision DESC LIMIT 50")
        .all(id)
        .map((row) => ({ revision: row.revision, updatedAt: row.updated }));
    },
    version(id, revision) {
      return decode(
        db.prepare("SELECT * FROM history WHERE id=? AND revision=?").get(id, revision),
      );
    },
    put(id, { record, baseRevision, mutationId }) {
      record = validateRecord(record, id);
      if (
        !Number.isSafeInteger(baseRevision) ||
        baseRevision < 0 ||
        typeof mutationId !== "string" ||
        !/^[\w-]{16,100}$/.test(mutationId)
      )
        throw Error("无效的同步版本");
      db.exec("BEGIN IMMEDIATE");
      try {
        const before = db.prepare("SELECT * FROM saves WHERE id=?").get(id);
        // A lost HTTP response can be retried without creating another revision.
        if (before?.mutation === mutationId && before.record === JSON.stringify(record)) {
          db.exec("COMMIT");
          return { conflict: false, value: decode(before) };
        }
        if ((before?.revision || 0) !== baseRevision) {
          db.exec("COMMIT");
          return { conflict: true, value: decode(before) || { id, revision: 0, record: null } };
        }
        const revision = baseRevision + 1,
          updated = Date.now(),
          json = JSON.stringify(record);
        db.prepare(
          "INSERT INTO saves VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record=excluded.record,updated=excluded.updated,mutation=excluded.mutation",
        ).run(id, revision, json, updated, mutationId);
        db.prepare("INSERT INTO history VALUES (?,?,?,?)").run(id, revision, json, updated);
        db.prepare("DELETE FROM history WHERE id=? AND revision<=?").run(id, revision - 50);
        db.exec("COMMIT");
        return { conflict: false, value: { id, revision, updatedAt: updated, record } };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async backup(destination) {
      await backup(db, destination);
      await chmod(destination, 0o600);
      await writeFile(destination + ".owner.json", await readFile(configFile), { mode: 0o600 });
    },
    close() {
      db.close();
    },
  };
}
