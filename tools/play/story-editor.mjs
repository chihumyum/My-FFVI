import { createServer } from "vite";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { StoryStore } from "./story-store.mjs";
import { createAktoCityContent } from "../../apps/play/akto-city-content.js";
import { createAktoStoryDemo } from "../../src/play/story-demo.js";
const root = path.resolve(import.meta.dirname, "../.."),
  port = Number(process.env.STORY_PORT || 4186);
const store = new StoryStore(
  path.resolve(process.env.STORY_DOCUMENT_DIR || path.join(root, "private-data/story-editor")),
);
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const dataRoot = path.join(root, "build/web-data"),
  artRoot = path.join(root, "build/play/deployment/akto-city");
const data = await read(path.join(dataRoot, "data.json"));
const battleData = await read(path.join(dataRoot, "battle.json"));
const art = await read(path.join(artRoot, "art-data.json")).catch(() => null);
const akto = art ? createAktoCityContent({ ...art, root: "http://127.0.0.1/__story/art/" }) : null;
const programs = {
  ...data.programs,
  ...Object.fromEntries(
    Object.entries(akto?.data.programs || {}).map(([id, p]) => [`akto-${id}`, p]),
  ),
};
const messages = { ...data.messages, ...akto?.data.messages },
  speakers = { ...data.speakers, ...akto?.data.speakers };
const globals = {
  ...data.global,
  ...Object.fromEntries(
    Object.entries(akto?.data.global || {}).map(([name, id]) => [name, `akto-${id}`]),
  ),
};
const byMap = {
  ...data.byMap,
  ...Object.fromEntries(
    Object.keys(akto?.maps || {}).map((id) => [
      id,
      Object.fromEntries(
        Object.entries(akto.data.global).map(([name, key]) => [name, `akto-${key}`]),
      ),
    ]),
  ),
};
const category = (name) =>
  /^sc_ai_/.test(name)
    ? "怪物 AI"
    : /^sc_b_/.test(name)
      ? "战斗事件"
      : /^sc_e_/.test(name)
        ? "剧情"
        : /^sc_map_/.test(name)
          ? "地图"
          : "公共";
const scopeByProgram = new Map();
for (const [mapId, aliases] of Object.entries(byMap))
  for (const id of new Set(Object.values(aliases).map(String))) {
    if (!scopeByProgram.has(id)) scopeByProgram.set(id, []);
    scopeByProgram.get(id).push(Number(mapId));
  }
const records = Object.entries(programs).map(([id, p]) => ({
  id,
  name: p.name,
  title: p.title,
  category: id.startsWith("akto-") ? "阿克托" : category(p.name),
  count: p.ops.length,
  maps: scopeByProgram.get(id) || [],
  searchText: p.ops
    .filter((o) => ["Msg", "Select"].includes(o[0]))
    .flatMap((o) => o[3])
    .map((key) => messages[key] || "")
    .join(" "),
}));
const incoming = new Map(),
  outgoing = new Map();
let triggers;
async function triggerIndex() {
  if (!triggers)
    triggers = (async () => {
      const index = new Map();
      const add = (mapId, script, details) => {
        const id = byMap[mapId]?.[script] ?? globals[script];
        if (id === undefined) return;
        const key = String(id);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ mapId: Number(mapId), script, ...details });
      };
      for (const id of Object.keys(data.maps)) {
        const map = await read(path.join(dataRoot, "maps", `${id}.json`));
        if (map.initializer) add(id, map.initializer, { kind: "地图入口" });
        for (const [group, entities] of [
          ["entity_default", map.entities || []],
          ...Object.entries(map.groups || {})
            .filter(([key]) => key !== "entity_default")
            .map(([key, value]) => [key, value.entities || []]),
        ])
          for (const entity of entities) {
            const script =
              entity.script ||
              entity.npc?.interaction?.script ||
              entity.mapObject?.interaction?.script;
            if (script)
              add(id, script, {
                kind: entity.kind === 2 ? "区域触发" : "交互",
                entityId: entity.id,
                x: entity.x,
                y: entity.y,
                layer: entity.layer,
                group,
              });
          }
      }
      for (const map of Object.values(akto?.maps || {})) {
        if (map.initializer) add(map.id, map.initializer, { kind: "地图入口" });
        for (const entity of map.entities || [])
          if (entity.script)
            add(map.id, entity.script, {
              kind: entity.kind === 2 ? "区域触发" : "交互",
              entityId: entity.id,
              x: entity.x,
              y: entity.y,
              group: "entity_default",
            });
      }
      return index;
    })();
  return triggers;
}
for (const [id, p] of Object.entries(programs)) {
  const scopes = scopeByProgram.get(id) || [];
  for (const [pc, [name, ints, , strings]] of p.ops.entries()) {
    if (!["ChangeScript", "ChangeMap"].includes(name)) continue;
    const targetName = strings?.[0];
    if (!targetName) continue;
    const contexts = name === "ChangeMap" ? [ints[0]] : scopes.length ? scopes : [null];
    const targets = new Set(
      contexts
        .map((mapId) => byMap[mapId]?.[targetName] ?? globals[targetName])
        .filter((v) => v !== undefined)
        .map(String),
    );
    for (const target of targets) {
      const edge = { from: id, to: target, pc, name: targetName, kind: name };
      if (!incoming.has(target)) incoming.set(target, []);
      if (!outgoing.has(id)) outgoing.set(id, []);
      incoming.get(target).push(edge);
      outgoing.get(id).push(edge);
    }
  }
}
const remap = (value) => {
  if (typeof value === "string")
    return value.startsWith("/web-data/") ? value.replace("/web-data/", "/play-data/") : value;
  if (Array.isArray(value)) return value.map(remap);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));
  return value;
};
const json = (res, value, status = 200) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
};
async function body(req) {
  let text = "";
  for await (const bytes of req) {
    text += bytes;
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw Error("文档超过 8 MiB");
  }
  return JSON.parse(text);
}
async function middleware(req, res, next) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith("/__story/")) return next();
  try {
    if (
      req.method !== "GET" &&
      (req.headers.origin !== url.origin || req.headers["sec-fetch-site"] === "cross-site")
    )
      return json(res, { error: "只接受本机工作台的同源写入" }, 403);
    const parts = url.pathname.slice(9).split("/").map(decodeURIComponent);
    if (parts[0] === "catalog")
      return json(res, {
        programs: records,
        maps: Object.fromEntries(
          Object.entries({
            ...data.maps,
            ...Object.fromEntries(
              Object.entries(akto?.maps || {}).map(([id, map]) => [id, { name: map.name }]),
            ),
          }).map(([id, value]) => [
            id,
            {
              ...value,
              title: messages[data.mapTitles[id]] || akto?.data.mapTitles[id] || value.name,
            },
          ]),
        ),
        hasAkto: !!art,
        demo: createAktoStoryDemo(),
      });
    if (parts[0] === "program") {
      const id = parts[1],
        program = programs[id];
      if (!program) return json(res, { error: "脚本不存在" }, 404);
      const keys = new Set(
        program.ops.flatMap((o) => (["Msg", "Select"].includes(o[0]) ? o[3].filter(Boolean) : [])),
      );
      return json(res, {
        program,
        source: { programId: id, program, kind: id.startsWith("akto-") ? "authored" : "pr" },
        messages: Object.fromEntries([...keys].map((k) => [k, messages[k] ?? k])),
        speakers: Object.fromEntries([...keys].map((k) => [k, speakers[k] || ""])),
        incoming: incoming.get(id) || [],
        outgoing: outgoing.get(id) || [],
        triggers: (await triggerIndex()).get(id) || [],
        maps: scopeByProgram.get(id) || [],
      });
    }
    if (parts[0] === "variable") {
      const bank = url.searchParams.get("bank"),
        slot = Number(url.searchParams.get("slot")),
        result = [];
      for (const [id, p] of Object.entries(programs))
        for (const [pc, [name, i, , s]] of p.ops.entries())
          if (
            ["Branch", "Calc", "SetFlag", "ResetFlag", "FlipFlag"].includes(name) &&
            s[0] === bank &&
            i[0] === slot
          )
            result.push({ id, name: p.name, pc, kind: name === "Branch" ? "读取" : "写入" });
      return json(res, result);
    }
    if (parts[0] === "documents") {
      const id = parts[1];
      if (!id) return json(res, await store.list());
      if (parts[2] === "history")
        return json(res, parts[3] ? await store.version(id, parts[3]) : await store.history(id));
      if (req.method === "PUT") {
        const value = await body(req),
          result = await store.save(id, value.document, value.revision);
        return json(res, result, result.conflict ? 409 : 200);
      }
      return json(res, await store.read(id));
    }
    if (parts[0] === "base") {
      if (url.searchParams.get("world") === "akto") {
        if (!art) throw Error("阿克托资源未准备；请先运行 npm run play:akto:city");
        return json(res, createAktoCityContent({ ...art, root: `${url.origin}/__story/art/` }));
      }
      return json(res, remap({ data, battleData }));
    }
    if (parts[0] === "map")
      return json(res, remap(await read(path.join(dataRoot, "maps", `${Number(parts[1])}.json`))));
    if (parts[0] === "art") {
      const file = path.resolve(artRoot, ...parts.slice(1));
      if (!file.startsWith(artRoot + path.sep)) return json(res, { error: "无效路径" }, 400);
      if (!(await stat(file)).isFile()) return json(res, { error: "资源不存在" }, 404);
      res.setHeader(
        "Content-Type",
        file.endsWith(".png") ? "image/png" : "application/octet-stream",
      );
      return res.end(await readFile(file));
    }
    if (parts[0] === "opera") return json(res, await read(path.join(dataRoot, "opera.json")));
    return json(res, { error: "接口不存在" }, 404);
  } catch (error) {
    return json(res, { error: error.message }, 400);
  }
}
const server = await createServer({
  configFile: path.join(root, "vite.config.mjs"),
  server: { host: "127.0.0.1", port, strictPort: true },
  plugins: [
    {
      name: "local-story-editor",
      configureServer(server) {
        server.middlewares.use(middleware);
      },
    },
  ],
});
await server.listen();
console.log(`剧情工作台：http://127.0.0.1:${port}/story-editor.html`);
console.log(`创作文件与版本历史：${store.directory}`);
