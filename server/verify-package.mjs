import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(root, "package-manifest.json")));
for (const row of manifest.files) {
  const file = path.resolve(root, row.file);
  if (!file.startsWith(root + path.sep)) throw Error("无效清单路径");
  if (
    (await stat(file)).size !== row.bytes ||
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex") !== row.sha256
  )
    throw Error(`文件损坏：${row.file}`);
}
console.log(`${manifest.files.length} 个文件完整，版本 ${manifest.sourceCommit}。`);
