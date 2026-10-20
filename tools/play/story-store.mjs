import { readFile, writeFile, mkdir, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateStoryProject, validateSourceDocument } from "../../src/play/story-authoring.js";

export class StoryStore {
  constructor(directory) {
    this.directory = directory;
    this.queue = Promise.resolve();
  }
  file(id) {
    if (!/^[a-z][a-z0-9_-]{0,79}$/.test(id || "")) throw Error("无效文档 ID");
    return path.join(this.directory, `${id}.json`);
  }
  async read(id) {
    try {
      return JSON.parse(await readFile(this.file(id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter((f) => /^[a-z][a-z0-9_-]*\.json$/.test(f));
    return Promise.all(
      files.map(async (f) => {
        const row = await this.read(f.slice(0, -5));
        return {
          id: row.document.id,
          title: row.document.title,
          mode: row.document.mode || "project",
          revision: row.revision,
        };
      }),
    );
  }
  async history(id) {
    this.file(id);
    const dir = path.join(this.directory, "history", id);
    const files = await readdir(dir).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    return files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
  }
  async version(id, file) {
    this.file(id);
    if (!/^[a-z0-9-]+\.json$/.test(file)) throw Error("无效历史版本");
    return JSON.parse(await readFile(path.join(this.directory, "history", id, file), "utf8"));
  }
  save(id, document, revision) {
    const operation = this.queue.then(async () => {
      const file = this.file(id);
      if (id !== document.id) throw Error("文档 ID 不匹配");
      const errors =
        document.mode === "source"
          ? validateSourceDocument(document)
          : validateStoryProject(document);
      if (errors.length) throw Error(errors.join("\n"));
      const current = await this.read(id);
      const directory = path.join(this.directory, "history", id);
      await mkdir(directory, { recursive: true });
      if ((current?.revision || 0) !== revision) {
        const conflict = `conflict-${randomUUID()}.json`;
        await writeFile(
          path.join(directory, conflict),
          JSON.stringify(
            { document, baseRevision: revision, conflictWith: current?.revision || 0 },
            null,
            2,
          ),
        );
        return { conflict: true, current, preserved: conflict };
      }
      const value = { revision: revision + 1, document };
      // Immutable versions include both the first save and every later save.
      await writeFile(
        path.join(directory, `${String(value.revision).padStart(8, "0")}.json`),
        JSON.stringify(value, null, 2),
      );
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(value, null, 2));
      await rename(temporary, file);
      return value;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
