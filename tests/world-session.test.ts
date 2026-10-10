import test from "node:test";
import assert from "node:assert/strict";
import { WorldSession } from "../src/core/world-session.js";
import { EventState } from "../src/core/event-state.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import { verifyContent } from "../src/core/content-integrity.js";
import { hash } from "../src/compiler/content.js";
import type {
  Character,
  FieldContent,
  FieldEntity,
  Op,
} from "../src/field/types.js";
import type { WorldCatalog, WorldMapContent } from "../src/field/world.js";

const source = {
  file: "synthetic",
  assetPath: "room.json",
  objectId: "9007199254740993",
};
const site = { script: "leave", index: 0, source };
const character: Character = {
  source,
  sprites: {
    pose: {
      file: "synthetic.png",
      width: 16,
      height: 24,
      pivot: [0.5, 0],
      sha256: "synthetic",
      source,
    },
  },
  animations: Object.fromEntries(
    ["Default", "WalkB", "WalkL", "WalkR"].map((k) => [
      k,
      {
        frames: [{ sprite: "pose", x: 0, y: 0, flip: false, alpha: 1 }],
        duration: 1,
        mode: 0,
        flip: false,
        next: "",
      },
    ]),
  ),
};
function fixture(
  oldArea = 7,
  nextArea = oldArea,
  state = EventState.initialized(),
) {
  const entrance: FieldEntity = {
    id: "99",
    objectId: 10,
    kind: 0,
    x: 2,
    y: 3,
    width: 1,
    height: 1,
    layer: 1,
    direction: "up",
    asset: null,
    script: null,
    collision: null,
    destinationLayer: null,
    source,
  };
  const map: FieldContent["map"] = {
    id: "Room",
    identity: { mapId: 1, areaId: oldArea },
    width: 5,
    height: 5,
    tileSize: 16,
    layers: [],
    tilesets: [],
    textures: {},
    collisions: { 1: Array(25).fill(0) },
    entities: [],
    source,
  };
  const request = {
    mapId: 2,
    entrance: 10,
    continuation: null,
    birdview: false,
    skipFade: false,
    skipBgm: false,
    origin: "script",
  } as const;
  const content: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "bootstrap",
    parentSourceSetHash: "base",
    contentHash: "old",
    map,
    characters: { hero: character },
    scripts: {
      leave: [
        { ...site, kind: "change-map", request },
        {
          ...site,
          kind: "flag",
          ref: { category: "ScenarioFlag1", index: 1 },
          operation: "set",
        },
      ],
    },
    entry: {
      player: {
        x: 1,
        y: 1,
        layer: 1,
        direction: "down",
        asset: "hero",
        mount: "",
      },
      description: "synthetic",
      evidence: [source],
    },
    limitations: [],
  };
  const target: WorldMapContent = {
    formatVersion: 1,
    kind: "world-map-development",
    sourceSetHash: "full",
    parentSourceSetHash: "base",
    mediaSourceSetHash: "media",
    contentHash: "next",
    mapId: 2,
    areaId: nextArea,
    name: "Next",
    map: {
      ...map,
      id: "Next",
      identity: { mapId: 2, areaId: nextArea },
      entities: [entrance],
      groups: {
        entity_default: {
          name: "entity_default",
          source,
          entities: [entrance],
          blockers: [],
        },
      },
      initialGroups: ["entity_default"],
    },
    scripts: {},
    scriptLocals: {},
    initializer: null,
    characterAssets: [],
    blockers: [],
    limitations: [],
  };
  const catalog: WorldCatalog = {
    formatVersion: 1,
    kind: "world-development",
    sourceSetHash: "full",
    parentSourceSetHash: "base",
    mediaSourceSetHash: "media",
    contentHash: "catalog",
    characters: { hero: character },
    characterIssues: {},
    maps: {
      2: {
        url: "/world/maps/2.json",
        contentHash: "next",
        name: "Next",
        areaId: nextArea,
        geometryReady: true,
        defaultGroupReady: true,
        blockers: [],
      },
    },
    limitations: [],
  };
  return { world: new WorldSession(content, state), target, catalog, state };
}
const flag = (index: number): Op => ({
  ...site,
  kind: "flag",
  ref: { category: "ScenarioFlag1", index },
  operation: "set",
});
const exit: Op = { ...site, kind: "exit" };

test("ChangeMap decodes reserved continuation and flag operands without dropping unknown forms", () => {
  const raw = {
    mnemonic: "ChangeMap",
    type: 1,
    operands: {
      iValues: [2, 10, 0, 7, -1, 0],
      rValues: [0],
      sValues: ["next", ""],
    },
  };
  const op = decodeFieldOp(raw, site, {});
  assert.equal(op.kind, "change-map");
  if (op.kind !== "change-map") throw new Error("Expected transition");
  assert.deepEqual(op.request, {
    mapId: 2,
    entrance: 10,
    continuation: "next",
    birdview: false,
    skipFade: true,
    skipBgm: true,
    origin: "script",
  });
  assert.equal(
    decodeFieldOp(
      { ...raw, operands: { ...raw.operands, rValues: [1] } },
      site,
      {},
    ).kind,
    "blocked",
  );
});
test("map handoff resolves PointIn object identity, reserves continuation, and clears only map-local state", () => {
  const { world, target, catalog, state } = fixture();
  state.write({ category: "MapLocalVariable", index: 0 }, 8);
  state.write({ category: "AreaLocalVariable", index: 0 }, 9);
  state.write({ category: "ScenarioVariable", index: 0 }, 10);
  state.write({ category: "TreasureFlag1", index: 20 }, 1);
  const op = world.field.content.scripts.leave![0]!;
  if (op.kind !== "change-map") throw new Error("Expected transition");
  op.request.continuation = "resume";
  target.initializer = "init";
  target.scripts = { resume: [flag(3), exit], init: [flag(4), exit] };
  const old = world.field;
  old.startEvent("leave");
  const prepared = world.prepare(catalog, target);
  assert.equal(world.field, old);
  assert.equal(state.read({ category: "MapLocalVariable", index: 0 }), 8);
  assert.equal(
    state.read({ category: "ScenarioFlag1", index: 1 }),
    0,
    "Old script ends at ChangeMap",
  );
  assert.equal(world.commit(prepared), true);
  assert.equal(world.commit(prepared), false, "One commit only");
  assert.deepEqual(
    [world.field.player.x, world.field.player.y, world.field.player.direction],
    [2, 3, "up"],
  );
  const next = world.field.eventState;
  assert.equal(next.read({ category: "MapLocalVariable", index: 0 }), 0);
  assert.equal(next.read({ category: "AreaLocalVariable", index: 0 }), 9);
  assert.equal(next.read({ category: "ScenarioVariable", index: 0 }), 10);
  assert.equal(next.read({ category: "TreasureFlag1", index: 20 }), 1);
  assert.equal(next.read({ category: "ScenarioFlag1", index: 3 }), 1);
  assert.equal(next.read({ category: "ScenarioFlag1", index: 4 }), 0);
  assert.equal(next.snapshot().currentMapId, 2);
});
test("cross-area reset follows source while initial area zero preserves unknown checkpoint values", () => {
  for (const [oldArea, nextArea, reset] of [
    [7, 8, true],
    [0, 8, false],
  ] as const) {
    const { world, target, catalog, state } = fixture(
      oldArea,
      nextArea,
      new EventState(),
    );
    state.write({ category: "ScenarioFlag1", index: 6 }, 1);
    world.field.startEvent("leave");
    assert.equal(world.commit(world.prepare(catalog, target)), true);
    const snap = world.field.eventState.snapshot();
    assert.equal(snap.area[0], reset ? 0 : null);
    assert.equal(snap.map[0], reset ? 0 : null);
    assert.equal(snap.scenario[6], 1);
    assert.equal(snap.scenario[7], null);
  }
});
test("failed dependencies and initializer mutations leave the old map and state intact", () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.target.blockers.push({ reason: "Unimplemented collision", source });
    },
    (f) => {
      f.target.map!.groups!.entity_default!.blockers.push({
        reason: "Unimplemented entity",
        source,
      });
    },
    (f) => {
      f.target.map!.groups!.entity_default!.entities.push({
        ...f.target.map!.entities[0]!,
        id: "another",
      });
    },
    (f) => {
      f.target.map!.groups!.entity_default!.entities[0]!.objectId = 99;
    },
    (f) => {
      f.target.map!.groups!.entity_default!.entities.push({
        ...f.target.map!.entities[0]!,
        id: "range",
        kind: 27,
        x: 0,
        y: 0,
        width: 2,
        height: 2,
      });
    },
    (f) => {
      f.catalog = { ...f.catalog, characters: {} };
    },
    (f) => {
      f.target.parentSourceSetHash = "foreign";
    },
    (f) => {
      f.target.mediaSourceSetHash = "foreign";
    },
    (f) => {
      f.target.contentHash = "changed";
    },
    (f) => {
      f.target.map!.identity!.mapId = 3;
    },
    (f) => {
      f.target.initializer = "init";
      f.target.scripts.init = [
        flag(5),
        {
          ...site,
          kind: "blocked",
          mnemonic: "unknown",
          reason: "Not migrated",
        },
      ];
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    f.world.field.startEvent("leave");
    const old = f.world.field,
      before = f.state.snapshot();
    assert.throws(() => f.world.prepare(f.catalog, f.target));
    assert.equal(f.world.field, old);
    assert.deepEqual(f.state.snapshot(), before);
  }
});
test("late loads cannot replace a newer field, failed request, or intervening state update", () => {
  const f = fixture();
  f.world.field.startEvent("leave");
  const a = f.world.prepare(f.catalog, f.target),
    b = f.world.prepare(f.catalog, f.target);
  assert.equal(f.world.commit(a), true);
  assert.equal(f.world.commit(b), false);
  f.world.field.previewMap(2, 10);
  assert.throws(
    () =>
      f.world.prepare({ ...f.catalog, contentHash: "new catalog" }, f.target),
    /catalog changed/,
  );
  const g = fixture();
  g.world.field.startEvent("leave");
  const pending = g.world.prepare(g.catalog, g.target);
  g.world.fail(pending.request, "Media failed");
  assert.equal(g.world.commit(pending), false);
  assert.equal(g.world.field.content.map.id, "Room");
  const h = fixture();
  h.world.field.startEvent("leave");
  const stale = h.world.prepare(h.catalog, h.target);
  h.state.write({ category: "ScenarioFlag1", index: 7 }, 1);
  assert.equal(h.world.commit(stale), false);
});
test("touching a source GotoMap produces the same lifecycle request without running a guessed script", () => {
  const f = fixture(),
    map = f.world.field.content.map;
  const entity: FieldEntity = {
    ...f.target.map!.entities[0]!,
    id: "door",
    kind: 3,
    x: 2,
    y: 1,
    destination: { mapId: 2, entrance: 10 },
    objectId: 0,
  };
  map.entities.push(entity);
  const world = new WorldSession(f.world.field.content);
  assert.equal(world.field.move("right"), true);
  world.field.advance(240);
  assert.equal(world.field.stop?.kind, "map-transition");
  assert.equal(world.commit(world.prepare(f.catalog, f.target)), true);
  assert.equal(world.transitions[0]!.origin, "trigger");
});
test("browser and compiler agree on digests; changed payloads and stale catalog references fail", async () => {
  const payload = {
    formatVersion: 1,
    values: { 中文: [null, true, 42], order: "stable" },
  };
  const signed = { ...payload, contentHash: hash(payload) };
  assert.equal(await verifyContent(signed), signed);
  await assert.rejects(
    verifyContent({ ...signed, formatVersion: 2 }),
    /payload changed/,
  );
  await assert.rejects(
    verifyContent(signed, "f".repeat(64)),
    /identity mismatch/,
  );
});
