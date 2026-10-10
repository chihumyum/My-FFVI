import { GameSession } from "/runtime/core/game-session.js";
import { Renderer } from "./renderer.js";
import { BattleView } from "./battle-view.js";
const $ = (id) => document.getElementById(id),
  canvas = $("game");
let content,
  battleContent,
  session,
  game,
  renderer,
  battleView,
  started = false,
  paused = false,
  last = 0,
  failed = false;
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
  if (!started || (game.stop && !session.battle)) return;
  paused = value;
  held.clear();
  $("pause").hidden = !value;
  $("menu-button").textContent = value ? "继续" : "暂停";
  sync();
  if (value) $("resume").focus();
  else focus();
}
function reset() {
  session = new GameSession(content, battleContent);
  game = session.field;
  started = true;
  paused = false;
  held.clear();
  for (const id of ["welcome", "pause", "stop", "dialogue"])
    $(id).hidden = true;
  battleView.hide();
  $("menu-button").disabled = false;
  $("menu-button").textContent = "暂停";
  focus();
  sync();
}
function text(id, value) {
  const node = $(id);
  if (node.textContent !== value) node.textContent = value;
}
function sync() {
  if (session.battle) {
    held.clear();
    $("dialogue").hidden = true;
    $("stop").hidden = true;
    battleView.sync(session.battle, paused);
    text(
      "status",
      `纳尔谢 · 战斗 · ${session.battle.phase === "active" ? "点击指令和目标；方向键选择，Enter 确认" : "战斗结束"}`,
    );
    return;
  }
  battleView.hide();
  $("dialogue").hidden = !game.dialogue || paused;
  if (game.dialogue) {
    text("speaker", game.dialogue.speaker);
    text("message", game.dialogue.text);
  }
  $("stop").hidden = !game.stop;
  if (game.stop) {
    held.clear();
    text("stop-title", "此处尚未迁移");
    text("stop-message", game.stop.message);
    text(
      "stop-source",
      game.stop.site
        ? `${game.stop.site.script} · 指令 ${game.stop.site.index}\n${game.stop.site.source.assetPath}\n${game.stop.site.source.pointer}`
        : "",
    );
    $("menu-button").disabled = true;
  }
  text(
    "status",
    game.stop
      ? "当前片段已停止，可重新开始。"
      : game.dialogue
        ? "空格 / Enter 继续对白"
        : game.busy
          ? "事件进行中…"
          : `纳尔谢 · ${game.player.x}, ${game.player.y} · ${session.gil} Gil`,
  );
}
function confirm() {
  if (!started || paused || game.stop) return;
  game.confirm();
  sync();
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && started) {
    e.preventDefault();
    if (!e.repeat) {
      if (session.battle && !paused && battleView.back()) sync();
      else pause(!paused);
    }
    return;
  }
  if (!started || paused) return;
  if (session.battle) {
    if (e.target === canvas || $("battle-menu").contains(e.target))
      battleView.keyboard(e);
    return;
  }
  if (document.activeElement !== canvas) return;
  if (directions[e.code]) {
    e.preventDefault();
    if (!e.repeat) {
      held.set(e.code, directions[e.code]);
      game.move(directions[e.code]);
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
  if (started) pause(true);
});
document.addEventListener("visibilitychange", () => {
  held.clear();
  last = 0;
  if (document.hidden && started) pause(true);
});
canvas.addEventListener("blur", () => held.clear());
canvas.addEventListener("click", focus);
$("start").onclick = reset;
$("restart").onclick = reset;
$("retry").onclick = reset;
$("resume").onclick = () => pause(false);
$("menu-button").onclick = () => pause(!paused);
$("next").onclick = () => {
  confirm();
  focus();
};
function frame(now) {
  if (failed) return;
  try {
    const dt = last ? Math.min(50, now - last) : 0;
    last = now;
    if (started && !paused && !document.hidden) {
      if (!session.battle && held.size) game.move([...held.values()].at(-1));
      session.advance(dt);
      sync();
    }
    if (session.battle) battleView.draw(session.battle);
    else if (renderer) renderer.draw(game);
    requestAnimationFrame(frame);
  } catch (error) {
    failure(error);
  }
}
function failure(error) {
  failed = true;
  held.clear();
  for (const id of ["pause", "dialogue", "stop", "battle-ui", "battle-result"])
    $(id).hidden = true;
  $("menu-button").disabled = true;
  $("welcome").hidden = false;
  $("load-error").hidden = false;
  $("load-error").textContent = String(error.message ?? error);
  $("start").disabled = true;
  $("start").textContent = "载入失败";
  text("status", "发生错误，已停止运行。");
}
async function init() {
  const responses = await Promise.all([
    fetch("/game/content.json"),
    fetch("/game/battle.json"),
  ]);
  if (responses.some((r) => !r.ok))
    throw new Error(
      "缺少内容，请先运行 npm run game:build 和 npm run battle:build。",
    );
  [content, battleContent] = await Promise.all(responses.map((r) => r.json()));
  const urls = new Set([
    ...Object.values(content.map.textures),
    ...Object.values(content.characters).flatMap((c) =>
      Object.values(c.sprites).map((s) => s.file),
    ),
    ...Object.values(battleContent.common.sprites).map((s) => s.file),
  ]);
  const images = new Map();
  await Promise.all(
    [...urls].map(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      images.set(url, img);
    }),
  );
  session = new GameSession(content, battleContent);
  game = session.field;
  renderer = new Renderer(canvas, content, images);
  battleView = new BattleView(
    canvas,
    battleContent.common,
    images,
    () => {
      if (session.continueVictory()) {
        sync();
        focus();
      }
    },
    () => {
      if (session.retryBattle()) {
        sync();
        focus();
      }
    },
  );
  for (const line of [
    content.entry.description,
    ...content.limitations,
    ...battleContent.common.limitations,
  ]) {
    const li = document.createElement("li");
    li.textContent = line;
    $("limitations").append(li);
  }
  $("start").disabled = false;
  text("start", "进入纳尔谢");
  text("status", "地图与战斗已载入 · 本地开发预览");
  requestAnimationFrame(frame);
}
init().catch(failure);
