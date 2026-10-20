import { PlayGame } from "../../src/play/game.js";
import { GameRenderer } from "./renderer.js";
import { createAktoContent } from "./akto-content.js";
import { createAktoCityContent } from "./akto-city-content.js";

const $ = (id) => document.getElementById(id);
const root = new URL("./trial/", location.href);
const art = await fetch(new URL("art-data.json", root)).then((r) => {
  if (!r.ok) throw Error(`阿克托资源加载失败：${r.status}`);
  return r.json();
});
const content = (art.city ? createAktoCityContent : createAktoContent)({ ...art, root });
if (art.city) {
  document.title = "阿克托 · 双子内城";
  document.querySelector(".eyebrow").textContent = "MY FFVI / AKTO CITY";
  document.querySelector(".intro").textContent =
    "河西水庭与彩幔，河东炉火与巨兵。一座可以步行探索的边疆双子城。";
  document.querySelector("aside p").textContent =
    "西北：水庭旧城 · 西南：彩幔商埠 · 东北：双子上城 · 东南：炉脊工区。带木招牌的门可进入；水庭两侧有楼梯，旧城东侧有眺望高廊。";
  document.querySelector("aside .panel-top span + span").textContent = "四区 / 六地标";
  document.querySelector("footer").textContent =
    "阿克托城市骨架 · 16 像素格拼装 · 8 处室内 · 本机独立试玩";
  document.querySelector(".section-title p").textContent =
    "本轮使用 7 张部件图集与 1 条天空色带，地图按 16 像素格拼装。NPC 沿用 PR 素材。";
}
const renderer = await new GameRenderer($("game")).init();
renderer.setAssets({});
let game;
const history = [];
const imageCache = new Map();
const image = (url) => {
  if (!imageCache.has(url))
    imageCache.set(
      url,
      new Promise((resolve, reject) => {
        const value = new Image();
        value.onload = () => resolve(value);
        value.onerror = reject;
        value.src = url;
      }),
    );
  return imageCache.get(url);
};
await Promise.all(Object.values(content.maps[9100].textures).map(image));
const names = {
  wall: "重复墙段",
  gate: "中央城门",
  tower: "双子塔楼",
  bridge: "纵向桥段",
  bank: "护城河岸",
  ground: "城外荒地",
  water: "护城河水面",
  icon: "大地图城标",
  factory: "城区厂房",
  paving: "城区铺地",
  stone: "石材与建筑格",
  canopy: "彩幔格",
  garden: "水庭与花木格",
  props: "街巷物件格",
  mechanics: "机械构件格",
  giant: "巨兵零件格",
  horizon: "远景构件格",
  sky: "天空平铺色带",
};
for (const [name, m] of Object.entries(art.modules)) {
  if (m.derivedFrom) continue;
  const figure = document.createElement("figure");
  figure.className = "asset";
  const picture = document.createElement("div");
  picture.className = "picture";
  const img = document.createElement("img");
  img.src = new URL(m.file, root);
  img.alt = names[name];
  picture.append(img);
  const caption = document.createElement("figcaption");
  caption.append(document.createTextNode(names[name]));
  const size = document.createElement("small");
  size.textContent = `${m.width} × ${m.height}`;
  caption.append(size);
  figure.append(picture, caption);
  $("assets").append(figure);
}
$("city-icon").src = new URL(art.modules.icon.file, root);
$("guard-sheet").src = new URL("assets/guard-sheet.png", root);

async function start() {
  history.length = 0;
  document.getElementById("landmark-gallery")?.remove();
  game = new PlayGame({
    data: structuredClone(content.data),
    battleData: content.battleData,
    loadMap: async (id) => structuredClone(content.maps[id]),
    onEvent: (event) => {
      history.push(event);
      if (history.length > 80) history.shift();
      if (event.kind === "map")
        $("status").textContent =
          event.mapId === 9101 ? "向北走近城标，即可进入阿克托。" : "沿着桥向北走，抵达城门。";
      if (art.city && event.kind === "map")
        $("status").textContent = "沿宽街自由探索；走进带招牌的门，或从水庭两侧的楼梯登高。";
      if (event.kind === "dialogue" && event.key === "halt")
        $("status").textContent = art.city
          ? "城防团正在查验。读完对白后继续向北，即可进入四区。"
          : "守卫已拦下来访者。确认阅读对白后，可以沿桥返回。";
    },
  });
  if (art.city && new URLSearchParams(location.search).get("entry") === "city")
    game.data.entry = { mapId: 9102, entrance: 1, script: "akto_init" };
  await game.start();
  game.unit(1).magitek = false;
  $("status").textContent =
    game.mapId === 9102
      ? "沿宽街自由探索；带木招牌的门可进入，水庭两侧的楼梯可以登高。"
      : "沿着桥向北走，抵达城门。";
  window.akto = { game, renderer, history, content };
  await drawOverview(true);
}
const keys = new Set();
const directions = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
};
window.addEventListener("keydown", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (directions[key]) {
    keys.add(directions[key]);
    event.preventDefault();
  }
  if (["Enter", " ", "z"].includes(key)) {
    if (!event.repeat) game.confirm();
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) =>
  keys.delete(directions[event.key.length === 1 ? event.key.toLowerCase() : event.key]),
);
window.addEventListener("blur", () => keys.clear());
for (const button of document.querySelectorAll("[data-move]")) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    keys.add(button.dataset.move);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(type, () => keys.delete(button.dataset.move));
}
$("confirm").addEventListener("click", () => game.confirm());
$("dialogue").addEventListener("click", () => game.confirm());
$("restart").addEventListener("click", start);
$("region").addEventListener("click", async () => {
  if (game.busy) return;
  await game.enter(game.mapId === 9100 ? 9101 : 9100, 1);
});
let overviewKey = "";
const overviewBackground = document.createElement("canvas");
async function drawOverview(force = false) {
  const map = game.map;
  if (overviewKey !== map.id || force) {
    overviewKey = map.id;
    delete overviewBackground.dataset.labeled;
    overviewBackground.width = map.width * 16;
    overviewBackground.height = map.height * 16;
    const ctx = overviewBackground.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#17201d";
    ctx.fillRect(0, 0, overviewBackground.width, overviewBackground.height);
    for (const layer of map.layers) {
      for (let index = 0; index < layer.data.length; index++) {
        const raw = layer.data[index] >>> 0,
          gid = raw & 0x0fffffff;
        if (!gid) continue;
        const set = [...map.tilesets].reverse().find((s) => s.firstgid <= gid);
        const texture = await image(map.textures[set.image]);
        const n = gid - set.firstgid;
        ctx.save();
        ctx.translate((index % map.width) * 16 + 8, Math.floor(index / map.width) * 16 + 8);
        ctx.scale(raw & 0x80000000 ? -1 : 1, raw & 0x40000000 ? -1 : 1);
        ctx.drawImage(
          texture,
          (n % set.columns) * 16,
          Math.floor(n / set.columns) * 16,
          16,
          16,
          -8,
          -8,
          16,
          16,
        );
        ctx.restore();
      }
    }
    $("overview").width = overviewBackground.width;
    $("overview").height = overviewBackground.height;
  }
  if (art.city && map.id === 9102 && (force || !overviewBackground.dataset.labeled)) {
    const c = overviewBackground.getContext("2d");
    c.font = "bold 27px sans-serif";
    c.textAlign = "center";
    c.lineWidth = 6;
    for (const p of content.city.landmarks.filter((p) => p.mapId === 9102)) {
      c.strokeStyle = "#17201d";
      c.fillStyle = "#f4d393";
      c.strokeText(p.name, p.x * 16, (p.y - 3) * 16);
      c.fillText(p.name, p.x * 16, (p.y - 3) * 16);
    }
    overviewBackground.dataset.labeled = "yes";
  }
  if (art.city && map.id === 9102 && !document.getElementById("landmark-gallery")) {
    const section = document.createElement("section");
    section.id = "landmark-gallery";
    section.className = "asset-section";
    const title = document.createElement("h2");
    title.textContent = "城中的五处地标";
    section.append(title);
    const grid = document.createElement("div");
    grid.className = "landmark-grid";
    for (const p of content.city.landmarks.filter((p) => p.mapId === 9102)) {
      const figure = document.createElement("figure"),
        c = document.createElement("canvas"),
        caption = document.createElement("figcaption");
      c.width = 384;
      c.height = 288;
      const cc = c.getContext("2d");
      cc.imageSmoothingEnabled = false;
      const centerY =
        p.name === "天秤连桥"
          ? 59
          : p.name === "跪伏巨兵"
            ? 30
            : p.name === "赤炉巨轮"
              ? 99
              : p.name === "悬水庭"
                ? 29
                : p.y;
      cc.drawImage(
        overviewBackground,
        (p.x - 12) * 16,
        (centerY - 9) * 16,
        384,
        288,
        0,
        0,
        384,
        288,
      );
      caption.textContent = p.name;
      figure.append(c, caption);
      grid.append(figure);
    }
    section.append(grid);
    document.querySelector(".asset-section").before(section);
  }
  const ctx = $("overview").getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(overviewBackground, 0, 0);
  const actors = [...game.actors.values(), game.player].filter(
    (a) => a.visible !== false && a.asset,
  );
  for (const actor of actors) {
    const char = game.data.characters[actor.asset.toLowerCase()];
    if (!char) continue;
    const frame = renderer.fieldAnimations.sample(actor, char, game.time, actor.asset);
    const info = frame?.info;
    if (!info) continue;
    const im = await image(info.file);
    const width = info.logicalWidth || info.width || im.width;
    const height = info.logicalHeight || info.height || im.height;
    // The core already integrates puppet motion into the actor's live position.
    const x = actor.x;
    const y = actor.y;
    ctx.drawImage(im, (x + 0.5) * 16 - width / 2, (y + 0.5) * 16 - height, width, height);
  }
  ctx.strokeStyle = "#f0c674";
  ctx.lineWidth = 2;
  ctx.strokeRect(game.player.x * 16 - 1, game.player.y * 16 - 13, 18, 22);
  $("overview").dataset.mapId = String(map.id);
}
await start();
$("loading").hidden = true;
let previous = performance.now(),
  nextMove = 0,
  nextOverview = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  game.tick(dt);
  if (keys.size && now >= nextMove) {
    game.move([...keys].at(-1));
    nextMove = now + 125;
  }
  const box = $("stage").getBoundingClientRect();
  renderer.resize(box.width, box.height);
  renderer.render(game, game.data, content.battleData);
  $("dialogue").hidden = !game.dialogue;
  if (game.dialogue) {
    $("speaker").textContent = game.dialogue.speaker;
    $("message").textContent = game.dialogue.text;
  }
  $("place").textContent = game.mapId === 9100 ? "共用城门 · 南桥" : "阿克托近郊 · 走近城标入城";
  $("region").textContent = game.mapId === 9100 ? "区域地图" : "返回城门";
  if (art.city) {
    let place = content.data.mapTitles[game.mapId] || "阿克托";
    if (game.mapId === 9102)
      place =
        (game.player.x < 60
          ? game.player.y < 62
            ? "水庭旧城"
            : "彩幔商埠"
          : game.player.x > 68
            ? game.player.y < 62
              ? "双子上城"
              : "炉脊工区"
            : "内河与天秤连桥") + (game.player.layer === 1 ? " · 悬水庭上层" : "");
    $("place").textContent = place;
    $("region").textContent = game.mapId === 9101 ? "返回城门" : "区域地图";
  }
  if (now >= nextOverview) {
    nextOverview = now + 100;
    drawOverview().catch(console.error);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
