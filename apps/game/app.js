import { InventoryView } from "./inventory-view.js";
import { EquipmentView } from "./equipment-view.js";
import { GameSession } from "/runtime/core/game-session.js";
import { battleAppearanceQuads } from "/runtime/core/battle-appearance.js";
import { verifyContent } from "/runtime/core/content-integrity.js";
import { CheckpointStorage } from "/runtime/core/saved-game.js";
import { Renderer } from "./renderer.js";
import { BattleView } from "./battle-view.js";
import { AudioOutput, audioProjection } from "./audio.js";
const $ = (id) => document.getElementById(id),
  canvas = $("game");
let content,
  battleContent,
  session,
  game,
  renderer,
  openingRenderer,
  minimapRenderer,
  overviewRenderer,
  catalogPromise,
  battleView,
  inventoryView,
  equipmentView,
  started = false,
  paused = false,
  mapOpen = false,
  lastMinimapFrame = 0,
  last = 0,
  failed = false;
let checkpointBusy = false,
  hasSave = false,
  hasPreviousSave = false;
const checkpointStorage = () => new CheckpointStorage(localStorage);
const images = new Map(),
  loading = new WeakSet();
const audio = new AudioOutput();
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
  if (checkpointBusy) return;
  if (!started || (game.stop && !session.battle)) return;
  paused = value;
  if (!value) audio.unlock().catch(failure);
  mapOpen = false;
  held.clear();
  $("pause").hidden = !value;
  $("menu-button").textContent = value ? "继续" : "暂停";
  if (value) {
    $("battle-mode").value = session.battlePreferences.mode;
    syncSaveControls();
    inventoryView.reset();
    inventoryView.render(session);
    equipmentView.reset();
    equipmentView.render(session);
  }
  sync();
  if (value) $("resume").focus();
  else focus();
}
function setMap(value) {
  if (
    value &&
    (!started || paused || session.battle || game.busy || !game.content.minimap)
  )
    return;
  mapOpen = value;
  held.clear();
  if (value) overviewRenderer.overview(game);
  sync();
  if (value) $("close-map").focus();
  else focus();
}
function setupMapViews(next) {
  minimapRenderer = new Renderer($("minimap"), next, images);
  overviewRenderer = new Renderer($("overview"), next, images);
  mapOpen = false;
  lastMinimapFrame = 0;
}
function reset() {
  if (checkpointBusy) return;
  audio.reset();
  audio.unlock().catch(failure);
  const preferences = session?.battlePreferences;
  session = new GameSession(content, battleContent);
  if (preferences) session.setBattlePreferences(preferences);
  game = session.field;
  renderer = openingRenderer;
  setupMapViews(content);
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
  const canMap =
    started &&
    !paused &&
    !session.battle &&
    !game.busy &&
    !!game.content.minimap;
  if (!canMap) mapOpen = false;
  $("map-button").disabled = !canMap;
  $("map-button").setAttribute("aria-expanded", String(mapOpen));
  $("map-overview").hidden = !mapOpen;
  $("minimap-button").hidden = !canMap || mapOpen;
  text("overview-title", mapName);
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
  $("dialogue").hidden = !game.messageWindow || paused;
  if (game.messageWindow) {
    text("speaker", game.messageWindow.speaker);
    text("message", game.messageWindow.text);
    $("message").style.textAlign = game.messageWindow.alignment ?? "left";
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
          : (game.movementBlocker ??
            `${mapName} · ${game.player.x}, ${game.player.y} · ${session.gil} Gil`),
  );
}
function confirm() {
  if (!started || paused || mapOpen || game.stop) return;
  game.confirm();
  sync();
}
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && started) {
    e.preventDefault();
    if (!e.repeat) setMap(!mapOpen);
    return;
  }
  if (e.code === "Escape" && started) {
    e.preventDefault();
    if (!e.repeat) {
      if (mapOpen) setMap(false);
      else if (session.battle && !paused && battleView.back()) sync();
      else pause(!paused);
    }
    return;
  }
  if (!started || paused || mapOpen) return;
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
$("battle-mode").onchange = () => {
  session.setBattlePreferences({ mode: $("battle-mode").value });
  sync();
};
$("save-game").onclick = saveGame;
$("load-game").onclick = () => loadGame(false);
$("load-start").onclick = () => loadGame(false);
$("load-previous").onclick = () => loadGame(true);
$("sound-button").onclick = () => {
  audio.mute();
  $("sound-button").textContent = audio.muted ? "声音关" : "声音开";
  $("sound-button").setAttribute("aria-pressed", String(!audio.muted));
  focus();
};
$("map-button").onclick = () => setMap(!mapOpen);
$("minimap-button").onclick = () => setMap(true);
$("close-map").onclick = () => setMap(false);
$("next").onclick = () => {
  confirm();
  focus();
};
function frame(now) {
  if (failed) return;
  try {
    const dt = last ? Math.min(50, now - last) : 0;
    last = now;
    const ready = started && audio.ready(audioProjection(game));
    if (
      started &&
      !paused &&
      !checkpointBusy &&
      !mapOpen &&
      !document.hidden &&
      ready
    ) {
      if (!session.battle && held.size) game.move([...held.values()].at(-1));
      session.advance(dt);
      if (game.stop?.kind === "map-transition" && !loading.has(game.stop))
        loadMap(session);
      sync();
    }
    const projection = started ? audioProjection(game) : [];
    const audioReady = started && audio.ready(projection);
    audio.project(
      projection,
      audioReady &&
        !failed &&
        !checkpointBusy &&
        !paused &&
        !mapOpen &&
        !document.hidden &&
        (!game.stop || !!session.battle),
    );
    text(
      "music-status",
      started ? audio.status(audioReady, projection.length > 0) : "",
    );
    if (session.battle) battleView.draw(session.battle);
    else if (renderer) renderer.draw(game);
    if (!$("minimap-button").hidden && now - lastMinimapFrame >= 125) {
      minimapRenderer.overview(game);
      lastMinimapFrame = now;
    }
    requestAnimationFrame(frame);
  } catch (error) {
    failure(error);
  }
}
function failure(error) {
  failed = true;
  audio.reset();
  held.clear();
  for (const id of [
    "pause",
    "dialogue",
    "stop",
    "battle-ui",
    "battle-result",
    "map-overview",
    "minimap-button",
  ])
    $(id).hidden = true;
  $("menu-button").disabled = true;
  $("map-button").disabled = true;
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
    ...Object.values(content.minimap?.icons ?? {}).map((s) => s.file),
  ]);
  await loadImages(urls);
  session = new GameSession(content, battleContent);
  game = session.field;
  renderer = new Renderer(canvas, content, images);
  openingRenderer = renderer;
  setupMapViews(content);
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
    battleAppearanceQuads,
  );
  inventoryView = new InventoryView(
    $("pause"),
    battleContent.gameState.items,
    () => {
      equipmentView.render(session);
      syncSaveControls();
    },
  );
  equipmentView = new EquipmentView($("equipment-menu"), () => {
    inventoryView.render(session);
    syncSaveControls();
  });
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
  await refreshSaveInfo();
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
    const catalog = await worldCatalog();
    const indexed = catalog.maps[String(request.request.mapId)];
    if (!indexed) throw new Error("来源地图目录中没有此地图。");
    const response = await fetch(indexed.url);
    if (!response.ok) throw new Error("地图内容载入失败。");
    const map = await verifyContent(await response.json(), indexed.contentHash);
    if (session !== owner || owner.field.stop !== request) return;
    const prepared = owner.world.prepare(catalog, map);
    const next = prepared.field.content;
    await audio.prepare(audioProjection(prepared.field));
    await loadImages(
      new Set([
        ...Object.values(next.map.textures),
        ...Object.values(next.characters).flatMap((c) =>
          Object.values(c.sprites).map((s) => s.file),
        ),
        ...Object.values(next.minimap?.icons ?? {}).map((s) => s.file),
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
    setupMapViews(next);
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
function worldCatalog() {
  catalogPromise ??= fetch("/world/catalog.json").then(async (response) => {
    if (!response.ok)
      throw new Error("地图目录尚未生成，请运行 npm run world:build。");
    return verifyContent(await response.json());
  });
  return catalogPromise;
}
function syncSaveControls() {
  $("save-game").disabled =
    failed || checkpointBusy || !session?.checkpointReady;
  $("load-game").disabled = failed || checkpointBusy || !hasSave;
  $("load-start").disabled = failed || checkpointBusy || !hasSave;
  $("load-previous").disabled = failed || checkpointBusy || !hasPreviousSave;
  for (const id of ["resume", "restart", "start"])
    $(id).disabled = failed || checkpointBusy;
  $("save-game").title = session?.checkpointReady
    ? "保存到这台设备的浏览器"
    : "移动、事件或战斗结束后才能保存";
}
async function refreshSaveInfo() {
  try {
    const saved = await checkpointStorage().load();
    hasSave = saved !== null;
    text(
      "save-info",
      saved ? `本地进度 · ${new Date(saved.savedAt).toLocaleString()}` : "",
    );
  } catch {
    hasSave = true;
    text("save-info", "本地进度暂时无法读取，原数据仍保留。");
  }
  try {
    hasPreviousSave = (await checkpointStorage().load(true)) !== null;
  } catch {
    hasPreviousSave = false;
  }
  $("load-start").hidden = !hasSave;
  syncSaveControls();
}
async function saveGame() {
  if (checkpointBusy || !session.checkpointReady) return;
  checkpointBusy = true;
  syncSaveControls();
  try {
    await checkpointStorage().save(session.checkpoint(), Date.now());
    await refreshSaveInfo();
    text("save-status", "进度已保存在此浏览器，刷新后可继续。");
  } catch (error) {
    text("save-status", `保存失败，原存档未替换：${error.message ?? error}`);
  } finally {
    checkpointBusy = false;
    syncSaveControls();
  }
}
async function loadGame(previous) {
  if (checkpointBusy) return;
  const owner = session;
  checkpointBusy = true;
  syncSaveControls();
  text(started ? "save-status" : "save-info", "正在读取进度…");
  try {
    // Create decoding resources during the click, without resuming a paused audio clock.
    // Playback resumes through the user's Continue action after the candidate is published.
    audio.initialize();
    const saved = await checkpointStorage().load(previous);
    if (!saved) throw new Error("尚无此本地进度。");
    let world;
    const location = saved.checkpoint?.world?.location;
    if (location !== null && location !== undefined) {
      if (
        !Number.isInteger(location.mapId) ||
        location.mapId <= 0 ||
        location.mapId > 2147483647
      )
        throw new Error("存档中的地图身份无效。");
      const catalog = await worldCatalog();
      const indexed = catalog.maps[String(location.mapId)];
      if (location.catalogHash !== catalog.contentHash || !indexed)
        throw new Error("存档与当前地图资源版本不匹配。");
      const response = await fetch(indexed.url);
      if (!response.ok) throw new Error("存档所需地图载入失败。");
      world = {
        catalog,
        map: await verifyContent(await response.json(), indexed.contentHash),
      };
    }
    const candidate = GameSession.restore(
      saved.checkpoint,
      content,
      battleContent,
      world,
    );
    const next = candidate.field.content;
    await audio.prepare(audioProjection(candidate.field));
    await loadImages(
      new Set([
        ...Object.values(next.map.textures),
        ...Object.values(next.characters).flatMap((c) =>
          Object.values(c.sprites).map((s) => s.file),
        ),
        ...Object.values(next.minimap?.icons ?? {}).map((s) => s.file),
      ]),
    );
    const nextRenderer = new Renderer(canvas, next, images);
    if (session !== owner) return;
    audio.reset();
    session = candidate;
    game = candidate.field;
    renderer = nextRenderer;
    setupMapViews(next);
    started = true;
    held.clear();
    last = 0;
    for (const id of ["welcome", "stop", "dialogue"]) $(id).hidden = true;
    battleView.hide();
    canvas.setAttribute(
      "aria-label",
      `${next.map.id} 游戏画面。方向键移动，空格确认，Escape 暂停。`,
    );
    showLimitations();
    checkpointBusy = false;
    pause(true);
    text(
      "save-status",
      previous ? "已读取上一份进度，点击继续。" : "进度已读取，点击继续。",
    );
  } catch (error) {
    catalogPromise = undefined;
    const reason =
      /source\/version mismatch|source identity|Content identity mismatch/i.test(
        error.message ?? "",
      )
        ? "这份存档与当前游戏内容版本不同，暂时无法读取。原存档已保留。"
        : `读取失败，当前游戏和存档仍保留：${error.message ?? error}`;
    text(started ? "save-status" : "save-info", reason);
  } finally {
    checkpointBusy = false;
    syncSaveControls();
  }
}
init().catch(failure);
