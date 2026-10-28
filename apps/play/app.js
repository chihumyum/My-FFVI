import { tr } from "../../src/play/i18n.js";
import { language, setLanguage } from "../../src/play/i18n.js";
import { operaAudioLanguage } from "../../src/play/languages.js";
import { mountLanguageControl } from "./language.js";
import { localizeGame, localizeSave } from "../../src/play/localized-data.js";
import { quickSaveKey } from "./identity.js";
import {
  playOptionLabels,
  readPlayOptions,
  savePlayOptions,
  simulationRepeats,
} from "./play-options.js";
import { WebData, webIndexURL } from "./data.js";
import { loading } from "./loading.js";
import { MapPreloader } from "./preload.js";
import { openFeedbackDialog } from "./feedback-dialog.js";
import "./touch-layout.css";
import { loadPresentation, loadBattlePresentation, presentText } from "./presentation.js";
import { SaveLibrary, renderSaveSlots } from "./saves.js";
import { CloudSaves } from "./cloud-saves.js";
import { mountCloudUI } from "./cloud-ui.js";
import { GameRenderer } from "./renderer.js";
import { GameUI, createWidget } from "./ui.js";
import { WebAudioPlayer } from "./audio.js";
import { createExtras } from "./extras.js";
import { OperaHost } from "./opera-host.js";
import { createEventHistory, describeBugState } from "./bug-report.js";
import {
  withPresentation,
  observingAudioInstruction,
  isAudioInstruction,
} from "./presentation-events.js";
import { createBattleMenu } from "./battle-menu.js";
import { BattleFlow } from "./battle-flow.js";
import { mapAudioCommands, legacySceneAudio } from "./scene-audio.js";
import { isTextEntry, mountTouchControls } from "./touch-controls.js";
import { buyFromShop, closeShop, openShop } from "../../src/play/event-systems.js";
import { submitPartyInput, cancelPartyInput } from "../../src/play/party-input.js";
import { partyInputMembers } from "../../src/play/party-input.js";
import {
  colosseumWagers,
  openColosseum,
  selectColosseumWager,
  selectColosseumChallenger,
  confirmColosseum,
  cancelColosseum,
} from "../../src/play/colosseum.js";
import {
  openVehicleInput,
  vehicleInputState,
  submitVehicleInput,
  closeVehicleInput,
} from "../../src/play/vehicle-input.js";
import { renderPartyMenu } from "./party-menu.js";
import { PlayGame } from "../../src/play/game.js";
import { advanceStory } from "../../src/play/story-route.js";
import { storyChoice } from "../../src/play/story-plan.js";
import { Battle } from "../../src/play/battle.js";
import { decodeAcceptanceState } from "./acceptance-state.js";
const canvas = document.getElementById("screen");
const renderer = new GameRenderer(canvas);
renderer.diagnostics.acceptance = new URLSearchParams(location.search).get("acceptance") === "1";
window.ffviRenderDiagnostics = () => renderer.diagnostics.summary();
window.ffviRenderMetrics = () => renderer.metrics();
await renderer.init();
const ui = new GameUI(renderer.layers.ui, (url, details) => renderer.getTexture(url, details));
window.ffviUIDiagnostics = () => ui.diagnostics();
const $ = (id) => ui.get(id) || document.getElementById(id);
let game,
  battleDialogue = null,
  paused = false,
  started = false,
  frame = 0,
  last = performance.now();
let repository;
let preloader,
  starting = false;
const createRepository = () => new WebData(webIndexURL(), { onProgress: loading.observe });
const playOptions = readPlayOptions();
const regression = new URLSearchParams(location.search).get("regression") === "boosted";
window.ffviPlayOptions = () => ({ ...playOptions });
function updatePlayOptions() {
  for (const [key, label] of Object.entries(playOptionLabels)) {
    const button = document.querySelector(`[data-play-option="${key}"]`);
    button.textContent = `${label}：${playOptions[key] ? tr("app.on") : tr("app.off")}`;
    button.setAttribute("aria-pressed", String(playOptions[key]));
  }
  document.body.classList.toggle("show-location", playOptions.showLocation);
  if (game) {
    game.assists = playOptions;
    if (game.battle) game.battle.context.assists = playOptions;
  }
  savePlayOptions(playOptions);
}
let data,
  battleData,
  walkClock = 0,
  autosavePending = false,
  titlePending = false;
const audio = new WebAudioPlayer();
const audioHistory = [];
const battleFlow = new BattleFlow({ audio, emit: (event) => renderer.event(event) });
window.ffviBattleFlow = () => battleFlow.diagnostics();
const opera = new OperaHost(renderer, audio);
renderer.onBattleSound = (id) =>
  audio
    .command({ name: "PlaySE", i: [id], r: [], s: [] })
    ?.catch?.((error) => audio.warn(error.message));
const saveLibrary = new SaveLibrary({ cloud: new CloudSaves() });
const menuState = { page: "队伍" };
const eventHistory = createEventHistory();
let reportingBug = false;
let acceptanceLoading = false;
let extrasReturn;
const extras = createExtras({
  ui,
  renderer,
  audio,
  game: () => game,
  onOpen: () => {
    extrasReturn = { paused, menu: $("menu").hidden, title: $("title").hidden };
    paused = true;
    $("menu").hidden = true;
    $("title").hidden = true;
  },
  onClose: () => {
    paused = extrasReturn.paused;
    $("menu").hidden = extrasReturn.menu;
    $("title").hidden = extrasReturn.title;
  },
});
$("extras-open").onclick = () => extras.open();
$("extras-close").onclick = () => extras.close();
const PresentationGame = withPresentation(PlayGame);
addEventListener("pointerdown", () => audio.unlock().catch((error) => audio.warn(error.message)));
addEventListener("keydown", () => audio.unlock().catch((error) => audio.warn(error.message)));
function presentation(command) {
  if (command.kind === "presentation-command") {
    renderer.event(command);
    return;
  }
  audioHistory.push({
    name: command.name,
    i: command.i,
    r: command.r,
    mapId: command.mapId ?? game?.mapId,
    script: command.script ?? game?.lastInstruction?.script,
    index: command.index ?? game?.lastInstruction?.index,
    time: game?.time,
  });
  if (audioHistory.length > 40) audioHistory.shift();
  battleFlow.audioCommand(command);
  const result = opera.command(
    command.name === "SyncBGM" && playOptions.fastForward
      ? { ...command, skipTrackEnd: true }
      : command,
  );
  result?.catch?.((error) => audio.warn(error.message));
}
function event(e) {
  eventHistory.record(e);
  if (["airship-motion", "vehicle", "vehicle-landing"].includes(e.kind)) renderer.event(e);
  if (e.kind === "opera" && !playOptions.fastForward) opera.play(e.stage);
  if (e.kind === "battle-message")
    battleDialogue = {
      key: e.key,
      text: presentText(game, e.text)
        .replace(/<[^>]*>/g, "")
        .replace(/\\n/g, "\n"),
      speaker: data.speakers[e.key] || "",
      choices: null,
    };
  if (e.kind === "battle-message-close" || e.kind === "battle-end") battleDialogue = null;
  if (e.kind === "map") {
    renderer.event(e);
    for (const command of mapAudioCommands(data.maps[e.mapId]))
      presentation({ ...command, mapId: e.mapId, script: "map.csv", index: null });
  }
  if (["battle", "battle-action", "battle-party", "battle-end", "battle-effect"].includes(e.kind))
    battleFlow.event(e, game?.battle);
  if ((e.kind === "bgm" || e.kind === "se") && !observingAudioInstruction(game)) {
    const engine = game?.battle?.events;
    const op = engine?.program?.ops?.[engine.pc - 1];
    if (op && isAudioInstruction(op[0]))
      presentation({ name: op[0], i: op[1], r: op[2], s: op[3] });
    else
      presentation({
        name: e.kind === "bgm" ? "PlayBGM" : "PlaySE",
        i: [e.id],
        r: [e.fade || 0],
      });
  }
  if (e.kind === "battle-effect") {
    if (isAudioInstruction(e.name)) presentation(e);
    else if (["Shake", "Flash", "ScreenEffect"].includes(e.name))
      renderer.event({ ...e, kind: "presentation-command" });
  }
  if (e.kind === "script") $("location").textContent = `${e.scene} · ${e.script}`;
  if (e.kind === "autosave" || e.kind === "save-menu") autosavePending = true;
  if (e.kind === "title-screen") titlePending = true;
  if (e.kind === "game-over") {
    $("over").hidden = false;
    $("over-message").textContent = e.reason;
  }
}
async function start(saved = null, testBoost = false) {
  starting = true;
  loading.begin(saved ? tr("app.loading_save_and_scene") : tr("app.preparing_new_game"));
  keys.clear();
  playOptions.story = false;
  updatePlayOptions();
  eventHistory.clear();
  audioHistory.length = 0;
  if (extras.active) extras.close();
  opera.reset();
  battleFlow.reset();
  renderer.heldBattle = null;
  renderer.resetPresentation();
  battleDialogue = null;
  $("new").disabled = true;
  try {
    await saveLibrary.beginSession(testBoost || !!saved?.testBoost);
    repository = createRepository();
    ({ data, battleData } = await repository.open(saved));
    opera.setRepository(repository);
    renderer.setAssets(repository.index.assets.images, repository.baseURL);
    await loadBattlePresentation(repository, renderer);
    audio.setAssets(repository.index.assets.audio, repository.baseURL);
    audio.setCatalog(data.audio);
    ui.setCharacters(battleData.characters);
    preloader = new MapPreloader(repository, renderer);
    game = new PresentationGame({
      onPresentation: presentation,
      yieldPresentation: (name) =>
        (name === "SyncBGM" && audio.syncPending) || (name === "PlayBGM" && audio.musicPending),
      onAudioSnapshot: () => ({
        ...audio.saveState(),
        ...(battleFlow.battle ? { music: battleFlow.previousMusic } : {}),
      }),
      data,
      battleData,
      Battle,
      testBoost: testBoost || !!saved?.testBoost,
      loadMap: (id) =>
        loading.task(
          tr("app.loading_value", {
            v0: ui.presentation.mapNames?.[id] || tr("app.the_next_scene"),
          }),
          () => repository.loadMap(id),
        ),
      onEvent: event,
      interactiveNames: true,
    });
    game.assists = playOptions;
    game.autoChoice = (g) => (playOptions.story ? storyChoice(g) : 0);
    window.ffvi = game;
    audio.playMusic(0);
    audio.stopEffects("environment");
    audio.savedMusic = null;
    if (saved) {
      await game.restore(saved, { testBoost });
      localizeGame(data, battleData, repository.currentLocale, game);
      if (saved.audio?.version === 1) await audio.restore(saved.audio);
      else {
        const commands = await legacySceneAudio(saved, { data, battleData, map: game.map });
        for (const command of commands) presentation(command);
      }
    } else await game.start();
    $("mode").hidden = !game.testBoost;
    started = true;
    autosavePending = false;
    titlePending =
      !!saved?.titleScreen ||
      (!!saved &&
        game.history.at(-1)?.script === "sc_e_1032_18" &&
        game.battles.some((b) => b.encounterId === 472 && b.outcome === "victory"));
    paused = false;
    audio.setVolume(game.settings.volume);
    menuState.page = "队伍";
    $("save").hidden = true;
    $("naming").hidden = true;
    $("over").hidden = true;
    $("menu").hidden = true;
    $("title").hidden = true;
  } catch (error) {
    loading.fail(error);
    $("message").textContent = error.message;
    $("dialogue").hidden = false;
    console.error(error);
  } finally {
    starting = false;
    $("new").disabled = false;
  }
}
function save() {
  openSaveMenu(true, game?.testBoost);
}
async function openSaveMenu(write, boost = false) {
  if (write && (!game || game.busy)) {
    $("location").textContent = tr("app.story_or_battle_in_progress_please_save_later");
    return;
  }
  paused = !!started;
  $("menu").hidden = true;
  $("title").hidden = true;
  $("save").hidden = false;
  $("save-heading").textContent =
    `${boost ? tr("app.story_test") : ""}${write ? tr("app.save") : tr("app.load")}`;
  $("save-status").textContent = tr("app.loading_save_slots");
  $("save-slots").replaceChildren();
  if (saveLibrary.cloud.enabled && navigator.onLine) await saveLibrary.sync();
  const quick = await saveLibrary.quick(boost);
  const refresh = async () => {
    const records = await saveLibrary.list(boost);
    $("save-slots").replaceChildren(
      ...renderSaveSlots(
        records,
        {
          write,
          boost,
          quick,
          display: (record) =>
            localizeSave(record, repository?.currentLocale || titleRepository.currentLocale),
        },
        createWidget,
        async (slot) => {
          try {
            if (write) {
              await saveLibrary.save(game, slot, ui.presentation.mapNames?.[game.mapId]);
              $("save-status").textContent = tr("app.saved_slot_value_value", {
                v0: slot,
                v1: ui.presentation.mapNames?.[game.mapId] || tr("app.current_location"),
              });
              await refresh();
            } else {
              const saved =
                slot === "quick"
                  ? await saveLibrary.quick(boost)
                  : await saveLibrary.load(boost, slot);
              if (saved) await start(saved, boost);
            }
          } catch (error) {
            $("save-status").textContent = error.message;
            console.error(error);
          }
        },
      ),
    );
  };
  try {
    await refresh();
    $("save-status").textContent = tr(
      "app.normal_and_story_test_saves_are_separate_with_12_slots_",
    );
  } catch (error) {
    $("save-status").textContent = error.message;
  }
}
$("save-close").onclick = () => {
  $("save").hidden = true;
  $("menu").hidden = !started;
  $("title").hidden = !!started;
  paused = !!started;
};
for (const key of Object.keys(playOptionLabels)) {
  const button = document.querySelector(`[data-play-option="${key}"]`);
  button.onclick = async () => {
    if (key === "story" && !playOptions.story) {
      if (!started || !game) return;
      const current = game;
      button.disabled = true;
      try {
        await repository?.preloadRegression();
      } catch (error) {
        $("bug-status").textContent = tr(
          "app.could_not_prepare_the_story_route_value_please_retry",
          { v0: error.message },
        );
        return;
      } finally {
        button.disabled = false;
      }
      if (game !== current) return;
    }
    playOptions[key] = !playOptions[key];
    keys.clear();
    updatePlayOptions();
  };
}
$("tools-close").onclick = () => {
  document.body.classList.remove("touch-tools-open");
  document.querySelector("[data-touch-tools]")?.setAttribute("aria-expanded", "false");
};
updatePlayOptions();
$("regression-start").hidden = !regression;
$("regression-start").onclick = () => start(null, true);
$("switch").onclick = () => game?.switchParty();
$("retry").onclick = () => {
  const bytes = localStorage.getItem(quickSaveKey(game?.testBoost));
  if (bytes) start(JSON.parse(bytes));
  else start(null, game?.testBoost);
};
$("new").onclick = () => start();
$("load").onclick = () => openSaveMenu(false, regression);
$("menu-save").onclick = save;
$("confirm").onclick = () => {
  if (!ui.revealDialogue()) {
    if (battleDialogue) battleDialogue = null;
    else game?.confirm();
  }
};
$("close").onclick = () => {
  paused = false;
  $("menu").hidden = true;
};
const keys = new Set();
async function reportBug() {
  if (reportingBug) return;
  reportingBug = true;
  const previousPause = paused,
    capturedGame = game,
    previousClock = renderer._previewClock;
  paused = true;
  renderer._previewClock = performance.now() / 1000;
  $("bug-status").textContent = tr("app.f9_capturing_game_state");
  try {
    renderer.render(started ? game : null, data, battleData);
    const report = describeBugState(game, renderer, eventHistory.read(), ui.presentation.mapNames);
    report.battlePresentation = battleFlow.diagnostics();
    report.playOptions = { ...playOptions };
    report.audio = { ...audio.snapshot(), commands: [...audioHistory] };
    report.screenshot = {
      mimeType: "image/png",
      dataURL: await renderer.captureFrame(),
    };
    const result = await openFeedbackDialog(report, { development: import.meta.env.DEV });
    $("bug-status").textContent =
      result.method === "cloud"
        ? tr("app.f9_sent_value", { v0: result.id })
        : result.method === "directory"
          ? tr("app.f9_saved_value", { v0: result.directory })
          : result.method === "download"
            ? tr("app.f9_downloaded_value", { v0: result.file })
            : tr("app.f9_cancelled");
  } catch (error) {
    $("bug-status").textContent = tr("app.f9_could_not_save_value", { v0: error.message });
    console.error("[bug-report]", error);
  } finally {
    if (game === capturedGame) paused = previousPause;
    renderer._previewClock = previousClock;
    reportingBug = false;
  }
}
$("bug-report").onclick = reportBug;
$("repository-open").onclick = () =>
  window.open("https://github.com/chihumyum/My-FFVI", "_blank", "noopener,noreferrer");
function gameKeyDown(e) {
  if (e.key === "F9") {
    e.preventDefault();
    if (!e.repeat) reportBug();
    return;
  }
  if (reportingBug) return;
  if (e.key === "Escape" && document.body.classList.contains("touch-tools-open")) {
    e.preventDefault();
    $("tools-close").click();
    return;
  }
  if (e.virtual && document.body.classList.contains("touch-tools-open")) return;
  if (!e.virtual && e.target?.closest?.("dialog, .cloud-panel, #touch-controls, #play-tools"))
    return;
  if (loading.active) {
    keys.clear();
    if (e.target?.closest?.("#boot-status") || e.key === "Tab") return;
    if (!isTextEntry(e.target)) e.preventDefault();
    return;
  }
  if (isTextEntry(e.target) || isTextEntry(document.activeElement)) return;
  if (battleFlow.busy && !paused) {
    if ([" ", "Enter"].includes(e.key) && !e.repeat) battleFlow.confirm();
    e.preventDefault();
    return;
  }
  if (extras.active) {
    if (e.key === "Escape") {
      extras.close();
      e.preventDefault();
    } else if (ui.handleKey(e)) e.preventDefault();
    return;
  }
  if (opera.handleKey(e)) return;
  if (game?.battle && !paused && !battleDialogue && !game.dialogue && battleMenu.handleKey(e)) {
    e.preventDefault();
    return;
  }
  if (["Enter", " "].includes(e.key) && !e.repeat && ui.revealDialogue()) {
    e.preventDefault();
    return;
  }
  if (ui.handleKey(e)) return;
  if (game?.nameInput) {
    if (e.key === "Enter") $("name-confirm").click();
    else if (e.key === "Backspace")
      $("name-value").value = Array.from($("name-value").value).slice(0, -1).join("");
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey)
      $("name-value").value = Array.from($("name-value").value + e.key)
        .slice(0, 6)
        .join("");
    e.preventDefault();
    return;
  }
  // Debug controls keep DOM focus after a click. Their native Space/Enter
  // activation must not consume the game's confirm input on the next press.
  if (
    e.target?.tagName === "BUTTON" &&
    !e.target.closest("footer") &&
    ["Enter", " "].includes(e.key)
  )
    return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Enter"].includes(e.key))
    e.preventDefault();

  keys.add(e.key);
  if (e.key === "Tab" && game?.battle && !battleDialogue && !game.dialogue) {
    e.preventDefault();
    battleMenu.cycle();
    return;
  }
  if (!game) return;
  if (e.key === "Enter" || e.key === " ") {
    if (ui.revealDialogue()) return;
    if (battleDialogue) battleDialogue = null;
    else game.confirm();
  }
  if (e.key === "q" || e.key === "Q") game.switchParty();
  if (e.key === "Escape") {
    if (!$("save").hidden) {
      $("save-close").click();
      return;
    }
    if (game.busy && !paused) return;
    paused = !paused;
    $("menu").hidden = !paused;
    renderMenu();
  }
}
function gameKeyUp(e) {
  keys.delete(e.key);
}
addEventListener("keydown", gameKeyDown);
addEventListener("keyup", gameKeyUp);
addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) keys.clear();
});
mountTouchControls({
  onKeyDown: gameKeyDown,
  onKeyUp: gameKeyUp,
  onRelease: () => keys.clear(),
  onLayout: () => renderer.resize(),
  onZoom: (view) => renderer.setGameZoom(view),
  getZoomViewport: () => renderer.gameZoomViewport(),
});
function renderMenu() {
  ui.scroll($("menu"), -Infinity);
  renderPartyMenu(
    game,
    { navigation: $("menu-nav"), party: $("party"), items: $("items") },
    renderMenu,
    createWidget,
    menuState,
    {
      save,
      settings: (settings) => audio.setVolume(settings.volume),
      location: ui.presentation.mapNames?.[game.mapId],
    },
  );
}
let shopView = null;
let namingView = null;
function renderNaming() {
  const input = game.nameInput;
  $("naming").hidden = !input;
  if (!input) {
    namingView = null;
    return;
  }
  if (namingView === input) return;
  namingView = input;
  $("name-value").value = input.original;
  $("name-value").onchange = () => {
    $("name-value").value = Array.from($("name-value").value).slice(0, 6).join("");
  };
  const portrait = createWidget("img");
  portrait.dataset.actorId = String(input.id);
  $("name-portrait").replaceChildren(portrait);
  $("name-keys").replaceChildren();
  for (const key of ["清空", "退格", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"]) {
    const b = createWidget("button");
    b.textContent = key === "清空" ? tr("app.clear") : key === "退格" ? tr("app.backspace") : key;
    b.onclick = () => {
      $("name-value").value =
        key === "清空"
          ? ""
          : key === "退格"
            ? Array.from($("name-value").value).slice(0, -1).join("")
            : Array.from($("name-value").value + key)
                .slice(0, 6)
                .join("");
    };
    $("name-keys").append(b);
  }
}
$("name-confirm").onclick = () => {
  if (game?.submitName($("name-value").value)) {
    ui.setCharacters(game.roster);
    $("naming").hidden = true;
  }
};
$("name-default").onclick = () => {
  $("name-value").value =
    battleData.characters[game?.nameInput?.id]?.name || game?.nameInput?.original || "";
};
function renderShop() {
  const shop = game.shop;
  $("shop").hidden = !shop;
  if (!shop) {
    shopView = null;
    return;
  }
  $("shop-gil").textContent = `Gil ${game.gil}`;
  const marker = game.gil + ":" + JSON.stringify(game.inventory);
  if (shopView !== shop || $("shop-stock").dataset.state !== marker) {
    shopView = shop;
    $("shop-stock").dataset.state = marker;
    $("shop-stock").replaceChildren();
    for (const item of shop.stock) {
      const button = createWidget("button");
      button.textContent = tr("app.buy_value_value_gil", { v0: item.name, v1: item.price });
      button.disabled = game.gil < item.price;
      button.onclick = () => {
        buyFromShop(game, item.id);
        renderShop();
      };
      $("shop-stock").append(button);
    }
    for (const [id, count] of Object.entries(game.inventory)) {
      const content = battleData.contents?.[id],
        item =
          content?.type_id === 1
            ? battleData.items?.[content.type_value]
            : content?.type_id === 2
              ? battleData.weapons?.[content.type_value]
              : content?.type_id === 3
                ? battleData.armors?.[content.type_value]
                : null;
      if (!(count > 0) || !item?.sell || item.sales_not_possible) continue;
      const button = createWidget("button");
      button.textContent = tr("app.sell_value_value_value_gil", {
        v0: game.text(content.mes_id_name),
        v1: count,
        v2: item.sell,
      });
      button.onclick = () => {
        game.sell(Number(id));
        renderShop();
      };
      $("shop-stock").append(button);
    }
  }
}
let colosseumView = "";
function renderColosseum() {
  const menu = game.colosseumMenu;
  $("colosseum").hidden = !menu;
  if (!menu) {
    colosseumView = "";
    return;
  }
  const marker = JSON.stringify([menu.phase, menu.selected, menu.challenger, game.inventory]);
  if (colosseumView === marker) return;
  colosseumView = marker;
  const choices = $("colosseum-choices");
  choices.replaceChildren();
  const button = (label, action) => {
    const node = createWidget("button");
    node.textContent = label;
    node.onclick = () => {
      action();
      renderColosseum();
    };
    choices.append(node);
  };
  const wager = colosseumWagers(game).find((w) => w.contentId === menu.selected);
  if (menu.phase === "wager") {
    $("colosseum-prompt").textContent = tr(
      "app.choose_an_item_to_wager_win_a_reward_or_lose_your_wager",
    );
    for (const w of colosseumWagers(game))
      button(
        tr("app.value_value_value_opponent_value", {
          v0: w.name,
          v1: w.count,
          v2: w.reward,
          v3: w.opponent,
        }),
        () => selectColosseumWager(game, w.contentId),
      );
  } else if (menu.phase === "challenger") {
    $("colosseum-prompt").textContent = tr(
      "app.wager_value_choose_a_challenger_who_will_fight_automati",
      { v0: wager.name },
    );
    for (const unit of partyInputMembers(game))
      button(`${unit.name} · Lv ${unit.level}`, () => selectColosseumChallenger(game, unit.id));
  } else {
    $("colosseum-prompt").textContent = tr("app.value_vs_value_wager_value_reward_value", {
      v0: game.unit(menu.challenger).name,
      v1: wager.opponent,
      v2: wager.name,
      v3: wager.reward,
    });
    button(tr("app.enter_battle"), () => confirmColosseum(game));
  }
}
$("colosseum-cancel").onclick = () => {
  cancelColosseum(game);
  renderColosseum();
};
const battleMenu = createBattleMenu({
  commands: $("commands"),
  targets: $("targets"),
  status: $("battle-status"),
  createElement: createWidget,
  isBlocked: () => battleFlow.busy,
});
renderer.canSelectBattleTarget = (side, index) =>
  !battleFlow.busy &&
  !paused &&
  !battleDialogue &&
  !game?.dialogue &&
  !playOptions.autoBattle &&
  battleMenu.canSelectTarget(side, index);
renderer.onBattleTarget = (side, index) => battleMenu.selectTarget(side, index);
$("escape").onclick = () => game?.battle?.requestEscape();
$("shop-close").onclick = () => {
  closeShop(game);
  renderShop();
};
let vehicleView = null;
function renderVehicle() {
  const model = vehicleInputState(game),
    menu = game.vehicleMenu;
  $("vehicle-open").hidden = !menu && (game.busy || model.actions.length <= 1);
  $("vehicle").hidden = !menu;
  if (!menu) {
    vehicleView = null;
    return;
  }
  if (vehicleView === menu) return;
  vehicleView = menu;
  $("vehicle-actions").replaceChildren();
  const labels = {
    takeoff: tr("app.take_off"),
    land: tr("app.land"),
    deck: tr("app.return_to_deck"),
    board: tr("app.board"),
    dismount: tr("app.disembark_dismount"),
    resume: tr("app.resume_movement"),
  };
  for (const action of model.actions) {
    const button = createWidget("button");
    button.textContent = labels[action.action];
    button.disabled = action.enabled === false;
    button.onclick = () => {
      submitVehicleInput(game, action);
      renderVehicle();
    };
    $("vehicle-actions").append(button);
  }
}
$("vehicle-open").onclick = () => {
  openVehicleInput(game);
  renderVehicle();
};
$("vehicle-close").onclick = () => {
  closeVehicleInput(game);
  renderVehicle();
};
let formationView = null;
function renderFormation() {
  const menu = game.partySelection;
  $("formation").hidden = !menu;
  if (!menu) {
    formationView = null;
    return;
  }
  if (formationView !== menu) {
    formationView = menu;
    $("formation-slots").replaceChildren();
    for (let slot = 0; slot < menu.slotCount; slot++) {
      const group = createWidget("fieldset"),
        title = createWidget("legend");
      title.textContent = tr("app.party_value", { v0: slot + 1 });
      group.append(title);
      for (let pos = 0; pos < 4; pos++) {
        const select = createWidget("select");
        select.setAttribute(
          "aria-label",
          tr("app.party_value_position_value", { v0: slot + 1, v1: pos + 1 }),
        );
        for (const member of [{ id: 0, name: tr("app.empty") }, ...menu.members]) {
          const option = createWidget("option");
          option.value = member.id;
          option.textContent = member.name;
          select.append(option);
        }
        select.value = menu.slots[slot][pos] || 0;
        select.onchange = () => {
          menu.slots[slot][pos] = Number(select.value);
        };
        group.append(select);
      }
      $("formation-slots").append(group);
    }
  }
  $("formation-problems").textContent = menu.problems.join(" ");
}
$("formation-confirm").onclick = () => {
  submitPartyInput(game);
  renderFormation();
};
$("formation-cancel").onclick = () => {
  cancelPartyInput(game);
  renderFormation();
};

let lastBattleResult = null;
$("battle-result-confirm").onclick = () => battleFlow.confirm();
function renderBattleFlow() {
  const locked = battleFlow.busy;
  $("battle-status").playbackLocked = locked;
  $("commands").hidden = locked;
  $("targets").hidden = locked;
  $("escape").hidden = locked;
  if (battleFlow.view) {
    $("battle-status").battleModel = battleFlow.view;
    if (locked)
      $("battle-status").textContent = JSON.stringify([
        battleFlow.view.players.map((u) => [u.hp, u.mp, u.atb]),
        battleFlow.view.log.at(-1),
        battleFlow.phase,
      ]);
  }
  if (locked) $("battle-status").activeActor = -1;
  $("battle-action").hidden = !battleFlow.banner;
  $("battle-action-name").textContent = battleFlow.banner;
  const result = battleFlow.phase === "result" ? battleFlow.result : null;
  $("battle-result").hidden = !result;
  if (lastBattleResult === result) return;
  lastBattleResult = result;
  if (!result) return;
  $("battle-reward-summary").textContent = tr("app.received_value_gil_value_ap_total_exp_value", {
    v0: result.gil,
    v1: result.ap,
    v2: result.exp,
  });
  $("battle-reward-members").replaceChildren(
    ...result.players.map((unit) => {
      const row = createWidget("p");
      const learned = unit.learned.map(
        (id) => battleData.abilities[id]?.name || tr("app.ability_value", { v0: id }),
      );
      row.textContent =
        `${unit.name}　Lv.${unit.level}　EXP +${unit.exp}` +
        (unit.levels > 0 ? tr("app.level_up_value", { v0: unit.levels }) : "") +
        (learned.length ? tr("app.learned_value", { v0: learned.join("、") }) : "");
      return row;
    }),
  );
  const drops = new Map();
  for (const item of result.drops || [])
    drops.set(item.id, (drops.get(item.id) || 0) + (item.count || 1));
  $("battle-reward-items").textContent = drops.size
    ? tr("app.items_received") +
      [...drops]
        .map(
          ([id, count]) =>
            `${battleData.contentNames[id] || tr("app.item_value", { v0: id })} ×${count}`,
        )
        .join("、")
    : tr("app.no_items_received");
}

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (acceptanceLoading || starting) {
    requestAnimationFrame(loop);
    return;
  }
  const toolsOpen = document.body.classList.contains("touch-tools-open");
  if (started && game && !acceptanceLoading) {
    if (!loading.active && !paused && !toolsOpen && !audio.musicPending)
      battleFlow.update(dt, {
        auto: playOptions.autoBattle || playOptions.skipDialogue,
        fast: playOptions.fastForward,
      });
    if (
      !loading.active &&
      !paused &&
      !toolsOpen &&
      !opera.busy &&
      !battleFlow.busy &&
      !audio.syncPending &&
      !audio.musicPending &&
      (!battleDialogue || playOptions.skipDialogue)
    ) {
      for (
        let n = 0;
        n <
        simulationRepeats(playOptions, {
          boosted: game.testBoost,
          realtime: battleFlow.realtimePresentation,
        });
        n++
      ) {
        game.tick(dt, {
          autoDialogue: playOptions.skipDialogue,
          autoBattle: playOptions.autoBattle,
          autoEvents: playOptions.story,
          dialogueDelay: playOptions.fastForward
            ? 0.15
            : Math.max(1.2, (game.dialogue?.text?.length || 0) * 0.035),
        });
        if (
          loading.active ||
          game.loading ||
          opera.busy ||
          battleFlow.busy ||
          audio.syncPending ||
          audio.musicPending
        ) {
          keys.clear();
          break;
        }
        if (playOptions.story) {
          walkClock += dt;
          if (walkClock >= 0.1) {
            walkClock -= 0.1;
            const input = advanceStory(game, {
              through: new URLSearchParams(location.search).get("through") || "all",
            });
            if (input.status === "done") {
              playOptions.story = false;
              updatePlayOptions();
              $("location").textContent = input.chapter
                ? input.chapter + tr("app.completed")
                : tr("app.left_narshe_world_map");
            } else if (
              ["no-route", "no-input", "game-over", "needs-input", "plan-end"].includes(
                input.status,
              )
            ) {
              playOptions.story = false;
              updatePlayOptions();
              $("location").textContent = tr(
                "app.automatic_story_progression_paused_continue_manually",
              );
            }
          }
        }
      }
      if (autosavePending && !game.busy && !game.over) {
        autosavePending = false;
        saveLibrary.autosave(game, ui.presentation.mapNames?.[game.mapId]).catch((error) => {
          saveLibrary.notify("error", {
            key: "app.local_autosave_failed_value_please_export_a_backup",
            values: { v0: error.message },
          });
        });
      }
      if (titlePending && !game.busy) {
        titlePending = false;
        started = false;
        playOptions.story = false;
        updatePlayOptions();
        $("title").hidden = false;
        $("location").textContent = game.history.some((row) => row.script === "sc_e_1032_18")
          ? tr("app.campaign_complete_returned_to_title")
          : tr("app.returned_to_title");
      }
      if (++frame % 7 === 0)
        for (const [k, d] of [
          ["ArrowUp", "up"],
          ["w", "up"],
          ["ArrowDown", "down"],
          ["s", "down"],
          ["ArrowLeft", "left"],
          ["a", "left"],
          ["ArrowRight", "right"],
          ["d", "right"],
        ])
          if (keys.has(k)) game.move(d);
    }
    if (game.battle && !battleFlow.busy) {
      $("escape").disabled = !game.battle.canEscape;
      $("escape").textContent = game.battle.escapeState?.active
        ? tr("app.escaping")
        : tr("app.escape");
      battleMenu.update(game.battle);
    }
    renderBattleFlow();
    renderFormation();
    renderNaming();
    renderShop();
    renderColosseum();
    renderVehicle();
    const dialogue = battleFlow.busy ? null : battleDialogue || game.dialogue;
    $("battle").hidden =
      !(game.battle || battleFlow.view) ||
      (battleFlow.view || game.battle)?.events?.uiVisible === false ||
      !!dialogue ||
      battleFlow.phase === "result";
    $("over").hidden = !game.over || battleFlow.busy;
    $("switch").hidden = !game.rts?.active;
    $("dialogue").hidden = !dialogue;
    if (dialogue) {
      const speaker = presentText(game, dialogue.speaker),
        message = presentText(game, dialogue.text);
      ui.setDialogue(
        dialogue,
        game.settings.textSpeed,
        playOptions.skipDialogue && playOptions.fastForward,
        speaker,
        message,
      );
      $("speaker").textContent = speaker;
      $("message").textContent = message;
      const choiceKey = dialogue.choices?.join("|") || "";
      if ($("choices").dataset.key !== choiceKey) {
        $("choices").dataset.key = choiceKey;
        $("choices").replaceChildren();
        for (const [label, n] of (dialogue.choices || []).map((x, n) => [x, n])) {
          const button = createWidget("button");
          button.textContent = label;
          button.onclick = () => game.confirm(n);
          $("choices").append(button);
        }
      }
      $("confirm").hidden = !!dialogue.choices;
    } else ui.setDialogue(null);
  }
  renderer.setMenuMode(
    extras.active ||
      ["menu", "shop", "save", "naming", "formation"].some(
        (id) => ui.get(id) && !ui.get(id).hidden,
      ),
  );
  ui.render();
  if (!loading.active && !paused && !toolsOpen) opera.update(dt);
  renderer.heldBattle = battleFlow.view;
  if (!game?.loading) {
    const resources = renderer.render(started ? game : null, data, battleData, {
      deferIncomplete: true,
    });
    if (resources?.pending || resources?.failed) {
      if (!loading.active) {
        loading.begin(tr("app.preparing_scene_resources"));
        keys.clear();
      }
      loading.update(resources);
      if (resources.failed)
        loading.fail(
          new Error(tr("app.value_textures_could_not_be_loaded", { v0: resources.failed })),
          () => {
            renderer.retryTextures();
            loading.begin(tr("app.reloading_scene_resources"));
          },
        );
    } else if (loading.panel.dataset.state !== "failed") {
      if (started) loading.setInGame(true);
      if (loading.active) loading.finish();
    }
  }
  if (!loading.active && !paused) preloader?.update(game);
  requestAnimationFrame(loop);
}
loading.begin(tr("app.loading_title_and_interface"), { boot: true });
const titleRepository = createRepository();
await loadPresentation(titleRepository, renderer, ui);
const originalMapNames = (await titleRepository.json(titleRepository.index.presentation)).mapNames;
mountLanguageControl(async (id) => {
  const previousPause = paused;
  paused = true;
  keys.clear();
  try {
    const source = repository || titleRepository;
    const catalog = await source.locale(id);
    if (!catalog) throw Error(`PR locale ${id} is unavailable in this resource export`);
    await setLanguage(id);
    source.currentLocale = catalog;
    const typedName =
      game?.nameInput && $("name-value").value !== game.nameInput.original
        ? $("name-value").value
        : null;
    if (game) localizeGame(data, battleData, catalog, game);
    if (battleDialogue?.key && catalog.messages[battleDialogue.key]) {
      battleDialogue.text = presentText(game, catalog.messages[battleDialogue.key])
        .replace(/<[^>]*>/g, "")
        .replace(/\\n/g, "\n");
      battleDialogue.speaker = catalog.speakers[battleDialogue.key] || "";
    }
    ui.presentation.mapNames = id === "zh-CN" ? originalMapNames : catalog.mapNames;
    if (ui.presentation.titleLogos?.[id])
      ui.presentation.sprites.titleLogo = ui.presentation.titleLogos[id];
    ui.translate();
    updatePlayOptions();
    if (game) {
      ui.setCharacters(game.roster);
      shopView = namingView = formationView = null;
      renderNaming();
      if (typedName !== null) $("name-value").value = typedName;
      if (!$("menu").hidden) renderMenu();
      if (!$("save").hidden) $("save-close").click();
      battleMenu.reset();
      battleFlow.relabel();
    }
    if (opera.player) {
      opera.player.messages = catalog.messages;
      opera.player.audioLanguage = operaAudioLanguage(id);
    }
    await extras.translate(catalog);
  } finally {
    paused = previousPause;
  }
});
renderer.diagnostics.mapNames = ui.presentation.mapNames || {};
opera.fontFamily = ui.presentation.fontFamily || opera.fontFamily;
if (new URLSearchParams(location.search).get("acceptance") === "1") {
  // Explicit diagnostic host for static-package screenshot acceptance. This is
  // not a playable save restore: VM/battle clocks stay frozen, including fades.
  window.ffviAcceptance = {
    async projection() {
      const field = renderer.fieldPresentation;
      if (!field.flight || !field.planeTexture) throw Error("No projected world map is displayed");
      return {
        plane: await renderer.app.renderer.extract.base64({ target: field.planeTexture }),
        projected: await renderer.app.renderer.extract.base64({ target: field.birdView.display }),
      };
    },
    async load(checkpoint) {
      acceptanceLoading = true;
      paused = true;
      playOptions.story = false;
      updatePlayOptions();
      opera.reset();
      battleFlow.reset();
      renderer.heldBattle = null;
      renderer.resetPresentation();
      battleDialogue = null;
      repository ||= new WebData(webIndexURL());
      if (!repository.data) ({ data, battleData } = await repository.open());
      const map = await repository.loadMap(checkpoint.metadata.mapId);
      await repository.ensurePrograms(checkpoint.programIds || []);
      renderer.setAssets(repository.index.assets.images, repository.baseURL);
      await loadBattlePresentation(repository, renderer);
      ui.setCharacters(battleData.characters);
      const restored = decodeAcceptanceState(
        checkpoint,
        { data, battleData, map },
        { Battle: Battle.prototype },
      );
      game = Object.assign(
        new PresentationGame({
          data,
          battleData,
          Battle,
          loadMap: (id) => repository.loadMap(id),
          onEvent: () => {},
          onPresentation: () => {},
        }),
        restored.state,
      );
      window.ffvi = game;
      game.onEvent = () => {};
      started = !game.titleScreen;
      autosavePending = titlePending = false;
      for (const id of [
        "title",
        "menu",
        "save",
        "naming",
        "over",
        "dialogue",
        "battle",
        "battle-action",
        "battle-result",
        "shop",
        "formation",
        "colosseum",
        "vehicle",
      ])
        if ($(id)) $(id).hidden = true;
      $("title").hidden = !game.titleScreen;
      if (game.over) {
        $("over").hidden = false;
        $("over-message").textContent = game.over.reason;
      }
      $("location").textContent =
        `${checkpoint.metadata.sequence} · ${checkpoint.metadata.kind} · ${checkpoint.metadata.map} · ${checkpoint.metadata.script || ""}`;
      $("mode").hidden = !game.testBoost;
      eventHistory.clear();
      for (const event of restored.recentEvents || []) eventHistory.record(event);
      const visualEvents = restored.visualEvents || [];
      // Earlier frozen frames omitted map events; their recorder manifest supplies
      // the real event timeline. New frames retain exact observer ordering.
      const commands = visualEvents.some((event) => event.kind === "map")
        ? visualEvents
        : [...(checkpoint.mapEvents || []), ...visualEvents].sort((a, b) => a.time - b.time);
      for (const command of commands) {
        renderer.fieldPresentation.prepare({ time: command.time }, false);
        renderer.event(command);
      }
      renderer.fieldAnimations.restore(restored.field);
      renderer._previewClock = game.time;
      if (game.battle) {
        renderer.battlePresentation.attach(game.battle, battleData);
        for (const { unit, row } of restored.battleRows || []) {
          if (!row) continue;
          const side = game.battle.players.includes(unit) ? "player" : "enemy",
            index = (side === "player" ? game.battle.players : game.battle.enemies).indexOf(unit);
          Object.assign(renderer.battlePresentation.row(side, index), {
            action: row.action,
            hurtAt: row.hurtAt,
          });
        }
      }
      acceptanceLoading = false;
      await new Promise(requestAnimationFrame);
      await Promise.all([...renderer._effectTasks]);
      ui.revealDialogue();
      await document.fonts.ready;
      for (let pass = 0; pass < 12; pass++) {
        await new Promise(requestAnimationFrame);
        const pending = [...renderer._textureSources.values()]
          .filter((row) => row.pending)
          .map((row) => row.promise);
        if (pending.length) await Promise.all(pending);
        else if (pass > 1) break;
      }
      await new Promise(requestAnimationFrame);
      const renderedGame = game.titleScreen ? null : game;
      if (renderer._renderedGame !== renderedGame)
        throw Error(
          `The game render loop did not draw checkpoint ${checkpoint.metadata.sequence}; stale screenshots are forbidden`,
        );
      return {
        metadata: checkpoint.metadata,
        titleScreen: !!game.titleScreen,
        state: describeBugState(game, renderer, eventHistory.read(), ui.presentation.mapNames),
        ui: {
          ...ui.diagnostics(),
          panels: Object.fromEntries(
            ["battle", "dialogue"].map((id) => [id, { hidden: $(id).hidden }]),
          ),
        },
        renderedFrame: renderer._renderedFrame,
        metrics: renderer.metrics(),
      };
    },
  };
}
if (import.meta.env.DEV) {
  // These isolated UI fixtures restore real regression checkpoints. They do not
  // write plot flags or count as story coverage, and are removed from production.
  const params = new URLSearchParams(location.search),
    checkpoint = params.get("checkpoint"),
    checkpointSet = params.get("checkpointSet") === "optional" ? "optional" : "stage1-checkpoints",
    panel = params.get("panel");
  if (checkpoint && /^[a-z0-9-]+$/.test(checkpoint)) {
    const response = await fetch(`/evidence/${checkpointSet}/${checkpoint}.json`);
    if (!response.ok) throw Error(`Missing real UI checkpoint ${checkpoint}`);
    await start(await response.json());
    if (
      ["队伍", "道具", "魔法", "魔石", "技能", "装备", "饰品", "状态", "队列", "设置"].includes(
        panel,
      )
    ) {
      menuState.page = panel;
      paused = true;
      $("menu").hidden = false;
      renderMenu();
    } else if (panel === "save") await openSaveMenu(true, game.testBoost);
    else if (panel === "name") game.requestName({ waitFor: null }, game.party[0].id);
    else if (panel === "dialogue") {
      const speaker = game.party[0].name,
        key = Object.keys(data.speakers).find(
          (key) => presentText(game, data.speakers[key]) === speaker && data.messages[key],
        );
      game.dialogue = { text: game.text(key), speaker: data.speakers[key] || speaker, elapsed: 0 };
    } else if (panel === "shop") openShop(game, Number(params.get("shop")) || 1);
    else if (panel === "colosseum") openColosseum(game, { locals: [], waitFor: null });
    else if (panel === "opera") {
      const script = params.get("script") || "sc_e_0318_1";
      if (["sc_e_0315_1", "sc_e_0315_3", "sc_e_0318_1", "sc_e_0330_1"].includes(script)) {
        const id = data.byMap[game.mapId]?.[script] ?? data.global[script];
        await repository.ensurePrograms([String(id)]);
        game.startScript(script);
      }
    } else if (panel === "battle")
      game.encounter(Number(params.get("formation")) || 1, null, { waitFor: null }, {});
    $("location").textContent = tr("app.ui_fixture_value_value_not_story_coverage", {
      v0: checkpoint,
      v1: panel || tr("app.map"),
    });
  }
}
let cloudPause = false;
mountCloudUI(saveLibrary, {
  onOpen: () => {
    cloudPause = paused;
    paused = true;
    keys.clear();
  },
  onClose: () => {
    paused = cloudPause;
    if (started) {
      canvas.tabIndex = -1;
      canvas.focus({ preventScroll: true });
    }
  },
});
// Do not dismiss the boot screen until the title's actual textures have arrived.
if (!started) {
  for (;;) {
    ui.render();
    const resources = renderer.render(null, data, battleData, { deferIncomplete: true });
    loading.update(resources);
    if (resources?.failed)
      throw new Error(tr("app.title_textures_failed_to_load_check_the_connection_and_"));
    if (!resources?.pending) break;
    await renderer.waitForFrame();
  }
}
requestAnimationFrame(loop);
