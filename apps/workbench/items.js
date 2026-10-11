import { GameSession } from "/runtime/core/game-session.js";
import {
  verifyContent,
  contentDigest,
} from "/runtime/core/content-integrity.js";
import { encodeSavedGame, decodeSavedGame } from "/runtime/core/saved-game.js";
import { InventoryView } from "/game/inventory-view.js";
import { BattleView } from "/game/battle-view.js";
const $ = (id) => document.getElementById(id);
const [field, catalog] = await Promise.all(
  ["/game/content.json", "/game/battle.json"].map(async (url) =>
    verifyContent(await (await fetch(url)).json()),
  ),
);
const fixtureField = structuredClone(field);
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
let game, saved;
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
  for (const id of ["step-battle", "finish-battle", "win-fixture"])
    $(id).disabled = !game.battle;
}
function reset() {
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
function start() {
  game.field.startEvent("__item_probe");
  game.advance(10);
  game.battle.players.forEach((p) => {
    p.atb = 100;
  });
  game.battle.enemies.forEach((p) => {
    p.atb = 0;
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
$("start-battle").onclick = start;
$("step-battle").onclick = () => {
  game.advance(410);
  sync("已推进 410 毫秒。");
};
$("finish-battle").onclick = () => {
  game.advance(500);
  sync("已推进 500 毫秒。");
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
