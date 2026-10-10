import { GameSession } from "/runtime/core/game-session.js";
import { verifyContent } from "/runtime/core/content-integrity.js";
import { Renderer } from "./renderer.js";
import { BattleView } from "./battle-view.js";
const $ = (id) => document.getElementById(id),
  canvas = $("game");
let content,
  battleContent,
  session,
  game,
  renderer,
  openingRenderer,
  catalogPromise,
  battleView,
  started = false,
  paused = false,
  last = 0,
  failed = false;
const images = new Map(),
  loading = new WeakSet();
const query = new URLSearchParams(location.search);
const preview = query.has("map")
  ? {
      mapId: Number(query.get("map")),
      entrance: Number(query.get("entrance") ?? 1),
    }
  : null;
const held = new Map(),
  directions = {
    ArrowUp: "up",
    ArrowRight: "right",
    ArrowDown: "down",
    ArrowLeft: "left",
    KeyW: "up",
    KeyD: "right",
    KeyS: "down",
    KeyA: "left",
  };
const focus = () => canvas.focus();
function pause(value) {
  if (!started || (game.stop && !session.battle)) return;
  paused = value;
  held.clear();
  $("pause").hidden = !value;
  $("menu-button").textContent = value ? "继续" : "暂停";
  sync();
  if (value) $("resume").focus();
  else focus();
}
function reset() {
  session = new GameSession(content, battleContent);
  game = session.field;
  renderer = openingRenderer;
  started = true;
  paused = false;
  held.clear();
  for (const id of ["welcome", "pause", "stop", "dialogue"])
    $(id).hidden = true;
  battleView.hide();
  $("menu-button").disabled = false;
  $("menu-button").textContent = "暂停";
  canvas.setAttribute(
    "aria-label",
    `${content.map.id} 游戏画面。方向键移动，空格确认，Escape 暂停。`,
  );
  showLimitations();
  focus();
  if (preview) game.previewMap(preview.mapId, preview.entrance);
  sync();
}
function text(id, value) {
  const node = $(id);
  if (node.textContent !== value) node.textContent = value;
}
function sync() {
  const mapName =
    game.content.map.id === content.map.id ? "纳尔谢" : game.content.map.id;
  text("map-label", mapName);
  if (session.battle) {
    held.clear();
    $("dialogue").hidden = true;
    $("stop").hidden = true;
    battleView.sync(session.battle, paused);
    text(
      "status",
      `${mapName} · 战斗 · ${session.battle.phase === "active" ? "点击指令和目标；方向键选择，Enter 确认" : "战斗结束"}`,
    );
    return;
  }
  battleView.hide();
  $("dialogue").hidden = !game.dialogue || paused;
  if (game.dialogue) {
    text("speaker", game.dialogue.speaker);
    text("message", game.dialogue.text);
  }
  $("stop").hidden = !game.stop;
  if (game.stop) {
    held.clear();
    text(
      "stop-title",
      game.stop.kind === "map-transition" ? "正在载入地图" : "此处尚未迁移",
    );
    text("stop-message", game.stop.message);
    text(
      "stop-source",
      game.stop.site
        ? `${game.stop.site.script} · 指令 ${game.stop.site.index}\n${game.stop.site.source.assetPath}\n${game.stop.site.source.pointer}`
        : "",
    );
  }
  $("menu-button").disabled = !!game.stop;
  text(
    "status",
    game.stop
      ? game.stop.kind === "map-transition"
        ? "地图载入中…"
        : "当前片段已停止，可重新开始。"
      : game.dialogue
        ? "空格 / Enter 继续对白"
        : game.busy
          ? "事件进行中…"
          : `${mapName} · ${game.player.x}, ${game.player.y} · ${session.gil} Gil`,
  );
}
function confirm() {
  if (!started || paused || game.stop) return;
  game.confirm();
  sync();
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && started) {
    e.preventDefault();
    if (!e.repeat) {
      if (session.battle && !paused && battleView.back()) sync();
      else pause(!paused);
    }
    return;
  }
  if (!started || paused) return;
  if (session.battle) {
    if (e.target === canvas || $("battle-menu").contains(e.target))
      battleView.keyboard(e);
    return;
  }
  if (document.activeElement !== canvas) return;
  if (directions[e.code]) {
    e.preventDefault();
    if (!e.repeat) {
      held.set(e.code, directions[e.code]);
      game.move(directions[e.code]);
    }
  }
  if (["Space", "Enter"].includes(e.code)) {
    e.preventDefault();
    if (!e.repeat) confirm();
  }
});
window.addEventListener("keyup", (e) => held.delete(e.code));
window.addEventListener("blur", () => {
  held.clear();
  if (started) pause(true);
});
document.addEventListener("visibilitychange", () => {
  held.clear();
  last = 0;
  if (document.hidden && started) pause(true);
});
canvas.addEventListener("blur", () => held.clear());
canvas.addEventListener("click", focus);
$("start").onclick = reset;
$("restart").onclick = reset;
$("retry").onclick = reset;
$("resume").onclick = () => pause(false);
$("menu-button").onclick = () => pause(!paused);
$("next").onclick = () => {
  confirm();
  focus();
};
function frame(now) {
  if (failed) return;
  try {
    const dt = last ? Math.min(50, now - last) : 0;
    last = now;
    if (started && !paused && !document.hidden) {
      if (!session.battle && held.size) game.move([...held.values()].at(-1));
      session.advance(dt);
      if (game.stop?.kind === "map-transition" && !loading.has(game.stop))
        loadMap(session);
      sync();
    }
    if (session.battle) battleView.draw(session.battle);
    else if (renderer) renderer.draw(game);
    requestAnimationFrame(frame);
  } catch (error) {
    failure(error);
  }
}
function failure(error) {
  failed = true;
  held.clear();
  for (const id of ["pause", "dialogue", "stop", "battle-ui", "battle-result"])
    $(id).hidden = true;
  $("menu-button").disabled = true;
  $("welcome").hidden = false;
  $("load-error").hidden = false;
  $("load-error").textContent = String(error.message ?? error);
  $("start").disabled = true;
  $("start").textContent = "载入失败";
  text("status", "发生错误，已停止运行。");
}
async function init() {
  if (
    preview &&
    (!Number.isInteger(preview.mapId) ||
      preview.mapId <= 0 ||
      preview.mapId > 2147483647 ||
      !Number.isInteger(preview.entrance) ||
      preview.entrance < 0 ||
      preview.entrance > 2147483647)
  )
    throw new Error("Invalid map preview identity");
  const responses = await Promise.all([
    fetch("/game/content.json"),
    fetch("/game/battle.json"),
  ]);
  if (responses.some((r) => !r.ok))
    throw new Error(
      "缺少内容，请先运行 npm run game:build 和 npm run battle:build。",
    );
  [content, battleContent] = await Promise.all(responses.map((r) => r.json()));
  await Promise.all([verifyContent(content), verifyContent(battleContent)]);
  const urls = new Set([
    ...Object.values(content.map.textures),
    ...Object.values(content.characters).flatMap((c) =>
      Object.values(c.sprites).map((s) => s.file),
    ),
    ...Object.values(battleContent.common.sprites).map((s) => s.file),
  ]);
  await loadImages(urls);
  session = new GameSession(content, battleContent);
  game = session.field;
  renderer = new Renderer(canvas, content, images);
  openingRenderer = renderer;
  battleView = new BattleView(
    canvas,
    battleContent.common,
    images,
    () => {
      if (session.continueVictory()) {
        sync();
        focus();
      }
    },
    () => {
      if (session.retryBattle()) {
        sync();
        focus();
      }
    },
  );
  showLimitations();
  if (preview) {
    text("welcome-title", "地图开发预览");
    text(
      "welcome-description",
      `地图 ${preview.mapId} · 入口 ${preview.entrance}`,
    );
    text(
      "welcome-scope",
      "直接检查来源地图、移动和入口事件。沿用开发队伍；未设置未知剧情状态，不代表该地图已从主线可达。",
    );
  }
  $("start").disabled = false;
  text("start", preview ? "进入地图预览" : "进入纳尔谢");
  text("status", "地图与战斗已载入 · 本地开发预览");
  requestAnimationFrame(frame);
}
function showLimitations() {
  $("limitations").replaceChildren();
  for (const line of [
    game.content.entry.description,
    ...game.content.limitations,
    ...battleContent.common.limitations,
  ]) {
    const li = document.createElement("li");
    li.textContent = line;
    $("limitations").append(li);
  }
}
async function loadImages(urls) {
  await Promise.all(
    [...urls]
      .filter((url) => !images.has(url))
      .map(async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        images.set(url, img);
      }),
  );
}
async function loadMap(owner) {
  const request = owner.field.stop;
  loading.add(request);
  held.clear();
  try {
    catalogPromise ??= fetch("/world/catalog.json").then(async (response) => {
      if (!response.ok)
        throw new Error("地图目录尚未生成，请运行 npm run world:build。");
      return verifyContent(await response.json());
    });
    const catalog = await catalogPromise;
    const indexed = catalog.maps[String(request.request.mapId)];
    if (!indexed) throw new Error("来源地图目录中没有此地图。");
    const response = await fetch(indexed.url);
    if (!response.ok) throw new Error("地图内容载入失败。");
    const map = await verifyContent(await response.json(), indexed.contentHash);
    if (session !== owner || owner.field.stop !== request) return;
    const prepared = owner.world.prepare(catalog, map);
    const next = prepared.field.content;
    await loadImages(
      new Set([
        ...Object.values(next.map.textures),
        ...Object.values(next.characters).flatMap((c) =>
          Object.values(c.sprites).map((s) => s.file),
        ),
      ]),
    );
    if (session !== owner) return;
    const nextRenderer = new Renderer(canvas, next, images);
    if (!owner.world.commit(prepared)) {
      owner.world.fail(request, "地图载入期间状态已变化，请重新开始。");
      sync();
      return;
    }
    game = owner.field;
    renderer = nextRenderer;
    held.clear();
    last = 0;
    canvas.setAttribute(
      "aria-label",
      `${next.map.id} 游戏画面。方向键移动，空格确认，Escape 暂停。`,
    );
    showLimitations();
    sync();
    if (!paused && !document.hidden) focus();
  } catch (error) {
    if (session !== owner) return;
    catalogPromise = undefined;
    owner.world.fail(request, String(error.message ?? error));
    sync();
  }
}
init().catch(failure);
