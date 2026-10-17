import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import type { FieldContent, Op } from "../src/field/types.js";

const source = { file: "synthetic", assetPath: "objects" };
const tables = {
  "action.csv": [
    { id: "2", action_name: "RunScript" },
    { id: "4", action_name: "Talk" },
    { id: "9", action_name: "Encount" },
  ],
  "script.csv": [{ id: "1", script_name: "inspect" }],
  "mapobject.csv": [{ id: "1", asset_name: "person" }],
  "transportation.csv": [
    { id: "1", type_id: "1", asset_id: "0" },
    { id: "2", type_id: "8", asset_id: "2" },
  ],
  "field_character_asset.csv": [{ id: "2", asset_name: "airship" }],
};
function compile(p: Record<string, unknown> = {}, geometry = {}) {
  return compileEntityGroup(
    "entity_default",
    {
      source,
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
                gid: 999,
                ...geometry,
                properties: Object.entries({
                  object_type: 5,
                  entity_id: 10,
                  asset_id: 0,
                  action_id: 4,
                  message_key: "inspect",
                  accept_action_direction: 15,
                  affected: true,
                  collision: true,
                  ...p,
                }).map(([name, value]) => ({ name, value })),
              },
            ],
          },
        ],
      },
    },
    tables,
    {
      story_mes_zhc: { inspect: "测试调查点。" },
      story_cha_zhc: { inspect: "" },
    },
  );
}
const op = (value: Record<string, unknown>): Op =>
  ({ ...value, source, script: "inspect", index: 0 }) as Op;
function fixture(p: Record<string, unknown> = {}, instructions: Op[] = []) {
  const group = compile(p);
  assert.deepEqual(group.blockers, []);
  const content: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic",
    contentHash: "synthetic",
    map: {
      id: "test",
      width: 6,
      height: 6,
      tileSize: 16,
      source,
      layers: [],
      textures: {},
      tilesets: [],
      collisions: { 1: Array(36).fill(0) },
      entities: group.entities,
    },
    characters: {},
    scripts: { inspect: instructions },
    entry: {
      player: {
        x: 2,
        y: 3,
        layer: 1,
        direction: "up",
        asset: "hero",
        mount: "",
      },
      description: "synthetic",
      evidence: [source],
    },
    limitations: [],
  };
  return new FieldGame(content, EventState.initialized());
}

test("assetless objects retain collision and interaction without requiring character media", () => {
  const game = fixture();
  assert.deepEqual(Object.keys(game.actors), ["-1001"]);
  assert.equal(game.entities[0]!.asset, null);
  assert.equal(game.entities[0]!.source.pointer, "/layers/0/objects/0");
  assert.equal(game.move("up"), false);
  game.confirm();
  assert.equal(game.dialogue?.key, "inspect");
  assert.equal(game.move("right"), false);
  game.confirm();
  assert.equal(game.busy, false);
  game.confirm();
  assert.equal(game.dialogue?.key, "inspect");
});

test("default map-object collision differs from NPC collision; noninteractive blockers still occupy space", () => {
  assert.equal(
    compile({ collision: undefined }).entities[0]!.mapObject!.collision,
    false,
  );
  assert.equal(
    compile({
      object_type: 6,
      asset_id: 1,
      affected: false,
      collision: undefined,
    }).entities[0]!.npc!.collision,
    true,
  );
  const solid = fixture({ action_id: 0 });
  solid.confirm();
  assert.equal(solid.busy, false);
  assert.equal(solid.move("up"), false);
  const through = fixture({ collision: false });
  assert.equal(through.move("up"), true);
  through.advance(240);
  assert.equal(through.player.y, 2);
});

test("map-object selection observes source side, transport, layer and hidden state", () => {
  const game = fixture({ accept_action_direction: 4 });
  game.confirm();
  assert.ok(game.dialogue);
  game.confirm();
  game.player.y = 1;
  game.player.direction = "down";
  game.confirm();
  assert.equal(game.dialogue, null);
  game.player.y = 3;
  game.player.direction = "up";
  game.player.mount = "airship";
  game.confirm();
  assert.equal(game.dialogue, null);
  game.player.mount = "";
  game.player.layer = 0;
  game.confirm();
  assert.equal(game.dialogue, null);
  game.player.layer = 1;
  game.hiddenEntities.add("10");
  game.confirm();
  assert.equal(game.dialogue, null);
  assert.equal(game.move("up"), true);
});

test("map-object scripts retain player root and can explicitly hide their logical entity", () => {
  const game = fixture({ action_id: 2, script_id: 1, se_id: 9 }, [
    op({ kind: "position", x: 3, y: 3, animation: "" }),
    op({ kind: "puppet", slot: 0, actor: "10", target: 4 }),
    op({ kind: "join" }),
    op({ kind: "exit" }),
    op({ kind: "hide" }),
    op({ kind: "exit" }),
  ]);
  game.confirm();
  game.advance(10);
  assert.equal(game.stop, null);
  assert.equal(game.busy, false);
  assert.equal(game.player.x, 3);
  assert.equal(game.entities[0]!.x, 2);
  assert.ok(game.hiddenEntities.has("10"));
  assert.equal(game.presentationOmissions[0]!.soundId, 9);
  game.player.x = 2;
  assert.equal(game.move("up"), true);
});

test("ordinary Talk does not borrow RunScript sound and explicit empty scripts yield without resetting state", () => {
  const talk = fixture({ se_id: 9 });
  talk.confirm();
  assert.deepEqual(talk.presentationOmissions, []);
  const empty = fixture({ action_id: 2, script_id: 0, se_id: 9 });
  const before = empty.eventState.snapshot();
  empty.confirm();
  assert.equal(empty.busy, true);
  empty.advance(10);
  assert.equal(empty.busy, false);
  assert.deepEqual(empty.eventState.snapshot(), before);
  assert.equal(empty.presentationOmissions[0]!.soundId, 9);
});

test("ambiguous NPC/object targets and missing scripts stop before performing actions", () => {
  const seed = fixture();
  seed.content.map.entities.push({
    ...compile({ object_type: 6, asset_id: 1, affected: false }).entities[0]!,
    id: "20",
  });
  const ambiguous = new FieldGame(seed.content);
  ambiguous.confirm();
  assert.match(ambiguous.stop!.message, /不明确/);
  assert.equal(ambiguous.dialogue, null);
  const missing = fixture({ action_id: 2, script_id: 1 });
  delete missing.content.scripts.inspect;
  missing.confirm();
  assert.match(missing.stop!.message, /缺少交互事件脚本/);
  assert.deepEqual(missing.presentationOmissions, []);
});

test("sprite objects, special geometry, missing text, conditions and contact actions remain explicit blockers", () => {
  for (const p of [
    { asset_id: 1 },
    { birdview_puppet: true },
    { action_id: 9 },
    { gimmick: true },
    { target_transportation_ids: "1" },
    { message_key: "missing" },
    { talk_target_transportation_ids: "99" },
    { accept_action_direction: 16 },
    { script_id: 99 },
    { target_character_status_id: 1 },
  ])
    assert.ok(compile(p).blockers.length, JSON.stringify(p));
  for (const geometry of [
    { width: 32 },
    { height: 48 },
    { x: 40 },
    { y: 47 },
    { gid: 0 },
  ])
    assert.ok(compile({}, geometry).blockers.length, JSON.stringify(geometry));
});

test("unsupported object movement is not silently treated as a character", () => {
  const game = fixture({ action_id: 2, script_id: 1 }, [
    op({ kind: "puppet", slot: 0, actor: "10", target: 3 }),
    op({ kind: "join" }),
    op({ kind: "exit" }),
    op({ kind: "position", x: 4, y: 4, animation: "" }),
    op({ kind: "exit" }),
  ]);
  game.confirm();
  assert.match(game.stop!.message, /非角色实体不能定位/);
  assert.deepEqual([game.entities[0]!.x, game.entities[0]!.y], [2, 2]);
});
