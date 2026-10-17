import test from "node:test";
import assert from "node:assert/strict";
import { compileMapGeometry } from "../src/compiler/map-geometry.js";
import { compileWorldCharacter } from "../src/compiler/world.js";
import { missingFieldPoses } from "../src/core/character-media.js";
import type { FieldBackgroundLayer } from "../src/core/field-background.js";
const source = {
  file: "synthetic",
  assetPath: "package/tilemap.json",
  objectId: "9007199254740993",
};
function geometry() {
  return {
    tile: {
      source,
      data: {
        width: 2,
        height: 2,
        tilewidth: 16,
        tileheight: 16,
        orientation: "orthogonal",
        layers: [
          {
            type: "tilelayer",
            name: "GroundLayer",
            width: 2,
            height: 2,
            data: [1, 0, 1, 0],
          },
        ],
        tilesets: [
          {
            firstgid: 1,
            tilewidth: 16,
            tileheight: 16,
            columns: 1,
            tilecount: 1,
            image: "atlas.png",
            imagewidth: 16,
            imageheight: 16,
          },
        ],
      },
    },
    collision: {
      source,
      data: {
        layers: [
          {
            name: "GroundCollision",
            visible: false,
            width: 2,
            height: 2,
            data: [0, 1, 0, 0],
          },
        ],
      },
    },
    textures: {
      "atlas.png": { url: "/synthetic.png", width: 16, height: 16, source },
    },
  };
}
test("background admission consumes only its own root layer and preserves unrelated geometry blockers", () => {
  const f = geometry(), provenance = { ...source, serializedFile: "synthetic-assets", sha256: "a".repeat(64) };
  const background: FieldBackgroundLayer = { kind: "native-center-repeat-background-v1", layerId: 7,
    name: "FarBGLayer1", source: provenance, mapSize: { width: 32, height: 32 },
    renderHost: { kind: "source-fresh-normal-background-host-v1", rendererWorld: { x: 0, y: 0 },
      renderCamera: { x: 0, y: 0 }, sources: [provenance, provenance] },
    size: { width: 512, height: 512 }, offset: { x: 0, y: 0 }, manualSpeed: { x: 0.5, y: 0.5 },
    texture: { width: 512, height: 512, sha256: "b".repeat(64),
      url: `/field-background-media/textures/${"b".repeat(64)}.png`, source: provenance, textureSource: provenance } };
  const layer = { id: 7, type: "imagelayer", name: "FarBGLayer1", visible: true, properties: [] };
  const tile = { source: provenance, data: { ...f.tile.data, layers: [...f.tile.data.layers, layer] } };
  assert.equal(compileMapGeometry(tile, f.collision, f.textures).blockers.length, 1);
  const accepted = compileMapGeometry(tile, f.collision, f.textures, [background]);
  assert.equal(accepted.blockers.length, 0); assert.deepEqual(accepted.backgrounds, [background]);
  const other = { ...tile, data: { ...tile.data, layers: [...tile.data.layers,
    { ...layer, id: 8, name: "NearBGLayer1" }] } };
  assert.equal(compileMapGeometry(other, f.collision, f.textures, [background]).blockers.length, 1);
  assert.throws(() => compileMapGeometry(tile, f.collision, f.textures,
    [{ ...background, source: { ...provenance, sha256: "c".repeat(64) } }]), /does not belong/);
  assert.throws(() => compileMapGeometry(tile, f.collision, f.textures,
    [{ ...background, layerId: 8 }]), /no source layer/);
  const nested = { source: provenance, data: { ...f.tile.data,
    layers: [{ type: "group", name: "other", layers: [layer] }] } };
  assert.throws(() => compileMapGeometry(nested, f.collision, f.textures, [background]), /no source layer/);
});
test("all-map geometry preserves tile flags and collision editor visibility but rejects missing/foreign atlases", () => {
  const f = geometry();
  f.tile.data.layers[0]!.data[0] = 0x80000001;
  const good = compileMapGeometry(f.tile, f.collision, f.textures);
  assert.deepEqual(good.blockers, []);
  assert.equal(good.layers[0]!.data[0], 0x80000001);
  assert.equal(good.source.objectId, "9007199254740993");
  assert.ok(
    compileMapGeometry(f.tile, f.collision, {}).blockers.some((x) =>
      x.reason.startsWith("Missing package texture"),
    ),
  );
  f.textures["atlas.png"].width = 15;
  assert.ok(
    compileMapGeometry(f.tile, f.collision, f.textures).blockers.some(
      (x) => x.reason === "Atlas dimensions differ from tileset",
    ),
  );
});
test("unsupported collision, transforms and atlas cells remain batch diagnostics", () => {
  const f = geometry();
  f.tile.data.layers[0]!.data[1] = 2;
  f.collision.data.layers[0]!.data[0] = 14;
  Object.assign(f.tile.data.layers[0]!, { offsetx: 16 });
  const result = compileMapGeometry(f.tile, f.collision, f.textures);
  for (const reason of [
    "Unsupported tile layer transform",
    "Unsupported collision value",
    "Tile references absent atlas cell",
  ])
    assert.ok(result.blockers.some((x) => x.reason === reason));
  f.collision.data.layers[0]!.name = "constructor";
  assert.ok(
    compileMapGeometry(f.tile, f.collision, f.textures).blockers.some(
      (x) => x.reason === "Unknown or duplicate collision layer",
    ),
  );
});
function actor() {
  return {
    animation: {
      source,
      data: {
        shader_type: 0,
        animation: [
          {
            name: "Default",
            play_speed: 1,
            play_mode: 0,
            is_reverse: false,
            next_anim_name: "WalkB",
            frames: [
              {
                sprite_name: "pose",
                offsetx: 0,
                offsety: 0,
                flip: false,
                alpha: 1,
                rgb: { r: 1, g: 1, b: 1 },
              },
            ],
          },
        ],
      },
    },
    sprites: {
      pose: {
        file: "sprites/pose.png",
        sha256: "synthetic",
        width: 16,
        height: 24,
        pivot: [0.5, 0],
        source,
      },
    },
  };
}
test("character packages fail ambiguous poses, missing next frames and unsupported shaders explicitly", () => {
  const raw = actor(),
    verified: string[] = [];
  let result = compileWorldCharacter(raw, (file) => {
    verified.push(file);
  });
  assert.deepEqual(verified, ["sprites/pose.png"]);
  assert.ok(missingFieldPoses(result.character).includes("WalkB"));
  raw.animation.data.animation.push(
    structuredClone(raw.animation.data.animation[0]!),
  );
  result = compileWorldCharacter(raw, () => {});
  assert.equal(result.character.animations.Default, undefined);
  assert.ok(
    result.issues.some((x) => x.reason.startsWith("Duplicate animation")),
  );
  raw.animation.data.shader_type = 1;
  result = compileWorldCharacter(raw, () => {});
  assert.deepEqual(result.character.animations, {});
  assert.equal(result.issues[0]!.reason, "Unsupported character shader");
});
