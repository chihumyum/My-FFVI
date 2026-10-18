import test from "node:test";
import assert from "node:assert/strict";
import { Container, Sprite, Texture, TextureSource } from "pixi.js";
import { sceneTextureBindings, detachTextureSource } from "./texture-ownership.js";

test("cached visible sprites and sampler-only pages remain owned without new image lookups", () => {
  const source = new TextureSource({ width: 2, height: 2 });
  const texture = new Texture({ source });
  const stage = new Container();
  const sprite = new Sprite(texture);
  stage.addChild(sprite);
  const sampler = { resources: { uOther: source } };
  const filtered = new Container();
  filtered.filters = [sampler];
  stage.addChild(filtered);
  const hidden = new Container();
  hidden.visible = false;
  hidden.addChild(new Sprite(texture));
  stage.addChild(hidden);
  const held = sceneTextureBindings(stage, { visibleOnly: true });
  assert.equal(held.length, 2);
  assert.ok(held.every((binding) => binding.source === source));
  sprite.visible = filtered.visible = false;
  assert.deepEqual(sceneTextureBindings(stage, { visibleOnly: true }), []);
  stage.destroy({ children: true });
  texture.destroy(true);
});

test("eviction detaches hidden pooled sprites, particle entries and shader samplers before destruction", () => {
  const source = new TextureSource({ width: 2, height: 2 });
  const texture = new Texture({ source });
  const stage = new Container();
  const pooled = new Sprite(texture);
  pooled.visible = false;
  stage.addChild(pooled);
  const sampler = { resources: { uOther: source } };
  stage.filters = [sampler];
  const particle = { texture };
  stage.particleChildren = [particle];
  assert.equal(detachTextureSource(stage, source, Texture.EMPTY), 3);
  assert.equal(pooled.texture, Texture.EMPTY);
  assert.equal(sampler.resources.uOther, Texture.EMPTY.source);
  assert.equal(particle.texture, Texture.EMPTY);
  texture.destroy(true);
  assert.equal(source.style, null);
  assert.ok(sceneTextureBindings(stage).every((binding) => !binding.source.destroyed));
  stage.filters = null;
  stage.destroy({ children: true });
});
