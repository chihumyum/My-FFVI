import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { slotPattern } from "./store.mjs";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const digest = (token) => createHash("sha256").update(token).digest("hex");
const maxBody = 16 * 1024 * 1024;
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw Object.assign(Error("需要 JSON 请求"), { status: 415 });
  const buffers = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBody) throw Object.assign(Error("存档过大"), { status: 413 });
    buffers.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString());
  } catch {
    throw Object.assign(Error("JSON 格式错误"), { status: 400 });
  }
}

export async function createHost({ store, staticDir, publicURL }) {
  const root = await realpath(staticDir),
    failures = new Map();
  if (publicURL && !/^https?:\/\//.test(publicURL))
    throw Error("FFVI_PUBLIC_URL 必须是 http(s) 地址");
  const origin = publicURL && new URL(publicURL).origin;
  const secure = origin?.startsWith("https:");
  const cookie = (token, age = 30 * 86400) =>
    `ffvi_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? "; Secure" : ""}`;
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    // Pixi v8 generates uniform upload functions with Function(). Inline scripts
    // stay forbidden; only the bundled same-origin code may be loaded.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    const json = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://localhost"),
        route = decodeURIComponent(url.pathname);
      if (!["GET", "HEAD", "POST", "PUT"].includes(req.method))
        return json(405, { error: "不支持的请求" });
      if (["POST", "PUT"].includes(req.method)) {
        const expected = origin || `http://${req.headers.host}`;
        if (req.headers.origin !== expected || req.headers["sec-fetch-site"] === "cross-site")
          return json(403, { error: "请求来源不匹配" });
      }
      const token = req.headers.cookie?.match(/(?:^|;\s*)ffvi_session=([\w-]+)/)?.[1];
      const session =
        token && store.db.prepare("SELECT expires FROM sessions WHERE token=?").get(digest(token));
      const authenticated = session?.expires > Date.now();
      if (route === "/api/session" && req.method === "GET")
        return json(200, { authenticated: !!authenticated, serverId: store.config.serverId });
      if (route === "/api/session" && req.method === "POST") {
        const ip = req.socket.remoteAddress,
          now = Date.now();
        if (failures.size > 10000)
          for (const [key, row] of failures) if (now - row.start > 600000) failures.delete(key);
        let limit = failures.get(ip);
        if (!limit || now - limit.start > 600000)
          failures.set(ip, (limit = { start: now, count: 0 }));
        if (++limit.count > 10) {
          res.setHeader("Retry-After", "600");
          return json(429, { error: "尝试过多，请 10 分钟后再试" });
        }
        const input = await body(req);
        if (!(await store.verify(input.password))) return json(401, { error: "密码不正确" });
        failures.delete(ip);
        store.db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
        const fresh = randomBytes(32).toString("base64url");
        store.db
          .prepare("INSERT INTO sessions VALUES (?,?)")
          .run(digest(fresh), now + 30 * 86400000);
        res.setHeader("Set-Cookie", cookie(fresh));
        return json(200, { authenticated: true, serverId: store.config.serverId });
      }
      if (
        ["/login", "/login.js", "/login.css", "/manifest.webmanifest", "/app-icon.svg"].includes(
          route,
        ) &&
        ["GET", "HEAD"].includes(req.method)
      ) {
        const file = route === "/login" ? "login.html" : route.slice(1);
        res.setHeader("Content-Type", types[path.extname(file)]);
        return res.end(
          req.method === "HEAD"
            ? undefined
            : await readFile(new URL(`./public/${file}`, import.meta.url)),
        );
      }
      if (!authenticated) {
        if (req.headers.accept?.includes("text/html") && ["GET", "HEAD"].includes(req.method)) {
          res.writeHead(302, { Location: "/login" });
          return res.end();
        }
        return json(401, { error: "请先登录" });
      }
      if (route === "/api/logout" && req.method === "POST") {
        store.db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
        res.setHeader("Set-Cookie", cookie("", 0));
        res.setHeader("Clear-Site-Data", '"cache"');
        return json(200, { ok: true });
      }
      if (route === "/api/saves" && req.method === "GET")
        return json(200, { serverId: store.config.serverId, saves: store.list() });
      const match = route.match(/^\/api\/saves\/([^/]+)(?:\/(history|[1-9]\d*))?$/);
      if (match && slotPattern.test(match[1])) {
        const [, id, version] = match;
        if (req.method === "GET") {
          if (version === "history") return json(200, { versions: store.history(id) });
          const value = version ? store.version(id, Number(version)) : store.get(id);
          return json(value ? 200 : 404, value || { error: "存档不存在" });
        }
        if (req.method === "PUT" && !version) {
          const result = store.put(id, await body(req));
          return json(
            result.conflict ? 409 : 200,
            result.conflict
              ? { error: "另一台设备已经修改此槽，两个版本均已保留", current: result.value }
              : result.value,
          );
        }
      }
      if (route.startsWith("/api/")) return json(404, { error: "接口不存在" });
      if (!["GET", "HEAD"].includes(req.method)) return json(405, { error: "仅支持读取" });
      if (
        route.includes("\0") ||
        route.includes("\\") ||
        route.split("/").some((part) => part.startsWith("."))
      )
        return json(404, { error: "文件不存在" });
      const file = await realpath(path.join(root, route === "/" ? "index.html" : route));
      if (!file.startsWith(root + path.sep)) return json(404, { error: "文件不存在" });
      const info = await stat(file);
      if (!info.isFile()) return json(404, { error: "文件不存在" });
      const ext = path.extname(file);
      res.setHeader("Content-Type", types[ext] || "application/octet-stream");
      if (file === path.join(root, "index.html")) {
        const html = (await readFile(file, "utf8")).replace(
          "<title>",
          '<meta name="ffvi-host" content="1"><title>',
        );
        return res.end(req.method === "HEAD" ? undefined : html);
      }
      const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "private, no-cache");
      res.setHeader("Accept-Ranges", "bytes");
      if (req.headers["if-none-match"] === etag && !req.headers.range) {
        res.writeHead(304);
        return res.end();
      }
      let start = 0,
        end = info.size - 1,
        status = 200;
      if (req.headers.range) {
        const range = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
        if (!range || (!range[1] && !range[2])) {
          res.setHeader("Content-Range", `bytes */${info.size}`);
          return json(416, { error: "无效范围" });
        }
        start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(end, Number(range[2])) : end;
        if (start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
          res.setHeader("Content-Range", `bytes */${info.size}`);
          return json(416, { error: "无效范围" });
        }
        status = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
      }
      res.setHeader("Content-Length", Math.max(0, end - start + 1));
      res.writeHead(status);
      if (req.method === "HEAD" || info.size === 0) return res.end();
      const stream = createReadStream(file, { start, end });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = ["ENOENT", "ENOTDIR"].includes(error.code)
        ? 404
        : error.status ||
          (error.message?.includes("存档") || error.message?.includes("同步版本") ? 400 : 500);
      if (status === 500) console.error("[private-host]", error);
      json(status, { error: status === 500 ? "服务器错误，本地存档仍保留" : error.message });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}
