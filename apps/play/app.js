import { GameRenderer } from "/game/renderer.js";
import { GameUI, createWidget } from "/game/ui.js";
import { WebAudioPlayer } from "/game/audio.js";
import {
  withPresentation,
  observingAudioInstruction,
  isAudioInstruction,
} from "/game/presentation-events.js";
import { createBattleMenu } from "/game/battle-menu.js";
import { buyFromShop, closeShop } from "/play-runtime/event-systems.js";
import { submitPartyInput, cancelPartyInput } from "/play-runtime/party-input.js";
import {
  openVehicleInput,
  vehicleInputState,
  submitVehicleInput,
  closeVehicleInput,
} from "/play-runtime/vehicle-input.js";
import { renderPartyMenu } from "/game/party-menu.js";
import { PlayGame } from "/play-runtime/game.js";
import { advanceStory } from "/play-runtime/story-route.js";
import { storyChoice } from "/play-runtime/story-plan.js";
import { Battle } from "/play-runtime/battle.js";
const canvas = document.getElementById("screen");
const renderer = new GameRenderer(canvas);
await renderer.init();
const ui = new GameUI(renderer.layers.ui);
const $ = (id) => ui.get(id) || document.getElementById(id);
let game,
  auto = false,
  paused = false,
  started = false,
  frame = 0,
  last = performance.now();
let data,
  battleData,
  walking = false,
  walkClock = 0,
  autosavePending = false,
  titlePending = false;
const json = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw Error(await r.text());
  return r.json();
};
const audio = new WebAudioPlayer();
const PresentationGame = withPresentation(PlayGame);
addEventListener("pointerdown", () => audio.unlock().catch((error) => audio.warn(error.message)));
addEventListener("keydown", () => audio.unlock().catch((error) => audio.warn(error.message)));
function presentation(command) {
  if (command.kind === "presentation-command") {
    renderer.event(command);
    return;
  }
  const result = audio.command(command);
  result?.catch?.((error) => audio.warn(error.message));
}
function event(e) {
  if ((e.kind === "bgm" || e.kind === "se") && !observingAudioInstruction(game)) {
    const engine = game?.battle?.events;
    const op = engine?.program?.ops?.[engine.pc - 1];
    if (op && isAudioInstruction(op[0]))
      presentation({ name: op[0], i: op[1], r: op[2], s: op[3] });
    else audio.event(e)?.catch?.((error) => audio.warn(error.message));
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
  renderer.resetPresentation();
  $("new").disabled = true;
  try {
    [data, battleData] = await Promise.all([
      json("/play-data/data.json"),
      json("/play-data/battle.json"),
    ]);
    data.navigation = await json("/play-data/navigation.json");
    audio.setCatalog(data.audio);
    game = new PresentationGame({
      onPresentation: presentation,
      data,
      battleData,
      Battle,
      testBoost: testBoost || !!saved?.testBoost,
      loadMap: (id) => json(`/play-data/maps/${id}.json`),
      onEvent: event,
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
  if (game && !game.busy) {
    localStorage.setItem(
      game.testBoost ? "ffvi-play-test" : "ffvi-play",
      JSON.stringify(game.snapshot()),
    );
    $("location").textContent = "已保存 · " + game.map.name;
  } else $("location").textContent = "剧情或战斗进行中，请稍后保存";
}
$("walk").onclick = () => {
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
  const bytes = localStorage.getItem("ffvi-play-test");
  if (bytes) start(JSON.parse(bytes));
};
$("load").onclick = () => {
  const bytes = localStorage.getItem("ffvi-play");
  if (bytes) start(JSON.parse(bytes));
};
$("menu-save").onclick = save;
$("confirm").onclick = () => game?.confirm();
$("auto").onclick = () => {
  auto = !auto;
  $("auto").textContent = `自动推进：${auto ? "开" : "关"}`;
};
$("close").onclick = () => {
  paused = false;
  $("menu").hidden = true;
};
const keys = new Set();
addEventListener("keydown", (e) => {
  if (ui.handleKey(e)) return;
  if (e.target?.tagName === "BUTTON" && ["Enter", " "].includes(e.key)) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Enter"].includes(e.key))
    e.preventDefault();
  if (game?.battle && battleMenu.handleKey(e)) {
    e.preventDefault();
    return;
  }
  keys.add(e.key);
  if (e.key === "Tab" && game?.battle) {
    e.preventDefault();
    battleMenu.cycle();
    return;
  }
  if (!game) return;
  if (e.key === "Enter" || e.key === " ") {
    game.confirm();
  }
  if (e.key === "q" || e.key === "Q") game.switchParty();
  if (e.key === "Escape") {
    paused = !paused;
    $("menu").hidden = !paused;
    renderMenu();
  }
});
addEventListener("keyup", (e) => keys.delete(e.key));
function renderMenu() {
  renderPartyMenu(game, { party: $("party"), items: $("items") }, renderMenu, createWidget);
}
let shopView = null;
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
const battleMenu = createBattleMenu({
  commands: $("commands"),
  targets: $("targets"),
  status: $("battle-status"),
  createElement: createWidget,
});
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
    if (!paused) {
      for (let n = 0; n < (auto ? (game.testBoost ? 16 : 4) : 1); n++) {
        game.tick(dt, { auto });
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
    renderShop();
    renderVehicle();
    $("battle").hidden = !game.battle;
    $("switch").hidden = !game.rts?.active;
    $("dialogue").hidden = !game.dialogue;
    if (game.dialogue) {
      $("speaker").textContent = game.dialogue.speaker;
      $("message").textContent = game.dialogue.text;
      const choiceKey = game.dialogue.choices?.join("|") || "";
      if ($("choices").dataset.key !== choiceKey) {
        $("choices").dataset.key = choiceKey;
        $("choices").replaceChildren();
        for (const [label, n] of (game.dialogue.choices || []).map((x, n) => [x, n])) {
          const button = createWidget("button");
          button.textContent = label;
          button.onclick = () => game.confirm(n);
          $("choices").append(button);
        }
      }
      $("confirm").hidden = !!game.dialogue.choices;
    }
  }
  ui.render();
  renderer.render(started ? game : null, data, battleData);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
