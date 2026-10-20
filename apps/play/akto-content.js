// Original trial content. Existing FFVI maps, story routes and saves are untouched.
const H = 0x80000000;
const V = 0x40000000;
const op = (name, i = [], r = [], s = []) => [name, i, r, s, 1, ""];

export function createAktoContent({ characters, battleData, modules, root = "./" }) {
  const tile = 16;
  const sets = [];
  const textures = {};
  let nextGid = 1;
  for (const [name, m] of Object.entries(modules)) {
    sets.push({
      name,
      image: name,
      firstgid: nextGid,
      columns: m.width / tile,
      tilecount: (m.width * m.height) / tile ** 2,
      tilewidth: tile,
      tileheight: tile,
      imagewidth: m.width,
      imageheight: m.height,
    });
    textures[name] = new URL(m.file, root).href;
    nextGid += (m.width * m.height) / tile ** 2;
  }
  const baseMap = (id, width, height, name) => ({
    id,
    name,
    areaId: id,
    initializer: "akto_init",
    width,
    height,
    tileSize: tile,
    layers: [],
    tilesets: sets,
    textures,
    collisions: { 0: new Array(width * height).fill(1) },
    entities: [],
    groups: {},
    routes: {},
  });
  const layer = (map, name) => {
    const value = {
      name: `Bottom${name}`,
      sourceGroup: "TileGroup",
      width: map.width,
      height: map.height,
      data: new Array(map.width * map.height).fill(0),
    };
    map.layers.push(value);
    return value;
  };
  const place = (map, target, name, x, y, flipX = false, flipY = false) => {
    const set = sets.find((s) => s.name === name);
    const width = set.columns;
    const height = set.imageheight / tile;
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= map.width || y + dy >= map.height) continue;
        const sx = flipX ? width - dx - 1 : dx;
        const sy = flipY ? height - dy - 1 : dy;
        target.data[(y + dy) * map.width + x + dx] =
          (set.firstgid + sy * width + sx) | (flipX ? H : 0) | (flipY ? V : 0);
      }
    }
  };
  const fill = (map, target, name, x, y, width, height) => {
    const set = sets.find((s) => s.name === name);
    for (let yy = y; yy < y + height; yy += set.imageheight / tile)
      for (let xx = x; xx < x + width; xx += set.columns)
        place(
          map,
          target,
          name,
          xx,
          yy,
          Math.floor((xx - x) / set.columns) % 2 === 1,
          Math.floor((yy - y) / (set.imageheight / tile)) % 2 === 1,
        );
  };
  const walk = (map, x, y, width, height) => {
    for (let yy = y; yy < y + height; yy++)
      for (let xx = x; xx < x + width; xx++) map.collisions[0][yy * map.width + xx] = 0;
  };
  const actor = (id, x, y, asset, message, extra = {}) => ({
    id: String(id),
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
      interaction: { message: { key: message } },
    },
    ...extra,
  });
  const town = baseMap(9100, 64, 60, "Akto_Gate_Approach");
  const earth = layer(town, "Ground");
  const cityPaving = layer(town, "CityPaving");
  const buildings = layer(town, "CityBlocks");
  const water = layer(town, "Moat");
  const shore = layer(town, "Bank");
  const bridge = layer(town, "Bridge");
  const walls = layer(town, "Wall");
  const towers = layer(town, "Towers");
  fill(town, earth, "ground", 0, 0, 64, 60);
  fill(town, cityPaving, "paving", 0, 0, 64, 24);
  for (const y of [3, 9, 14])
    for (const x of [2, 10, 18, 40, 48, 56])
      place(town, buildings, "factory", x, y, (x / 2) % 4 === 1);
  place(town, buildings, "factory", 26, 5);
  place(town, buildings, "factory", 33, 5, true);
  fill(town, water, "water", 0, 28, 64, 24);
  fill(town, shore, "bank", 0, 27, 64, 2);
  fill(town, shore, "bank", 0, 51, 64, 2);
  // South bank faces the water; flip the complete module without repainting it.
  for (let x = 0; x < 64; x += 8) place(town, shore, "bank", x, 51, (x / 8) % 2 === 1, true);
  fill(town, bridge, "bridge", 27, 25, 10, 30);
  for (let x = 0; x < 64; x += 4) place(town, walls, "wall", x, 18, x % 8 === 4);
  place(town, towers, "tower", 15, 13);
  place(town, towers, "tower", 42, 13);
  place(town, towers, "gate", 26, 12);
  walk(town, 0, 53, 64, 7);
  walk(town, 28, 25, 8, 30);
  walk(town, 22, 25, 20, 3);
  town.entities.push(
    { id: "entry", kind: 0, objectId: 1, x: 32, y: 53, layer: 0, direction: "up" },
    actor(101, 29, 25, "akto_guard", "guard_repeat", { script: "akto_guard_talk" }),
    actor(102, 34, 25, "akto_guard", "guard_repeat", { script: "akto_guard_talk" }),
    actor(103, 23, 18, "akto_guard", "guard_wall"),
    actor(104, 40, 18, "akto_guard", "guard_wall"),
    actor(201, 29, 41, "mo_ff6_n002_c00", "traveller"),
    actor(202, 34, 46, "mo_ff6_n003_c00", "merchant"),
    actor(203, 30, 34, "mo_ff6_n008_c00", "local"),
  );
  for (let x = 28; x <= 35; x++)
    town.entities.push({ id: `halt-${x}`, kind: 2, x, y: 27, layer: 0, script: "akto_halt" });
  for (let x = 28; x <= 35; x++)
    town.entities.push({
      id: `leave-${x}`,
      kind: 3,
      x,
      y: 59,
      layer: 0,
      destination: { mapId: 9101, entrance: 1 },
    });

  const region = baseMap(9101, 32, 22, "Akto_Regional_Map");
  const regionGround = layer(region, "Ground");
  const city = layer(region, "City");
  fill(region, regionGround, "ground", 0, 0, 32, 22);
  place(region, city, "icon", 15, 7);
  walk(region, 0, 0, 32, 22);
  region.entities.push(
    { id: "region-entry", kind: 0, objectId: 1, x: 16, y: 13, layer: 0, direction: "up" },
    { id: "city-entry", kind: 3, x: 16, y: 9, layer: 0, destination: { mapId: 9100, entrance: 1 } },
  );
  const messages = {
    halt: "站住！这里是帝国双子城阿克托。",
    pass: "内城正在戒严。没有双子议署签发的通行文书，任何人不得入城。",
    return: "请退回桥外等候。城门重新开放之前，不要再靠近。",
    guard_repeat: "命令没有改变。请留在桥外，等候城门开放。",
    guard_wall: "城墙上的巡逻兵注视着桥面。",
    traveller: "我从南边来，在这桥上已经等了半天。那两座塔的钟，一直没响。",
    merchant: "看见守卫肩上的彩绸了吗？阿克托自己的城防团，一眼就认得出来。",
    local: "这座桥通往双子城的共用城门。今天，两边都不让进。",
  };
  const programs = {};
  const add = (name, ops) => (programs[name] = { name, title: name, locals: [], ops });
  add("akto_init", [op("Exit")]);
  add("akto_guard_talk", [op("Msg", [], [], ["guard_repeat"]), op("Exit")]);
  // Ordinary PR VM instructions own actor movement, blocking dialogue and control return.
  const halt = [
    op("Branch", [0, 1, 0], [], ["AktoStory", "=", "imm"]),
    op("SetPuppet", [0, 101, 0]),
    op("SetPuppet", [1, 102, 0]),
    op("ExecPuppet", [0]),
    op("Msg", [], [], ["halt"]),
    op("Msg", [], [], ["pass"]),
    op("Msg", [], [], ["return"]),
    op("SetFlag", [0], [], ["AktoStory"]),
    op("Exit"),
  ];
  const repeat = halt.length;
  halt.push(op("Msg", [], [], ["guard_repeat"]), op("Exit"));
  const left = halt.length;
  halt.push(op("Lerp", [31, 26], [0.55]), op("LookAt", [2]), op("Exit"));
  const right = halt.length;
  halt.push(op("Lerp", [33, 26], [0.55]), op("LookAt", [2]), op("Exit"));
  halt[0][1][2] = repeat;
  halt[1][1][2] = left;
  halt[2][1][2] = right;
  add("akto_halt", halt);

  const guardSprites = {};
  const animations = [];
  for (const [direction, suffix] of [
    ["down", ""],
    ["up", "B"],
    ["left", "L"],
    ["right", "R"],
  ]) {
    const walkName = direction === "down" ? "Default" : `Walk${suffix}`;
    for (let index = 0; index < 3; index++)
      guardSprites[`${direction}-${index}`] = {
        file: new URL(`assets/guard-${direction}-${index}.png`, root).href,
        width: 32,
        height: 32,
        pivot: [0.5, 0],
      };
    const frame = (n) => ({ sprite_name: `${direction}-${n}`, alpha: 1, offsetx: 0, offsety: 0 });
    animations.push({
      name: walkName,
      frames: [frame(1), frame(0), frame(2), frame(0)],
      play_speed: 0.55,
      play_mode: 3,
    });
    animations.push({ name: `${walkName}-S`, frames: [frame(0)], play_speed: 1, play_mode: 3 });
  }
  const data = {
    entry: { mapId: 9100, entrance: 1, script: "akto_init" },
    init: [{ key_name: "INIT_PARTY_1", value1: 1 }],
    programs,
    global: Object.fromEntries(Object.keys(programs).map((key) => [key, key])),
    byMap: { 9100: {}, 9101: {} },
    messages,
    speakers: Object.fromEntries(
      Object.keys(messages).map((key) => [
        key,
        key.includes("guard") || ["halt", "pass", "return"].includes(key)
          ? "阿克托城防团"
          : "桥上的旅人",
      ]),
    ),
    characters: {
      ...Object.fromEntries(
        Object.entries(characters).map(([name, character]) => [
          name,
          {
            ...character,
            sprites: Object.fromEntries(
              Object.entries(character.sprites).map(([key, value]) => [
                key,
                {
                  ...value,
                  file: new URL(value.file, root).href,
                },
              ]),
            ),
          },
        ]),
      ),
      akto_guard: { animation: { data: { animation: animations } }, sprites: guardSprites },
    },
    fieldAssets: { 1: { asset_name: "mo_ff6_p001" } },
    mapTitles: { 9100: "帝国双子城阿克托", 9101: "阿克托近郊" },
  };
  return { data, battleData, maps: { 9100: town, 9101: region } };
}
