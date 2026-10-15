import { syncFieldMessageView } from "./source-message-view.js";
import { createWebFieldMessageSequencePort } from "/runtime/core/source-message-sequence.js";
import { createWebFlatConditionLeaderActivityPort } from "/runtime/core/field-condition-activity.js";
import { InventoryView } from "./inventory-view.js";
import { EquipmentView } from "./equipment-view.js";
import { PartyView } from "./party-view.js";
import { ChoiceView } from "./choice-view.js";
import { ShopView } from "./shop-view.js";
import { GameSession } from "/runtime/core/game-session.js";
import { WEB_SOURCE_ENCOUNTER_POLICY } from "/runtime/core/source-encounter-entry.js";
import { prepareGameDevelopmentEntry } from "/runtime/core/game-development-entry.js";
import { GameFlow } from "/runtime/core/game-flow.js";
import { GameCommands } from "/runtime/core/game-commands.js";
import { GameEntryLoader } from "/runtime/core/game-entry-loader.js";
import { GameMapLoader } from "/runtime/core/game-map-loader.js";
import { GameBattleHandoff } from "/runtime/core/game-battle-handoff.js";
import { GameEventSaveCoordinator } from "/runtime/core/game-event-save.js";
import { GameContentRepository, fieldMediaUrls, sourceEntryMediaUrls } from "/runtime/core/game-content.js";
import { parseGameContentRefs } from "/runtime/core/game-content-refs.js";
import { GameContentHistory } from "/runtime/core/game-content-history.js";
import { GameContentSessions } from "/runtime/core/game-content-sessions.js";
import { resolveGameContentReleaseMedia } from "/runtime/core/game-content-release.js";
import { selectGamePackage } from "/runtime/core/game-package-selection.js";
import { NewGameFieldEntry } from "/runtime/core/new-game-field-entry.js";
import { FieldFadeState, fieldFadeOverlay } from "/runtime/core/field-fade.js";
import { createSourcePresentationContext } from "/runtime/core/source-presentation.js";
import { battleAppearanceQuads } from "/runtime/core/battle-appearance.js";
import { projectDevelopmentBattleLayout } from "/runtime/core/battle-layout.js";
import { CheckpointStorage } from "/runtime/core/saved-game.js";
import { Renderer } from "./renderer.js";
import { BattleView } from "./battle-view.js";
import { AudioOutput, audioProjection } from "./audio.js";
import { drawStoryTimer } from "./story-overlay.js";
const $ = (id) => document.getElementById(id),
  canvas = $("game");
let flow,
  commands,
  entryLoader,
  mapLoader,
  battleHandoff,
  game,
  renderer,
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
let entryLoad = null;
let mapLoadFailure = null;
let battleLoadAttempt = null;
let eventSaver = null;
let eventSaveFailure = null;
let menuCommandsReady = null;
let contentHistory, contentSessions;
const attemptedEventSaves = new WeakSet();
const attemptedBattleStarts = new WeakSet();
let hasSave = false,
  hasPreviousSave = false;
const query = new URLSearchParams(location.search);
let packageSelection = null;
let systemsPlayground = false, worldTravel = false;
let contentProfile = "source";
let contentReady = false;
const checkpointStorage = () => new CheckpointStorage(localStorage, contentProfile, packageSelection?.packageId ?? undefined);
const currentImages = new Map(), imageSets = new WeakMap(), loading = new WeakSet();
let images = currentImages;
const audioFile = (release, track) => {
  if (release === null) return track.file;
  const reference = resolveGameContentReleaseMedia(release, track.file);
  if (reference.extension !== "flac" || reference.sha256 !== track.sha256)
    throw new Error("历史声音资源与内容摘要不匹配。");
  return reference.url;
};
const audio = new AudioOutput(track => audioFile(contentSessions?.release ?? null, track));
const readGameJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("游戏内容载入失败，请确认本地内容已经构建。");
  return response.json();
};
let contents = new GameContentRepository(readGameJson, contentProfile);
// Same declared Web policy as the source-route audit; no native default claim.
const runtime = {
  // Source slots and entry ordering are retained; this seed mapping and
  // deferred media-first publication are explicit Web policies, not Unity RNG.
  sourceEncounterPolicy: WEB_SOURCE_ENCOUNTER_POLICY, sourceMessageSequence: createWebFieldMessageSequencePort(),
  // Explicit flat Web component/ancestor policy, rebound from each candidate's
  // trusted native factory. Saved activeSelf never grants this capability.
  conditionLeaderActivity: createWebFlatConditionLeaderActivityPort(),
  battleHandoff: "prepared", audioReadiness: { isReady: (track) => audio.isReady(track) },
  soundPresentation: { isPresented: (voice, track) => audio.isSoundPresented(voice, track) },
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
    menuCommandsReady = commands.menuReady;
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
function beginEntryLoad(kind, message) {
  const operation = entryLoader.begin(kind);
  entryLoad = operation;
  held.clear();
  $("entry-loading").hidden = false;
  $("entry-error").hidden = true;
  $("load-error").hidden = true;
  text("entry-loading-message", message);
  syncSaveControls();
  return operation;
}
function finishEntryLoad(operation) {
  operation.cancel();
  if (entryLoad !== operation) return;
  entryLoad = null;
  if (sourceBoot?.operation === operation) sourceBoot = null;
  $("entry-loading").hidden = true;
  last = 0;
  syncSaveControls();
}
function entryLoadFailed(operation, error, message = `载入失败，当前游戏和存档仍保留：${error.message ?? error}`) {
  if (entryLoad !== operation) return;
  contents.clear();
  audio.reset();
  text("entry-error", message);
  $("entry-error").hidden = !flow.started;
  if (!flow.started) {
    $("welcome").hidden = false;
    text("load-error", message);
    $("load-error").hidden = false;
  }
  finishEntryLoad(operation);
}
function cancelEntryLoad() {
  if (!entryLoad) return;
  const operation = entryLoad;
  finishEntryLoad(operation);
  audio.reset();
  $("welcome").hidden = flow.started;
  if (flow.started) { sync(); if (flow.paused) $("resume").focus(); else focus(); }
  else $(contents.hasInitializedEntry || contents.hasDevelopmentEntry ? "start" : "source-start").focus();
}
function imagesFor(repository) {
  let result = imageSets.get(repository);
  if (!result) { result = new Map(); imageSets.set(repository, result); }
  return result;
}
function prepareSessionViews(candidate, nextImages = currentImages) {
  const next = candidate.field.content;
  return { field: new Renderer(canvas, next, nextImages),
    minimap: new Renderer($("minimap"), next, nextImages),
    overview: new Renderer($("overview"), next, nextImages), images: nextImages };
}
// Content and media are prepared privately before the flow ticket publishes.
// Once published, view-binding failures are fatal; never retry the committed entry.
function bindSession(candidate, views) {
  battleHandoff?.cancel();
  battleLoadAttempt = null;
  game = candidate.field;
  images = views.images;
  commands = new GameCommands(flow, candidate);
  menuCommandsReady = null;
  renderer = views.field;
  minimapRenderer = views.minimap;
  overviewRenderer = views.overview;
  mapLoadFailure = null;
  mapOpen = false;
  last = lastMinimapFrame = 0;
  held.clear();
  battleView?.hide();
  const battleOwnerReady = () => !failed && !document.hidden && flow.currentSession === candidate &&
    flow.inputReady && battleView?.instance === candidate.battle;
  const commandOptions = { commands, owner: candidate };
  equipmentView = new EquipmentView($("equipment-menu"), () => {
    inventoryView.render(flow.session);
    syncSaveControls();
  }, commandOptions);
  partyView = new PartyView($("party-menu"), () => {
    inventoryView.render(flow.session);
    equipmentView.render(flow.session);
    syncSaveControls();
  }, commandOptions);
  shopView = new ShopView($("shop-menu"), () => {
    held.clear();
    sync();
    if (!game.currentShop) focus();
  }, commandOptions);
  battleView = new BattleView(canvas, candidate.battleCatalog.common, images,
    () => {
      if (!battleOwnerReady()) return;
      if (["victory", "escaped"].includes(candidate.battle?.phase)) loadBattle(candidate, "return");
    },
    () => { if (battleOwnerReady()) loadBattle(candidate, "retry"); },
    battleAppearanceQuads, projectDevelopmentBattleLayout, {
      canRequest: () => battleOwnerReady() && commands.canEscape(candidate.battle),
      request: () => {
        if (!battleOwnerReady() || !commands.canEscape(candidate.battle)) return false;
        try {
          const requested = commands.requestEscape(candidate.battle);
          if (requested) { sync(); focus(); }
          return requested;
        } catch (error) { failure(error); return false; }
      },
    }, commandOptions);
  inventoryView = new InventoryView($("pause"), candidate.battleCatalog.gameState.items,
    () => { equipmentView.render(flow.session); syncSaveControls(); }, commandOptions);
  equipmentView.reset(); partyView.reset(); choiceView.reset(); shopView.reset();
  for (const id of ["welcome", "pause", "stop", "dialogue", "map-overview", "minimap-button"])
    $(id).hidden = true;
  $("menu-button").disabled = false;
  $("menu-button").textContent = "暂停";
  canvas.setAttribute("aria-label", `${game.content.map.id} 游戏画面。方向键移动，空格确认，Escape 暂停。`);
  showLimitations();
}
async function reset() {
  if (contents.hasInitializedEntry) return startInitializedGame();
  if (!contentReady || !contents.hasDevelopmentEntry || failed || flow.busy) return;
  const outgoingOwner = flow.currentSession;
  const operation = beginEntryLoad("new-game", systemsPlayground ? "正在准备系统演示…" : "正在准备开发片段…");
  const preferences = flow.currentSession?.battlePreferences;
  let published = false;
  try {
    const result = await operation.prepare(async (context) => {
      const current = () => { if (!context.isCurrent()) throw new Error("Game entry cancelled"); };
      audio.reset();
      await audio.unlock(); current();
      const { repository, release } = await contentHistory.openCurrent(); current();
      const { field, battle, development } = await repository.opening(); current();
      const candidate = development
        ? await prepareGameDevelopmentEntry(field, battle, development.catalog, development.map, runtime)
        : new GameSession(field, battle, undefined, runtime);
      current();
      if (preferences) candidate.setBattlePreferences(preferences);
      contentSessions.registerCandidate(candidate, repository, release);
      const nextImages = imagesFor(repository);
      await audio.prepare(audioProjection(candidate.field), candidate.field.pendingAudioTracks, track => audioFile(release, track)); current();
      await loadImages(fieldMediaUrls(candidate.field.content), release, nextImages); current();
      return { session: candidate, presentation: prepareSessionViews(candidate, nextImages) };
    });
    if (result.status === "cancelled") return;
    if (result.status === "failed") { entryLoadFailed(operation, result.error); return; }
    published = true;
    bindSession(result.session, result.presentation);
    if (preview) game.previewMap(preview.mapId, preview.entrance);
    focus(); sync();
  } catch (error) {
    if (published || entryLoad === operation && flow.currentSession !== outgoingOwner) failure(error);
    else entryLoadFailed(operation, error);
  } finally { finishEntryLoad(operation); }
}
async function startInitializedGame() {
  if (!contentReady || !contents.hasInitializedEntry || failed || flow.busy) return;
  const outgoingOwner = flow.currentSession;
  const operation = beginEntryLoad("new-game", packageSelection?.packageId === "systems-initialized"
    ? "正在准备系统演示…" : worldTravel ? "正在准备世界旅行…" : "正在准备来源地点…");
  const preferences = flow.currentSession?.battlePreferences;
  let published = false;
  try {
    const result = await operation.prepare(async (context) => {
      const current = () => { if (!context.isCurrent()) throw new Error("Game entry cancelled"); };
      audio.reset();
      await audio.unlock(); current();
      const { repository, release } = await contentHistory.openCurrent(); current();
      const { content, catalog, map, battle } = await repository.initializedNewGame(); current();
      // The entry declares a real initializer and an authored route. It does
      // not borrow the source title/fade launch or seed a development save.
      const candidate = await GameSession.prepareFrameworkNewGame(content, catalog, map, battle, runtime);
      current();
      if (preferences) candidate.setBattlePreferences(preferences);
      contentSessions.registerCandidate(candidate, repository, release);
      const nextImages = imagesFor(repository);
      await audio.prepare(audioProjection(candidate.field), candidate.field.pendingAudioTracks, track => audioFile(release, track)); current();
      await loadImages(fieldMediaUrls(candidate.field.content), release, nextImages); current();
      return { session: candidate, presentation: prepareSessionViews(candidate, nextImages) };
    });
    if (result.status === "cancelled") return;
    if (result.status === "failed") { entryLoadFailed(operation, result.error); return; }
    published = true;
    bindSession(result.session, result.presentation);
    focus(); sync();
  } catch (error) {
    if (published || entryLoad === operation && flow.currentSession !== outgoingOwner) failure(error);
    else entryLoadFailed(operation, error);
  } finally { finishEntryLoad(operation); }
}
async function startSourceGame() {
  if (!contentReady || !contents.hasSourceEntry || failed || flow.busy || sourceBoot) return;
  const operation = beginEntryLoad("new-game", "正在准备新游戏…");
  try {
    audio.reset();
    await audio.unlock();
    if (!operation.isCurrent()) return;
    const { repository, release } = await contentHistory.openCurrent();
    if (!operation.isCurrent()) return;
    const entryContent = await repository.sourceNewGame();
    const { content: bundle, catalog, map, battle } = entryContent;
    if (!operation.isCurrent()) return;
    const presentation = createSourcePresentationContext({ kind: "title-new-game",
      titleCleanupComplete: true, openingCallbackStarted: false });
    const entry = new NewGameFieldEntry(bundle.entry, presentation);
    // This is the visible Web title's actual clear overlay, not a guessed native prefab.
    const titleFade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
      rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
    const start = entry.prepareStart(titleFade, { active: true, callbacks: "absent" });
    start.commit();
    if (!operation.isCurrent()) return;
    const boot = { bundle, battle, presentation, entry, fade: start.fade, ready: false, catalog, map, operation, repository, release,
      outgoingOwner: flow.currentSession };
    sourceBoot = boot;
    held.clear();
    text("status", "正在准备新游戏…");
    if (!map.map) throw new Error("新游戏地图几何未完成。");
    await loadImages(sourceEntryMediaUrls(entryContent, { includeBattle: false }), release, imagesFor(repository));
    if (sourceBoot !== boot || !operation.isCurrent()) return;
    boot.ready = true;
  } catch (error) {
    entryLoadFailed(operation, error);
  }
}
function advanceSourceBoot(seconds) {
  const boot = sourceBoot;
  if (!boot || !boot.operation.isCurrent()) return;
  let published = false;
  try {
    boot.fade.advance(seconds);
    const next = boot.entry.prepareResume(boot.fade, boot.ready);
    if (next) { next.commit(); boot.fade = next.fade; }
    if (boot.entry.phase !== "field-preparing" || !boot.ready) return;
    const candidate = GameSession.prepareNewGame(boot.bundle, boot.catalog, boot.map, boot.battle,
      boot.fade, boot.presentation, runtime);
    contentSessions.registerCandidate(candidate, boot.repository, boot.release);
    const views = prepareSessionViews(candidate, imagesFor(boot.repository));
    const launch = boot.entry.prepareLaunch(boot.fade, candidate.newGamePreparation(true));
    candidate.launchNewGame(launch.launch);
    launch.commit();
    const result = boot.operation.commit({ session: candidate, presentation: views });
    if (result.status === "cancelled") { finishEntryLoad(boot.operation); return; }
    if (result.status === "failed") { entryLoadFailed(boot.operation, result.error); return; }
    published = true;
    bindSession(candidate, views);
    finishEntryLoad(boot.operation);
    focus(); sync();
  } catch (error) {
    if (published || sourceBoot === boot && flow.currentSession !== boot.outgoingOwner) failure(error);
    else entryLoadFailed(boot.operation, error);
  }
}
function returnToTitle() {
  mapLoader.cancel();
  battleHandoff?.cancel();
  battleLoadAttempt = null;
  eventSaver?.cancel();
  eventSaveFailure = null;
  mapLoadFailure = null;
  flow.returnToTitle();
  if (entryLoad) finishEntryLoad(entryLoad);
  sourceBoot = null;
  audio.reset();
  held.clear();
  mapOpen = false;
  last = 0;
  for (const id of ["pause", "stop", "dialogue", "map-overview", "minimap-button", "shop-menu", "event-saving", "battle-loading"])
    $(id).hidden = true;
  battleView?.hide();
  shopView?.reset();
  choiceView?.reset();
  $("welcome").hidden = false;
  $("load-error").hidden = true;
  $("entry-error").hidden = true;
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
  syncEventSave();
  syncBattleLoad();
  if (!flow.started || !game) {
    choiceView?.reset(); shopView?.reset();
    $("map-button").disabled = true;
    $("menu-button").disabled = true;
    $("minimap-button").hidden = true;
    $("map-overview").hidden = true;
    text("map-label", "游戏标题");
    return;
  }
  // A restored paused owner becomes ready on its first host observation.
  // Refresh only when that admission changes; do not rebuild focused menus each frame.
  if (flow.paused && menuCommandsReady !== commands.menuReady) {
    menuCommandsReady = commands.menuReady;
    inventoryView.render(flow.session);
    equipmentView.render(flow.session);
    partyView.render(flow.session);
  }
  const mapFailure = mapLoadFailure?.session === flow.session && mapLoadFailure.request === game.stop
    ? mapLoadFailure : null;
  choiceView?.render(flow, { disabled: failed || document.hidden || mapOpen });
  if (game.choicePending) held.clear();
  shopView?.render(
    flow.session,
    flow.inputReady && !document.hidden && !flow.session.battle && !game.stop,
  );
  const mapName = game.content.map.id;
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
  syncFieldMessageView({ dialogue: $("dialogue"), speaker: $("speaker"), message: $("message"), next: $("next") }, game, flow.paused);
  $("stop").hidden = !game.stop || battleLoadAttempt?.session === flow.currentSession;
  $("retry-map").hidden = !mapFailure;
  $("retry-map").disabled = failed || flow.busy;
  const encounterFailure = flow.session.encounterPreparationError;
  $("retry-encounter").hidden = !encounterFailure;
  $("retry-encounter").disabled = failed || flow.busy;
  $("retry").hidden = game.stop?.kind === "map-transition";
  if (game.stop) {
    held.clear();
    text(
      "stop-title",
      mapFailure ? "地图载入失败" : encounterFailure ? "战斗准备失败" : game.stop.kind === "map-transition" ? "正在载入地图" : "此处尚未迁移",
    );
    text("stop-message", mapFailure ? `当前进度已保留，可以重试。${mapFailure.error?.message ?? String(mapFailure.error)}` :
      encounterFailure ? `当前位置与遇敌结果已保留。${encounterFailure}` : game.stop.message);
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
        ? mapFailure ? "地图载入失败，进度已保留。" : "地图载入中…"
        : "当前片段已停止，可重新开始。"
      : game.currentShop
        ? "选择商品和数量，Esc 返回或离开商店"
        : game.choice
          ? "方向键选择，空格 / Enter 确认"
        : game.dialogue || game.sourceMessage.projection?.acceptsInput
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
  flow?.observeHost({ visible: !document.hidden, mediaReady: false, overlayOpen: mapOpen });
  if (document.hidden && flow?.started) pause(true);
});
canvas.addEventListener("blur", () => held.clear());
canvas.addEventListener("click", focus);
$("start").onclick = reset;
$("source-start").onclick = startSourceGame;
$("restart").onclick = reset;
$("retry").onclick = reset;
$("retry-encounter").onclick = () => {
  if (failed || !flow.started || flow.busy) return;
  loadBattle(flow.session, "start");
};
$("retry-battle-load").onclick = () => {
  const attempt = battleLoadAttempt;
  if (attempt && attempt.session === flow.currentSession && !attempt.running && !flow.busy)
    loadBattle(attempt.session, attempt.kind);
};
$("cancel-battle-load").onclick = cancelBattleLoad;
$("battle-load-title").onclick = returnToTitle;
$("retry-map").onclick = () => {
  if (failed || !flow.started || flow.busy || mapLoadFailure?.session !== flow.session || mapLoadFailure.request !== game.stop) return;
  try {
    audio.reset();
    loadMap(flow.session);
  } catch (error) { failure(error); }
};
$("return-title").onclick = returnToTitle;
$("stop-title-return").onclick = returnToTitle;
$("cancel-entry-load").onclick = cancelEntryLoad;
$("resume").onclick = () => pause(false);
$("menu-button").onclick = () => pause(!flow.paused);
$("battle-mode").onchange = () => {
  if (!commands?.settingsReady) return;
  commands.menu({ kind: "set-preferences", preferences: { ...flow.session.battlePreferences, mode: $("battle-mode").value } });
  sync();
};
$("battle-speed").onchange = () => {
  if (!commands?.settingsReady) return;
  commands.menu({ kind: "set-preferences", preferences: { ...flow.session.battlePreferences, speedIndex: Number($("battle-speed").value) } });
  sync();
};
$("save-game").onclick = saveGame;
$("load-game").onclick = () => loadGame(false);
$("load-start").onclick = () => loadGame(false);
$("load-previous").onclick = () => loadGame(true);
$("retry-event-save").onclick = () => saveEventProgress();
$("event-save-title").onclick = returnToTitle;
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
  if (!game?.currentShop) focus();
};
function frame(now) {
  if (failed) return;
  try {
    const dt = last ? Math.min(50, now - last) : 0;
    last = now;
    if (sourceBoot && !document.hidden) advanceSourceBoot(dt / 1000);
    // The current I/O operation owns candidate media failures. Polling a
    // shared failed decode from the outgoing field would bypass map retry.
    const battlePreparing = battleLoadAttempt?.session === flow.currentSession;
    const ready = flow.started && !flow.busy && !battlePreparing && game.stop?.kind !== "map-transition" &&
      audio.ready(audioProjection(game), game.pendingAudioTracks);
    flow.advance(dt, { visible: !document.hidden, mediaReady: ready, overlayOpen: mapOpen });
    if (flow.started && !sourceBoot) {
      if (flow.session.eventSaveRequest && !attemptedEventSaves.has(flow.session.eventSaveRequest))
        saveEventProgress();
      if (held.size) flow.move([...held.values()].at(-1));
      if (game.stop?.kind === "map-transition" && !loading.has(game.stop))
        loadMap(flow.session);
      if (!flow.busy && !flow.session.battle && game.stop?.kind === "encounter" &&
          !attemptedBattleStarts.has(game.stop)) {
        attemptedBattleStarts.add(game.stop);
        loadBattle(flow.session, "start");
      }
      sync();
    }
    const projection = flow.started ? audioProjection(game) : [];
    const audioReady = flow.started && !flow.busy && !battlePreparing && game.stop?.kind !== "map-transition" &&
      audio.ready(projection, game.pendingAudioTracks);
    audio.project(
      projection,
      audioReady &&
        !failed &&
        !flow.busy &&
        !flow.session.eventSaveRequest &&
        !flow.paused &&
        !mapOpen &&
        !document.hidden &&
        (!game.stop || !!flow.session.battle),
      game?.pendingAudioTracks ?? [],
    );
    text(
      "music-status",
      flow.started ? audio.status(audioReady, projection.length > 0) : "",
    );
    if (flow.started && flow.session.battle) {
      battleView.draw(flow.session.battle);
      drawStoryTimer(canvas.getContext("2d"), canvas.width, game.timerProjection);
    }
    else if (renderer && game) renderer.draw(game);
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
  try { battleHandoff?.cancel(); } catch { /* Preserve the original failure. */ }
  battleLoadAttempt = null;
  try { flow?.returnToTitle(); } catch { /* An in-progress publication cannot be cancelled; preserve the fatal error. */ }
  if (entryLoad) finishEntryLoad(entryLoad);
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
    "event-saving",
    "battle-loading",
  ])
    $(id).hidden = true;
  $("menu-button").disabled = true;
  $("map-button").disabled = true;
  $("welcome").hidden = false;
  $("load-error").hidden = false;
  $("load-error").textContent = String(error.message ?? error);
  $("start").disabled = true;
  $("source-start").disabled = true;
  $("start").textContent = "载入失败";
  text("status", "发生错误，已停止运行。");
}
async function init() {
  // A title does not own game state or depend on any playable content package.
  flow = new GameFlow();
  entryLoader = new GameEntryLoader(flow, {
    // These views borrow immutable media and own no private GPU or audio resources.
    discard: () => {},
  });
  packageSelection = selectGamePackage(location.search);
  const { packageId } = packageSelection;
  let configuredRefs;
  systemsPlayground = packageId === "systems-playground";
  worldTravel = packageId === "world-travel";
  contentProfile = packageSelection.profile;
  contents = new GameContentRepository(readGameJson, contentProfile);
  contentReady = packageId === null;
  if (packageId !== null) {
    // The host selects an authored same-origin package. Saved state never
    // supplies its URLs or changes the declared source/development profile.
    const refs = parseGameContentRefs(await readGameJson(`/content-packages/${packageId}.json`));
    configuredRefs = refs;
    if (packageSelection.explicitProfile && refs.profile !== contentProfile)
      throw new Error("Content package profile mismatch");
    contentProfile = refs.profile;
    contents = new GameContentRepository(readGameJson, contentProfile, refs);
    contentReady = true;
  }
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
  contentHistory = new GameContentHistory({ current: contents, profile: contentProfile, loadJson: readGameJson,
    ...(packageId === null ? {} : { packageId, refs: configuredRefs }) });
  contentSessions = new GameContentSessions(flow, contents);
  imageSets.set(contents, currentImages);
  mapLoader = new GameMapLoader(flow, contentSessions, {
    prepare: async (field) => {
      await audio.prepare(audioProjection(field), field.pendingAudioTracks);
      await loadImages(fieldMediaUrls(field.content));
      return new Renderer(canvas, field.content, images);
    },
    // Renderers only reference shared immutable images; they have no private GPU resources.
    discard: () => {},
  });
  battleHandoff = new GameBattleHandoff(flow, {
    prepareStart: async (candidate) => {
      const owner = flow.session;
      await audio.prepare(audioProjection(owner.field), owner.field.pendingAudioTracks);
      const content = candidate.content;
      if (!content.sprites[content.background]) throw new Error("战斗背景资源尚未迁移。");
      await loadImages(candidate.mediaUrls);
      return { kind: "battle" };
    },
    prepareReturn: async () => {
      const field = flow.session.field;
      await audio.prepare(audioProjection(field), field.pendingAudioTracks);
      await loadImages(fieldMediaUrls(field.content));
      return { kind: "field", renderer: new Renderer(canvas, field.content, images) };
    },
    // Prepared views borrow the image cache and own no audio or GPU state.
    discard: () => {},
  });
  choiceView = new ChoiceView($("choice-panel"), () => {
    held.clear();
    sync();
    if (!game.choice) focus();
  });
  if (!contents.hasInitializedEntry) {
    text("welcome-title", "FINAL FANTASY VI · 原迁移样本");
    text("welcome-description", "从故事开头运行，或进入纳尔谢开发片段。");
    text("welcome-scope", "原版剧情迁移尚未完成，遇到未实现内容会明确停止；本地进度与系统版、世界旅行各自独立。");
  }
  if (contentProfile === "framework") {
    text("welcome-scope", "可从故事开头运行；当前开发版采用简化的环境与骑乘演出，剧情与游戏系统仍在迁移中。");
    text("source-start", "从头开始（框架开发版）");
  }
  if (systemsPlayground) {
    text("welcome-title", "游戏系统演示");
    text("welcome-description", "进入后向上走一格，按空格 / Enter 继续对话并进入第一战。");
    text("welcome-scope", "使用来源开发队伍和作者编排的演示事件，拥有独立本地存档。战后打开暂停菜单，可使用道具、调整队伍、保存并恢复；继续后向右走一步过门，再向上走进入第二战。");
  }
  if (contents.hasInitializedEntry) {
    text("welcome-title", "来源地点 · 内容批次");
    text("welcome-description", "探索来源地点，使用方向键移动并与面前的角色交谈；可打开菜单保存和读取进度。");
    text("welcome-scope", "使用新游戏初始化数据与明确的起始地点，完整剧情和部分玩法仍在迁移。各内容包的本地进度独立。");
    text("systems-playground-help", "方向键移动，Enter / 空格与面前的角色交谈；Esc 打开队伍、装备、物品和保存菜单。读取进度后可继续探索。");
    if (packageId === "systems-initialized") {
      text("welcome-title", "游戏系统演示");
      text("welcome-description", "购买道具、装备魔石并练习战斗；探索时可打开暂停菜单，查看学习进度、保存和恢复。");
      text("welcome-scope", "使用新游戏初始化数据与作者编排的演示事件，拥有独立本地存档，不代表原剧情进度。");
      text("systems-playground-help", "游戏系统演示：起点上方是战斗训练，右侧是商店，下方可领取魔石。按方向键面向设施，再按 Enter / 空格交互。按 Esc 打开菜单，可换装、编队、使用道具或魔法、装备魔石和存读档。先升级与回复，再挑战魔法学习训练。");
    }
  }
  if (worldTravel) {
    text("welcome-title", "世界旅行演示");
    text("welcome-description", "探索世界地图、进入纳尔谢，再从入口返回；可随时打开菜单保存旅行进度。");
    text("welcome-scope", "使用原版地图地形与新游戏初始角色，采用独立演示路线和平面画面，拥有独立本地存档。");
    text("systems-playground-help", "世界旅行：起点向北一步进入纳尔谢，面向入口南侧按 Enter / 空格返回世界。方向键移动，Esc 打开菜单，可查看队伍、使用道具或魔法、保存和读取进度。");
  }
  if (packageId === "figaro-initialized") {
    text("welcome-title", "费加罗 · 来源内容批次");
    text("welcome-description", "探索两张相连地图，与原 NPC 对话；菜单可保存、读取后继续。");
    text("welcome-scope", "保留原地图、NPC、对白与出口。使用新游戏初始队伍，并直接放置到这里测试；不代表原剧情已经到达费加罗。拥有独立本地进度。");
    text("systems-playground-help", "方向键移动，Enter / 空格与面前的角色交谈；Esc 打开队伍、装备、物品和保存菜单。两张地图保留原出口，可往返并读档继续。");
  }
  for (const [id, active] of [["systems-playground-link", packageId === "systems-initialized"],
    ["world-travel-link", worldTravel], ["source-content-link", packageId === "figaro-initialized"],
    ["source-sample-link", packageId === null]]) {
    $(id).setAttribute("aria-current", active ? "page" : "false");
  }
  $("systems-playground-help").hidden = !systemsPlayground && !contents.hasInitializedEntry;
  if (preview && !contents.hasInitializedEntry) {
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
  const canStart = contents.hasDevelopmentEntry || contents.hasInitializedEntry;
  $("start").hidden = !canStart;
  $("source-start").hidden = !contents.hasSourceEntry;
  $("restart").hidden = !canStart;
  $("retry").hidden = !canStart;
  $("start").disabled = !canStart;
  $("source-start").disabled = !contents.hasSourceEntry;
  await refreshSaveInfo();
  text("start", worldTravel ? "开始世界旅行" : packageId === "systems-initialized" || systemsPlayground ? "开始系统演示" : contents.hasInitializedEntry ? "进入来源地点" : preview ? "进入地图预览" : packageId !== null ? "进入开发片段" : "进入纳尔谢");
  sync();
  text("status", "选择开始游戏或继续本地进度。");
  requestAnimationFrame(frame);
}
function showLimitations() {
  $("limitations").replaceChildren();
  for (const line of [
    game.content.entry.description,
    ...game.content.limitations,
    ...(game.content.map.nativeComposition ? ["原生普通角色的身体和头部已接入来源合成；角色阴影仍缺失，属于当前开发版的画面偏差。"] : []),
    ...flow.session.battleCatalog.common.limitations,
  ]) {
    const li = document.createElement("li");
    li.textContent = line;
    $("limitations").append(li);
  }
}
async function loadImages(urls, release = contentSessions?.release ?? null, target = images) {
  await Promise.all(
    [...urls]
      .filter((url) => !target.has(url))
      .map(async (url) => {
        const img = new Image();
        if (release === null) { img.src = url; await img.decode(); }
        else {
          const reference = resolveGameContentReleaseMedia(release, url);
          if (reference.extension !== "png") throw new Error("历史图片类型不匹配。");
          const response = await fetch(reference.url);
          if (!response.ok) throw new Error("历史图片资源载入失败。");
          const bytes = await response.arrayBuffer();
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
            .map(value => value.toString(16).padStart(2, "0")).join("");
          if (hash !== reference.sha256) throw new Error("历史图片资源摘要不匹配。");
          const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
          try { img.src = objectUrl; await img.decode(); }
          finally { URL.revokeObjectURL(objectUrl); }
        }
        target.set(url, img);
      }),
  );
}
function syncBattleLoad() {
  const attempt = battleLoadAttempt;
  const current = attempt && flow.started && flow.currentSession === attempt.session;
  $("battle-loading").hidden = !current;
  if (!current) return;
  text("battle-loading-message", attempt.running
    ? attempt.kind === "return" ? "正在返回探索…" : "正在准备战斗…"
    : attempt.cancelled ? "准备已取消" : "准备失败，可以重试");
  text("battle-loading-error", attempt.error?.message ?? (attempt.error ? String(attempt.error) : ""));
  $("retry-battle-load").hidden = attempt.running;
  $("retry-battle-load").disabled = failed || flow.busy;
  $("cancel-battle-load").hidden = !attempt.running;
}
function cancelBattleLoad() {
  const attempt = battleLoadAttempt;
  if (!attempt || !attempt.running || attempt.session !== flow.currentSession) return;
  battleHandoff.cancel();
  attempt.running = false;
  attempt.cancelled = true;
  sync(); syncSaveControls();
}
async function loadBattle(owner, kind) {
  if (failed || !flow.started || flow.busy || flow.currentSession !== owner) return;
  const previous = battleLoadAttempt;
  const attempt = { session: owner, kind, running: true, cancelled: false, error: null };
  battleLoadAttempt = attempt;
  held.clear();
  try {
    // The same audio owner recorded the failed decode. An explicit retry
    // clears that failure and reprojects the held field clock after readiness.
    if (previous?.session === owner && previous.error) audio.reset();
    const pending = kind === "return" ? battleHandoff.return() :
      kind === "retry" ? battleHandoff.retry() : battleHandoff.start();
    sync(); syncSaveControls();
    const result = await pending;
    if (battleLoadAttempt !== attempt || !flow.started || flow.currentSession !== owner) return;
    attempt.running = false;
    if (result.status === "cancelled") {
      attempt.cancelled = true; sync(); return;
    }
    if (result.status === "failed") {
      attempt.error = result.error; sync(); return;
    }
    // Publication has completed. A presentation error here must never replay
    // the request, lease, source continuation or battle settlement.
    battleLoadAttempt = null;
    if (result.presentation.kind === "field") {
      game = owner.field;
      renderer = result.presentation.renderer;
      setupMapViews(game.content);
    }
    last = 0;
    sync();
    if (!flow.paused && !document.hidden) focus();
  } catch (error) {
    failure(error);
  } finally {
    syncSaveControls();
  }
}
async function loadMap(owner) {
  if (flow.busy || flow.session !== owner || owner.field.stop?.kind !== "map-transition") return;
  const request = owner.field.stop;
  loading.add(request);
  mapLoadFailure = null;
  held.clear();
  try {
    const pending = mapLoader.load();
    syncSaveControls();
    const result = await pending;
    if (result.status === "cancelled") return;
    if (result.status === "failed") {
      if (flow.session !== result.session || result.session.field.stop !== result.request || !flow.started) return;
      mapLoadFailure = result;
      contents.clear();
      sync();
      return;
    }
    // The coordinator has committed. UI failures from here are fatal, never a
    // reason to replay the old request or publish its rewards a second time.
    if (flow.session !== result.session || result.session.field !== result.field || !flow.started) return;
    game = result.field;
    renderer = result.presentation;
    setupMapViews(game.content);
    held.clear();
    last = 0;
    canvas.setAttribute("aria-label", `${game.content.map.id} 游戏画面。方向键移动，空格确认，Escape 暂停。`);
    showLimitations();
    sync();
    if (!flow.paused && !document.hidden) focus();
  } catch (error) {
    failure(error);
  } finally {
    syncSaveControls();
  }
}
function syncSaveControls() {
  const owner = flow.currentSession;
  // Menu actions must not mutate the outgoing owner during asynchronous saves
  // or while a replacement session is being prepared.
  $("pause").inert = flow.busy;
  $("pause").setAttribute("aria-busy", String(flow.busy));
  if (owner && flow.started) partyView?.render(owner, { disabled: failed || flow.busy });
  $("save-game").disabled =
    failed || !flow.started || flow.busy || !owner?.checkpointReady;
  $("load-game").disabled = failed || flow.busy || !hasSave;
  $("load-start").disabled = failed || flow.busy || !hasSave;
  $("load-previous").disabled = failed || flow.busy || !hasPreviousSave;
  for (const id of ["resume", "restart", "start", "source-start", "return-title"])
    $(id).disabled = failed || flow.busy;
  $("start").disabled ||= !contentReady || !(contents.hasDevelopmentEntry || contents.hasInitializedEntry);
  $("restart").disabled ||= !contentReady || !(contents.hasDevelopmentEntry || contents.hasInitializedEntry);
  $("source-start").disabled ||= !contentReady || !contents.hasSourceEntry;
  $("stop-title-return").disabled = failed;
  $("cancel-entry-load").disabled = failed;
  $("save-game").title = owner?.checkpointReady
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
  if (!flow.started || flow.busy || !flow.session.checkpointReady) return;
  const operation = flow.beginOperation("save");
  let prepared;
  syncSaveControls();
  try {
    prepared = await checkpointStorage().prepareSave(flow.session.checkpoint(), Date.now());
    if (!operation.isCurrent()) return;
    prepared.commit();
    await refreshSaveInfo();
    if (!operation.isCurrent()) return;
    text("save-status", "进度已保存在此浏览器，刷新后可继续。");
  } catch (error) {
    if (!operation.isCurrent()) return;
    text("save-status", `保存失败，原存档未替换：${error.message ?? error}`);
  } finally {
    prepared?.discard();
    operation.cancel();
    syncSaveControls();
  }
}
function syncEventSave() {
  const request = flow?.started ? flow.currentSession?.eventSaveRequest : null;
  $("event-saving").hidden = !request;
  if (!request) return;
  const problem = eventSaveFailure?.request === request ? eventSaveFailure.error : null;
  text("event-save-message", problem
    ? `保存失败，剧情已停在此处。重试后继续：${problem.message ?? problem}`
    : "正在保存进度…");
  $("retry-event-save").hidden = !problem;
  $("retry-event-save").disabled = failed || flow.busy;
  $("event-save-title").disabled = failed;
}
async function saveEventProgress() {
  const owner = flow.currentSession, request = owner?.eventSaveRequest;
  if (failed || !flow.started || flow.busy || !request) return;
  attemptedEventSaves.add(request);
  eventSaveFailure = null;
  held.clear();
  try {
    try { eventSaver ??= new GameEventSaveCoordinator(flow, checkpointStorage()); }
    catch (error) { eventSaveFailure = { request, error }; return; }
    const pending = eventSaver.save(Date.now());
    syncSaveControls(); syncEventSave();
    const result = await pending;
    if (result.status === "cancelled") return;
    if (result.status === "failed") {
      if (flow.started && flow.currentSession === owner && owner.eventSaveRequest === request)
        eventSaveFailure = { request, error: result.error };
      return;
    }
    await refreshSaveInfo();
  } catch (error) {
    // After a successful write, an ACK or UI failure must not offer replay.
    failure(error);
  } finally {
    syncEventSave(); syncSaveControls();
  }
}
async function loadGame(previous) {
  if (!contentReady) return;
  if (failed || flow.busy) return;
  const outgoingOwner = flow.currentSession;
  const operation = beginEntryLoad("load", "正在读取进度…");
  let published = false;
  syncSaveControls();
  if (flow.started) text("save-status", "正在读取进度…");
  try {
    const result = await operation.prepare(async (context) => {
      const current = () => { if (!context.isCurrent()) throw new Error("Game entry cancelled"); };
      // Initialize decoding on the click. Playback resumes through Continue.
      audio.initialize();
      audio.reset();
      const saved = await checkpointStorage().load(previous); current();
      if (!saved) throw new Error("尚无此本地进度。");
      const restored = await contentHistory.restoreSessionContent(saved.checkpoint, { pinCurrent: true }); current();
      const { initial, battle, world } = restored.content;
      const candidate = GameSession.restore(saved.checkpoint, initial, battle, world, runtime);
      contentSessions.registerCandidate(candidate, restored.repository, restored.release);
      const nextImages = imagesFor(restored.repository);
      await audio.prepare(audioProjection(candidate.field), candidate.field.pendingAudioTracks,
        track => audioFile(restored.release, track)); current();
      await loadImages(fieldMediaUrls(candidate.field.content), restored.release, nextImages); current();
      return { session: candidate, presentation: prepareSessionViews(candidate, nextImages), options: { paused: true } };
    });
    if (result.status === "cancelled") return;
    if (result.status === "failed") throw result.error;
    published = true;
    bindSession(result.session, result.presentation);
    audio.reset();
    finishEntryLoad(operation);
    pause(true);
    text(
      "save-status",
      previous ? "已读取上一份进度，点击继续。" : "进度已读取，点击继续。",
    );
  } catch (error) {
    if (published || entryLoad === operation && flow.currentSession !== outgoingOwner) { failure(error); return; }
    if (entryLoad !== operation) return;
    contents.clear();
    const reason =
      /(?:source|kind)\/version mismatch|source identity|Content identity mismatch/i.test(
        error.message ?? "",
      )
        ? "这份存档与当前游戏内容版本不同，暂时无法读取。原存档已保留。"
        : `读取失败，当前游戏和存档仍保留：${error.message ?? error}`;
    if (flow.started) text("save-status", reason);
    entryLoadFailed(operation, error, reason);
  } finally {
    finishEntryLoad(operation);
  }
}
init().catch(failure);
