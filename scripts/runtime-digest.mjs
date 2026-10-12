import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";

/** Identical build identity for the systems suite and a content-batch run. */
export async function runtimeDigest(root, compiled = "dist") {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = resolve(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(?:js|mjs|json)$/.test(entry.name)) files.push(full);
    }
  }
  for (const folder of [resolve(root, compiled, "src"), resolve(root, compiled, "tests"), "apps/game", "scripts"])
    await walk(resolve(root, folder));
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const hashes = await Promise.all(files.sort().map(async path => [relative(root, path), digest(await readFile(path))]));
  return digest(JSON.stringify(hashes));
}
