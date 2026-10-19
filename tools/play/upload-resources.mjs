import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "../..");
const directory = path.join(root, "dist/cloudflare/resources");
const local = process.argv.includes("--local");
const localState = process.env.PLAY_R2_LOCAL_STATE || ".wrangler/public-local";
const bucket = process.env.FFVI_RESOURCE_BUCKET || "ffvi-resources";
const output = path.join(root, "build/play/deployment/public");
await mkdir(output, { recursive: true });
const types = {
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
const entries = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await walk(file);
    else {
      const bytes = await readFile(file),
        ext = path.extname(file);
      if (!types[ext]) throw Error(`不支持的资源格式：${ext}`);
      entries.push({
        key: path.relative(directory, file).split(path.sep).join("/"),
        file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        md5: createHash("md5").update(bytes).digest("hex"),
        bytes: bytes.length,
        type: types[ext],
      });
    }
  }
}
await walk(directory);
const cacheFile = path.join(
  root,
  "private-data",
  `r2-${bucket}-${local ? localState.replaceAll(/[\W]/g, "-") : "remote"}.json`,
);
await mkdir(path.dirname(cacheFile), { recursive: true, mode: 0o700 });
let uploaded;
try {
  uploaded = JSON.parse(await readFile(cacheFile));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  uploaded = {};
}
if (!local && !process.argv.includes("--all")) {
  // Confirm remote contents, including partial uploads from an interrupted run.
  // Wrangler credentials are captured privately and never written or logged.
  const auth = JSON.parse(
    execFileSync(path.join(root, "node_modules/.bin/wrangler"), ["auth", "token", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const config = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
  const account = config.match(/"account_id"\s*:\s*"([a-f0-9]+)"/)?.[1];
  if (!account || !auth.token) throw Error("无法取得资源上传身份");
  let cursor;
  uploaded = {};
  do {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects`,
    );
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw Error(`无法校验远端资源清单：HTTP ${response.status}`);
    const value = await response.json();
    if (!value.success) throw Error("远端资源清单读取失败");
    const byKey = new Map(value.result.map((row) => [row.key, row]));
    for (const entry of entries) {
      const found = byKey.get(entry.key);
      if (
        found?.size === entry.bytes &&
        found.etag === entry.md5 &&
        found.http_metadata?.contentType === entry.type
      )
        uploaded[entry.key] = entry.sha256;
    }
    cursor = value.result_info?.is_truncated ? value.result_info.cursor : null;
  } while (cursor);
  console.log(JSON.stringify({ remoteVerified: Object.keys(uploaded).length }));
}
const pending = entries.filter(
  (row) => process.argv.includes("--all") || uploaded[row.key] !== row.sha256,
);
for (const type of new Set(pending.map((row) => row.type))) {
  const group = pending.filter((row) => row.type === type);
  for (let offset = 0; offset < group.length; offset += 100) {
    const started = Date.now();
    const batch = group.slice(offset, offset + 100);
    const filename = path.join(output, `upload-batch-${local ? "local" : "remote"}.json`);
    await writeFile(filename, JSON.stringify(batch.map(({ key, file }) => ({ key, file }))));
    for (let attempt = 0; ; attempt++) {
      try {
        execFileSync(
          path.join(root, "node_modules/.bin/wrangler"),
          [
            "r2",
            "bulk",
            "put",
            bucket,
            "--filename",
            filename,
            local ? "--local" : "--remote",
            "--force",
            "--concurrency",
            "4",
            ...(local ? ["--persist-to", localState] : []),
            "--content-type",
            type,
            "--cache-control",
            "public, max-age=31536000, immutable",
          ],
          { cwd: root, stdio: "inherit" },
        );
        break;
      } catch (error) {
        if (attempt >= 2) throw Error(`资源上传失败（批次 ${offset}），已完成批次保留，可重跑继续`);
        console.log("上传中断，稍后重试当前批次…");
        await delay(10000 * (attempt + 1));
      }
    }
    for (const row of batch) uploaded[row.key] = row.sha256;
    await writeFile(cacheFile, JSON.stringify(uploaded), { mode: 0o600 });
    if (!local) await delay(Math.max(0, 30000 - (Date.now() - started)));
  }
}
const report = {
  bucket,
  local,
  files: entries.length,
  bytes: entries.reduce((n, r) => n + r.bytes, 0),
  uploaded: pending.length,
  entries: entries.map(({ file, ...row }) => row),
};
await writeFile(
  path.join(output, `resources-${local ? "local" : "remote"}.json`),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    bucket,
    local,
    files: report.files,
    bytes: report.bytes,
    uploaded: report.uploaded,
  }),
);
