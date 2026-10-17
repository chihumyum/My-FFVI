import test from "node:test";
import assert from "node:assert/strict";
import {
  WaterMaterial,
  waterMaterialConfig,
  waterControlWeights,
  shadeWaterPixel,
} from "./water-material.js";
import { Texture, TextureSource } from "pixi.js";
import { inspectWaterMaterials } from "../../tools/play/check-water-materials.mjs";

test("water cannot bind an evicted palette or apply while replacement inputs are pending", () => {
  const fresh = () => new Texture({ source: new TextureSource({ width: 16, height: 16 }) }),
    inputs = new Map(
      ["noise", "normalSmall", "normalLarge", "pattern", "palette"].map((key) => [key, fresh()]),
    ),
    material = {
      properties: {},
      textures: Object.fromEntries(
        [...inputs.keys()].filter((key) => key !== "palette").map((key) => [key, { url: key }]),
      ),
      palette: { url: "palette", colors: 16, frameCount: 8 },
    },
    // Exercise resource lifetime without a browser GL constructor. The real
    // back-buffer shader and all source layers have separate WebGL coverage.
    water = Object.assign(Object.create(WaterMaterial.prototype), {
      getTexture: (key) => inputs.get(key),
      warn: () => {},
      collectAll: () => false,
      warnings: new Set(),
      resources: {
        waterUniforms: {
          uniforms: new Proxy(
            {},
            {
              get(object, key) {
                return (object[key] ??= new Float32Array(4));
              },
            },
          ),
        },
      },
    });
  try {
    assert.equal(water.update(material), true);
    const retired = inputs.get("palette");
    retired.destroy(true);
    inputs.delete("palette");
    assert.equal(water.update(material), false, "A pending palette must prevent rendering");
    assert.equal(water.resources.uPalette, Texture.WHITE.source);
    const withoutPalette = { ...material, palette: null };
    assert.equal(water.update(withoutPalette), true);
    assert.equal(
      water.resources.uPalette,
      Texture.WHITE.source,
      "Unused sampler bindings still must be valid",
    );
    inputs.get("noise").destroy(true);
    inputs.delete("noise");
    assert.equal(water.update(withoutPalette), false);
    assert.equal(water.resources.uNoise, Texture.EMPTY.source);
    inputs.set("noise", fresh());
    assert.equal(water.update(withoutPalette), true);
    assert.equal(water.resources.uNoise, inputs.get("noise").source);
  } finally {
    for (const texture of inputs.values()) texture.destroy(true);
  }
});

test("source controller blue is coverage, not a visible blue floor", () => {
  const material = {
      properties: {
        use_custom_water_color: true,
        custom_water_color: "#ffd94000",
        water_blend_ratio: 1,
        condensing_pattern_intensity: 0,
      },
    },
    config = waterMaterialConfig(material, "BottomWater"),
    floor = [0.1, 0.2, 0.3, 1];
  assert.deepEqual(shadeWaterPixel(config, [0, 0, 1, 1], floor), [217 / 255, 64 / 255, 0, 1]);
  assert.deepEqual(shadeWaterPixel(config, [1, 1, 1, 0], floor), [0, 0, 0, 0]);
  assert.equal(waterControlWeights([0, 0, 0.25, 0.25]).coverage, 0.25);
  assert.equal(
    waterControlWeights([0, 0, 0, 1]).coverage,
    1,
    "opaque black controller RGB is not an alpha cutout",
  );
  assert.deepEqual(
    shadeWaterPixel(config, [0, 0, 0, 1], floor),
    floor,
    "opaque black retains raster alpha but does not paint water over the source bank mask",
  );
  const transparent = shadeWaterPixel(config, [0, 0, 0, 0], floor);
  assert.equal(transparent[3], 0, "unmasked floor is left untouched by alpha blending");
  const shallow = waterMaterialConfig({ properties: { water_depth_level: 0 } });
  assert.equal(shadeWaterPixel(shallow, [0, 0, 1, 1], floor)[3], 1);
  const halfOpacity = shadeWaterPixel({ ...config, opacity: 0.5 }, [0, 0, 1, 1], floor);
  assert.deepEqual(halfOpacity, [217 / 255 / 2, 64 / 255 / 2, 0, 0.5]);
});

test("source Water commands animate material properties, not a layer alpha inferred from depth", () => {
  const material = {
      properties: { custom_water_color: "#ffd94000", use_custom_water_color: true },
    },
    properties = {
      "_WaterColor:R": { from: 217, to: 27, duration: 3, time: 10, layer: -1 },
      "_WaterColor:A": { from: 255, to: 0, duration: 3, time: 10, layer: 0 },
      _CondensingPatternIntensity: { from: 15, to: 3, duration: 3, time: 10 },
      _HighlightIntensity: { from: 25, to: 1, duration: 1.5, time: 10 },
    },
    bottom = waterMaterialConfig(material, "BottomWater", { properties, time: 11.5 }),
    ground = waterMaterialConfig(material, "GroundWater", { properties, time: 13 });
  assert.equal(bottom.color[0], 122 / 255);
  assert.equal(bottom.opacity, 0.5);
  assert.equal(bottom.patternIntensity, 9);
  assert.equal(bottom.highlight, 1);
  assert.equal(ground.opacity, 1, "bottom-only command cannot erase the GroundWater surface");
  const faded = waterMaterialConfig(material, "BottomWater", { properties, time: 13 });
  assert.deepEqual(shadeWaterPixel(faded, [0, 0, 1, 1], [1, 0, 0, 1]), [0, 0, 0, 0]);
  const layers = waterMaterialConfig(material, "BottomWater", {
    properties: {
      "0:_WaterColor:A": {
        name: "_WaterColor:A",
        layer: 0,
        from: 0,
        to: 0,
        time: 10,
        duration: 0,
        order: 1,
      },
      "-1:_WaterColor:A": {
        name: "_WaterColor:A",
        layer: -1,
        from: 255,
        to: 255,
        time: 10,
        duration: 0,
        order: 2,
      },
    },
    time: 10,
  });
  assert.equal(
    layers.opacity,
    1,
    "later all-layer source command overrides the older Bottom-only one",
  );
});

test("water composition retains underlying floor detail and authored defaults", () => {
  const config = waterMaterialConfig(
    {
      properties: {
        use_custom_water_color: false,
        water_blend_ratio: 0,
        condensing_pattern_intensity: 0,
        base_color_brightness: 1,
        base_color_saturation: 1,
      },
    },
    "BottomWater",
  );
  const a = shadeWaterPixel(config, [0, 0, 1, 1], [0.3, 0.4, 0.5, 1]),
    b = shadeWaterPixel(config, [0, 0, 1, 1], [0.7, 0.2, 0.1, 1]);
  assert.ok(a.every((x, i) => Math.abs(x - [0.3, 0.4, 0.5, 1][i]) < 1e-8));
  assert.notDeepEqual(a, b);
  const guessed = waterMaterialConfig({ properties: { unhandled_source_module: 1 } });
  assert.deepEqual(guessed.unknown, ["unhandled_source_module"]);
});

test("all 62 PR runtime water layers retain source controls and real floor/material images", async () => {
  const report = await inspectWaterMaterials();
  assert.equal(report.summary.rawWaterGroups, 49);
  assert.equal(report.summary.runtimeMaps, 50);
  assert.equal(report.summary.runtimeLayers, 62);
  assert.equal(report.summary.paletteLayers, 11);
  assert.deepEqual(report.issues, []);
  const lava = report.layers.find((row) => row.mapId === 499);
  assert.equal(lava.properties.custom_water_color, "#ffd94000");
  assert.equal(lava.properties.condensing_pattern_intensity, 15);
  assert.ok(lava.references.some((row) => row.kind === "floor"));
});
