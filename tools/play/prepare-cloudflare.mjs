import { cp, mkdir, readFile, readdir, rm, writeFile, chmod } from "node:fs/promises";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "dist/cloudflare/web");
process.env.PLAY_BUNDLE_OUT = output;
await import("./bundle.mjs");
for (const file of ["login.html", "login.js", "login.css", "manifest.webmanifest", "app-icon.svg"])
  await cp(path.join(root, "server/public", file), path.join(output, file));
const indexFile = path.join(output, "index.html");
await writeFile(
  indexFile,
  (await readFile(indexFile, "utf8")).replace(
    "<title>",
    '<meta name="ffvi-host" content="1"><title>',
  ),
);
const login = path.join(output, "login.html");
await writeFile(
  login,
  (await readFile(login, "utf8")).replace(
    "服务器初次启动后，密码在私有数据目录的 first-login.txt 中。",
    "站点密码由部署者保存；手机和电脑使用同一个密码登录。",
  ),
);
// Never upload macOS metadata, credentials or development evidence as assets.
const assetSizes = {};
async function scan(dir) {
  let count = 0,
    bytes = 0,
    largest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.name.startsWith(".")) {
      await rm(file, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      const part = await scan(file);
      count += part.count;
      bytes += part.bytes;
      largest = Math.max(largest, part.largest);
    } else {
      const content = await readFile(file);
      assetSizes["/" + path.relative(output, file).split(path.sep).join("/")] = content.length;
      count++;
      bytes += content.length;
      largest = Math.max(largest, content.length);
      if (content.length > 25 * 1024 * 1024) throw Error(`Cloudflare 单文件超过 25 MiB: ${file}`);
    }
  }
  return { count, bytes, largest };
}
const inventory = await scan(output);
await writeFile(path.join(root, "dist/cloudflare/asset-sizes.json"), JSON.stringify(assetSizes));
if (inventory.count > 20000) throw Error("静态文件数量超过免费档上限");
const directory = path.join(root, "private-data");
await mkdir(directory, { recursive: true, mode: 0o700 });
const secretFile = path.join(directory, "cloudflare-secrets.json");
try {
  await readFile(secretFile);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const password = randomBytes(24).toString("base64url"),
    salt = randomBytes(24).toString("hex");
  const verifier = {
    salt,
    iterations: 100000,
    hash: pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex"),
  };
  await writeFile(secretFile, JSON.stringify({ FFVI_PASSWORD: JSON.stringify(verifier) }) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(path.join(directory, "cloudflare-first-login.txt"), password + "\n", {
    mode: 0o600,
    flag: "wx",
  });
}
await chmod(secretFile, 0o600);
const secrets = JSON.parse(await readFile(secretFile, "utf8"));
await writeFile(path.join(root, ".dev.vars.local"), `FFVI_PASSWORD=${secrets.FFVI_PASSWORD}\n`, {
  mode: 0o600,
});
await mkdir(path.join(root, "build/play/deployment/cloudflare"), { recursive: true });
await writeFile(
  path.join(root, "build/play/deployment/cloudflare/assets.json"),
  JSON.stringify(inventory, null, 2),
);
console.log(
  JSON.stringify({ output, ...inventory, passwordFile: "private-data/cloudflare-first-login.txt" }),
);
