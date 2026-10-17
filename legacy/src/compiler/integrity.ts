import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Hash } from "../contracts.js";

const Snapshot = z.object({ formatVersion: z.literal(1), files: z.array(z.object({ file: z.string(), sha256: Hash }).strict()).min(1) }).strict();

/** Consume only the bytes verified here, preventing edits between verification and parsing. */
export async function readSnapshot(directory: string): Promise<Map<string, Buffer>> {
  const root = resolve(directory);
  const manifest = Snapshot.parse(JSON.parse(await readFile(resolve(root, "snapshot.json"), "utf8")));
  const files = new Map<string, Buffer>();
  for (const item of manifest.files) {
    if (files.has(item.file)) throw new Error(`Duplicate snapshot file: ${item.file}`);
    const path = resolve(root, item.file);
    if (!path.startsWith(root + sep) || item.file.includes("\\") || item.file.split("/").includes(".."))
      throw new Error(`Unsafe snapshot path: ${item.file}`);
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error(`Snapshot changed: ${item.file}`);
    files.set(item.file, bytes);
  }
  return files;
}

export function snapshotFile(files: Map<string, Buffer>, name: string): Buffer {
  const bytes = files.get(name);
  if (!bytes) throw new Error(`Unlisted snapshot dependency: ${name}`);
  return bytes;
}
