import { readFile, writeFile } from "node:fs/promises";
import { PlayGame } from "../../src/play/game.js";
import { Battle } from "../../src/play/battle.js";
const root = process.env.PLAY_DATA_DIR || "build/web-data";
const read = async (file) => JSON.parse(await readFile(file));
const data = await read(`${root}/data.json`),
  battleData = await read(`${root}/battle.json`);
const fixtures = [];
const unit = (u) =>
  Object.fromEntries(
    [
      "id",
      "name",
      "hp",
      "maxHp",
      "mp",
      "maxMp",
      "hidden",
      "removed",
      "escaped",
      "row",
      "sprite",
      "atb",
      "ready",
    ].map((key) => [key, u[key]]),
  );
for (const [name, checkpoint, encounterId] of [
  ["纳尔谢", "narshe-rock", 0],
  ["世界地图", "figaro-gate", 0],
  ["飞空艇甲板", "narshe-report", 0],
  ["普通战斗", "figaro-gate", 1],
  ["Boss 战", "vargas", 436],
]) {
  const snapshot = await read(`build/play/stage1-checkpoints/${checkpoint}.json`);
  const game = new PlayGame({
    data,
    battleData,
    Battle,
    loadMap: (id) => read(`${root}/maps/${id}.json`),
  });
  await game.restore(snapshot);
  const state = {
    mapId: game.mapId,
    time: game.time,
    player: game.player,
    camera: game.camera,
    actors: [...game.actors.values()],
    fade: null,
  };
  if (encounterId) {
    const b = new Battle({
      data: battleData,
      party: game.party,
      inventory: game.inventory,
      encounterId,
      random: () => 0.5,
    });
    state.battle = {
      formation: b.formation,
      players: b.players.map((u) =>
        unit({ ...u, sprite: battleData.characters[u.id]?.sprite || u.sprite }),
      ),
      enemies: b.enemies.map(unit),
      time: b.time,
    };
  }
  fixtures.push({ name, checkpoint, encounterId, state });
}
// Performance fixture: find the densest viewport in every exported PR map.
// This is a drawing stress case, not a claimed story checkpoint.
let densest = { count: -1 };
for (const id of Object.keys(data.maps)) {
  const map = await read(`${root}/maps/${id}.json`);
  const w = map.width,
    h = map.height,
    tile = map.tileSize || 16;
  const grid = new Uint16Array(w * h);
  for (const layer of map.layers || [])
    if (layer.data)
      for (let y = 0; y < Math.min(h, layer.height); y++)
        for (let x = 0; x < Math.min(w, layer.width); x++)
          if ((layer.data[y * layer.width + x] >>> 0) & 0x1fffffff) grid[y * w + x]++;
  const stride = w + 1,
    sum = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      sum[(y + 1) * stride + x + 1] =
        grid[y * w + x] + sum[y * stride + x + 1] + sum[(y + 1) * stride + x] - sum[y * stride + x];
  const vw = Math.ceil(320 / tile) + 1,
    vh = Math.ceil(180 / tile) + 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const right = Math.min(w, x + vw),
        bottom = Math.min(h, y + vh);
      const count =
        sum[bottom * stride + right] -
        sum[y * stride + right] -
        sum[bottom * stride + x] +
        sum[y * stride + x];
      if (count > densest.count)
        densest = { count, id: Number(id), x: x + 160 / tile, y: y + 90 / tile };
    }
}
fixtures.push({
  name: "最密集地图",
  checkpoint: "PR 全量地图瓦片密度扫描（绘制压力用例）",
  encounterId: 0,
  state: {
    ...fixtures[0].state,
    mapId: densest.id,
    actors: [],
    camera: { manual: false },
    player: { ...fixtures[0].state.player, x: densest.x, y: densest.y },
  },
  density: densest.count,
});
await writeFile("build/play/render-fixtures.json", JSON.stringify(fixtures));
console.log(
  fixtures.map(({ name, state, encounterId }) => ({
    name,
    mapId: state.mapId,
    encounterId,
    enemies: state.battle?.enemies.map((u) => u.name),
  })),
);
