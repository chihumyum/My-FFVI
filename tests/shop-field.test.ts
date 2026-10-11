import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import type { FieldContent } from "../src/field/types.js";

function fixture(start = "HELLO", close = "BYE") {
  const source = { file: "synthetic", assetPath: "shop" };
  const tables = {
    "action.csv": [{ id: "8", action_name: "Shop" }],
    "mapobject.csv": [{ id: "29", asset_name: "shopkeeper" }],
    "transportation.csv": [{ id: "1", type_id: "1", asset_id: "0" }],
    "field_character_asset.csv": [],
    "product_group.csv": [{ id: "3", mes_id_name: "SHOP" }],
    "product.csv": [
      {
        id: "10",
        group_id: "3",
        content_id: "2",
        coefficient: "0",
        purchase_limit: "0",
      },
    ],
    "content.csv": [{ id: "2", type_id: "1", type_value: "1" }],
    "item.csv": [{ id: "1", type_id: "1", buy: "50" }],
  };
  const properties = {
    object_type: 17,
    entity_id: 8,
    asset_id: 29,
    action_id: 8,
    product_group_id: 3,
    accept_action_direction: 15,
    direction: 8,
    move_type: 0,
    message_key: start,
    close_message_key: close,
    eye_contact: true,
    turn_around: true,
    pushed: false,
    collision: true,
  };
  const raw = {
    data: {
      layers: [
        {
          name: "GroundObject",
          objects: [
            {
              x: 32,
              y: 48,
              width: 16,
              height: 16,
              gid: 1,
              properties: Object.entries(properties).map(([name, value]) => ({
                name,
                value,
              })),
            },
          ],
        },
      ],
    },
    source,
  };
  const messages = {
    story_mes_zhc: { HELLO: "Welcome", BYE: "Goodbye" },
    story_cha_zhc: { HELLO: "Clerk", BYE: "Clerk" },
  };
  const group = compileEntityGroup("shop", raw, tables, messages);
  assert.deepEqual(group.blockers, []);
  const content: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic",
    contentHash: "synthetic-shop",
    map: {
      id: "synthetic-shop",
      width: 6,
      height: 6,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(36).fill(0) },
      entities: group.entities,
      source,
    },
    characters: {},
    scripts: {
      another: [{ kind: "exit", script: "another", index: 0, source }],
    },
    entry: {
      player: {
        x: 2,
        y: 3,
        layer: 1,
        direction: "up",
        asset: "hero",
        mount: "",
      },
      description: "Controlled shop lifecycle",
      evidence: [source],
    },
    limitations: [],
  };
  let validated = 0;
  const options = {
    shop: {
      validate: (id: number) => {
        assert.equal(id, 3);
        validated++;
      },
    },
  };
  return {
    content,
    group,
    options,
    validated: () => validated,
    game: new FieldGame(
      content,
      EventState.initialized(),
      undefined,
      undefined,
      options,
    ),
  };
}

test("ShopNPC uses the ordinary actor path and retains collision/facing behavior", () => {
  const { game, group } = fixture();
  assert.equal(group.entities[0]!.kind, 17);
  assert.equal(game.actors["8"]!.asset, "shopkeeper");
  assert.equal(game.move("up"), false);
  game.confirm();
  assert.equal(game.actors["8"]!.direction, "down");
  game.confirm();
  game.closeShop();
  game.confirm();
  assert.equal(game.actors["8"]!.direction, "left");
});

test("greeting precedes the transaction window and farewell precedes idle save readiness", () => {
  const { game, validated, content, options } = fixture();
  game.confirm();
  assert.equal(validated(), 1);
  assert.equal(game.dialogue!.key, "HELLO");
  assert.equal(game.currentShop, null);
  assert.equal(game.closeShop(), false);
  assert.throws(() => game.checkpoint(), /Cannot save/);
  game.confirm();
  assert.equal(game.dialogue, null);
  assert.equal(game.currentShop!.groupId, 3);
  const shop = game.currentShop!;
  shop.groupId = 99;
  assert.equal(game.currentShop!.groupId, 3);
  assert.equal(game.busy, true);
  assert.equal(game.checkpointReady, false);
  game.confirm();
  game.advance(100);
  assert.equal(game.currentShop!.id, shop.id);
  assert.equal(game.closeShop(), true);
  assert.equal(game.closeShop(), false);
  assert.equal(game.currentShop, null);
  assert.equal(game.dialogue!.key, "BYE");
  assert.throws(() => game.checkpoint(), /Cannot save/);
  game.confirm();
  assert.equal(game.checkpointReady, true);
  const restored = FieldGame.restore(content, game.checkpoint(), options);
  assert.equal(restored.currentShop, null);
  assert.equal(restored.dialogue, null);
  restored.confirm();
  restored.confirm();
  assert.ok(restored.currentShop!.id > shop.id);
});

test("open shop prevents movement, unrelated event starts and map handoff", () => {
  const { game } = fixture("", "");
  game.confirm();
  assert.ok(game.currentShop);
  assert.equal(game.move("right"), false);
  assert.equal(game.startEvent("another"), false);
  assert.throws(() => game.previewMap(1, 1), /during an event/);
  assert.equal(game.closeShop(), true);
  assert.equal(game.checkpointReady, true);
  assert.equal(game.closeShop(), false);
  assert.equal(game.startEvent("another"), true);
});

test("a stopped field withdraws the shop transaction window and stays unsaveable", () => {
  const { game } = fixture("", "");
  game.confirm();
  assert.ok(game.currentShop);
  game.stop = { kind: "unsupported", message: "Controlled field failure", site: null };
  assert.equal(game.currentShop, null);
  assert.equal(game.closeShop(), false);
  assert.equal(game.checkpointReady, false);
});

test("missing or rejected shop owner blocks atomically before greeting or facing changes", () => {
  const { content } = fixture();
  for (const options of [
    {},
    {
      shop: {
        validate() {
          throw new Error("Unknown catalog");
        },
      },
    },
  ]) {
    const game = new FieldGame(
      content,
      EventState.initialized(),
      undefined,
      undefined,
      options,
    );
    game.confirm();
    assert.equal(game.stop!.kind, "unsupported");
    assert.equal(game.dialogue, null);
    assert.equal(game.currentShop, null);
    assert.equal(game.actors["8"]!.direction, "left");
    assert.equal(game.checkpointReady, false);
  }
});
