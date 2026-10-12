import { GameSession } from "/runtime/core/game-session.js";
import { GameFlow } from "/runtime/core/game-flow.js";
import { verifyContent } from "/runtime/core/content-integrity.js";
import { fieldMediaUrls } from "/runtime/core/game-content.js";
import { ChoiceView } from "/game/choice-view.js";
import { Renderer } from "/game/renderer.js";

const $ = (id) => document.getElementById(id);
const field = await verifyContent(await (await fetch("/interaction-field.json")).json());
const catalog = await verifyContent(await (await fetch("/game/battle.json")).json());
const flow = new GameFlow(new GameSession(field, catalog));
const images = new Map();
await Promise.all(fieldMediaUrls(field).map(async (url) => {
  const image = new Image(); image.src = url; await image.decode(); images.set(url, image);
}));
const renderer = new Renderer($("game"), field, images);
const view = new ChoiceView($("choice-panel"), sync);
let last = 0, saved = null, stopped = false;
function sync() {
  const game = flow.session, message = game.field.messageWindow;
  view.render(flow);
  $("dialogue").hidden = !message || flow.paused;
  $("speaker").textContent = message?.speaker ?? "";
  $("message").textContent = message?.text ?? "";
  $("next").hidden = game.field.choicePending;
  $("next").disabled = !flow.inputReady;
  $("status").textContent = game.field.stop?.message ?? (flow.paused ? "已暂停，选择尚未提交。" :
    game.field.choice ? "方向键选择，空格 / Enter 确认" : game.field.dialogue ? "继续对白" : "可以继续移动或保存测试进度。");
  $("pause-button").disabled = !flow.started;
  $("pause-button").textContent = flow.paused ? "继续" : "暂停";
  $("save").disabled = !flow.started || !game.checkpointReady;
  $("restore").disabled = saved === null;
  $("observations").textContent = JSON.stringify({ phase: flow.phase,
    choicePending: game.field.choicePending, selection: game.field.eventState.snapshot().selected,
    recordedPlan: game.field.eventState.snapshot().global[15],
    potions: game.state.snapshot().items.find((row) => row.id === 2)?.count ?? 0,
    checkpointReady: game.checkpointReady, position: [game.field.player.x, game.field.player.y] }, null, 2);
}
$("start").onclick = () => {
  flow.start(new GameSession(field, catalog));
  flow.advance(0, { visible: true, mediaReady: true, overlayOpen: false });
  flow.session.field.startEvent("controlled_framework_choice"); sync(); $("game").focus();
};
$("next").onclick = () => { flow.confirm(); sync(); if (!flow.session.field.choice) $("game").focus(); };
$("pause-button").onclick = () => { flow.pause(!flow.paused); sync(); };
$("save").onclick = () => {
  saved = flow.session.checkpoint(); $("saved-state").textContent = "已保存到测试内存。"; sync();
};
$("restore").onclick = () => {
  if (!saved) return;
  flow.start(GameSession.restore(saved, field, catalog));
  $("saved-state").textContent = "已从测试内存恢复剧情状态、库存和地图进度。"; sync();
};
window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && !event.repeat) { event.preventDefault(); flow.pause(!flow.paused); sync(); return; }
  if (flow.session.field.choicePending) { view.keyboard(event); return; }
  if (event.target !== $("game") || event.repeat) return;
  if (["Enter", "Space"].includes(event.code)) { event.preventDefault(); flow.confirm(); sync(); }
  const direction = { ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left" }[event.code];
  if (direction) { event.preventDefault(); flow.move(direction); }
});
function frame(now) {
  if (stopped) return;
  try {
    flow.advance(last ? Math.min(100, now - last) : 0, { visible: !document.hidden, mediaReady: true, overlayOpen: false });
    last = now; sync(); renderer.draw(flow.session.field); requestAnimationFrame(frame);
  } catch (error) { stopped = true; $("status").textContent = String(error); console.error(error); }
}
$("start").disabled = false; sync(); requestAnimationFrame(frame);
