import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Container, Texture } from "pixi.js";
import { PRParticles } from "./particles.js";

test("PR's sub-frame water particles survive their first render, renew and obey capacity", async () => {
  const catalog = JSON.parse(
      await readFile(new URL("../../build/web-data/particles.json", import.meta.url)),
    ),
    particles = new PRParticles({
      container: new Container(),
      getTexture: () => Texture.WHITE,
      warn: () => {},
    }).setCatalog(catalog),
    instance = particles.play("bg_ff6_14", { seed: 14, duration: Infinity }),
    water = instance.systems.find((state) => state.definition.name === "Water");
  try {
    assert.ok(water.definition.initial.lifetime.max < 1 / 60);
    assert.equal(water.definition.initial.maxParticles, 1);
    let previous;
    for (let frame = 0; frame < 120; frame++) {
      particles.update(1 / 60);
      assert.equal(water.particles.length, 1, `Water is absent at frame ${frame}`);
      const p = water.particles[0];
      assert.notEqual(p, previous, "Expired water planes must be replaced, not kept alive forever");
      assert.ok(p.sprite.visible && p.sprite.alpha > 0);
      assert.ok(p.age < p.lifetime);
      previous = p;
    }
  } finally {
    particles.destroy();
  }
});
