import { InventoryView } from "./inventory-view.js";
import { EquipmentView } from "./equipment-view.js";
import { PartyView } from "./party-view.js";
import { ChoiceView } from "./choice-view.js";
import { ShopView } from "./shop-view.js";
import { GameSession } from "/runtime/core/game-session.js";
import { GameFlow } from "/runtime/core/game-flow.js";
import { GameContentRepository, fieldMediaUrls, openingMediaUrls } from "/runtime/core/game-content.js";
import { NewGameFieldEntry } from "/runtime/core/new-game-field-entry.js";
import { FieldFadeState, fieldFadeOverlay } from "/runtime/core/field-fade.js";
import { createSourcePresentationContext } from "/runtime/core/source-presentation.js";
import { battleAppearanceQuads } from "/runtime/core/battle-appearance.js";
import { CheckpointStorage } from "/runtime/core/saved-game.js";
import { Renderer } from "./renderer.js";
import { BattleView } from "./battle-view.js";
import { AudioOutput, audioProjection } from "./audio.js";
const $ = (id) => document.getElementById(id),
  canvas = $("game");
let content,
  battleContent,
  flow,
  game,
  renderer,
  openingRenderer,
  minimapRenderer,
  overviewRenderer,
  battleView,
  inventoryView,
  equipmentView,
  partyView,
  choiceView,
  shopView,
  mapOpen = false,
  lastMinimapFrame = 0,
  last = 0,
  failed = false;
let sourceBoot = null;
let hasSave = false,
  hasPreviousSave = false;
const query = new URLSearchParams(location.search);
const contentProfile = query.get("profile") === "framework" ? "framework" : "source";
const checkpointStorage = () => new CheckpointStorage(localStorage, contentProfile);
const images = new Map(),
  loading = new WeakSet();
const audio = new AudioOutput();
const contents = new GameContentRepository(async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("游戏内容载入失败，请确认本地内容已经构建。");
  return response.json();
}, contentProfile);
const runtime = { audioReadiness: { isReady: (track) => audio.isReady(track) },
  // Source DateTime.Now.Ticks is local wall time. Keep its Int64 as a string.
  transportationTimestamp: () => { const now = new Date();
    return (621355968000000000n + BigInt(now.getTime() - now.getTimezoneOffset() * 60000) * 10000n).toString(); } };
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
  if (!flow?.pause(value)) return;
  if (!value) audio.unlock().catch(failure);
  mapOpen = false;
  held.clear();
  $("pause").hidden = !value;
  $("menu-button").textContent = value ? "继续" : "暂停";
  if (value) {
    $("battle-mode").value = flow.session.battlePreferences.mode;
    $("battle-speed").value = String(flow.session.battlePreferences.speedIndex);
    syncSaveControls();
    inventoryView.reset();
    inventoryView.render(flow.session);
    equipmentView.reset();
    equipmentView.render(flow.session);
    partyView.reset();
    partyView.render(flow.session);
  }
  sync();
  if (value) $("resume").focus();
  else focus();
}
function setMap(value) {
  if (
    value &&
    (!flow?.started || flow.paused || flow.busy || flow.session.battle || game.busy || !game.content.minimap)
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
  if (flow.busy) return;
  sourceBoot = null;
  audio.reset();
  audio.unlock().catch(failure);
  const preferences = flow.session.battlePreferences;
  const candidate = new GameSession(content, battleContent, undefined, runtime);
  candidate.setBattlePreferences(preferences);
  flow.start(candidate);
  game = flow.session.field;
  renderer = openingRenderer;
  setupMapViews(content);
  held.clear();
  for (const id of ["welcome", "pause", "stop", "dialogue"])
    $(id).hidden = true;
  battleView.hide();
  shopView.reset();
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
async function startSourceGame() {
  if (flow.busy || sourceBoot) return;
  const operation = flow.beginOperation("new-game");
  syncSaveControls();
  $("source-start").disabled = true;
  $("load-error").hidden = true;
  try {
    const { content: bundle, catalog, map } = await contents.sourceNewGame();
    if (!operation.isCurrent()) return;
    const presentation = createSourcePresentationContext({ kind: "title-new-game",
      titleCleanupComplete: true, openingCallbackStarted: false });
    const entry = new NewGameFieldEntry(bundle.entry, presentation);
    // This is the visible Web title's actual clear overlay, not a guessed native prefab.
    const titleFade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
      rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
    const start = entry.prepareStart(titleFade, { active: true, callbacks: "absent" });
    audio.reset(); // The Web title has no active BGM voice to fade.
    await audio.unlock();
    start.commit();
    if (!operation.isCurrent()) return;
    const boot = { bundle, presentation, entry, fade: start.fade, ready: false, catalog, map, operation };
    sourceBoot = boot;
    held.clear();
    for (const id of ["welcome", "pause", "stop", "dialogue"]) $(id).hidden = true;
    text("status", "正在准备新游戏…");
    if (!map.map) throw new Error("新游戏地图几何未完成。");
    await loadImages(new Set([...Object.values(map.map.textures),
      ...(map.map.backgrounds ?? []).map(background => background.texture.url),
      ...Object.values(catalog.characters).flatMap(c => Object.values(c.sprites).map(s => s.file)),
      ...Object.values(catalog.minimap?.icons ?? {}).map(s => s.file)]));
    if (sourceBoot !== boot || !operation.isCurrent()) return;
    boot.ready = true;
  } catch (error) {
    if (!operation.isCurrent()) return;
    operation.cancel();
    sourceBoot = null;
    $("welcome").hidden = false;
    $("source-start").disabled = false;
    $("load-error").hidden = false;
    text("load-error", error.message ?? String(error));
    syncSaveControls();
  }
}
function advanceSourceBoot(seconds) {
  const boot = sourceBoot;
  if (!boot || !boot.operation.isCurrent()) return;
  boot.fade.advance(seconds);
  const next = boot.entry.prepareResume(boot.fade, boot.ready);
  if (next) { next.commit(); boot.fade = next.fade; }
  if (boot.entry.phase !== "field-preparing" || !boot.ready) return;
  const candidate = GameSession.prepareNewGame(boot.bundle, boot.catalog, boot.map, battleContent,
    boot.fade, boot.presentation, runtime);
  const nextRenderer = new Renderer(canvas, candidate.field.content, images);
  const launch = boot.entry.prepareLaunch(boot.fade, candidate.newGamePreparation(true));
  candidate.launchNewGame(launch.launch);
  launch.commit();
  if (!boot.operation.publish(candidate)) return;
  game = flow.session.field; renderer = nextRenderer;
  setupMapViews(game.content);
  sourceBoot = null;
  $("source-start").disabled = false;
  battleView.hide(); shopView.reset();
  $("menu-button").disabled = false;
  $("menu-button").textContent = "暂停";
  canvas.setAttribute("aria-label", `${game.content.map.id} 原始新游戏画面。`);
  showLimitations(); syncSaveControls(); focus(); sync();
}
function returnToTitle() {
  flow.returnToTitle();
  sourceBoot = null;
  audio.reset();
  held.clear();
  mapOpen = false;
  last = 0;
  for (const id of ["pause", "stop", "dialogue", "map-overview", "minimap-button", "shop-menu"])
    $(id).hidden = true;
  battleView.hide();
  shopView.reset();
  choiceView.reset();
  $("welcome").hidden = false;
  $("load-error").hidden = true;
  $("menu-button").disabled = true;
  $("menu-button").textContent = "暂停";
  $("map-button").disabled = true;
  syncSaveControls();
  text("status", "选择开始游戏或继续本地进度。");
  $("start").focus();
}
function text(id, value) {
  const node = $(id);
  if (node.textContent !== value) node.textContent = value;
}
function sync() {
  choiceView?.render(flow, { disabled: failed || document.hidden || mapOpen });
  if (game.choicePending) held.clear();
  shopView?.render(
    flow.session,
    flow.inputReady && !document.hidden && !flow.session.battle && !game.stop,
  );
  const mapName =
    game.content.map.id === content.map.id ? "纳尔谢" : game.content.map.id;
  text("map-label", mapName);
  const canMap =
    flow.started &&
    !flow.paused &&
    !flow.busy &&
    !flow.session.battle &&
    !game.busy &&
    !!game.content.minimap;
  if (!canMap) mapOpen = false;
  $("map-button").disabled = !canMap;
  $("map-button").setAttribute("aria-expanded", String(mapOpen));
  $("map-overview").hidden = !mapOpen;
  $("minimap-button").hidden = !canMap || mapOpen;
  text("overview-title", mapName);
  if (flow.session.battle) {
    held.clear();
    $("dialogue").hidden = true;
    $("stop").hidden = true;
    battleView.sync(flow.session.battle, !flow.inputReady || document.hidden);
    text(
      "status",
      `${mapName} · 战斗 · ${flow.session.battle.phase === "active" ? "点击指令和目标；方向键选择，Enter 确认" : "战斗结束"}`,
    );
    return;
  }
  battleView.hide();
  $("dialogue").hidden = !game.messageWindow || flow.paused;
  $("next").hidden = game.choicePending;
  if (game.messageWindow) {
    text("speaker", game.messageWindow.speaker);
    text("message", game.messageWindow.text);
    $("message").style.textAlign = game.messageWindow.alignment ?? "left";
    $("dialogue").dataset.window = game.messageWindow.manual?.window ?? "frame";
    $("dialogue").dataset.anchor = game.messageWindow.manual?.anchor ?? "bottom";
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
      : game.currentShop
        ? "选择商品和数量，Esc 返回或离开商店"
        : game.choice
          ? "方向键选择，空格 / Enter 确认"
        : game.dialogue
          ? "空格 / Enter 继续对白"
          : game.busy
            ? "事件进行中…"
            : (game.movementBlocker ??
              `${mapName} · ${game.player.x}, ${game.player.y} · ${flow.session.gil} Gil`),
  );
}
function confirm() {
  if (!flow.started || flow.paused || mapOpen || game.stop) return;
  flow.confirm();
  sync();
}
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && flow?.started) {
    e.preventDefault();
    if (!e.repeat) setMap(!mapOpen);
    return;
  }
  if (e.code === "Escape" && flow?.started) {
    e.preventDefault();
    if (!e.repeat) {
      if (mapOpen) setMap(false);
      else if (!flow.paused && game.currentShop && shopView.back()) sync();
      else if (flow.session.battle && !flow.paused && battleView.back()) sync();
      else pause(!flow.paused);
    }
    return;
  }
  if (!flow?.started || flow.paused || flow.busy || mapOpen) return;
  if (flow.session.battle) {
    if (e.target === canvas || $("battle-menu").contains(e.target))
      battleView.keyboard(e);
    return;
  }
  if (game.choicePending) {
    if (e.target === canvas || $("choice-panel").contains(e.target)) choiceView.keyboard(e);
    return;
  }
  if (document.activeElement !== canvas) return;
  if (directions[e.code]) {
    e.preventDefault();
    if (!e.repeat) {
      held.set(e.code, directions[e.code]);
      flow.move(directions[e.code]);
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
  if (flow?.started) pause(true);
});
document.addEventListener("visibilitychange", () => {
  held.clear();
  last = 0;
  if (document.hidden && flow?.started) pause(true);
});
canvas.addEventListener("blur", () => held.clear());
canvas.addEventListener("click", focus);
$("start").onclick = reset;
$("source-start").onclick = startSourceGame;
$("restart").onclick = reset;
$("retry").onclick = reset;
$("return-title").onclick = returnToTitle;
$("stop-title-return").onclick = returnToTitle;
$("resume").onclick = () => pause(false);
$("menu-button").onclick = () => pause(!flow.paused);
$("battle-mode").onchange = () => {
  if (!flow.started || flow.busy) return;
  flow.session.setBattlePreferences({ ...flow.session.battlePreferences, mode: $("battle-mode").value });
  sync();
};
$("battle-speed").onchange = () => {
  if (!flow.started || flow.busy) return;
  flow.session.setBattlePreferences({ ...flow.session.battlePreferences, speedIndex: Number($("battle-speed").value) });
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
  if (!game.currentShop) focus();
};
function frame(now) {
  if (failed) return;
  try {
    const dt = last ? Math.min(50, now - last) : 0;
    last = now;
    if (sourceBoot && !document.hidden) advanceSourceBoot(dt / 1000);
    const ready = flow.started && audio.ready(audioProjection(game), game.pendingBgmTracks);
    flow.advance(dt, { visible: !document.hidden, mediaReady: ready, overlayOpen: mapOpen });
    if (flow.started && !sourceBoot) {
      if (held.size) flow.move([...held.values()].at(-1));
      if (game.stop?.kind === "map-transition" && !loading.has(game.stop))
        loadMap(flow.session);
      sync();
    }
    const projection = flow.started ? audioProjection(game) : [];
    const audioReady = flow.started && audio.ready(projection, game.pendingBgmTracks);
    audio.project(
      projection,
      audioReady &&
        !failed &&
        !flow.busy &&
        !flow.paused &&
        !mapOpen &&
        !document.hidden &&
        (!game.stop || !!flow.session.battle),
      game.pendingBgmTracks,
    );
    text(
      "music-status",
      flow.started ? audio.status(audioReady, projection.length > 0) : "",
    );
    if (flow.session.battle) battleView.draw(flow.session.battle);
    else if (renderer) renderer.draw(game);
    if (sourceBoot) {
      const c = canvas.getContext("2d"), color = fieldFadeOverlay(sourceBoot.fade.projection);
      c.fillStyle = `rgba(${color.r * 255},${color.g * 255},${color.b * 255},${color.a})`;
      c.fillRect(0, 0, canvas.width, canvas.height);
    }
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
  // Cleanup failure must not hide the original error or resume a broken loop.
  try { audio.reset(); } catch { /* The game is already stopped. */ }
  held.clear();
  choiceView?.reset();
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
  ({ field: content, battle: battleContent } = await contents.opening());
  await loadImages(openingMediaUrls(content, battleContent));
  flow = new GameFlow(new GameSession(content, battleContent, undefined, runtime));
  game = flow.session.field;
  renderer = new Renderer(canvas, content, images);
  openingRenderer = renderer;
  setupMapViews(content);
  battleView = new BattleView(
    canvas,
    battleContent.common,
    images,
    () => {
      if (flow.continueVictory()) {
        sync();
        focus();
      }
    },
    () => {
      if (flow.retryBattle()) {
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
      equipmentView.render(flow.session);
      syncSaveControls();
    },
  );
  equipmentView = new EquipmentView($("equipment-menu"), () => {
    inventoryView.render(flow.session);
    syncSaveControls();
  });
  partyView = new PartyView($("party-menu"), () => {
    inventoryView.render(flow.session);
    equipmentView.render(flow.session);
    syncSaveControls();
  });
  choiceView = new ChoiceView($("choice-panel"), () => {
    held.clear();
    sync();
    if (!game.choice) focus();
  });
  shopView = new ShopView($("shop-menu"), () => {
    held.clear();
    sync();
    if (!game.currentShop) focus();
  });
  showLimitations();
  if (contentProfile === "framework") {
    text("welcome-scope", "可从故事开头运行；当前开发版采用简化的环境与骑乘演出，剧情与游戏系统仍在迁移中。");
    text("source-start", "从头开始（框架开发版）");
  }
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
  $("source-start").disabled = false;
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
    ...(game.content.map.nativeComposition ? ["原生普通角色的身体和头部已接入来源合成；角色阴影仍缺失，属于当前开发版的画面偏差。"] : []),
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
  if (flow.busy || flow.session !== owner) return;
  const request = owner.field.stop;
  const operation = flow.beginOperation("map");
  loading.add(request);
  held.clear();
  syncSaveControls();
  let prepared;
  let published = false;
  try {
    const catalog = await contents.world();
    const map = await contents.map(request.request.mapId, catalog);
    if (!operation.isCurrent() || owner.field.stop !== request) return;
    prepared = owner.world.prepare(catalog, map);
    const next = prepared.field.content;
    await audio.prepare(audioProjection(prepared.field), prepared.field.pendingBgmTracks);
    await loadImages(fieldMediaUrls(next));
    if (!operation.isCurrent()) return;
    const nextRenderer = new Renderer(canvas, next, images);
    if (!owner.world.commit(prepared)) {
      owner.world.fail(request, "地图载入期间状态已变化，请重新开始。");
      operation.finish();
      sync();
      return;
    }
    published = true;
    game = owner.field;
    operation.finish();
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
    if (!flow.paused && !document.hidden) focus();
  } catch (error) {
    if (published) { failure(error); return; }
    if (!operation.isCurrent()) return;
    contents.clear();
    owner.world.fail(request, String(error.message ?? error));
    operation.finish();
    sync();
  } finally {
    if (prepared) owner.world.discard(prepared);
    operation.cancel();
    syncSaveControls();
  }
}
function syncSaveControls() {
  // Menu actions must not mutate the outgoing owner during asynchronous saves
  // or while a replacement session is being prepared.
  $("pause").inert = flow.busy;
  $("pause").setAttribute("aria-busy", String(flow.busy));
  partyView?.render(flow.session, { disabled: failed || flow.busy });
  $("save-game").disabled =
    failed || flow.busy || !flow.session?.checkpointReady;
  $("load-game").disabled = failed || flow.busy || !hasSave;
  $("load-start").disabled = failed || flow.busy || !hasSave;
  $("load-previous").disabled = failed || flow.busy || !hasPreviousSave;
  for (const id of ["resume", "restart", "start", "source-start", "return-title", "stop-title-return"])
    $(id).disabled = failed || flow.busy;
  $("save-game").title = flow.session?.checkpointReady
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
  if (flow.busy || !flow.session.checkpointReady) return;
  const operation = flow.beginOperation("save");
  syncSaveControls();
  try {
    await checkpointStorage().save(flow.session.checkpoint(), Date.now());
    if (!operation.isCurrent()) return;
    await refreshSaveInfo();
    text("save-status", "进度已保存在此浏览器，刷新后可继续。");
  } catch (error) {
    if (!operation.isCurrent()) return;
    text("save-status", `保存失败，原存档未替换：${error.message ?? error}`);
  } finally {
    operation.cancel();
    syncSaveControls();
  }
}
async function loadGame(previous) {
  if (flow.busy) return;
  const operation = flow.beginOperation("load");
  let published = false;
  syncSaveControls();
  text(flow.started ? "save-status" : "save-info", "正在读取进度…");
  try {
    // Create decoding resources during the click, without resuming a paused audio clock.
    // Playback resumes through the user's Continue action after the candidate is published.
    audio.initialize();
    const saved = await checkpointStorage().load(previous);
    if (!saved) throw new Error("尚无此本地进度。");
    const world = await contents.restoreWorld(saved.checkpoint);
    if (!operation.isCurrent()) return;
    const candidate = GameSession.restore(
      saved.checkpoint,
      content,
      battleContent,
      world,
      runtime,
    );
    const next = candidate.field.content;
    await audio.prepare(audioProjection(candidate.field), candidate.field.pendingBgmTracks);
    await loadImages(fieldMediaUrls(next));
    const nextRenderer = new Renderer(canvas, next, images);
    if (!operation.publish(candidate, { paused: true })) return;
    published = true;
    game = candidate.field;
    renderer = nextRenderer;
    audio.reset();
    setupMapViews(next);
    held.clear();
    last = 0;
    for (const id of ["welcome", "stop", "dialogue"]) $(id).hidden = true;
    battleView.hide();
    canvas.setAttribute(
      "aria-label",
      `${next.map.id} 游戏画面。方向键移动，空格确认，Escape 暂停。`,
    );
    showLimitations();
    pause(true);
    text(
      "save-status",
      previous ? "已读取上一份进度，点击继续。" : "进度已读取，点击继续。",
    );
  } catch (error) {
    if (published) { failure(error); return; }
    if (!operation.isCurrent()) return;
    contents.clear();
    const reason =
      /(?:source|kind)\/version mismatch|source identity|Content identity mismatch/i.test(
        error.message ?? "",
      )
        ? "这份存档与当前游戏内容版本不同，暂时无法读取。原存档已保留。"
        : `读取失败，当前游戏和存档仍保留：${error.message ?? error}`;
    text(flow.started ? "save-status" : "save-info", reason);
  } finally {
    operation.cancel();
    syncSaveControls();
  }
}
init().catch(failure);
