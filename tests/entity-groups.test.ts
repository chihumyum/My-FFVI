import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { EventState, UnknownEventValue } from "../src/core/event-state.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import {
  bindMapPackages,
  resolveMapScript,
} from "../src/compiler/map-package.js";
import type { CorpusAsset } from "../src/compiler/corpus.js";
import { tableId } from "../src/compiler/table-id.js";
import type {
  EntityGroup,
  FieldContent,
  FieldEntity,
} from "../src/field/types.js";
const source = { file: "fixture", assetPath: "Assets/Room/event.json" };
const corpusAsset = (
  id: string,
  path: string,
  kind: CorpusAsset["kind"],
  data: unknown,
  file = "fixture",
): CorpusAsset => ({
  id,
  kind,
  data,
  source: {
    file,
    assetPath: path,
    serializedFile: "fixture",
    objectId: "9007199254740993",
    sha256: "a".repeat(64),
  },
});
const raw = (mnemonic: string, iv: number[] = [], sv: string[] = []) => ({
  mnemonic,
  type: 1,
  operands: { iValues: iv, rValues: [], sValues: sv },
});
const entity = (
  id: string,
  kind: number,
  x: number,
  y: number,
): FieldEntity => ({
  id,
  kind,
  x,
  y,
  layer: 1,
  width: 1,
  height: 1,
  asset: kind === 6 ? "npc" : null,
  direction: "down",
  script: null,
  collision: kind === 19 ? 1 : null,
  destinationLayer: null,
  source,
});
const group = (name: string, entities: FieldEntity[]): EntityGroup => ({
  name,
  entities,
  source,
  blockers: [],
});
function fixture(
  groups: EntityGroup[],
  instructions: unknown[],
  state = EventState.initialized(),
) {
  const content: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "fixture",
    parentSourceSetHash: "fixture",
    contentHash: "fixture",
    map: {
      id: "fixture",
      width: 5,
      height: 5,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(25).fill(0) },
      entities: [],
      groups: Object.fromEntries(groups.map((g) => [g.name, g])),
      source,
    },
    characters: {},
    scripts: {
      event: instructions.map((m, index) =>
        decodeFieldOp(m, { script: "event", index, source }, {}),
      ),
    },
    scriptLocals: { event: { labels: [], values: [] } },
    entry: {
      player: {
        x: 2,
        y: 3,
        layer: 1,
        direction: "up",
        asset: "hero",
        mount: "",
      },
      description: "fixture",
      evidence: [source],
    },
    limitations: [],
  };
  return new FieldGame(content, state);
}
test("SetEntities appends groups and activates actors, collision and future triggers together", () => {
  const trigger = { ...entity("trigger", 2, 1, 3), script: "after" };
  const game = fixture(
    [
      group("people", [entity("npc", 6, 2, 2)]),
      group("gates", [entity("wall", 19, 3, 3), trigger]),
    ],
    [
      raw("SetEntities", [], ["people"]),
      raw("SetEntities", [], ["gates"]),
      raw("Exit"),
    ],
  );
  game.content.scripts.after = [
    raw("SetFlag", [5], ["ScenarioFlag1"]),
    raw("Exit"),
  ].map((m, index) => decodeFieldOp(m, { script: "after", index, source }, {}));
  game.startEvent("event");
  assert.equal(game.stop, null);
  assert.deepEqual([...game.activeGroups], ["people", "gates"]);
  assert.equal(
    game.content.map.entities.length,
    0,
    "Compiled content stays immutable",
  );
  assert.equal(game.move("up"), false);
  assert.equal(game.move("right"), false);
  assert.equal(game.move("left"), true);
  game.advance(240);
  assert.equal(
    game.eventState.read({ category: "ScenarioFlag1", index: 5 }),
    1,
  );
});
test("unknown story state cannot choose a group; known state selects one variant", () => {
  const instructions = [
    raw("Branch", [0, 1, 4], ["ScenarioFlag1", "＝", "imm"]),
    raw("SetEntities", [], ["before"]),
    raw("Exit"),
    raw("Nop"),
    raw("SetEntities", [], ["after"]),
    raw("Exit"),
  ];
  const groups = [
    group("before", [entity("same-logical-npc", 6, 2, 1)]),
    group("after", [entity("same-logical-npc", 6, 3, 1)]),
  ];
  const unknown = fixture(groups, instructions, new EventState());
  unknown.startEvent("event");
  assert.equal(unknown.stop?.kind, "unsupported");
  assert.equal(unknown.entities.length, 0);
  for (const value of [0, 1]) {
    const game = fixture(groups, instructions);
    game.eventState.write({ category: "ScenarioFlag1", index: 0 }, value);
    game.startEvent("event");
    assert.equal(game.stop, null);
    assert.equal(game.actors["same-logical-npc"]!.x, value ? 3 : 2);
  }
});
test("invalid group activation is atomic and cannot run following state changes", () => {
  for (const invalid of [
    group("bad", [entity("new", 6, 1, 1), entity("existing", 6, 2, 2)]),
    {
      ...group("bad", [entity("new", 6, 1, 1)]),
      blockers: [{ reason: "Unknown transport condition", source }],
    },
  ]) {
    const game = fixture(
      [group("good", [entity("existing", 6, 2, 1)]), invalid],
      [
        raw("SetEntities", [], ["good"]),
        raw("SetEntities", [], ["bad"]),
        raw("SetFlag", [8], ["ScenarioFlag1"]),
        raw("Exit"),
      ],
      new EventState(),
    );
    game.startEvent("event");
    assert.equal(game.stop?.kind, "unsupported");
    assert.equal(game.actors.new, undefined);
    assert.equal(game.entities.length, 1);
    assert.deepEqual([...game.activeGroups], ["good"]);
    assert.throws(
      () => game.eventState.read({ category: "ScenarioFlag1", index: 8 }),
      UnknownEventValue,
    );
  }
  const missing = fixture(
    [],
    [raw("SetEntities", [], ["missing"]), raw("Exit")],
  );
  missing.startEvent("event");
  assert.equal(missing.stop?.kind, "unsupported");
});
test("entity adapter preserves Tiled object anchors, unique anonymous IDs and unresolved behavior", () => {
  const object = (
    id: number,
    props: Record<string, unknown>,
    gid?: number,
  ) => ({
    id,
    x: 32,
    y: 48,
    width: 16,
    height: 16,
    ...(gid ? { gid } : {}),
    properties: Object.entries(props).map(([name, value]) => ({ name, value })),
  });
  const a = {
    source,
    data: {
      layers: [
        {
          name: "GroundObject",
          objects: [
            object(1, { object_type: 0, object_id: 7, entity_id: 0 }, 100),
            object(2, { object_type: 0, object_id: 8, entity_id: 0 }),
            object(3, { object_type: 99, entity_id: 9 }),
          ],
        },
      ],
    },
  };
  const g = compileEntityGroup("group", a, {});
  assert.deepEqual(
    g.entities.map((e) => [e.id, e.y, e.objectId]),
    [
      ["group:0:0", 2, 7],
      ["group:0:1", 3, 8],
      ["9", 3, 0],
    ],
  );
  assert.equal(g.blockers[0]!.reason, "Unsupported entity kind 99");
  assert.equal(g.entities[1]!.source.pointer, "/layers/0/objects/1");
});
test("package aliases resolve within their bundle and map initializer uses its own table", () => {
  const a = (
    id: string,
    path: string,
    kind: CorpusAsset["kind"],
    data: unknown,
    file = "fixture",
  ): CorpusAsset => ({
    id,
    kind,
    data,
    source: {
      file,
      assetPath: path,
      serializedFile: "fixture",
      objectId: "9007199254740993",
      sha256: "a".repeat(64),
    },
  });
  const assets = [
    a("pkg", "Assets/package.json", "map-package", {
      asset_group_name: "fixture",
      map: [
        {
          name: "Room",
          script: [{ name: "boot", asset: "Room/boot" }],
          entity: [{ name: "crowd", asset: "Room/crowd" }],
        },
      ],
    }),
    a("boot", "Assets/Room/boot.json", "script", {}),
    a("crowd", "Assets/Room/crowd.json", "data", {}),
    a("wrong", "Assets/Room/crowd.json", "data", {}, "other"),
  ];
  const tables = {
    "map.csv": [
      {
        id: "7",
        area_id: "2",
        map_name: "Room",
        asset_name: "fixture",
        script_id: "9",
      },
    ],
    "map_script.csv": [{ id: "9 ", script_name: "boot" }],
    "script.csv": [{ id: "9", script_name: "different-domain" }],
  };
  const [map] = bindMapPackages(assets, tables);
  assert.deepEqual(map!.groups, { crowd: "crowd" });
  assert.equal(map!.initializer, "boot");
  assert.deepEqual(map!.issues, []);
  assets.splice(2, 1);
  assert.ok(
    bindMapPackages(assets, tables)[0]!.issues.some((i) =>
      i.includes("crowd:missing"),
    ),
  );
});

test("repeated group activation stops without duplicating entities", () => {
  const game = fixture(
    [group("once", [entity("npc", 6, 1, 1)])],
    [raw("SetEntities", [], ["once"]), raw("SetEntities", [], ["once"])],
  );
  game.startEvent("event");
  assert.match(game.stop!.message, /重复实体组/);
  assert.equal(game.entities.length, 1);
});

test("unreviewed layers and NPC behavior do not erase other entry candidates or become ready", () => {
  const object = (p: Record<string, unknown>) => ({
    x: 16,
    y: 32,
    width: 16,
    height: 16,
    properties: Object.entries(p).map(([name, value]) => ({ name, value })),
  });
  const g = compileEntityGroup(
    "mixed",
    {
      source,
      data: {
        layers: [
          {
            name: "BottomObject",
            objects: [object({ object_type: 0, object_id: 12 })],
          },
          { name: "UnknownLayer", objects: [] },
          {
            name: "GroundObject",
            objects: [
              object({
                object_type: 6,
                asset_id: 1,
                action_id: 4,
                message_key: "fixture",
                pushed: true,
                link_object_id: 9,
              }),
            ],
          },
        ],
      },
    },
    { "mapobject.csv": [{ id: "1", asset_name: "npc" }] },
  );
  assert.equal(g.entities[0]!.layer, 0);
  assert.equal(g.entities[0]!.objectId, 12);
  assert.equal(g.entities.length, 2);
  assert.deepEqual(
    g.blockers.map((b) => b.reason),
    [
      "Unknown entity layer UnknownLayer",
      "Unsupported actor interaction",
      "Unsupported actor movement response",
      "Unsupported actor route binding",
    ],
  );
});

test("initializer absence differs from broken declarations and Resident fallback never hides ambiguity", () => {
  const map = {
    name: "Room",
    script: [] as { name: string; asset: string }[],
    entity: [] as { name: string; asset: string }[],
    entity_default: "",
    tilemap: "",
    collision: "",
  };
  const assets = [
    corpusAsset("local-package", "Assets/package.json", "map-package", {
      asset_group_name: "fixture",
      map: [map],
    }),
    corpusAsset("resident-package", "Shared/package.json", "map-package", {
      asset_group_name: "map_script",
      map: [
        {
          name: "Resident",
          script: [{ name: "shared", asset: "Resident/shared" }],
        },
      ],
    }),
    corpusAsset("shared", "Shared/Resident/shared.json", "script", {}),
    corpusAsset("local", "Assets/Room/local.json", "script", {}),
    corpusAsset("group", "Assets/Room/group.json", "data", {}),
  ];
  const tables = {
    "map.csv": [
      {
        id: "1",
        area_id: "1",
        asset_name: "fixture",
        map_name: "Room",
        script_id: "1",
      },
    ],
    "map_script.csv": [{ id: "1", script_name: "absent" }],
  };
  let bound = bindMapPackages(assets, tables)[0]!;
  assert.equal(bound.initializerStatus, "not-declared");
  assert.equal(bound.initializer, null);
  assert.deepEqual(bound.issues, []);
  assert.equal(bound.tilemap, null);
  assert.deepEqual(bound.groups, {});
  assert.equal(resolveMapScript(bound, "shared"), "shared");
  assert.equal(resolveMapScript(bound, "constructor"), null);
  map.script.push({ name: "shared", asset: "Room/local" });
  bound = bindMapPackages(assets, tables)[0]!;
  assert.equal(resolveMapScript(bound, "shared"), "local");
  map.script.push(
    { name: "shared", asset: "Room/local" },
    { name: "shared", asset: "Room/local" },
  );
  bound = bindMapPackages(assets, tables)[0]!;
  assert.equal(resolveMapScript(bound, "shared"), null);
  assert.ok(bound.issues.includes("duplicate-alias:shared"));
  map.script.push({ name: "absent", asset: "Room/missing" });
  bound = bindMapPackages(assets, tables)[0]!;
  assert.equal(bound.initializerStatus, "unresolved");
  map.entity_default = "Room/group";
  map.entity.push({ name: "entity_default", asset: "Room/group" });
  bound = bindMapPackages(assets, tables)[0]!;
  assert.equal(bound.groups.entity_default, undefined);
  assert.ok(bound.issues.includes("duplicate-alias:entity_default"));
});

test("numeric master joins accept source whitespace without merging invalid or duplicate identities", () => {
  assert.equal(tableId(" +00250 "), 250);
  for (const value of ["", "   ", "1.5", "1e2", "0x10", "2147483648"])
    assert.throws(() => tableId(value), /ID/);
  assert.throws(
    () => bindMapPackages([], { "map.csv": [{ id: "250" }, { id: "250 " }] }),
    /Duplicate map row/,
  );
});
