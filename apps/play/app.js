import { WebData, webIndexURL } from "./data.js";
import { loadPresentation, loadBattlePresentation, presentText } from "./presentation.js";
import { SaveLibrary, renderSaveSlots } from "./saves.js";
import { GameRenderer } from "./renderer.js";
import { GameUI, createWidget } from "./ui.js";
import { WebAudioPlayer } from "./audio.js";
import { createExtras } from "./extras.js";
import { OperaHost } from "./opera-host.js";
import { createEventHistory, describeBugState, saveBugReport } from "./bug-report.js";
import {
  withPresentation,
  observingAudioInstruction,
  isAudioInstruction,
} from "./presentation-events.js";
import { createBattleMenu } from "./battle-menu.js";
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
const canvas = document.getElementById("screen");
const renderer = new GameRenderer(canvas);
renderer.diagnostics.acceptance = new URLSearchParams(location.search).get("acceptance") === "1";
window.ffviRenderDiagnostics = () => renderer.diagnostics.summary();
await renderer.init();
const ui = new GameUI(renderer.layers.ui, (url, details) => renderer.getTexture(url, details));
window.ffviUIDiagnostics = () => ui.diagnostics();
const $ = (id) => ui.get(id) || document.getElementById(id);
let game,
  battleDialogue = null,
  auto = false,
  paused = false,
  started = false,
  frame = 0,
  last = performance.now();
let repository;
let data,
  battleData,
  walking = false,
  walkClock = 0,
  autosavePending = false,
  titlePending = false;
const audio = new WebAudioPlayer();
const opera = new OperaHost(renderer, audio);
renderer.onBattleSound = (id) =>
  audio
    .command({ name: "PlaySE", i: [id], r: [], s: [] })
    ?.catch?.((error) => audio.warn(error.message));
const saveLibrary = new SaveLibrary();
const menuState = { page: "队伍" };
const eventHistory = createEventHistory();
let reportingBug = false;
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
  const result = opera.command(command);
  result?.catch?.((error) => audio.warn(error.message));
}
function event(e) {
  eventHistory.record(e);
  if (e.kind === "opera" && !auto && !walking) opera.play(e.stage);
  if (e.kind === "battle-message")
    battleDialogue = {
      text: presentText(game, e.text)
        .replace(/<[^>]*>/g, "")
        .replace(/\\n/g, "\n"),
      speaker: data.speakers[e.key] || "",
      choices: null,
    };
  if (e.kind === "battle-message-close" || e.kind === "battle-end") battleDialogue = null;
  if (["battle-action", "battle-party", "battle-end"].includes(e.kind)) renderer.event(e);
  if ((e.kind === "bgm" || e.kind === "se") && !observingAudioInstruction(game)) {
    const engine = game?.battle?.events;
    const op = engine?.program?.ops?.[engine.pc - 1];
    if (op && isAudioInstruction(op[0]))
      presentation({ name: op[0], i: op[1], r: op[2], s: op[3] });
    else opera.event(e)?.catch?.((error) => audio.warn(error.message));
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
    $("retrytest").hidden = !!game?.testBoost;
  }
}
async function start(saved = null, testBoost = false) {
  eventHistory.clear();
  if (extras.active) extras.close();
  opera.reset();
  renderer.resetPresentation();
  battleDialogue = null;
  $("new").disabled = true;
  try {
    repository = new WebData(webIndexURL());
    ({ data, battleData } = await repository.open(saved));
    opera.setRepository(repository);
    renderer.setAssets(repository.index.assets.images, repository.baseURL);
    await loadBattlePresentation(repository, renderer);
    audio.setAssets(repository.index.assets.audio, repository.baseURL);
    audio.setCatalog(data.audio);
    ui.setCharacters(battleData.characters);
    game = new PresentationGame({
      onPresentation: presentation,
      data,
      battleData,
      Battle,
      testBoost: testBoost || !!saved?.testBoost,
      loadMap: (id) => repository.loadMap(id),
      onEvent: event,
      interactiveNames: true,
    });
    game.autoChoice = (g) => (walking ? storyChoice(g) : 0);
    window.ffvi = game;
    if (saved) await game.restore(saved, { testBoost });
    else await game.start();
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
    $("message").textContent = error.message;
    $("dialogue").hidden = false;
    console.error(error);
  } finally {
    $("new").disabled = false;
  }
}
function save() {
  openSaveMenu(true, game?.testBoost);
}
async function openSaveMenu(write, boost = false) {
  if (write && (!game || game.busy)) {
    $("location").textContent = "剧情或战斗进行中，请稍后保存";
    return;
  }
  paused = !!started;
  $("menu").hidden = true;
  $("title").hidden = true;
  $("save").hidden = false;
  $("save-heading").textContent = `${boost ? "剧情测试 · " : ""}${write ? "存档" : "读档"}`;
  $("save-status").textContent = "正在读取存档列表…";
  $("save-slots").replaceChildren();
  const quick = localStorage.getItem(boost ? "ffvi-play-test" : "ffvi-play");
  const refresh = async () => {
    const records = await saveLibrary.list(boost);
    $("save-slots").replaceChildren(
      ...renderSaveSlots(records, { write, boost, quick }, createWidget, async (slot) => {
        try {
          if (write) {
            await saveLibrary.save(game, slot, ui.presentation.mapNames?.[game.mapId]);
            $("save-status").textContent =
              `已保存 · 存档 ${slot} · ${ui.presentation.mapNames?.[game.mapId] || "当前地点"}`;
            await refresh();
          } else {
            const saved =
              slot === "quick" ? JSON.parse(quick) : await saveLibrary.load(boost, slot);
            if (saved) await start(saved, boost);
          }
        } catch (error) {
          $("save-status").textContent = error.message;
          console.error(error);
        }
      }),
    );
  };
  try {
    await refresh();
    $("save-status").textContent = "普通与剧情测试存档分别保存，共 12 槽。";
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
$("walk").onclick = async () => {
  if (!started || !game) return;
  if (!walking && repository) await repository.preloadRegression();
  walking = !walking;
  $("walk").textContent = `自动行走：${walking ? "开" : "关"}`;
  if (walking && !auto) $("auto").click();
};
$("switch").onclick = () => game?.switchParty();
$("retry").onclick = () => {
  const bytes = localStorage.getItem(game?.testBoost ? "ffvi-play-test" : "ffvi-play");
  if (bytes) start(JSON.parse(bytes));
  else start(null, game?.testBoost);
};
$("retrytest").onclick = () => {
  const bytes = localStorage.getItem("ffvi-play");
  start(bytes ? JSON.parse(bytes) : null, true);
};
$("test").onclick = () => start(null, true);
$("new").onclick = () => start();
$("loadtest").onclick = () => {
  openSaveMenu(false, true);
};
$("load").onclick = () => {
  openSaveMenu(false, false);
};
$("menu-save").onclick = save;
$("confirm").onclick = () => {
  if (!ui.revealDialogue()) {
    if (battleDialogue) battleDialogue = null;
    else game?.confirm();
  }
};
$("auto").onclick = () => {
  auto = !auto;
  $("auto").textContent = `自动推进：${auto ? "开" : "关"}`;
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
  $("bug-status").textContent = "F9：正在保存现场…";
  try {
    renderer.render(started ? game : null, data, battleData);
    const report = describeBugState(game, renderer, eventHistory.read(), ui.presentation.mapNames);
    report.screenshot = {
      mimeType: "image/png",
      dataURL: await renderer.captureFrame(),
    };
    const result = await saveBugReport(report, { development: import.meta.env.DEV });
    $("bug-status").textContent =
      result.method === "directory"
        ? `F9：已保存 ${result.directory}`
        : `F9：已下载 ${result.file}`;
  } catch (error) {
    $("bug-status").textContent = `F9：保存失败：${error.message}`;
    console.error("[bug-report]", error);
  } finally {
    if (game === capturedGame) paused = previousPause;
    renderer._previewClock = previousClock;
    reportingBug = false;
  }
}
$("bug-report").onclick = reportBug;
addEventListener("keydown", (e) => {
  if (e.key === "F9") {
    e.preventDefault();
    if (!e.repeat) reportBug();
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
  if (game?.battle && !battleDialogue && battleMenu.handleKey(e)) {
    e.preventDefault();
    return;
  }
  keys.add(e.key);
  if (e.key === "Tab" && game?.battle && !battleDialogue) {
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
});
addEventListener("keyup", (e) => keys.delete(e.key));
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
  const bonus = createWidget("button");
  bonus.textContent = "额外内容";
  bonus.onclick = () => extras.open();
  $("menu-nav").append(bonus);
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
    b.textContent = key;
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
      button.textContent = `购买 ${item.name} · ${item.price} Gil`;
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
      button.textContent = `卖出 ${game.text(content.mes_id_name)} ×${count} · ${item.sell} Gil`;
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
    $("colosseum-prompt").textContent = "请选择押注道具。胜利获得奖励，失败失去押注。";
    for (const w of colosseumWagers(game))
      button(`${w.name} ×${w.count} → ${w.reward} · 对手 ${w.opponent}`, () =>
        selectColosseumWager(game, w.contentId),
      );
  } else if (menu.phase === "challenger") {
    $("colosseum-prompt").textContent =
      `押注 ${wager.name}，请选择一名出战者。战斗中角色自行行动。`;
    for (const unit of partyInputMembers(game))
      button(`${unit.name} · Lv ${unit.level}`, () => selectColosseumChallenger(game, unit.id));
  } else {
    $("colosseum-prompt").textContent =
      `${game.unit(menu.challenger).name} 对战 ${wager.opponent}，押注 ${wager.name}，奖励 ${wager.reward}。`;
    button("确认参战", () => confirmColosseum(game));
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
});
renderer.canSelectBattleTarget = (side, index) =>
  !paused && !battleDialogue && !auto && battleMenu.canSelectTarget(side, index);
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
    takeoff: "起飞",
    land: "着陆",
    deck: "返回甲板",
    board: "乘坐",
    dismount: "下船 / 下陆行鸟",
    resume: "继续移动",
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
      title.textContent = `队伍 ${slot + 1}`;
      group.append(title);
      for (let pos = 0; pos < 4; pos++) {
        const select = createWidget("select");
        select.setAttribute("aria-label", `队伍 ${slot + 1} 位置 ${pos + 1}`);
        for (const member of [{ id: 0, name: "空位" }, ...menu.members]) {
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

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (started && game) {
    if (!paused && !opera.busy && (!battleDialogue || auto)) {
      for (let n = 0; n < (auto ? (game.testBoost ? 16 : 4) : 1); n++) {
        game.tick(dt, { auto });
        if (opera.busy) {
          keys.clear();
          break;
        }
        if (walking) {
          walkClock += dt;
          if (walkClock >= 0.1) {
            walkClock -= 0.1;
            const input = advanceStory(game, {
              through:
                new URLSearchParams(location.search).get("through") ||
                (game.testBoost ? "all" : "M3-sabin"),
            });
            if (input.status === "done") {
              walking = false;
              auto = false;
              $("walk").textContent = "自动行走：关";
              $("auto").textContent = "自动推进：关";
              $("location").textContent = input.chapter
                ? input.chapter + " 已完成"
                : "已离开纳尔谢 · 世界地图";
            } else if (
              ["no-route", "no-input", "game-over", "needs-input", "plan-end"].includes(
                input.status,
              )
            ) {
              walking = false;
              $("walk").textContent = "自动行走：关";
              $("location").textContent = "自动行走暂停，请手动操作";
            }
          }
        }
      }
      if (autosavePending && !game.busy && !game.over) {
        localStorage.setItem(
          game.testBoost ? "ffvi-play-test" : "ffvi-play",
          JSON.stringify(game.snapshot()),
        );
        autosavePending = false;
      }
      if (titlePending && !game.busy) {
        titlePending = false;
        started = false;
        walking = false;
        auto = false;
        $("walk").textContent = "自动行走：关";
        $("auto").textContent = "自动推进：关";
        $("title").hidden = false;
        $("location").textContent = game.history.some((row) => row.script === "sc_e_1032_18")
          ? "主线通关 · 已返回标题"
          : "已返回标题";
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
    if (game.battle) {
      $("escape").disabled = !game.battle.canEscape;
      $("escape").textContent = game.battle.escapeState?.active ? "正在逃跑…" : "逃跑";
      battleMenu.update(game.battle);
    }
    renderFormation();
    renderNaming();
    renderShop();
    renderColosseum();
    renderVehicle();
    $("battle").hidden = !game.battle || !!battleDialogue;
    $("switch").hidden = !game.rts?.active;
    const dialogue = battleDialogue || game.dialogue;
    $("dialogue").hidden = !dialogue;
    if (dialogue) {
      const speaker = presentText(game, dialogue.speaker),
        message = presentText(game, dialogue.text);
      ui.setDialogue(dialogue, game.settings.textSpeed, auto, speaker, message);
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
  opera.update(dt);
  renderer.render(started ? game : null, data, battleData);
  requestAnimationFrame(loop);
}
await loadPresentation(new WebData(webIndexURL()), renderer, ui);
renderer.diagnostics.mapNames = ui.presentation.mapNames || {};
opera.fontFamily = ui.presentation.fontFamily || opera.fontFamily;
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
    $("location").textContent = `界面用例 · ${checkpoint} · ${panel || "地图"}（不计剧情覆盖）`;
  }
}
requestAnimationFrame(loop);
