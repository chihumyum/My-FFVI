import test from "node:test";
import assert from "node:assert/strict";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import type { FieldContent, FieldEntity } from "../src/field/types.js";

const source = { file: "synthetic", assetPath: "Room/people.json" };
const messages = {
  story_mes_zhc: { greeting: "测试第一行\\n测试第二行。" },
  story_cha_zhc: { greeting: "测试居民" },
};
const tables = {
  "mapobject.csv": [{ id: "7", asset_name: "resident" }],
  "script.csv": [{ id: "11", script_name: "conversation" }],
  "action.csv": [
    { id: "2", action_name: "RunScript" },
    { id: "4", action_name: "Talk" },
    { id: "9", action_name: "Encount" },
  ],
  "transportation.csv": [
    { id: "1", type_id: "1", asset_id: "0" },
    { id: "6", type_id: "12", asset_id: "7" },
    { id: "8", type_id: "8", asset_id: "8" },
  ],
  "field_character_asset.csv": [
    { id: "7", asset_name: "vehicle" },
    { id: "8", asset_name: "airship" },
  ],
};
function compile(
  props: Record<string, unknown> = {},
  text = messages,
  masters = tables,
) {
  const p = {
    object_type: 6,
    entity_id: 10,
    asset_id: 7,
    action_id: 4,
    message_key: "greeting",
    direction: 8,
    move_type: 0,
    accept_action_direction: 15,
    eye_contact: true,
    turn_around: true,
    pushed: true,
    idling: true,
    ...props,
  };
  return compileEntityGroup(
    "people",
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
                gid: 900,
                properties: Object.entries(p).map(([name, value]) => ({
                  name,
                  value,
                })),
              },
            ],
          },
        ],
      },
    },
    masters,
    text,
  );
}
function fixture(
  props: Record<string, unknown> = {},
  instructions: unknown[] = [],
) {
  const group = compile(props);
  assert.deepEqual(group.blockers, []);
  const content: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic",
    contentHash: "synthetic",
    map: {
      id: "room",
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
      conversation: instructions.map((m, index) =>
        decodeFieldOp(m, { script: "conversation", index, source }, messages),
      ),
    },
    scriptLocals: { conversation: { labels: ["visit"], values: [7] } },
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
const raw = (
  mnemonic: string,
  iValues: number[] = [],
  sValues: string[] = [],
  rValues: number[] = [0, 0, 0, 0],
) => ({
  mnemonic,
  type: 1,
  operands: {
    iValues: [...iValues, ...Array(8 - iValues.length).fill(0)],
    rValues,
    sValues: [...sValues, ...Array(8 - sValues.length).fill("")],
  },
});

test("stationary NPC metadata uses source action and transportation domains; unknown behavior remains blocked", () => {
  const group = compile({ link_object_id: 9 });
  assert.deepEqual(group.blockers, []);
  const e = group.entities[0]!;
  assert.equal(e.asset, "resident");
  assert.deepEqual(e.npc!.talkMounts, ["", "vehicle"]);
  assert.equal(e.npc!.pushed, true);
  assert.equal(e.npc!.collision, true);
  assert.equal(e.source.pointer, "/layers/0/objects/0");
  assert.equal(e.y, 2);
  for (const props of [
    { move_type: 1 },
    { move_type: 2 },
    { move_type: 3 },
    { affected: true },
    { all_layers: true },
    { birdview_puppet: true },
    { action_id: 9 },
    { script_id: 99, action_id: 2 },
    { target_character_status_id: 99 },
    { talk_target_transportation_ids: "99" },
    { accept_action_direction: 16 },
  ])
    assert.ok(compile(props).blockers.length, JSON.stringify(props));
  assert.deepEqual(compile({ collision: false }).blockers, []);
  assert.deepEqual(compile({ action_id: 0 }).entities[0]!.npc!.interaction, {
    kind: "none",
  });
});

test("NPC and script messages reject missing localization and inline controls without inventing text", () => {
  for (const text of [
    { ...messages, story_cha_zhc: {} },
    { ...messages, story_mes_zhc: { greeting: "<unknown>" } },
    { ...messages, story_mes_zhc: { greeting: "wait\\p" } },
    { ...messages, story_cha_zhc: { greeting: "<player>" } },
  ]) {
    assert.ok(compile({}, text as typeof messages).blockers.length);
    assert.equal(
      decodeFieldOp(
        raw("Msg", [], ["greeting"]),
        { script: "x", index: 0, source },
        text,
      ).kind,
      "blocked",
    );
  }
  const ambiguous = structuredClone(tables);
  ambiguous["action.csv"].push({ id: "4", action_name: "Different" });
  assert.match(
    compile({}, messages, ambiguous).blockers[0]!.reason,
    /Ambiguous/,
  );
});

test("Talk consumes one confirmation to close, freezes walking, and restores only the native eye-contact/turn-around combination", () => {
  for (const eye of [false, true])
    for (const turn of [false, true]) {
      const game = fixture({ eye_contact: eye, turn_around: turn });
      game.confirm();
      assert.equal(game.dialogue?.text, "测试第一行\n测试第二行。");
      assert.equal(game.actors["10"]!.direction, eye ? "down" : "left");
      assert.equal(game.move("right"), false);
      game.advance(1000);
      assert.equal((game as FieldGame).dialogue?.key, "greeting");
      game.confirm();
      assert.equal(game.dialogue, null);
      assert.equal(game.busy, false);
      assert.equal(
        game.actors["10"]!.direction,
        eye && !turn ? "down" : "left",
      );
      game.confirm();
      assert.equal((game as FieldGame).dialogue?.key, "greeting");
    }
});

test("accept direction is the NPC-to-player side; transportation, hidden state and actor position govern targeting", () => {
  const game = fixture({ accept_action_direction: 4 });
  game.confirm();
  assert.ok(
    game.dialogue,
    "Player south of NPC is direction bit 4 even when facing up",
  );
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
  game.player.mount = "vehicle";
  game.confirm();
  assert.ok(game.dialogue);
  game.confirm();
  game.hiddenEntities.add("10");
  game.confirm();
  assert.equal(game.dialogue, null);
  game.hiddenEntities.clear();
  game.actors["10"]!.x = 4;
  game.confirm();
  assert.equal(
    game.dialogue,
    null,
    "Original entity anchor must not remain interactive",
  );
  game.player.x = 4;
  game.confirm();
  assert.ok(game.dialogue, "The moved actor is the interaction target");
  game.confirm();
  game.actors["10"]!.layer = 2;
  game.confirm();
  assert.equal(game.dialogue, null);
});

test("script interaction runs the shared VM and player root, initializes locals and retains NPC facing until all work ends", () => {
  const game = fixture({ action_id: 2, script_id: 11 }, [
    raw("SetPos", [3, 3]),
    raw("Msg", [0, 0], ["greeting"]),
    raw("Wait", [], [], [0.1]),
    raw("SetFlag", [5], ["ScenarioFlag1"]),
    raw("Exit"),
  ]);
  game.confirm();
  assert.equal(game.stop, null);
  assert.equal(
    game.player.x,
    3,
    "NPC action does not bind the VM root to the NPC",
  );
  assert.equal(game.actors["10"]!.x, 2);
  assert.equal(game.actors["10"]!.direction, "down");
  assert.equal(
    game.eventState.read({ category: "ScriptLocalVariable", index: 0 }),
    7,
  );
  game.confirm();
  game.advance(90);
  assert.equal(game.busy, true);
  assert.equal(game.actors["10"]!.direction, "down");
  game.advance(10);
  assert.equal(
    game.eventState.read({ category: "ScenarioFlag1", index: 5 }),
    1,
  );
  assert.equal(game.actors["10"]!.direction, "left");
  assert.equal(game.busy, false);
});

test("stationary collision follows the nullable source switch; pushed does not turn Wait into a wandering controller", () => {
  const solid = fixture();
  assert.equal(solid.move("up"), false);
  solid.advance(10000);
  assert.deepEqual([solid.actors["10"]!.x, solid.actors["10"]!.y], [2, 2]);
  const through = fixture({ collision: false });
  assert.equal(through.move("up"), true);
  through.advance(240);
  assert.equal(through.player.y, 2);
});

test("an explicitly empty RunScript yields control without creating a script, message or local-state reset", () => {
  const game = fixture({ action_id: 2, script_id: 0 });
  const before = game.eventState.snapshot();
  game.confirm();
  assert.equal(game.stop, null);
  assert.equal(game.dialogue, null);
  assert.equal(game.busy, true);
  assert.equal(game.actors["10"]!.direction, "down");
  game.advance(10);
  assert.equal(game.busy, false);
  assert.equal(game.actors["10"]!.direction, "left");
  assert.deepEqual(game.eventState.snapshot(), before);
});

test("missing scripts and ambiguous interactive actors fail before changing NPC facing or starting dialogue", () => {
  const missing = fixture({ action_id: 2, script_id: 11 });
  delete missing.content.scripts.conversation;
  missing.confirm();
  assert.match(missing.stop!.message, /缺少 NPC/);
  assert.equal(missing.actors["10"]!.direction, "left");
  const seed = fixture();
  seed.content.map.entities.push({
    ...structuredClone(seed.entities[0]!),
    id: "11",
  } as FieldEntity);
  const ambiguous = new FieldGame(seed.content);
  ambiguous.confirm();
  assert.match(ambiguous.stop!.message, /不明确/);
  assert.equal(ambiguous.dialogue, null);
  assert.equal(ambiguous.actors["10"]!.direction, "left");
});
