import test from "node:test";
import assert from "node:assert/strict";
import { Sprite, Texture } from "pixi.js";
import { FieldPresentation } from "./field-presentation.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("world-water planes release stale atlas views while a replacement page loads", () => {
  const water = {
      name: "water",
      properties: { opaque_shader: "Last/WorldmapFarBgWarterSurfaceShader" },
      textures: [{ url: "/source-ocean.png" }],
    },
    stale = new Texture({ source: Texture.EMPTY.source }),
    next = new Texture({ source: Texture.EMPTY.source }),
    plane = new Sprite(stale);
  let loaded = null;
  const view = {
    catalog: { maps: { 1: { far: [water], near: [] } }, gps: {} },
    backdropPlane: {},
    waterPlane: plane,
    getTexture: () => loaded,
    waterFilter: { setMaterial() {}, update() {} },
    flightFilter: { resources: { properties: { uniforms: {} } } },
    near: {},
    gps: { visible: false },
    gpsSprites: [],
    farEnabled: false,
    farPlanes: [],
    nearPlanes: [],
    _metrics: {},
    _sprites: () => 0,
    clock: 0,
    flight: false,
  };
  stale.destroy(false);
  const draw = () =>
    FieldPresentation.prototype.draw.call(view, {
      mapId: 1,
      map: { name: "Map_10010" },
      player: {},
    });
  draw();
  assert.equal(plane.visible, false);
  assert.equal(plane.texture, Texture.EMPTY);
  loaded = next;
  draw();
  assert.equal(plane.visible, true);
  assert.equal(plane.texture, next);
  loaded = null;
  next.destroy(false);
  draw();
  assert.equal(plane.visible, false);
  assert.equal(plane.texture, Texture.EMPTY);
  plane.destroy();
});

test("field ColorFade cannot black out a battle or survive a map-camera replacement", () => {
  const properties = { uniforms: {} },
    view = {
      mapId: 118,
      tone: { rgb: [0, 0, 0], alpha: 1, from: [1, 1, 1, 0], time: 10, duration: 0.7 },
      screenEffects: {},
      far: {},
      near: {},
      projected: {},
      gps: {},
      screenFilter: { resources: { properties } },
      _syncMap: FieldPresentation.prototype._syncMap,
    },
    prepare = (mapId, inBattle) =>
      FieldPresentation.prototype.prepare.call(
        view,
        {
          mapId,
          map: { name: "Opera" },
          player: {},
          time: 20,
        },
        inBattle,
      );
  prepare(118, false);
  assert.deepEqual(properties.uniforms.uTone, [0, 0, 0, 1]);
  prepare(118, true);
  assert.deepEqual(properties.uniforms.uTone, [1, 1, 1, 0]);
  prepare(118, false);
  assert.deepEqual(properties.uniforms.uTone, [0, 0, 0, 1]);
  prepare(120, false);
  assert.deepEqual(properties.uniforms.uTone, [1, 1, 1, 0]);
});

test("new-map far scenery is immediately visible at frozen time, with only same-map variants crossfading", () => {
  const first = { name: "FarBGLayer1", visible: true, properties: {} },
    second = { name: "FarBGLayer2", visible: true, properties: {} },
    seen = [],
    view = {
      catalog: {
        maps: { 1: { far: [first, second], near: [] }, 2: { far: [first], near: [] } },
        gps: {},
      },
      mapId: 1,
      clock: 100,
      farEnabled: true,
      variant: 0,
      backdropPlane: {},
      waterPlane: {},
      flightFilter: { resources: { properties: { uniforms: {} } } },
      near: {},
      gps: { visible: false },
      gpsSprites: [],
      _metrics: {},
      _sprites: (_pool, _parent, images, _offset, kind) => {
        if (kind === "far") seen.push(images);
        return images.length;
      },
    },
    draw = (mapId = 1) =>
      FieldPresentation.prototype.draw.call(view, { mapId, map: { name: "test" }, player: {} });
  draw();
  assert.equal(seen.at(-1)[0].alpha, 1);
  draw();
  assert.equal(seen.at(-1)[0].alpha, 1, "Pausing cannot hold initial scenery at alpha zero");
  view.variant = 1;
  draw();
  assert.deepEqual(
    seen.at(-1).map((row) => row.alpha),
    [1, 0],
  );
  view.clock += 0.35;
  draw();
  for (const row of seen.at(-1)) assert.ok(Math.abs(row.alpha - 0.5) < 1e-10);
  FieldPresentation.prototype._syncMap.call(view, 2);
  draw(2);
  assert.equal(seen.at(-1).length, 1);
  assert.equal(
    seen.at(-1)[0].alpha,
    1,
    "A different map never fades from the previous map's scenery",
  );
});

test("explicit PR far-background switches activate initially hidden variants across the source catalog", async () => {
  const root = path.resolve(import.meta.dirname, "../../build/web-data"),
    catalog = JSON.parse(await readFile(path.join(root, "field-presentation.json"))),
    data = JSON.parse(await readFile(path.join(root, "data.json"))),
    selectors = new Map([
      ["背景変更：飛空艇（通常）", 1],
      ["背景変更：飛空艇（特殊）", 2],
      ["背景変更：飛空艇（黒）", 3],
    ]),
    seen = [],
    view = {
      catalog,
      clock: 100,
      mapId: null,
      _syncMap: FieldPresentation.prototype._syncMap,
      backdropPlane: {},
      waterPlane: {},
      waterFilter: { setMaterial() {}, update() {} },
      flightFilter: { resources: { properties: { uniforms: {} } } },
      maskFilter: { setMaterial() {}, update() {} },
      warn() {},
      near: {},
      gps: { visible: false },
      gpsSprites: [],
      _metrics: {},
      getTexture: () => null,
      _sprites: (_pool, _parent, images, _offset, kind) => {
        if (kind === "far") seen.push(images);
        return images.length;
      },
    };
  const draw = (mapId) => {
    FieldPresentation.prototype.draw.call(view, {
      mapId,
      map: { name: "source-variant-check" },
      player: {},
    });
    return seen
      .at(-1)
      .filter((row) => row.alpha > 0)
      .map((row) => row.name);
  };
  let checked = 0,
    hiddenTargets = 0;
  for (const [id, binding] of Object.entries(catalog.maps)) {
    const mapId = Number(id),
      water = binding.far.find((row) => /Warter|Water|Ocean/.test(row.properties?.opaque_shader));
    FieldPresentation.prototype._syncMap.call(view, mapId);
    assert.deepEqual(
      draw(mapId),
      binding.far
        .filter((row) => row !== water && row.visible !== false && row.properties.active !== false)
        .map((row) => row.name),
      `map${id}: no explicit switch must preserve authored initial visibility`,
    );
    for (const [selector, number] of selectors) {
      const targets = binding.far.filter(
        (row) => row !== water && row.name.endsWith(String(number)),
      );
      if (!targets.length) continue;
      FieldPresentation.prototype._syncMap.call(view, -1);
      FieldPresentation.prototype.event.call(view, {
        kind: "presentation-command",
        name: "SysCall",
        mapId,
        s: [selector],
      });
      assert.deepEqual(
        draw(mapId),
        targets.map((row) => row.name),
        `map${id}: ${selector}`,
      );
      checked += targets.length;
      hiddenTargets += targets.filter((row) => row.visible === false).length;
    }
  }
  assert.equal(checked, 59, "exercise every declared ordinary far-background variant");
  assert.equal(hiddenTargets, 2, "the two initially hidden Opera scene variants remain selectable");
  const opera = data.programs[data.byMap[114].sc_map_20161_2];
  assert.ok(opera.ops.some((op) => op[0] === "SysCall" && op[3][0] === "背景変更：飛空艇（通常）"));
  assert.ok(opera.ops.some((op) => op[0] === "SysCall" && op[3][0] === "背景変更：飛空艇（特殊）"));
  const before = JSON.stringify(catalog.maps[114]);
  FieldPresentation.prototype._syncMap.call(view, -1);
  FieldPresentation.prototype.event.call(view, {
    kind: "presentation-command",
    name: "SysCall",
    mapId: 114,
    s: ["背景変更：飛空艇（通常）"],
  });
  assert.deepEqual(draw(114), ["FarBGLayer1"]);
  FieldPresentation.prototype.event.call(view, {
    kind: "presentation-command",
    name: "SysCall",
    mapId: 114,
    s: ["背景消去"],
  });
  view.clock += 1;
  draw(114);
  view.clock += 1;
  assert.deepEqual(draw(114), [], "explicit source disappearance still takes effect");
  assert.equal(JSON.stringify(catalog.maps[114]), before, "source layer visibility is immutable");
});

test("every nonzero PR field shader_type keeps its source binding and is applied without changing source pixels/state", async () => {
  const root = path.resolve(import.meta.dirname, "../../build/web-data"),
    raw = JSON.parse(await readFile(path.join(root, "raw/index.json"))),
    catalog = JSON.parse(await readFile(path.join(root, "field-presentation.json"))),
    data = JSON.parse(await readFile(path.join(root, "data.json"))),
    source = [];
  for (const entry of raw.files.filter((row) => row.bundleOutput && /\/mo_/.test(row.file)))
    for (const asset of JSON.parse(await readFile(path.join(root, entry.bundleOutput))))
      if (
        asset.source.assetPath?.toLowerCase().endsWith("/anim_info.json") &&
        asset.data.shader_type
      )
        source.push({
          name: path.basename(entry.file).split("_assets_all_")[0],
          type: asset.data.shader_type,
        });
  assert.equal(source.length, 3);
  assert.deepEqual(
    Object.keys(catalog.actorMaterials).sort(),
    source.map((row) => row.name).sort(),
  );
  const warnings = [],
    view = { catalog, warn: (_key, message) => warnings.push(message) };
  for (const row of source) {
    const character = data.characters[row.name],
      before = JSON.stringify(character);
    assert.equal(catalog.actorMaterials[row.name].shaderType, row.type);
    assert.equal(character.animation.data.shader_type, row.type);
    assert.equal(FieldPresentation.prototype.actorBlendMode.call(view, row.name, character), "add");
    assert.equal(JSON.stringify(character), before);
  }
  assert.ok(warnings.some((message) => message.includes("inferred")));
  assert.equal(FieldPresentation.prototype.actorBlendMode.call(view, "normal", {}), "normal");
  assert.equal(
    FieldPresentation.prototype.actorBlendMode.call(view, "unknown", {
      animation: { data: { shader_type: 99 } },
    }),
    "normal",
  );
  assert.ok(warnings.some((message) => message.includes("Unknown PR")));
});

test("reloading the same source world map ends the flight camera before walking", () => {
  const view = {
    mapId: 2,
    view: true,
    tone: { rgb: [0, 0, 0], alpha: 1, from: [1, 1, 1, 0], time: 0, duration: 0 },
    screenEffects: {},
    water: {},
    far: {},
    near: {},
    projected: {},
    gps: {},
    screenFilter: { resources: { properties: { uniforms: {} } } },
    _syncMap: FieldPresentation.prototype._syncMap,
    warn() {},
  };
  const prepare = (vehicle = null) =>
    FieldPresentation.prototype.prepare.call(
      view,
      { mapId: 2, map: { name: "Map_10020" }, time: 50, player: { vehicle } },
      false,
    );
  prepare();
  assert.equal(view.flight, true, "Scripted world flyover may hide the player without a vehicle");
  FieldPresentation.prototype.event.call(view, { kind: "map", mapId: 2 });
  prepare();
  assert.equal(view.flight, false, "A same-ID ChangeMap returns the on-foot camera to normal");
  assert.equal(view.tone, null);
  prepare(5);
  assert.equal(view.flight, true, "A real mounted airship still enables projection");
  FieldPresentation.prototype.event.call(view, {
    kind: "presentation-command",
    name: "ChangeView",
    mapId: 2,
    i: [0],
  });
  prepare(5);
  assert.equal(view.flight, false, "An explicit source top-down view still overrides a vehicle");
});

test("flight projection respects hidden players, including unmounted scripted flyovers", () => {
  const actor = new Sprite(Texture.EMPTY),
    texture = new Texture({ source: Texture.EMPTY.source }),
    view = {
      catalog: { maps: { 1: { far: [], near: [] } }, gps: {}, sky: {} },
      backdropPlane: {},
      waterPlane: {},
      flightFilter: { resources: { properties: { uniforms: {} } } },
      flightActor: actor,
      flight: true,
      near: {},
      gps: { visible: false },
      gpsSprites: [],
      farPlanes: [],
      nearPlanes: [],
      _metrics: {},
      _sprites: () => 0,
      diagnostics: { record() {} },
      getTexture: () => texture,
      sampleActor: () => ({ info: { file: "rider.png", width: 16, height: 32 }, flip: false }),
      clock: 1,
    },
    game = {
      mapId: 1,
      map: { name: "Map_10010" },
      time: 1,
      player: { id: -1001, visible: true, asset: "mo_ff6_p009" },
    },
    draw = () =>
      FieldPresentation.prototype.draw.call(view, game, undefined, {
        characters: { mo_ff6_p009: { sprites: {} } },
      });
  draw();
  assert.equal(actor.visible, true);
  game.player.visible = false;
  draw();
  assert.equal(actor.visible, false);
  assert.equal(view.flightFrame.drawn, false);
  assert.equal(view.flightFrame.reason, "hidden-player");
  game.player.vehicle = 5;
  draw();
  assert.equal(actor.visible, false, "A vehicle never overrides an authored HidePlayer");
  game.player.visible = true;
  draw();
  assert.equal(actor.visible, true);
  actor.destroy();
  texture.destroy();
});

test("the projected world renders PR water before land rather than inventing horizon colors", () => {
  const calls = [],
    water = { visible: false, width: 320, height: 180 },
    map = { filters: [], filterArea: null },
    actors = {},
    target = {},
    view = {
      flight: true,
      _flightWater: true,
      clock: 5,
      planeTexture: target,
      waterPlane: water,
      waterFilter: { update: (time, size) => calls.push({ time, size }) },
      flightSprite: {},
      flightFilter: { resources: { properties: { uniforms: {} } } },
    };
  FieldPresentation.prototype.project.call(
    view,
    {
      render: (command) =>
        calls.push({
          ...command,
          visible: command.container.visible,
          width: command.container.width,
        }),
    },
    { mapLayers: map, actors },
    { player: { direction: "up" } },
  );
  assert.equal(calls[1].container, water);
  assert.equal(calls[1].clear, true);
  assert.equal(calls[1].visible, true);
  assert.equal(calls[1].width, 640);
  assert.equal(calls[2].container, map);
  assert.equal(calls[2].clear, false);
  assert.equal(calls[3].container, actors);
  assert.equal(water.visible, false);
  assert.equal(water.width, 320);
  assert.equal(water.height, 180);
});
