import assetSizes from "../dist/cloudflare/asset-sizes.json" with { type: "json" };
import { slotPattern } from "../server/save-schema.mjs";
import { openD1Store } from "./store.mjs";
import { serveResource } from "./resources.mjs";
import { rangeResponse } from "./ranges.mjs";
import { handleReports } from "./reports.mjs";

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
      const publicSite = env.FFVI_PUBLIC_SITE === "1";
      if (!publicSite && !env.FFVI_PASSWORD) return json(503, { error: "私人站点尚未设置密码" });
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
      if (publicSite && route.startsWith("/resources/") && ["GET", "HEAD"].includes(request.method))
        return serveResource(request, env.RESOURCES, { headers: securityHeaders, publicSite, ctx });
      const db = env.DB.withSession("first-primary");
      const token = request.headers.get("cookie")?.match(/(?:^|;\s*)ffvi_session=([\w-]+)/)?.[1];
      const digest = token && (await sha("session\0" + token));
      const legacyDigest = token && (await sha(token + "\0" + env.FFVI_PASSWORD));
      const session =
        token &&
        (await db
          .prepare(
            "SELECT token,expires,owner FROM profile_sessions WHERE token=? AND expires>? UNION ALL SELECT token,expires,'legacy' AS owner FROM sessions WHERE token=? AND expires>?",
          )
          .bind(digest, Date.now(), legacyDigest, Date.now())
          .first());
      const authenticated = !!session;
      const store = openD1Store(env.DB, session?.owner || "legacy");
      const cookie = (value, age = 30 * 86400) =>
        `ffvi_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${url.protocol === "https:" ? "; Secure" : ""}`;
      const identity = async (owner = session?.owner) => ({
        authenticated: !!owner,
        publicSite,
        serverId: owner ? await openD1Store(env.DB, owner).serverId() : null,
        profileId: owner === "legacy" ? "原私人存档" : owner?.slice(0, 12),
        legacy: owner === "legacy",
      });
      const establish = async (owner, recoveryKey) => {
        const fresh = hex(crypto.getRandomValues(new Uint8Array(32))),
          now = Date.now();
        await db.batch([
          db.prepare("DELETE FROM login_attempts WHERE expires<?").bind(now),
          db.prepare("DELETE FROM profile_sessions WHERE expires<?").bind(now),
          owner === "legacy"
            ? db
                .prepare("INSERT INTO sessions VALUES (?,?)")
                .bind(await sha(fresh + "\0" + env.FFVI_PASSWORD), now + 30 * 86400000)
            : db
                .prepare("INSERT INTO profile_sessions (token,expires,owner) VALUES (?,?,?)")
                .bind(await sha("session\0" + fresh), now + 30 * 86400000, owner),
        ]);
        return json(
          200,
          { ...(await identity(owner)), ...(recoveryKey ? { recoveryKey } : {}) },
          { "Set-Cookie": cookie(fresh) },
        );
      };
      const limit = async (key, maximum, duration = 600000) => {
        const now = Date.now();
        const row = await db
          .prepare(
            "INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(ip) DO UPDATE SET attempts=CASE WHEN expires<? THEN 1 ELSE attempts+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING attempts",
          )
          .bind(key, now + duration, now, now)
          .first();
        if (row.attempts > maximum)
          throw Object.assign(Error("请求过多，请稍后重试；本机进度仍保留"), { status: 429 });
      };
      if (route === "/api/session" && request.method === "GET") return json(200, await identity());
      if ((route === "/api/session" || route === "/api/identity") && request.method === "POST") {
        await limit("login:" + (await sha(request.headers.get("cf-connecting-ip") || "local")), 20);
        const input = await body(request);
        if (route === "/api/identity") {
          if (!publicSite) return json(404, { error: "此站点未开放匿名身份" });
          const key = "ffvi_" + hex(crypto.getRandomValues(new Uint8Array(32)));
          const owner = await sha("profile-v1\0" + key);
          await db.prepare("INSERT INTO profiles VALUES (?,?)").bind(owner, Date.now()).run();
          return establish(owner, key);
        }
        if (typeof input.recoveryKey === "string") {
          if (!/^ffvi_[a-f0-9]{64}$/.test(input.recoveryKey))
            return json(401, { error: "恢复密钥格式不正确" });
          const owner = await sha("profile-v1\0" + input.recoveryKey);
          if (!(await db.prepare("SELECT id FROM profiles WHERE id=?").bind(owner).first()))
            return json(401, { error: "恢复密钥不存在，请检查是否完整；不会新建或覆盖存档" });
          return establish(owner);
        }
        if (!env.FFVI_PASSWORD || !(await verify(input.password, env.FFVI_PASSWORD)))
          return json(401, { error: "密码不正确" });
        return establish("legacy");
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
      if (!authenticated && (!publicSite || route.startsWith("/api/")))
        return request.headers.get("accept")?.includes("text/html") &&
          ["GET", "HEAD"].includes(request.method)
          ? new Response(null, { status: 302, headers: { ...securityHeaders, Location: "/login" } })
          : json(401, { error: "请先登录" });
      if (route === "/api/logout" && request.method === "POST") {
        await db.batch([
          db.prepare("DELETE FROM sessions WHERE token=?").bind(session.token),
          db.prepare("DELETE FROM profile_sessions WHERE token=?").bind(session.token),
        ]);
        return json(
          200,
          { ok: true },
          { "Set-Cookie": cookie("", 0), "Clear-Site-Data": '"cache"' },
        );
      }
      if (route.startsWith("/api/reports") || route.startsWith("/api/admin/reports"))
        return await handleReports(request, env, {
          route,
          session,
          account: await store.serverId(),
          db,
          json,
          headers: securityHeaders,
        });
      if (route.startsWith("/api/saves")) {
        // Pin the browser's identity on every operation. Switching the shared
        // cookie in another tab must never redirect an in-flight save to it.
        if (
          (publicSite || request.headers.has("X-FFVI-Account")) &&
          request.headers.get("X-FFVI-Account") !== (await store.serverId())
        )
          return json(403, { error: "存档身份已切换，请刷新此页；本机版本仍保留" });
        if (request.method === "PUT") await limit("save:" + session.owner, 120, 60000);
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
      if (route.startsWith("/resources/"))
        return serveResource(request, env.RESOURCES, { headers: securityHeaders, publicSite, ctx });
      const asset = await rangeResponse(
        await env.ASSETS.fetch(request),
        request,
        assetSizes[route],
      );
      const headers = new Headers(asset.headers);
      for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
      headers.set("Cache-Control", publicSite ? "no-cache" : "private, no-cache");
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
