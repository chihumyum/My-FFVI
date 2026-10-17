import { GameRenderer } from "/game/renderer.js";
import { GameUI, createWidget } from "/game/ui.js";
import { configureGogo } from "/play-runtime/battle-commands.js";
import { Battle } from "/play-runtime/battle.js";
import { createCharacter, learnNaturalAbilities } from "/play-runtime/progression.js";
import { createBattleMenu } from "/game/battle-menu.js";
const renderer = new GameRenderer(document.getElementById("screen"));
await renderer.init();
const ui = new GameUI(renderer.layers.ui);
const $ = (id) => ui.get(id) || document.getElementById(id);
const data = await fetch("/play-data/battle.json").then((r) => r.json());
const menu = createBattleMenu({
  commands: $("commands"),
  targets: $("targets"),
  status: $("battle-status"),
  createElement: createWidget,
});
for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 31, 32]) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = data.characters[id]?.name ?? `角色 ${id}`;
  $("actor").append(option);
}
let battle,
  last = performance.now();
function start() {
  const id = Number($("actor").value),
    unit = createCharacter(data, id, true);
  learnNaturalAbilities(unit);
  if ([31, 32].includes(id)) unit.magitek = true;
  unit.abilities = [
    ...new Set([
      ...unit.abilities,
      ...Object.values(data.abilities)
        .filter((a) => [1, 2, 601, 602].includes(a.typeId) && a.id < 140)
        .map((a) => a.id),
    ]),
  ];
  unit.commands = [...new Set([...unit.commands, ...(id === 1 ? [8, 7] : [7])])];
  unit.magicite = Object.keys(data.magicStones).map(Number)[0];
  unit.loreAbilities = Object.values(data.abilities)
    .filter((a) => a.typeId === 504)
    .map((a) => a.id);
  unit.danceAbilities = [164, 165, 166, 167, 168, 169, 170, 171];
  unit.rages = Object.values(data.monsters)
    .filter((m) => m.rageGroup)
    .slice(0, 16)
    .map((m) => m.id);
  if (id === 13) unit.customCommands = [1, 7, 15];
  const from = Number($("relic").value);
  if (from) {
    const f = Object.values(data.functions).find(
      (f) => f.function1_id === 61 && f.function1_value1 === from,
    );
    if (f)
      unit.equipmentEffects = [{ id: 61, values: [f.function1_value1, f.function1_value2, 0] }];
  }
  const companion = createCharacter(data, 7, true);
  companion.abilities = [31, 40, 41, 42];
  const inventory = Object.fromEntries(
    Object.values(data.contents)
      .filter((c) => [1, 2, 3].includes(c.type_id))
      .map((c) => [c.id, 10]),
  );
  battle = new Battle({
    data,
    party: [unit, ...(id === 7 ? [] : [companion])],
    inventory,
    encounterId: Number($("formation").value),
    isVeldt: true,
    context: { gil: 500000, settings: { atbMode: "wait", battleSpeed: 3 } },
    onEnd: (result) => {
      $("result").textContent = `本次战斗：${result.outcome}。点击开始测试战斗可更换角色。`;
    },
  });
  for (const u of battle.players) {
    u.atb = 100;
    u.ready = true;
  }
  $("gogo-commands").hidden = id !== 13;
  $("gogo-commands").replaceChildren();
  if (id === 13)
    for (let n = 0; n < 3; n++) {
      const label = document.createElement("label"),
        select = document.createElement("select");
      label.textContent = `戈戈指令 ${n + 1}`;
      select.id = `gogo-${n}`;
      for (const cid of [1, 3, 7, 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23]) {
        const option = document.createElement("option");
        option.value = cid;
        option.textContent = data.commands[cid]?.name ?? `${cid}`;
        select.append(option);
      }
      select.value = unit.customCommands[n];
      select.onchange = () => {
        const ids = [...unit.customCommands];
        ids[n] = Number(select.value);
        configureGogo(data, unit, ids);
        menu.reset();
      };
      label.append(select);
      $("gogo-commands").append(label);
    }
  $("result").textContent = "真实 Battle 运行中；每次选择会消耗回合和资源。";
  menu.reset();
}
$("restart").onclick = start;
$("cycle").onclick = () => menu.cycle();
addEventListener("keydown", (e) => {
  if (ui.handleKey(e)) return;
  if (menu.handleKey(e)) {
    e.preventDefault();
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    menu.cycle();
  }
});
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (battle) {
    battle.tick(dt);
    menu.update(battle);
    $("action-log").textContent = battle.log.slice(-30).join("\n");
  }
  ui.render();
  renderer.render(battle ? { battle, time: battle.time } : null, null, data);
  requestAnimationFrame(loop);
}
start();
requestAnimationFrame(loop);
