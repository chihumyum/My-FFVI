import { GameRenderer } from "./renderer.js";
import { reference } from "/evidence/reference-canvas.js";
const $ = (id) => document.getElementById(id);
const read = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw Error(`${r.status} ${url}`);
  return r.json();
};
const [data, battleData, fixtures] = await Promise.all([
  read("/play-data/data.json"),
  read("/play-data/battle.json"),
  read("/evidence/render-fixtures.json"),
]);
const renderer = new GameRenderer($("webgl"));
await renderer.init();
let game,
  oldDraw,
  selected,
  mode = "new",
  measure;
const samples = [];
for (const [index, fixture] of fixtures.entries()) {
  const button = document.createElement("button");
  button.textContent = fixture.name;
  button.onclick = () => select(index);
  $("scenes").append(button);
}
async function select(index) {
  selected = fixtures[index];
  game = {
    ...selected.state,
    actors: new Map(selected.state.actors.map((a) => [a.id, a])),
    map: await read(`/play-data/maps/${selected.state.mapId}.json`),
  };
  oldDraw = reference($("reference"), game, data, battleData);
  $("name").textContent =
    `${selected.name} · 原版 PR 数据 · ${selected.checkpoint}${selected.density ? "" : " 真实检查点"} · 地图 ${game.mapId}${selected.encounterId ? " / 阵型 " + selected.encounterId : ""} · 当前${mode === "new" ? "Pixi 320×180" : "旧Canvas 480×320"}视口`;
}
$("old").onclick = () => {
  mode = "old";
  $("reference").hidden = false;
  $("surface").hidden = true;
  if (selected) select(fixtures.indexOf(selected));
};
$("new").onclick = () => {
  mode = "new";
  $("reference").hidden = true;
  $("surface").hidden = false;
  if (selected) select(fixtures.indexOf(selected));
};
$("stress").onclick = () => {
  measure = { started: performance.now(), times: [], scene: selected.name };
  samples.length = 0;
};
function loop() {
  if (game) {
    if (mode === "old") oldDraw?.();
    renderer.render(game, data, battleData);
  }
  const metrics = renderer.metrics();
  if (measure) {
    measure.times.push(performance.now());
    if (performance.now() - measure.started >= 10000) {
      const delta = measure.times.slice(1).map((t, i) => t - measure.times[i]);
      delta.sort((a, b) => a - b);
      samples.push({
        scene: measure.scene,
        frames: delta.length,
        fps: (delta.length * 1000) / (measure.times.at(-1) - measure.times[0]),
        p95FrameMs: delta[Math.floor(delta.length * 0.95)],
        p99FrameMs: delta[Math.floor(delta.length * 0.99)],
        renderer: metrics,
      });
      measure = null;
    }
  }
  $("metrics").textContent = JSON.stringify(
    { mode, measuring: Boolean(measure), metrics, measurements: samples },
    null,
    2,
  );
  requestAnimationFrame(loop);
}
await select(0);
requestAnimationFrame(loop);
