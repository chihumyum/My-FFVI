import { mkdir, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const directory = path.join(root, "backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
const output = path.join(
  directory,
  `cloudflare-${new Date().toISOString().replaceAll(":", "-")}.sql`,
);
try {
  execFileSync(
    path.join(root, "node_modules/.bin/wrangler"),
    ["d1", "export", "ffvi-saves", "--remote", "--output", output],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  // Wrangler prints a signed export URL. Never forward it into task output.
  throw Error(`Cloudflare 备份失败（退出码 ${error.status}），请稍后重试`);
}
await chmod(output, 0o600);
console.log(`Cloudflare 存档备份：${output}`);
