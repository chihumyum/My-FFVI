import test from "node:test";
import assert from "node:assert/strict";
import { decodeFieldOp } from "../src/compiler/field.js";
import { EventState } from "../src/core/event-state.js";
import { FieldGame } from "../src/core/field.js";
import {
  executeInventoryEvent,
  type FieldInventoryCommand,
  type FieldInventoryPort,
  type InventoryEventOp,
} from "../src/core/inventory-event.js";
import type { FieldContent, Op, Site } from "../src/field/types.js";

const source = { file: "synthetic", assetPath: "/inventory-event" };
const site: Site = { script: "event", index: 0, source };
const tables = {
  "content.csv": [
    { id: "201", type_id: "1", type_value: "88" },
    { id: "202", type_id: "1", type_value: "89" },
    { id: "303", type_id: "3", type_value: "88" },
    { id: "304", type_id: "2", type_value: "88" },
    { id: "305", type_id: "2", type_value: "89" },
    { id: "404", type_id: "9", type_value: "88" },
    { id: "505", type_id: "5", type_value: "1" },
  ],
  "item.csv": [
    { id: "88", type_id: "1" },
    { id: "89", type_id: "2" },
  ],
  "weapon.csv": [
    { id: "88", type_id: "1" },
    { id: "89", type_id: "2" },
  ],
  "armor.csv": [{ id: "88", type_id: "1" }],
  "product.csv": [
    { id: "91", group_id: "700", coefficient: "37", content_id: "0" },
  ],
};
function raw(mnemonic: string, values: number[]) {
  return {
    mnemonic,
    type: 1,
    operands: {
      iValues: [...values, ...Array(8 - values.length).fill(0)],
      rValues: Array(8).fill(0),
      sValues: Array(8).fill(""),
    },
  };
}
function decode(name: string, values: number[], input = tables): Op {
  return decodeFieldOp(raw(name, values), site, {}, input);
}
function inventoryOp(name: string, values: number[]): InventoryEventOp & Site {
  const result = decode(name, values);
  assert.equal(result.kind, "inventory");
  return result as InventoryEventOp & Site;
}
function field(ops: Op[]): FieldContent {
  return {
    kind: "field-development",
    formatVersion: 1,
    contentHash: "synthetic",
    sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic",
    map: {
      id: "synthetic",
      width: 1,
      height: 1,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: [0] },
      entities: [],
      source,
    },
    characters: {},
    scripts: { event: ops },
    entry: {
      player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
      description: "Synthetic inventory host",
      evidence: [source],
    },
    limitations: [],
  };
}

test("inventory decoder preserves content identity and resolves fees by product group", () => {
  assert.deepEqual(inventoryOp("GetItem", [201, 2]), {
    ...site,
    kind: "inventory",
    command: { kind: "grant-item", id: 201, count: 2 },
    result: null,
    dependencies: [
      { table: "content.csv", id: 201 },
      { table: "item.csv", id: 88 },
    ],
  });
  assert.deepEqual(inventoryOp("RemoveItem", [202, 1]).command, {
    kind: "remove-item",
    id: 202,
    count: 1,
  });
  assert.deepEqual(inventoryOp("GetItem", [505, 293]).command, {
    kind: "grant-gil",
    amount: 293,
  });
  assert.deepEqual(inventoryOp("RemoveGil", [700]), {
    ...site,
    kind: "inventory",
    command: { kind: "pay-gil", amount: 37 },
    result: { category: "MapLocalVariable", index: 0 },
    dependencies: [{ table: "product.csv", id: 91 }],
  });
});

test("equipment event ownership keeps content, weapon and armor identities distinct", () => {
  assert.deepEqual(inventoryOp("GetItem", [303, 2]), {
    ...site,
    kind: "inventory",
    command: { kind: "grant-equipment", id: 303, count: 2 },
    result: null,
    dependencies: [
      { table: "content.csv", id: 303 },
      { table: "armor.csv", id: 88 },
    ],
  });
  assert.deepEqual(inventoryOp("RemoveItem", [304, 3]), {
    ...site,
    kind: "inventory",
    command: { kind: "remove-equipment", id: 304, count: 3 },
    result: null,
    dependencies: [
      { table: "content.csv", id: 304 },
      { table: "weapon.csv", id: 88 },
    ],
  });
  assert.equal(decode("GetItem", [305, 1]).kind, "blocked");
  assert.equal(
    decode("GetItem", [303, 1], { ...tables, "armor.csv": [] }).kind,
    "blocked",
  );
  assert.equal(
    decode("RemoveItem", [304, 1], {
      ...tables,
      "content.csv": [
        ...tables["content.csv"],
        { id: "306", type_id: "2", type_value: "88" },
      ],
    }).kind,
    "blocked",
  );
  const commands: FieldInventoryCommand[] = [];
  executeInventoryEvent(
    inventoryOp("GetItem", [303, 2]),
    EventState.initialized(),
    {
      prepare(command) {
        return {
          result: null,
          commit() {
            commands.push(command);
          },
        };
      },
    },
  );
  assert.deepEqual(commands, [{ kind: "grant-equipment", id: 303, count: 2 }]);
});

test("missing, ambiguous, special and malformed inventory operands remain blockers", () => {
  for (const [name, values] of [
    ["GetItem", [305, 1]],
    ["GetItem", [404, 1]],
    ["RemoveItem", [505, 1]],
    ["GetItem", [201, -1]],
    ["GetItem", [201, 0]],
    ["GetItem", [999, 1]],
    ["GetItem", [201, 1, 1]],
    ["RemoveGil", [700, 1]],
    ["RemoveGil", [999]],
  ] as const)
    assert.equal(decode(name, [...values]).kind, "blocked");
  assert.equal(
    decodeFieldOp(raw("GetItem", [201, 1]), site, {}).kind,
    "blocked",
  );
  assert.equal(
    decode("GetItem", [201, 1], { ...tables, "item.csv": [] }).kind,
    "blocked",
  );
  assert.equal(
    decode("GetItem", [201, 1], {
      ...tables,
      "content.csv": [...tables["content.csv"], tables["content.csv"][0]!],
    }).kind,
    "blocked",
  );
  assert.equal(
    decode("RemoveGil", [700], {
      ...tables,
      "product.csv": [
        ...tables["product.csv"],
        { id: "92", group_id: "700", coefficient: "20", content_id: "0" },
      ],
    }).kind,
    "blocked",
  );
  assert.equal(
    decode("RemoveGil", [700], {
      ...tables,
      "product.csv": [
        { id: "91", group_id: "700", coefficient: "37", content_id: "201" },
      ],
    }).kind,
    "blocked",
  );
  const extra = raw("GetItem", [201, 1]);
  extra.operands.sValues[5] = "unreviewed";
  assert.equal(decodeFieldOp(extra, site, {}, tables).kind, "blocked");
  assert.equal(decode("UseItem", [201, 1]).kind, "blocked");
});

test("inventory transaction failure never publishes a field result or mutates the compiled instruction", () => {
  const state = EventState.initialized(),
    ref = { category: "MapLocalVariable" as const, index: 0 };
  state.write(ref, 9);
  const op = inventoryOp("RemoveGil", [700]),
    before = structuredClone(op);
  const port: FieldInventoryPort = {
    prepare(command) {
      if (command.kind === "pay-gil") command.amount = 1000;
      return {
        result: true,
        commit() {
          throw new Error("Stale inventory event");
        },
      };
    },
  };
  assert.throws(() => executeInventoryEvent(op, state, port), /Stale/);
  assert.equal(state.read(ref), 9);
  assert.deepEqual(op, before);
  let commits = 0;
  assert.throws(
    () =>
      executeInventoryEvent(op, state, {
        prepare: () => ({
          result: null,
          commit() {
            commits++;
          },
        }),
      }),
    /result/,
  );
  assert.equal(commits, 0);
  assert.equal(state.read(ref), 9);
  assert.throws(
    () => executeInventoryEvent(op, state, undefined),
    /unavailable/,
  );
});

test("an invalid result address is rejected before inventory preparation", () => {
  const op = inventoryOp("RemoveGil", [700]);
  op.result = { category: "ScriptLocalVariable", index: 0 };
  let preparations = 0;
  assert.throws(
    () =>
      executeInventoryEvent(op, new EventState(), {
        prepare() {
          preparations++;
          return { result: true, commit() {} };
        },
      }),
    /Uninitialized/,
  );
  assert.equal(preparations, 0);
});

test("field VM submits each inventory instruction once and branches on the owner result", () => {
  const commands: FieldInventoryCommand[] = [];
  const port: FieldInventoryPort = {
    prepare(command) {
      return {
        result: command.kind === "pay-gil" ? false : null,
        commit() {
          commands.push(command);
        },
      };
    },
  };
  const ops: Op[] = [
    inventoryOp("GetItem", [201, 2]),
    inventoryOp("RemoveGil", [700]),
    {
      ...site,
      kind: "branch",
      left: { category: "MapLocalVariable", index: 0 },
      operator: "＝",
      right: { kind: "immediate", value: 0 },
      target: 4,
    },
    inventoryOp("RemoveItem", [201, 1]),
    { ...site, kind: "wait", seconds: 0.1 },
    { ...site, kind: "exit" },
  ].map((op, index) => ({ ...op, index }) as Op);
  const game = new FieldGame(
    field(ops),
    EventState.initialized(),
    undefined,
    undefined,
    { inventory: port },
  );
  game.startEvent("event");
  game.advance(100);
  game.advance(1000);
  assert.equal(game.stop, null);
  assert.equal(game.busy, false);
  assert.deepEqual(commands, [
    { kind: "grant-item", id: 201, count: 2 },
    { kind: "pay-gil", amount: 37 },
  ]);
  assert.equal(
    game.eventState.read({ category: "MapLocalVariable", index: 0 }),
    0,
  );
  const restored = FieldGame.restore(game.content, game.checkpoint(), {
    inventory: port,
  });
  restored.advance(1000);
  assert.equal(commands.length, 2, "idle restoration does not replay grants");
  const unavailable = new FieldGame(field(ops));
  unavailable.startEvent("event");
  assert.equal(unavailable.stop?.kind, "unsupported");
  assert.match(
    unavailable.stop?.message ?? "",
    /inventory state is unavailable/,
  );
});
