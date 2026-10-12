import { GameSession } from "/runtime/core/game-session.js";
import {
  verifyContent,
  contentDigest,
} from "/runtime/core/content-integrity.js";
import { encodeSavedGame, decodeSavedGame } from "/runtime/core/saved-game.js";
import { InventoryView } from "/game/inventory-view.js";
import { BattleView } from "/game/battle-view.js";
import { battleAppearanceQuads } from "/runtime/core/battle-appearance.js";
import { projectDevelopmentBattleLayout } from "/runtime/core/battle-layout.js";
const $ = (id) => document.getElementById(id);
const [field, catalog] = await Promise.all(
  ["/game/content.json", "/game/battle.json"].map(async (url) =>
    verifyContent(await (await fetch(url)).json()),
  ),
);
const fixtureField = structuredClone(field);
// Controlled transport input, separate from the opening's rider artwork.
fixtureField.entry.transportationId = 1;
const site = {
  script: "__item_probe",
  index: 0,
  source: { file: "controlled-browser-input", assetPath: "item-transaction" },
};
fixtureField.scripts.__item_probe = [
  { ...site, kind: "encounter", party: 3, continuation: "__item_return" },
];
fixtureField.scripts.__item_return = [
  { ...site, script: "__item_return", kind: "exit" },
];
const { contentHash: originalFieldHash, ...fixturePayload } = fixtureField;
fixtureField.contentHash = await contentDigest(fixturePayload);
const images = new Map();
await Promise.all(
  Object.values(catalog.common.sprites).map(async (sprite) => {
    if (images.has(sprite.file)) return;
    const image = new Image();
    image.src = sprite.file;
    await image.decode();
    images.set(sprite.file, image);
  }),
);
let game,
  saved,
  poisonProbe = false;
const view = new InventoryView(
  $("inventory-panel"),
  catalog.gameState.items,
  () => sync(),
);
const battleView = new BattleView(
  $("game"),
  catalog.common,
  images,
  leave,
  retry,
  battleAppearanceQuads,
  projectDevelopmentBattleLayout,
);
function sync(message) {
  view.render(game);
  if (game.battle) {
    battleView.sync(game.battle, false);
    battleView.draw(game.battle);
  } else battleView.hide();
  if (message) $("receipt").textContent = message;
  $("start-battle").disabled = !!game.battle;
  $("save-fixture").disabled = !game.checkpointReady;
  $("load-fixture").disabled = !saved || !!game.battle;
  $("field-step").disabled = !game.checkpointReady;
  $("battle-mode").value = game.battlePreferences.mode;
  for (const id of [
    "step-battle",
    "finish-battle",
    "win-fixture",
    "step-poison",
  ])
    $(id).disabled = !game.battle;
  $("condition-readout").textContent =
    game.battle
      ? game.battle.players
          .map((p) => {
            const clocks = game.battle.phase === "active"
              ? game.battle.conditionClockState(p.id)
              : [];
            return `${p.name}：HP ${p.hp}/${p.maxHp} · ATB ${p.atb.toFixed(2)}${clocks.length ? ` · 毒计时 ${clocks[0].elapsedSeconds.toFixed(2)}/${clocks[0].thresholdSeconds.toFixed(2)} 秒` : ""}`;
          })
          .join("；")
      : (game.field.movementBlocker ??
        `交通身份 ${game.field.transportationId} · 完成步数 ${game.field.player.steps} · 坐标 ${game.field.player.x},${game.field.player.y} · ${game.state.snapshot().roster.map((p) => `${p.name} HP ${p.hp}/${p.maxHp}`).join("；")}`);
}
function reset() {
  poisonProbe = false;
  game = new GameSession(fixtureField, catalog);
  saved = null;
  const s = game.state.snapshot();
  s.roster.forEach((p) => {
    p.hp = 1;
    p.mp = 0;
  });
  game.state.restore(s);
  game.state.changeItems(
    [
      { id: 2, count: 2 },
      { id: 8, count: 1 },
      { id: 9, count: 1 },
    ],
    "grant",
  );
  view.reset();
  sync(
    "受控输入就绪：队员 HP 1、MP 0；恢复药 × 2、圣灵药 × 1、终极圣灵药 × 1。",
  );
}
function resetStatus() {
  poisonProbe = false;
  game = new GameSession(fixtureField, catalog);
  saved = null;
  const s = game.state.snapshot();
  s.roster[1].hp = 0;
  s.roster[1].conditionIds = [5];
  s.roster[2].conditionIds = [6];
  game.state.restore(s);
  game.state.changeItems(
    [
      { id: 10, count: 2 },
      { id: 15, count: 1 },
      { id: 21, count: 1 },
    ],
    "grant",
  );
  view.reset();
  sync(
    "受控输入就绪：第二名队员战斗不能，第三名沉默；不死鸟之尾 × 2、万能药 × 1、山彦烟幕 × 1。",
  );
}
function resetPoison() {
  poisonProbe = true;
  game = new GameSession(fixtureField, catalog);
  saved = null;
  const s = game.state.snapshot();
  s.roster[0].conditionIds = [10];
  game.state.restore(s);
  game.state.changeItems([{ id: 12, count: 1 }], "grant");
  view.reset();
  sync(
    "受控输入：第一名角色中毒、解毒药 × 1；战斗中敌方行动条增幅设为零，隔离周期效果。",
  );
}
function start() {
  game.field.startEvent("__item_probe");
  game.advance(10);
  game.battle.players.forEach((p) => {
    p.atb = p.hp > 0 ? 100 : 0;
  });
  game.battle.enemies.forEach((p) => {
    p.atb = 0;
    if (poisonProbe) {
      p.agility = 0;
      p.weight = 21;
    }
  });
  sync("来源战斗经受控事件进入；预订与消耗显示在战斗菜单。");
}
function retry() {
  game.retryBattle();
  sync("已恢复战前角色与库存。");
}
function leave() {
  if (!game.continueVictory()) return;
  game.advance(10);
  sync("胜利已提交并返回空闲地图；菜单读取战后 HP/MP 与剩余数量。");
}
$("reset-fixture").onclick = reset;
$("reset-status-fixture").onclick = resetStatus;
$("reset-poison-fixture").onclick = resetPoison;
$("battle-mode").onchange = () => {
  game.setBattlePreferences({ mode: $("battle-mode").value });
  sync();
};
$("field-step").onclick = () => {
  const direction = game.field.player.y === fixtureField.entry.player.y ? "up" : "down";
  if (game.field.move(direction)) {
    game.advance(240);
    sync("完成一格移动；毒伤经正式字段步点与共享状态事务结算。");
  } else sync(game.field.movementBlocker ?? "此步被地图碰撞或事件阻挡。");
};
$("start-battle").onclick = start;
$("step-battle").onclick = () => {
  game.advance(410);
  sync("已推进 410 毫秒。");
};
$("finish-battle").onclick = () => {
  game.advance(500);
  sync("已推进 500 毫秒。");
};
$("step-poison").onclick = () => {
  game.advance(8100);
  sync("已推进 8.1 秒；中毒伤害与计时读取正式内核。");
};
$("win-fixture").onclick = () => {
  game.battle.enemies.forEach((p) => {
    p.hp = 0;
  });
  game.advance(1000);
  sync("受控敌人 HP 置零，仅用于验证奖励与库存提交。");
};
$("save-fixture").onclick = async () => {
  saved = await encodeSavedGame(game.checkpoint(), 0);
  sync("检查点已编码到内存；正式浏览器存档未写入。");
};
$("load-fixture").onclick = async () => {
  game = GameSession.restore(
    (await decodeSavedGame(saved)).checkpoint,
    fixtureField,
    catalog,
  );
  view.reset();
  sync("检查点已恢复，资源与库存数量见左侧。");
};
reset();
