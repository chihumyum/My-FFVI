import assetSizes from "../dist/cloudflare/asset-sizes.json" with { type: "json" };
import { slotPattern } from "../server/save-schema.mjs";
import { openD1Store } from "./store.mjs";
import { rangeResponse } from "./ranges.mjs";

const encoder = new TextEncoder();
const maxBody = 1950000;
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};
const hex = (buffer) =>
  Array.from(new Uint8Array(buffer), (v) => v.toString(16).padStart(2, "0")).join("");
const sha = async (text) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
const json = (status, value, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", ...headers },
  });
async function body(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw Object.assign(Error("需要 JSON 请求"), { status: 415 });
  if (Number(request.headers.get("content-length")) > maxBody)
    throw Object.assign(Error("请求过大，本机存档仍保留"), { status: 413 });
  const reader = request.body?.getReader(),
    chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBody) {
        await reader.cancel();
        throw Object.assign(Error("请求过大"), { status: 413 });
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw Object.assign(Error("JSON 格式错误"), { status: 400 });
  }
}
async function verify(password, encoded) {
  if (typeof password !== "string" || password.length > 1024) return false;
  const config = JSON.parse(encoded);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(config.salt),
      iterations: config.iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );
  const expected = Uint8Array.from(config.hash.match(/../g), (v) => parseInt(v, 16));
  return crypto.subtle.timingSafeEqual(bits, expected);
}

export default {
  async fetch(request, env, ctx) {
    try {
      if (!env.FFVI_PASSWORD) return json(503, { error: "私人站点尚未设置密码" });
      const url = new URL(request.url),
        route = decodeURIComponent(url.pathname);
      const origin = env.FFVI_PUBLIC_URL || url.origin;
      if (origin.startsWith("https:") && url.protocol !== "https:")
        return new Response(null, {
          status: 308,
          headers: {
            ...securityHeaders,
            Location: new URL(url.pathname + url.search, origin).href,
          },
        });
      if (!["GET", "HEAD", "POST", "PUT"].includes(request.method))
        return json(405, { error: "不支持的请求" });
      if (
        ["POST", "PUT"].includes(request.method) &&
        (request.headers.get("origin") !== origin ||
          request.headers.get("sec-fetch-site") === "cross-site")
      ) {
        console.warn(
          JSON.stringify({
            event: "origin-rejected",
            expected: origin,
            received: request.headers.get("origin"),
          }),
        );
        return json(403, { error: "请求来源不匹配" });
      }
      const store = openD1Store(env.DB),
        db = store.db;
      const token = request.headers.get("cookie")?.match(/(?:^|;\s*)ffvi_session=([\w-]+)/)?.[1];
      const digest = token && (await sha(token + "\0" + env.FFVI_PASSWORD));
      const session =
        digest &&
        (await db.prepare("SELECT expires FROM sessions WHERE token=?").bind(digest).first());
      const authenticated = session?.expires > Date.now();
      const cookie = (value, age = 30 * 86400) =>
        `ffvi_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${url.protocol === "https:" ? "; Secure" : ""}`;
      if (route === "/api/session" && request.method === "GET")
        return json(200, { authenticated: !!authenticated, serverId: await store.serverId() });
      if (route === "/api/session" && request.method === "POST") {
        const input = await body(request),
          now = Date.now(),
          ip = await sha(request.headers.get("cf-connecting-ip") || "local");
        const limit = await db
          .prepare(
            "INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(ip) DO UPDATE SET attempts=CASE WHEN expires<? THEN 1 ELSE attempts+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING attempts",
          )
          .bind(ip, now + 600000, now, now)
          .first();
        if (limit.attempts > 10)
          return json(429, { error: "尝试过多，请 10 分钟后再试" }, { "Retry-After": "600" });
        if (!(await verify(input.password, env.FFVI_PASSWORD)))
          return json(401, { error: "密码不正确" });
        const fresh = hex(crypto.getRandomValues(new Uint8Array(32)));
        await db.batch([
          db.prepare("DELETE FROM login_attempts WHERE ip=? OR expires<?").bind(ip, now),
          db.prepare("DELETE FROM sessions WHERE expires<?").bind(now),
          db
            .prepare("INSERT INTO sessions VALUES (?,?)")
            .bind(await sha(fresh + "\0" + env.FFVI_PASSWORD), now + 30 * 86400000),
        ]);
        return json(
          200,
          { authenticated: true, serverId: await store.serverId() },
          { "Set-Cookie": cookie(fresh) },
        );
      }
      const publicFiles = new Map([
        ["/login", "/login"],
        ["/login.js", "/login.js"],
        ["/login.css", "/login.css"],
        ["/manifest.webmanifest", "/manifest.webmanifest"],
        ["/app-icon.svg", "/app-icon.svg"],
      ]);
      if (publicFiles.has(route) && ["GET", "HEAD"].includes(request.method)) {
        const target = new URL(publicFiles.get(route), url);
        const asset = await env.ASSETS.fetch(new Request(target, request));
        const headers = new Headers(asset.headers);
        for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
        return new Response(asset.body, { status: asset.status, headers });
      }
      if (!authenticated)
        return request.headers.get("accept")?.includes("text/html") &&
          ["GET", "HEAD"].includes(request.method)
          ? new Response(null, { status: 302, headers: { ...securityHeaders, Location: "/login" } })
          : json(401, { error: "请先登录" });
      if (route === "/api/logout" && request.method === "POST") {
        await db.prepare("DELETE FROM sessions WHERE token=?").bind(digest).run();
        return json(
          200,
          { ok: true },
          { "Set-Cookie": cookie("", 0), "Clear-Site-Data": '"cache"' },
        );
      }
      if (route === "/api/saves" && request.method === "GET")
        return json(200, { serverId: await store.serverId(), saves: await store.list() });
      const match = route.match(/^\/api\/saves\/([^/]+)(?:\/(history|[1-9]\d*))?$/);
      if (match && slotPattern.test(match[1])) {
        const [, id, version] = match;
        if (request.method === "GET") {
          if (version === "history") return json(200, { versions: await store.history(id) });
          const value = version ? await store.version(id, Number(version)) : await store.get(id);
          return json(value ? 200 : 404, value || { error: "存档不存在" });
        }
        if (request.method === "PUT" && !version) {
          const result = await store.put(id, await body(request));
          return json(
            result.conflict ? 409 : 200,
            result.conflict
              ? { error: "另一台设备已经修改此槽，两个版本均已保留", current: result.value }
              : result.value,
          );
        }
      }
      if (route.startsWith("/api/")) return json(404, { error: "接口不存在" });
      if (!["GET", "HEAD"].includes(request.method)) return json(405, { error: "仅支持读取" });
      if (
        route.includes("\0") ||
        route.includes("\\") ||
        route.split("/").some((p) => p.startsWith("."))
      )
        return json(404, { error: "文件不存在" });
      const asset = await rangeResponse(
        await env.ASSETS.fetch(request),
        request,
        assetSizes[route],
      );
      const headers = new Headers(asset.headers);
      for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
      headers.set("Cache-Control", "private, no-cache");
      return new Response(request.method === "HEAD" ? null : asset.body, {
        status: asset.status,
        headers,
      });
    } catch (error) {
      const status = error.status || (/存档|同步版本/.test(error.message) ? 400 : 500);
      if (status === 500)
        console.error(JSON.stringify({ event: "ffvi-worker-error", message: error.message }));
      return json(status, { error: status === 500 ? "服务器错误，本机存档仍保留" : error.message });
    }
  },
};
