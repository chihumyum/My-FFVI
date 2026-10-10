import { FieldGame } from "/runtime/core/field.js";
import { Renderer } from "./renderer.js";
const $ = (id) => document.getElementById(id),
  canvas = $("game");
let content,
  game,
  renderer,
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
function focus() {
  canvas.focus();
}
function pause(value) {
  if (!started || game.stop) return;
  paused = value;
  held.clear();
  $("pause").hidden = !value;
  $("dialogue").hidden = value || !game.dialogue;
  $("menu-button").textContent = value ? "继续" : "暂停";
  if (value) $("resume").focus();
  else focus();
}
function reset() {
  game = new FieldGame(content);
  started = true;
  paused = false;
  held.clear();
  $("welcome").hidden = true;
  $("pause").hidden = true;
  $("stop").hidden = true;
  $("dialogue").hidden = true;
  $("menu-button").disabled = false;
  $("menu-button").textContent = "暂停";
  focus();
  sync();
}
function setText(id, value) {
  const node = $(id);
  if (node.textContent !== value) node.textContent = value;
}
function sync() {
  $("dialogue").hidden = !game.dialogue || paused;
  if (game.dialogue) {
    setText("speaker", game.dialogue.speaker);
    setText("message", game.dialogue.text);
  }
  if (game.stop) {
    held.clear();
    $("stop").hidden = false;
    setText(
      "stop-title",
      game.stop.kind === "encounter" ? "已到达战斗" : "此处尚未迁移",
    );
    setText("stop-message", game.stop.message);
    setText(
      "stop-source",
      game.stop.site
        ? `${game.stop.site.script} · 指令 ${game.stop.site.index}\n${game.stop.site.source.assetPath}\n${game.stop.site.source.pointer}`
        : "",
    );
    $("menu-button").disabled = true;
  }
  setText(
    "status",
    game.stop
      ? "当前片段已停止，可重新开始。"
      : game.dialogue
        ? "空格 / Enter 继续对白"
        : game.busy
          ? "事件进行中…"
          : `纳尔谢 · ${game.player.x}, ${game.player.y}`,
  );
}
function confirm() {
  if (!started || paused || game.stop) return;
  game.confirm();
  sync();
}
function keydown(e) {
  if (e.code === "Escape" && started) {
    e.preventDefault();
    if (!e.repeat) pause(!paused);
    return;
  }
  if (document.activeElement !== canvas || paused || !started) return;
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
}
window.addEventListener("keydown", keydown);
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
      if (held.size) game.move([...held.values()].at(-1));
      game.advance(dt);
      sync();
    }
    if (renderer) renderer.draw(game);
    requestAnimationFrame(frame);
  } catch (error) {
    failure(error);
  }
}
function failure(error) {
  failed = true;
  held.clear();
  for (const id of ["pause", "dialogue", "stop"]) $(id).hidden = true;
  $("menu-button").disabled = true;
  $("welcome").hidden = false;
  $("load-error").hidden = false;
  $("load-error").textContent = String(error.message ?? error);
  $("start").disabled = true;
  $("start").textContent = "载入失败";
  $("status").textContent = "发生错误，已停止运行。";
}
async function init() {
  const response = await fetch("/game/content.json");
  if (!response.ok)
    throw new Error("缺少游戏内容，请先运行 npm run game:build。");
  content = await response.json();
  const urls = new Set([
    ...Object.values(content.map.textures),
    ...Object.values(content.characters).flatMap((c) =>
      Object.values(c.sprites).map((s) => s.file),
    ),
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
  game = new FieldGame(content);
  renderer = new Renderer(canvas, content, images);
  for (const text of [content.entry.description, ...content.limitations]) {
    const li = document.createElement("li");
    li.textContent = text;
    $("limitations").append(li);
  }
  $("start").disabled = false;
  $("start").textContent = "进入纳尔谢";
  $("status").textContent = "地图与角色已载入 · 本地开发预览";
  requestAnimationFrame(frame);
}
init().catch(failure);
