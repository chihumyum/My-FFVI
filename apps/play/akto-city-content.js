import { createAktoContent } from "./akto-content.js";
const op = (name, i = [], r = [], s = []) => [name, i, r, s, 1, ""];
const H = 0x80000000,
  V = 0x40000000;

// Authored streets and small tile modules. No generated whole-map image is used.
export function createAktoCityContent(options) {
  const content = createAktoContent(options);
  const { data, maps } = content;
  const template = maps[9100];
  const sets = Object.fromEntries(template.tilesets.map((s) => [s.name, s]));
  const make = (id, w, h, name) => ({
    id,
    name,
    areaId: id,
    initializer: "akto_init",
    width: w,
    height: h,
    tileSize: 16,
    tilesets: structuredClone(template.tilesets),
    textures: { ...template.textures },
    layers: [],
    collisions: { 0: Array(w * h).fill(1), 1: Array(w * h).fill(1) },
    entities: [],
    groups: {},
    routes: {},
  });
  const layer = (m, name) => {
    const l = {
      name,
      sourceGroup: "TileGroup",
      width: m.width,
      height: m.height,
      data: Array(m.width * m.height).fill(0),
    };
    m.layers.push(l);
    return l;
  };
  const rect = (m, x, y, w, h, value = 0, plane = 0) => {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        if (i >= 0 && j >= 0 && i < m.width && j < m.height)
          m.collisions[plane][j * m.width + i] = value;
  };
  const cell = (m, l, set, n, x, y, flipX = false, flipY = false) => {
    // Overlapping mechanical pieces keep their alpha instead of erasing one another.
    if (set === "giantLarge" || (set === "mechanicsLarge" && n === 13))
      l = layer(m, `BottomAssembly${m.layers.length}`);
    const s = sets[set],
      size = s.columns / 4,
      sx = (n % 4) * size,
      sy = Math.floor(n / 4) * size;
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++)
        if (x + i >= 0 && y + j >= 0 && x + i < m.width && y + j < m.height)
          l.data[(y + j) * m.width + x + i] =
            (s.firstgid +
              (sy + (flipY ? size - 1 - j : j)) * s.columns +
              sx +
              (flipX ? size - 1 - i : i)) |
            (flipX ? H : 0) |
            (flipY ? V : 0);
  };
  const fill = (m, l, set, n, x, y, w, h) => {
    for (let j = y; j < y + h; j += 2) for (let i = x; i < x + w; i += 2) cell(m, l, set, n, i, j);
  };
  const module = (m, l, name, x, y) => {
    const s = sets[name];
    for (let j = 0; j < s.imageheight / 16; j++)
      for (let i = 0; i < s.columns; i++)
        if (x + i >= 0 && y + j >= 0 && x + i < m.width && y + j < m.height)
          l.data[(y + j) * m.width + x + i] = s.firstgid + j * s.columns + i;
  };
  const clear = (m, l, x, y, w, h) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) l.data[j * m.width + i] = 0;
  };
  const entry = (m, id, x, y, layer = 0, direction = "up") =>
    m.entities.push({ id: `entry-${id}`, objectId: id, kind: 0, x, y, layer, direction });
  const exit = (m, id, x, y, mapId, entrance, layer = 0) =>
    m.entities.push({ id, kind: 3, x, y, layer, destination: { mapId, entrance } });
  let serial = 500;
  const npc = (m, x, y, asset, text, speaker = "阿克托居民", extra = {}) => {
    const id = String(serial++),
      key = `city_${id}`;
    data.messages[key] = text;
    data.speakers[key] = speaker;
    const actor = {
      id,
      kind: 6,
      x,
      y,
      layer: 0,
      width: 1,
      height: 1,
      direction: "down",
      asset,
      collision: true,
      npc: {
        collision: true,
        moveType: 0,
        eyeContact: true,
        turnAround: true,
        interaction: { message: { key } },
      },
      ...extra,
    };
    m.entities.push(actor);
    return actor;
  };
  const city = make(9102, 128, 128, "Akto_Four_Districts");
  maps[9102] = city;
  const floor = layer(city, "BottomGround"),
    water = layer(city, "BottomRiver"),
    build = layer(city, "BottomBuildings"),
    detail = layer(city, "BottomStreetDetails"),
    upper = layer(city, "GroundTerraces");
  fill(city, floor, "stone", 2, 0, 0, 128, 128);
  rect(city, 2, 2, 124, 124);
  const districts = [
    { name: "水庭旧城", x: 4, y: 4, w: 54, h: 50, ground: 0, roof: 12, industrial: false },
    { name: "双子上城", x: 72, y: 4, w: 52, h: 50, ground: 0, roof: 13, industrial: true },
    { name: "彩幔商埠", x: 4, y: 74, w: 54, h: 50, ground: 1, roof: 13, industrial: false },
    { name: "炉脊工区", x: 72, y: 74, w: 52, h: 50, ground: 1, roof: 12, industrial: true },
  ];
  for (const d of districts) fill(city, floor, "stone", d.ground, d.x, d.y, d.w, d.h);
  // Quays and broad sight corridors connect the four quarters without corridor maps.
  for (const x of [6, 24, 44, 56, 70, 88, 108, 122]) fill(city, floor, "stone", 0, x, 4, 4, 120);
  for (const y of [20, 40, 54, 62, 74, 90, 110, 122])
    fill(city, floor, "stone", 0, 4, y, 120, y === 62 ? 6 : 4);
  fill(city, water, "horizon", 3, 60, 2, 8, 114);
  const waterSet = sets.waterFlow;
  for (const set of city.tilesets)
    if (set.name === "waterFlow")
      set.tiles = Array.from({ length: 16 }, (_, id) => ({
        id,
        animation: [
          { tileid: id, duration: 420 },
          { tileid: id + 16, duration: 420 },
        ],
      }));
  for (let y = 2; y < 116; y += 4)
    for (let x = 60; x < 68; x += 4) {
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++)
          water.data[(y + j) * 128 + x + i] = waterSet.firstgid + j * 4 + i;
    }
  rect(city, 60, 2, 8, 114, 1);
  // River retaining edges are small stone tiles, with repeated bollards and greenery.
  for (let y = 4; y < 114; y += 6) {
    cell(city, detail, "props", 5, 58, y);
    cell(city, detail, "props", 5, 68, y);
  }
  for (const y of [16, 62, 106]) {
    clear(city, water, 60, y, 8, 6);
    fill(city, floor, "stone", 13, 58, y, 12, 6);
    rect(city, 58, y, 12, 6);
    for (let x = 58; x < 70; x += 2) {
      cell(city, detail, "mechanics", 6, x, y);
      cell(city, detail, "mechanics", 6, x, y + 4);
    }
    rect(city, 58, y, 12, 2, 1);
    rect(city, 58, y + 4, 12, 2, 1);
  }
  // Each facade and roof is assembled from 32px cells split into 16px tiles.
  const houses = [];
  function house(x, y, w, h, industrial = false, seed = 0) {
    fill(
      city,
      build,
      industrial ? "mechanics" : "stone",
      industrial ? 4 : seed % 3 === 0 ? 13 : 12,
      x,
      y,
      w,
      h - 4,
    );
    fill(
      city,
      build,
      industrial ? "mechanics" : "stone",
      industrial ? 5 : 4 + (seed % 3),
      x,
      y + h - 4,
      w,
      4,
    );
    for (let i = x + 1; i < x + w - 1; i += 4)
      cell(city, detail, "stone", seed % 2 ? 8 : 9, i, y + h - 4);
    const doorX = x + Math.floor(w / 4) * 2;
    cell(city, detail, "stone", 10, doorX, y + h - 2);
    rect(city, x, y, w, h, 1);
    houses.push({ x, y, w, h, doorX, industrial });
    if (industrial) {
      cell(city, detail, "mechanics", 11, x + w - 3, y - 1);
      cell(city, detail, "mechanics", 7, x, y + 2);
    } else {
      cell(city, detail, "garden", 2, x - 2, y + h - 2);
      cell(city, detail, "garden", 3, x + w, y + h - 2);
    }
    return houses.at(-1);
  }
  for (const d of districts) {
    let seed = 0;
    for (const y of [d.y + 2, d.y + 22, d.y + 38])
      for (const x of [d.x + 5, d.x + 25, d.x + 43]) {
        if (x + 8 > d.x + d.w || y + 8 > d.y + d.h) continue;
        // Central district squares are intentionally left open for the six landmarks.
        if (y === d.y + 22 && x >= d.x + 20) continue;
        house(x, y, seed % 3 === 0 ? 10 : 8, 8, d.industrial, seed++);
      }
  }
  // Perimeter wall segments reuse the approved gate kit rather than a city painting.
  for (let x = 0; x < 128; x += 4) {
    module(city, build, "wall", x, 0);
    module(city, build, "wall", x, 124);
  }
  rect(city, 0, 0, 128, 6, 1);
  rect(city, 0, 124, 128, 4, 1);
  for (let y = 6; y < 124; y += 2) {
    cell(city, build, "stone", 7, 0, y);
    cell(city, build, "stone", 7, 126, y);
  }
  rect(city, 0, 0, 2, 128, 1);
  rect(city, 126, 0, 2, 128, 1);
  clear(city, build, 60, 124, 8, 4);
  rect(city, 60, 116, 8, 12);
  fill(city, floor, "stone", 3, 58, 116, 12, 12);
  // 百幔大市: alternating cloth tops and fringes over narrow stall rows, with open crossings.
  fill(city, floor, "stone", 13, 18, 94, 30, 14);
  for (const y of [94, 102])
    for (let x = 18; x < 46; x += 8) {
      const c = (Math.floor((x - 18) / 8) + Math.floor((y - 94) / 8)) % 4;
      for (const dx of [0, 2]) {
        cell(city, detail, "canopy", 4 + c, x + dx, y);
        cell(city, detail, "canopy", c, x + dx, y + 2);
        cell(city, detail, "canopy", 8 + c, x + dx, y + 4);
        cell(city, detail, "props", dx ? 9 : 8, x + dx, y + 5);
      }
      rect(city, x, y, 4, 7, 1);
    }
  for (const x of [17, 47]) for (const y of [94, 102]) cell(city, detail, "canopy", 12, x, y);
  for (let x = 20; x < 46; x += 6) cell(city, detail, "canopy", 13, x, 91);
  // 悬水庭: a real second walking plane with two stair landings and an aqueduct arcade.
  fill(city, build, "stone", 7, 22, 24, 22, 10);
  rect(city, 22, 24, 22, 10, 1);
  fill(city, upper, "stone", 13, 22, 24, 22, 8);
  rect(city, 22, 24, 22, 8, 0, 1);
  for (let x = 22; x < 44; x += 4) {
    cell(city, detail, "garden", 6, x, 32);
    cell(city, detail, "garden", 7, x, 30);
    cell(city, upper, "garden", 14, x, 24);
    rect(city, x, 24, 2, 2, 1, 1);
  }
  for (const x of [22, 42]) {
    cell(city, upper, "garden", 15, x, 32);
    rect(city, x, 32, 2, 2);
    rect(city, x, 32, 2, 2, 0, 1);
    for (let i = 0; i < 2; i++) {
      city.entities.push({
        id: `garden-up-${x + i}`,
        kind: 4,
        x: x + i,
        y: 32,
        layer: 0,
        destinationLayer: 1,
      });
      city.entities.push({
        id: `garden-down-${x + i}`,
        kind: 4,
        x: x + i,
        y: 33,
        layer: 1,
        destinationLayer: 0,
      });
    }
  }
  cell(city, upper, "garden", 4, 31, 27);
  rect(city, 31, 27, 2, 2, 1, 1);
  for (const x of [24, 38]) {
    cell(city, upper, "garden", 0, x, 27);
    cell(city, upper, "garden", 10, x + 2, 27);
    rect(city, x, 27, 4, 2, 1, 1);
  }
  // 赤炉巨轮: four flipped gear quadrants, pipes, furnace cells and a service court.
  fill(city, floor, "mechanics", 4, 94, 94, 22, 14);
  house(98, 94, 14, 6, true, 0);
  for (let i = 0; i < 4; i++)
    cell(
      city,
      detail,
      "mechanicsLarge",
      12,
      98 + (i % 2) * 4,
      92 + Math.floor(i / 2) * 4,
      i % 2 === 1,
      i >= 2,
    );
  cell(city, detail, "mechanicsLarge", 13, 100, 94);
  cell(city, detail, "mechanics", 8, 106, 97);
  for (let x = 94; x < 116; x += 2) cell(city, detail, "mechanics", 0, x, 101);
  for (let y = 94; y < 106; y += 2) cell(city, detail, "mechanics", 1, 94, y);
  cell(city, detail, "mechanics", 2, 94, 101);
  cell(city, detail, "mechanics", 10, 112, 101);
  for (const x of [96, 110]) {
    cell(city, detail, "props", 10, x, 105);
    cell(city, detail, "props", 14, x + 2, 105);
  }
  // 跪伏巨兵: head, torso halves, limbs and feet are separate modular small pieces.
  fill(city, floor, "mechanics", 4, 92, 24, 24, 12);
  rect(city, 96, 24, 16, 10, 1);
  cell(city, detail, "giantLarge", 0, 102, 22);
  cell(city, detail, "giantLarge", 1, 98, 25);
  cell(city, detail, "giantLarge", 2, 108, 25);
  cell(city, detail, "giantLarge", 4, 100, 26);
  cell(city, detail, "giantLarge", 5, 104, 26);
  cell(city, detail, "giantLarge", 8, 97, 28);
  cell(city, detail, "giantLarge", 9, 109, 28);
  cell(city, detail, "giantLarge", 10, 98, 31);
  cell(city, detail, "giantLarge", 11, 108, 31);
  cell(city, detail, "giantLarge", 12, 101, 31);
  cell(city, detail, "giantLarge", 13, 105, 32);
  cell(city, detail, "giantLarge", 14, 100, 35);
  cell(city, detail, "giantLarge", 14, 106, 35);
  rect(city, 97, 22, 16, 17, 1);
  for (const x of [95, 111])
    for (let y = 24; y < 34; y += 2) cell(city, detail, "mechanics", 7, x, y);
  for (let x = 95; x < 113; x += 2) cell(city, detail, "mechanics", 6, x, 24);
  cell(city, detail, "giant", 15, 113, 31);
  cell(city, detail, "props", 10, 93, 34);
  // 天秤连桥: aligned river, bridge, lamps and paired civic pylons frame a long view.
  for (const x of [49, 72]) {
    module(city, build, "tower", x, 51);
    rect(city, x, 51, 7, 11, 1);
  }
  for (const x of [52, 72]) {
    cell(city, detail, "garden", 6, x, 58);
    cell(city, detail, "garden", 8, x, 60);
    cell(city, detail, "props", 4, x, 64);
  }
  // Small courts, shade, canalside gardens and loading bays break up repeating facades.
  for (const d of districts)
    for (let i = 0; i < 9; i++) {
      const x = d.x + 2 + (i % 3) * 18,
        y = d.y + 12 + Math.floor(i / 3) * 16;
      if (y >= d.y + d.h - 2 || (d.name === "水庭旧城" && y >= 24 && y <= 34 && x >= 20 && x <= 44))
        continue;
      cell(
        city,
        detail,
        d.industrial ? "props" : "garden",
        d.industrial ? (i % 2 ? 0 : 1) : i % 2 ? 0 : 1,
        x,
        y,
      );
      rect(city, x, y, 2, 2, 1);
    }
  for (const [x, y] of [
    [16, 20],
    [36, 20],
    [10, 38],
    [48, 52],
    [18, 58],
    [36, 58],
  ]) {
    cell(city, detail, "garden", 4, x, y);
    rect(city, x, y, 2, 2, 1);
    for (const dx of [-3, 3]) {
      cell(city, detail, "garden", 0, x + dx, y);
      rect(city, x + dx, y, 2, 2, 1);
    }
    cell(city, detail, "garden", 9, x, y + 3);
    rect(city, x, y + 3, 2, 1, 1);
  }
  for (let y = 8; y < 116; y += 10) {
    for (const x of [54, 72]) {
      cell(city, detail, "garden", 2, x, y);
      rect(city, x, y, 2, 2, 1);
    }
    for (const x of [56, 70]) cell(city, detail, "props", 7, x, y + 3);
  }
  for (const [x, y] of [
    [14, 86],
    [34, 86],
    [48, 96],
    [12, 112],
    [40, 114],
  ]) {
    cell(city, detail, "props", 3, x, y);
    cell(city, detail, "props", 0, x + 2, y);
    rect(city, x, y, 4, 2, 1);
  }
  for (const [x, y] of [
    [82, 88],
    [114, 88],
    [80, 104],
    [112, 114],
    [116, 54],
  ]) {
    cell(city, detail, "props", 13, x, y);
    cell(city, detail, "props", 1, x + 2, y);
    rect(city, x, y, 4, 2, 1);
  }
  for (const [x, y] of [
    [80, 20],
    [98, 18],
    [116, 20],
    [82, 50],
    [104, 50],
  ]) {
    cell(city, detail, "garden", 8, x, y);
    cell(city, detail, "props", 11, x + 2, y);
    rect(city, x, y, 4, 2, 1);
  }
  for (const y of [42, 76, 112])
    for (const x of [8, 26, 46, 74, 90, 110, 120]) {
      cell(city, detail, "props", 4, x, y);
      rect(city, x, y, 1, 2, 1);
    }
  for (const x of [10, 30, 48]) {
    cell(city, detail, "props", 6, x, 56);
    cell(city, detail, "garden", 3, x + 2, 56);
  }
  for (const y of [80, 86, 92, 98, 104, 110]) {
    cell(city, detail, "mechanics", 0, 118, y);
    cell(city, detail, "props", 15, 120, y + 2);
  }
  entry(city, 1, 64, 122);
  exit(city, "south-gate", 64, 127, 9100, 2);
  for (let x = 30; x < 34; x++) exit(template, `open-gate-${x}`, x, 25, 9102, 1);
  entry(template, 2, 32, 29, 0, "down");
  // Keep the original closed-gate trial intact; the expansion has a short admission scene.
  data.messages.pass = "双子城防团例行查验。旧城沿河向西，新城的工坊在东边。";
  data.messages.return = "查验完毕。今天的入城许可已经放行。沿桥直走，欢迎来到阿克托。";
  data.messages.guard_repeat = "已经查验过了。请沿桥进入内城，不要靠近机器的管线。";

  // These are ordinary authored messages and puppets, exactly as in the gate trial.
  data.programs.akto_guard_talk.ops = [op("Msg", [], [], ["guard_repeat"]), op("Exit")];
  // Eight enterable places share the tile vocabulary, but each has its own plan and speaker.
  const rooms = [
    ["驿站旅舍", "店主", "上层的房间留给商队。窗外的彩幔遮住烈日，夜里才听得见炉声。"],
    ["香料行", "香料商", "河西收的是路税，河东收的是机税。一座城，两本账。"],
    ["陶器作坊", "制陶师", "青釉是旧阿克托的颜色。帝国来了，烟囱改了，碗没有改。"],
    ["水庭档案室", "水庭书记", "悬水庭先有水道，后有花园。缺水的边疆，能看见水才算富有。"],
    ["城防团值房", "城防军士", "我们守的是双子城。制服上的彩绸，是家乡织坊送的。"],
    ["双子议署", "接待员", "旧城的水权与新城的炉权，在这张桌子上各占一半。"],
    ["炉心检修间", "机修师", "巨轮只停半刻。想走上炉架，先让铜管的温度降下来。"],
    ["工人食堂", "厨师", "桥那边卖香料，桥这边炖豆子。每天中午，两边的人都来吃。"],
  ];
  const selected = [
    houses.find((h) => h.x === 9 && h.y === 76),
    houses.find((h) => h.x === 29 && h.y === 76),
    houses.find((h) => h.x === 9 && h.y === 6),
    houses.find((h) => h.x === 29 && h.y === 6),
    houses.find((h) => h.x === 77 && h.y === 6),
    houses.find((h) => h.x === 97 && h.y === 6),
    houses.find((h) => h.x === 77 && h.y === 76),
    houses.find((h) => h.x === 97 && h.y === 112),
  ];
  const interiors = [];
  rooms.forEach(([title, speaker, text], index) => {
    const id = 9200 + index,
      h = selected[index];
    if (!h) throw Error(`Missing authored room facade ${index}`);
    const door = { x: h.doorX, y: h.y + h.h };
    rect(city, door.x, door.y, 2, 2);
    entry(city, index + 10, door.x, door.y + 1, 0, "down");
    exit(city, `door-${id}`, door.x, door.y, id, 1);
    const room = make(id, 24, 20, `Akto_Interior_${index}`);
    maps[id] = room;
    const rf = layer(room, "BottomFloor"),
      rw = layer(room, "BottomWalls"),
      rd = layer(room, "BottomFurniture");
    fill(room, rf, index >= 4 ? "mechanics" : "stone", index >= 4 ? 4 : 3, 0, 0, 24, 20);
    rect(room, 2, 5, 20, 14);
    fill(room, rw, index >= 4 ? "mechanics" : "stone", index >= 4 ? 5 : 5, 0, 0, 24, 6);
    for (let x = 4; x < 22; x += 6) cell(room, rd, "stone", 8, x, 3);
    for (const x of [3, 17]) {
      cell(room, rd, "props", index % 2 ? 9 : 6, x, 8);
      rect(room, x, 8, 2, 2, 1);
      cell(room, rd, "garden", 2, x, 14);
      rect(room, x, 14, 2, 2, 1);
    }
    fill(room, rd, "stone", 13, 8, 8, 8, 2);
    rect(room, 8, 8, 8, 2, 1);
    cell(room, rd, "props", 7, 2, 4);
    rect(room, 12, 19, 1, 1);
    entry(room, 1, 12, 17);
    exit(room, "leave", 12, 19, 9102, index + 10);
    npc(
      room,
      12,
      7,
      ["mo_ff6_n002_c00", "mo_ff6_n003_c00", "mo_ff6_n008_c00"][index % 3],
      text,
      speaker,
    );
    data.mapTitles[id] = title;
    interiors.push({ id, title, door });
    cell(city, detail, "props", 12, door.x + 2, door.y - 3);
  });
  const conversations = [
    [26, 111, "mo_ff6_n003_c00", "从这条街向北，走过彩幔，就是旧城的水庭。", "商队领路人"],
    [40, 100, "mo_ff6_n008_c00", "一百条彩幔，没有两条出自同一片沙漠。", "织工"],
    [18, 90, "mo_ff6_n002_c00", "别把这儿当成帝国的集市。我们比他们的城墙还早。", "香料商"],
    [46, 38, "mo_ff6_n008_c00", "从两侧楼梯能登上水庭。高处看得到连桥和炉烟。", "旧城住民"],
    [32, 29, "mo_ff6_n003_c00", "水从北边的高地来，在这里歇一歇，再流入每条街。", "护水人", 1],
    [56, 66, "mo_ff6_n002_c00", "天秤连桥。西边的水庭与东边的炉塔，站在这里都看得见。", "过桥人"],
    [104, 104, "mo_ff6_n003_c00", "赤炉巨轮给整个工区送水。那声音响了一整代人。", "炉工"],
    [114, 40, "mo_ff6_n008_c00", "巨兵跪在这里已经十二年了。孩子们管它叫守夜人。", "机修学徒"],
    [82, 40, "akto_guard", "彩绸是阿克托的。盔甲才是帝国的。", "双子城防团"],
    [70, 112, "mo_ff6_n002_c00", "南边是共用城门，北边是双子城。你要去哪一半？", "送信人"],
  ];
  for (const [x, y, a, t, s, p] of conversations) npc(city, x, y, a, t, s, { layer: p || 0 });
  for (const d of districts)
    for (let i = 0; i < 4; i++) {
      const x = d.x + 10 + i * 10,
        y = d.y + 16;
      if (city.collisions[0][y * 128 + x]) continue;
      npc(
        city,
        x,
        y,
        ["mo_ff6_n002_c00", "mo_ff6_n003_c00", "mo_ff6_n008_c00"][i % 3],
        `${d.name}的街道连着内河。沿宽街走，就不会迷路。`,
        d.name + "居民",
      );
    }
  // Four authored turn-in-place NPCs add life using the existing PR controller.
  for (const [x, y] of [
    [12, 60],
    [48, 72],
    [80, 60],
    [116, 72],
  ]) {
    const a = npc(city, x, y, "akto_guard", "两边的街道都开放。过桥时留意运货的人。", "巡街城防团");
    a.npc = { ...a.npc, moveType: 1, moveSpeedId: 0, moveIntervalId: 3, moveStep: 1 };
  }
  // Fixed local circuits use the existing PR polyline controller.
  for (const [index, x, y] of [
    [0, 8, 18],
    [1, 8, 88],
    [2, 76, 18],
    [3, 74, 108],
  ]) {
    const objectId = 9500 + index;
    city.entities.push({
      id: `porter-circuit-${index}`,
      kind: 14,
      objectId,
      layer: 0,
      polyline: {
        closed: true,
        points: [
          { x, y },
          { x: x + 4, y },
          { x: x + 4, y: y + 1 },
          { x, y: y + 1 },
        ],
      },
    });
    const a = npc(city, x, y, "mo_ff6_n003_c00", "让一让，给街那边送货。", "搬运工");
    a.npc = {
      ...a.npc,
      moveType: 3,
      moveAreaId: objectId,
      moveSpeedId: 1,
      moveIntervalId: 2,
      moveStep: 1,
    };
  }
  // A rooftop promenade changes to a separate, tile-built horizon view.
  const vista = make(9103, 48, 22, "Akto_Rooftop_Horizon");
  maps[9103] = vista;
  const vf = layer(vista, "BottomSky"),
    vm = layer(vista, "BottomDistantRoofs"),
    vp = layer(vista, "BottomPromenade"),
    vr = layer(vista, "BottomParapet");
  for (let y = 0; y < 22; y++)
    for (let x = 0; x < 48; x++) vf.data[y * 48 + x] = sets.sky.firstgid + Math.min(15, y);
  for (let x = 0; x < 48; x += 4) cell(vista, vm, "horizon", x < 24 ? 4 : 5 + (x % 3), x, 13);
  for (const [x, y, n] of [
    [1, 11, 8],
    [8, 11, 8],
    [15, 11, 8],
    [21, 11, 9],
    [27, 12, 10],
    [34, 12, 10],
    [41, 11, 11],
  ])
    cell(vista, vm, "horizonLarge", n, x, y);
  fill(vista, vp, "stone", 13, 0, 15, 48, 7);
  rect(vista, 1, 17, 46, 4);
  for (let x = 0; x < 48; x += 2) {
    cell(vista, vr, "horizon", 12, x, 15);
    cell(vista, vr, "horizon", 13, x, 20);
  }
  cell(vista, vp, "horizon", 14, 4, 14);
  cell(vista, vp, "horizon", 14, 42, 14);
  rect(vista, 24, 21, 1, 1);
  entry(vista, 1, 24, 18);
  vista.entities.push({ id: "view-range", kind: 27, x: 0, y: 3, width: 48, height: 16 });
  exit(vista, "leave-rooftop", 24, 21, 9102, 30);
  entry(city, 30, 48, 40, 0, "down");
  cell(city, detail, "garden", 15, 48, 36);
  rect(city, 48, 36, 2, 4);
  exit(city, "rooftop-stair", 48, 36, 9103, 1);
  npc(
    vista,
    28,
    18,
    "mo_ff6_n008_c00",
    "西边是水庭和圆顶，东边是炉塔。河把它们分开，连桥又把它们接在一起。",
    "眺望的人",
  );
  data.mapTitles[9102] = "阿克托 · 双子内城";
  data.mapTitles[9103] = "水庭高廊 · 双城远眺";
  content.city = {
    districts,
    interiors,
    landmarks: [
      { name: "双塔城门", mapId: 9100, x: 32, y: 27 },
      { name: "百幔大市", mapId: 9102, x: 32, y: 100 },
      { name: "悬水庭", mapId: 9102, x: 32, y: 31 },
      { name: "赤炉巨轮", mapId: 9102, x: 104, y: 102 },
      { name: "天秤连桥", mapId: 9102, x: 64, y: 65 },
      { name: "跪伏巨兵", mapId: 9102, x: 104, y: 40 },
    ],
    tileSize: 16,
    atlasCellSize: 32,
  };
  return content;
}
