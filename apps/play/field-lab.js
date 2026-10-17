import { GameRenderer } from "./renderer.js";
import { WebData, webIndexURL } from "./data.js";
import { loadBattlePresentation } from "./presentation.js";
import { PRFilter } from "./pr-filters.js";
const $ = (id) => document.getElementById(id);
const read = async (file) => {
  const r = await fetch(file);
  if (!r.ok) throw Error(`${file}: ${r.status}`);
  return r.json();
};
const renderer = new GameRenderer($("screen"));
await renderer.init();
const repository = new WebData(webIndexURL());
repository.index = await repository.json(webIndexURL().href);
renderer.setAssets(repository.index.assets.images, repository.baseURL);
await loadBattlePresentation(repository, renderer);
let previewFilter = null;
for (const name of Object.keys(renderer.shaderCatalog?.shaders || {})) {
  const option = document.createElement("option");
  option.value = option.textContent = name;
  $("shader").append(option);
}
$("shader").onchange = () => {
  previewFilter?.destroy();
  previewFilter = null;
  const name = $("shader").value;
  if (!name) {
    renderer.setFilters([renderer.fieldPresentation.screenFilter]);
    $("shader-status").textContent = "场景默认";
    return;
  }
  const definition = renderer.shaderCatalog.shaders[name];
  const material = { floats: {}, colors: {}, textures: {} };
  for (const p of definition.properties) {
    if (p.type === 0) material.colors[p.name] = p.default;
    else if ([2, 3].includes(p.type)) material.floats[p.name] = p.default[0];
  }
  const scenery = renderer.fieldPresentation.catalog.scenery;
  material.textures._MaskTex = scenery.near.map_near.find(
    (s) => s.name === "foreground_alpha_mask",
  );
  material.textures._MainTex2 = scenery.far.map_far_map_20170.find((s) => s.name.endsWith("_2"));
  if (/CrossFade/.test(name)) material.floats._BlendRatio = 0.5;
  if (/LastBackGround/.test(name)) {
    material.colors._TintColor = [1, 0.65, 0.5, 1];
    material.floats._Weight = 0.7;
    material.floats._Block = 80;
  }
  previewFilter = new PRFilter(name, {
    material,
    getTexture: (url) => renderer.getTexture(url),
    width: 320,
    height: 180,
  });
  renderer.setFilters([previewFilter]);
  $("shader-status").textContent =
    name +
    " · " +
    definition.adapter.operations.join(" / ") +
    " · " +
    definition.adapter.approximations.join("; ");
};
const [data, battleData, fixtures] = await Promise.all([
  read("/play-data/data.json"),
  read("/play-data/battle.json"),
  read("/evidence/render-fixtures.json"),
]);
const camp = await read("/evidence/stage1-checkpoints/kefka-camp.json").catch(() => null);
if (camp) {
  const saved = camp.snapshot || camp;
  fixtures.push({
    name: "帝国军营遮罩",
    checkpoint: "kefka-camp",
    state: {
      mapId: saved.mapId,
      time: saved.time,
      player: saved.player,
      actors: saved.actors.map(([, actor]) => actor),
    },
  });
}
let game,
  selected,
  gray = false,
  measure = null,
  measurements = [],
  last = performance.now();
for (const [index, fixture] of fixtures.entries()) {
  const button = document.createElement("button");
  button.textContent = fixture.name;
  button.onclick = () => select(index);
  $("scenes").append(button);
}
async function select(index) {
  selected = fixtures[index];
  renderer.resetPresentation();
  game = {
    ...structuredClone(selected.state),
    actors: new Map(selected.state.actors.map((a) => [a.id, structuredClone(a)])),
    map: await repository.json(repository.index.maps[selected.state.mapId]),
  };
  $("name").textContent = `${selected.name} · PR 地图 ${game.mapId} · ${selected.checkpoint}`;
}
function command(name, i = [], r = [], s = []) {
  renderer.event({
    kind: "presentation-command",
    name,
    i,
    r,
    s,
    time: game.time,
    mapId: game.mapId,
  });
}
$("flight").onclick = () => command("ChangeView", [1]);
$("ordinary").onclick = () => command("ChangeView", [0]);
$("night").onclick = () => command("SysCall", [], [], ["背景変更：飛空艇（特殊）"]);
$("day").onclick = () => command("SysCall", [], [], ["背景変更：飛空艇（通常）"]);
$("gray").onclick = () => {
  gray = !gray;
  command("SysCall", [], [], [gray ? "モノクロフィルターかける" : "モノクロフィルターはずす"]);
};
$("measure").onclick = () => {
  measure = { name: $("name").textContent, started: performance.now(), frames: [] };
};
function tick(now) {
  if (game) {
    game.time += Math.min(0.1, Math.max(0, (now - last) / 1000));
    renderer.render(game, data, battleData);
    previewFilter?.update(game.time, { width: 320, height: 180 });
  }
  last = now;
  if (measure) {
    measure.frames.push(now);
    if (now - measure.started > 10000) {
      const intervals = measure.frames
        .slice(1)
        .map((n, i) => n - measure.frames[i])
        .sort((a, b) => a - b);
      measurements.push({
        scene: measure.name,
        fps: (1000 * intervals.length) / (now - measure.frames[0]),
        p95FrameMs: intervals[Math.floor(intervals.length * 0.95)],
        metrics: renderer.metrics(),
      });
      measure = null;
    }
  }
  $("metrics").textContent = JSON.stringify(
    { measuring: !!measure, metrics: renderer.metrics(), measurements },
    null,
    2,
  );
  requestAnimationFrame(tick);
}
await select(0);
requestAnimationFrame(tick);
