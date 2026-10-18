import { validateRecord } from "../server/save-schema.mjs";

const decode = (row) =>
  row && {
    id: row.id,
    revision: row.revision,
    updatedAt: row.updated,
    record: JSON.parse(row.record),
  };

export function openD1Store(binding) {
  // All reads in a request start at the primary. A device must never resolve
  // conflicts against a stale read replica after switching networks.
  const db = binding.withSession("first-primary");
  return {
    db,
    async serverId() {
      const row = await db.prepare("SELECT value FROM metadata WHERE key='serverId'").first();
      if (!row) throw Error("存档数据库尚未初始化");
      return row.value;
    },
    async list() {
      const { results } = await db
        .prepare("SELECT id,revision,updated AS updatedAt FROM saves ORDER BY id")
        .all();
      return results;
    },
    async get(id) {
      return decode(await db.prepare("SELECT * FROM saves WHERE id=?").bind(id).first());
    },
    async history(id) {
      const { results } = await db
        .prepare(
          "SELECT revision,updated AS updatedAt FROM history WHERE id=? ORDER BY revision DESC LIMIT 50",
        )
        .bind(id)
        .all();
      return results;
    },
    async version(id, revision) {
      return decode(
        await db
          .prepare("SELECT * FROM history WHERE id=? AND revision=?")
          .bind(id, revision)
          .first(),
      );
    },
    async put(id, { record, baseRevision, mutationId }) {
      record = validateRecord(record, id);
      if (
        !Number.isSafeInteger(baseRevision) ||
        baseRevision < 0 ||
        typeof mutationId !== "string" ||
        !/^[\w-]{16,100}$/.test(mutationId)
      )
        throw Object.assign(Error("无效的同步版本"), { status: 400 });
      const json = JSON.stringify(record),
        updated = Date.now();
      if (new TextEncoder().encode(json).length > 1900000)
        throw Object.assign(Error("存档超过 D1 单行容量，本机版本仍保留；请导出备份"), {
          status: 413,
        });
      const update =
        baseRevision === 0
          ? db
              .prepare("INSERT OR IGNORE INTO saves VALUES (?,1,?,?,?)")
              .bind(id, json, updated, mutationId)
          : db
              .prepare(
                "UPDATE saves SET revision=revision+1,record=?,updated=?,mutation=? WHERE id=? AND revision=?",
              )
              .bind(json, updated, mutationId, id, baseRevision);
      // The compare-and-write, history copy, pruning and returned value are one
      // atomic batch. A competing device cannot slip between these statements.
      const rows = await db.batch([
        update,
        db
          .prepare(
            "INSERT OR IGNORE INTO history SELECT id,revision,record,updated FROM saves WHERE id=? AND mutation=? AND record=?",
          )
          .bind(id, mutationId, json),
        db
          .prepare(
            "DELETE FROM history WHERE id=? AND revision <= (SELECT revision-50 FROM saves WHERE id=?)",
          )
          .bind(id, id),
        db.prepare("SELECT * FROM saves WHERE id=?").bind(id),
      ]);
      const current = rows[3].results[0];
      return {
        conflict: !(current?.mutation === mutationId && current.record === json),
        value: decode(current) || { id, revision: 0, record: null },
      };
    },
  };
}
