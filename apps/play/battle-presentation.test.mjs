import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Container, Texture, TextureSource } from "pixi.js";
import { Battle } from "../../src/play/battle.js";
import { BattlePresentation } from "./battle-presentation.js";

const read = async (name) =>
  JSON.parse(await readFile(new URL(`../../build/web-data/${name}`, import.meta.url)));
const [data, catalog, tables] = await Promise.all([
  read("battle.json"),
  read("battle-presentation.json"),
  read("raw/tables.json"),
]);

test("Narshe's PR party keeps Terra and both soldier riders on P022 armor, including an older ghost-sprite save", () => {
  const ghost = data.characters[17].sprite;
  assert.match(ghost.url, /bc_ff6_p019_/);
  const party = [1, 31, 32].map((id) => ({
    ...structuredClone(data.characters[id]),
    magitek: true,
    sprite: ghost,
    normalSprite: ghost,
    magitekSprite: ghost,
  }));
  const battle = new Battle({ data, party, encounterId: 1, random: () => 0.5 });
  const textures = new Map(),
    sprites = new Map(
      [
        ...Object.values(catalog.groups).flatMap(Object.values),
        ...Object.values(data.monsters).map((m) => m.sprite),
      ]
        .filter(Boolean)
        .map((info) => [info.url, info]),
    ),
    actors = new Container(),
    effects = new Container(),
    getTexture = (url) => {
      if (!url) return null;
      if (!textures.has(url)) {
        const info = sprites.get(url);
        textures.set(
          url,
          new Texture({ source: new TextureSource({ width: info.width, height: info.height }) }),
        );
      }
      return textures.get(url);
    },
    view = new BattlePresentation({ actors, effects, getTexture, warn: () => {} });
  view.setCatalog(catalog);
  view.draw(battle, data, 10);
  for (const [index, id] of [1, 31, 32].entries()) {
    const source = tables["character_asset.csv"].find((row) => Number(row.id) === id),
      group = catalog.groups[source.asset_name],
      row = view.row("player", index);
    assert.equal(battle.players[index].sprite.url, data.characters[id].sprite.url);
    assert.match(data.characters[id].magitekSprite.url, /bc_ff6_p022_/);
    const original = getTexture(group.Idle_00.url);
    assert.equal(row.sprite.texture.source, original.source);
    assert.equal(row.sprite.texture.frame.y, original.frame.y);
    assert.equal(
      row.sprite.texture.height,
      24,
      "native .25 UV offset removes the lower eight leg pixels",
    );
    assert.equal(
      row.sprite.y - row.sprite.texture.height,
      -48,
      "the rider's head is eight pixels lower than the former full-height -56 top",
    );
    assert(
      row.container.getChildIndex(row.sprite) > row.container.getChildIndex(row.armor),
      "the cropped soldier head cannot be covered by its own armor",
    );
    assert.equal(row.armor.texture, getTexture(catalog.groups.bc_ff6_p022.WalkL_01.url));
    assert.equal(row.armor.visible, true);
    assert.equal(
      row.sprite.y,
      -catalog.animationAliases.default.magic_armor_table.chara_position[0].y,
    );
    assert.notEqual(row.sprite.texture, getTexture(ghost.url));
  }

  const terra = view.row("player", 0);
  terra.action = { at: 10, abilityId: 218 };
  view.draw(battle, data, 10.3);
  assert.equal(terra.armor.texture, getTexture(catalog.groups.bc_ff6_p022.LeftAttack_00.url));
  assert.equal(
    terra.sprite.texture.source,
    getTexture(catalog.groups.bc_ff6_p001.WalkL_01.url).source,
  );
  const mirrored = view.pose(battle.players[0], terra, 10.3, true);
  assert.equal(mirrored.info, catalog.groups.bc_ff6_p001.WalkR_01);
  assert.equal(mirrored.armor, catalog.groups.bc_ff6_p022.LeftAttackR_00);
  assert.equal(mirrored.explicitRight, true);

  battle.players[0].magitek = false;
  terra.action = null;
  view.draw(battle, data, 12);
  assert.equal(terra.armor.visible, false);
  assert.equal(terra.sprite.y, 0);
  assert.equal(terra.sprite.texture, getTexture(catalog.groups.bc_ff6_p001.Default_00.url));
  assert.equal(view.group({ ...data.characters[17], side: "player" }), catalog.groups.bc_ff6_p019);
  view.clear();
  actors.destroy();
  effects.destroy();
  for (const texture of textures.values()) texture.destroy(false);
});

test("source groups and slot offsets keep both pincer sides visible and full-size Magitek riders apart", () => {
  const battle = new Battle({
      data,
      party: [1, 31, 32].map((id) => ({ ...structuredClone(data.characters[id]), magitek: true })),
      encounterId: 42,
      random: () => 0.5,
    }),
    view = new BattlePresentation({ warn: () => {} });
  view.setCatalog(catalog);
  view.attach(battle, data);
  assert.equal(battle.pattern, 4);
  assert.deepEqual(
    battle.enemies.map((unit) => unit.group),
    [1, 1, 2],
  );
  for (const [index, enemy] of battle.enemies.entries()) {
    const point = view.position("enemy", index);
    assert.equal(point.x > 192, enemy.group === 1);
    assert.equal(point.mirror, enemy.group === 1);
    assert(point.x > 0 && point.x < 384);
  }
  const players = battle.players.map((_, index) => view.position("player", index));
  assert.deepEqual(
    players.map((p) => p.x),
    [192, 192, 192],
  );
  assert.deepEqual(
    players.map((p) => p.mirror),
    [false, true, false],
  );
  assert(players[1].y - players[0].y >= 48);
  assert(players[2].y - players[1].y >= 48);
  assert(players[0].y - 48 >= 0 && players[2].y <= 160);

  battle.pattern = 0;
  const normal = view.position("enemy", 0);
  assert.equal(normal.x, 192 - 75 + 43, "slot zero retains the native 35-unit lattice adjustment");
  battle.pattern = 2;
  assert.equal(view.position("enemy", 0).x, 384 - normal.x);
  assert(view.position("player", 0).x < 192);
  assert.equal(view.position("player", 0).mirror, true);
  battle.players.push({ ...structuredClone(data.characters[2]), magitek: false });
  battle.pattern = 5;
  const wings = battle.players.map((_, index) => view.position("player", index));
  assert.deepEqual(
    wings.map((point) => point.x > 192),
    [true, true, false, false],
  );
  assert.deepEqual(
    wings.map((point) => point.mirror),
    [false, false, true, true],
  );
  battle.players.splice(2);
  assert(view.position("player", 0).x > 192 && view.position("player", 1).x < 192);
});
