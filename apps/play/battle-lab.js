import { WebData, webIndexURL } from "./data.js";
import { loadPresentation, loadBattlePresentation } from "./presentation.js";
import { GameRenderer } from "./renderer.js";
import { GameUI, createWidget } from "./ui.js";
import { configureGogo } from "../../src/play/battle-commands.js";
import { Battle } from "../../src/play/battle.js";
import { createCharacter, learnNaturalAbilities } from "../../src/play/progression.js";
import { createBattleMenu } from "./battle-menu.js";
const renderer = new GameRenderer(document.getElementById("screen"));
await renderer.init();
const ui = new GameUI(renderer.layers.ui, (url) => renderer.getTexture(url));
const $ = (id) => ui.get(id) || document.getElementById(id);
const repository = new WebData(webIndexURL());
const index = await repository.json(webIndexURL().href);
const data = await repository.json(index.battle);
renderer.setAssets(index.assets.images, repository.baseURL);
await loadPresentation(repository, renderer, ui);
await loadBattlePresentation(repository, renderer);
ui.setCharacters(data.characters);
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
  preview = false,
  last = performance.now();
function start() {
  renderer.resetPresentation();
  preview = false;
  $("visual-result").textContent = "";
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
    isVeldt: id === 12,
    context: { gil: 500000, settings: { atbMode: "wait", battleSpeed: 3 } },
    event: (kind, event) => renderer.event({ kind, ...event }),
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
const visualSkills = [
  1,
  6,
  8,
  9,
  11,
  18,
  21,
  ...Array.from({ length: 33 }, (_, n) => n + 31),
  71,
  77,
  80,
  124,
  132,
  134,
  136,
  145,
  151,
  154,
];
for (const [n, id] of visualSkills.entries()) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = `${String(n + 1).padStart(2, "0")} · ${data.abilities[id].name}`;
  $("visual-skill").append(option);
}
const missOption = document.createElement("option");
missOption.value = "miss";
missOption.textContent = "MISS · 表现测试";
$("visual-skill").append(missOption);
$("visual-play").onclick = async () => {
  $("visual-play").disabled = true;
  $("visual-result").textContent = "正在读取演出资源…";
  try {
    start();
    preview = true;
    const id = $("visual-skill").value;
    if (id === "miss")
      renderer.event({
        kind: "battle-action",
        actorSide: "player",
        actorIndex: 0,
        targetSide: "enemy",
        targetIndex: 0,
        abilityId: 1,
        result: { hit: false, amount: 0, mp: 0 },
      });
    else {
      const ability = data.abilities[id],
        actor = battle.players[0];
      const target = ability.target === "ally" ? actor : battle.enemies[0];
      if (ability.functions.some((f) => f.id === 34)) target.hp = 0;
      else if (ability.kind === "heal") target.hp = Math.max(1, target.maxHp - 2000);
      battle.perform(actor, target, ability, 1);
    }
    await renderer.captureBattleFrame({ battle, time: battle.elapsed }, null, data);
    $("visual-result").textContent =
      `演出已就绪 · ${id === "miss" ? "MISS" : data.abilities[id].name} · 0.5 秒`;
  } catch (error) {
    $("visual-result").textContent = `演出失败：${error.message}`;
    console.error(error);
  } finally {
    $("visual-play").disabled = false;
  }
};
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
    if (!preview) battle.tick(dt);
    menu.update(battle);
    $("commands").hidden = preview;
    $("targets").hidden = preview;
    $("action-log").textContent = battle.log.slice(-30).join("\n");
  }
  ui.render();
  renderer.render(battle ? { battle, time: battle.time } : null, null, data);
  $("render-metrics").textContent = JSON.stringify(renderer.metrics(), null, 2);
  requestAnimationFrame(loop);
}
start();
requestAnimationFrame(loop);
