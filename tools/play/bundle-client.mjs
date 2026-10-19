// Build public source without PR files, exported caches or copied game assets.
import { build } from "vite";
import path from "node:path";
const value = (name) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
let index = value("--data-index") || process.env.FFVI_DATA_INDEX;
if (!index && value("--site")) {
  const site = new URL(value("--site"));
  const response = await fetch(site, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`无法读取站点资源配置：HTTP ${response.status}`);
  const html = await response.text();
  const file = html.match(/name="ffvi-data-index" content="([^"]+)"/)?.[1];
  if (!file) throw Error("该站点没有独立资源清单");
  index = new URL(file, site).href;
}
if (!index) throw Error("请指定 --data-index <资源清单 URL> 或 --site <游戏站点 URL>");
process.env.FFVI_DATA_INDEX = index;
await build({
  configFile: path.resolve(import.meta.dirname, "../../vite.config.mjs"),
  publicDir: false,
  build: { outDir: path.resolve(import.meta.dirname, "../../dist/client") },
});
console.log(
  "仅代码静态包：dist/client；资源从指定地址读取，存档保存在当前浏览器。带云同步的部署请使用 Cloudflare Worker。",
);
