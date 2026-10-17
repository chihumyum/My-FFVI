import test from "node:test";
import assert from "node:assert/strict";
import {
  compileInitialPartyState,
  compilePartyEvent,
} from "../src/compiler/party.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import {
  activePartyMembers,
  emptyPartyState,
  previewPartyCommand,
} from "../src/core/party.js";

const tables = {
  "character_status.csv": [{ id: "12" }, { id: "17" }, { id: "9" }],
  "initialize_data.csv": [
    { id: "20", key_name: "INIT_PARTY_1", value1: "17" },
    { id: "30", key_name: "INIT_PARTY_3", value1: "12" },
    { id: "40", key_name: "INIT_CORPS_3", value1: "2" },
    { id: "41", key_name: "INIT_CORPS_4", value1: "2" },
  ],
};
const roster = [
  { id: "owned:a", sourceId: 12, enabled: true },
  { id: "owned:b", sourceId: 17, enabled: true },
];
const site = {
  script: "synthetic-party",
  index: 7,
  source: { file: "synthetic", assetPath: "/party-script" },
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

test("source slot indexing and all nonpositive empty sentinels compile without filling holes", () => {
  const compiled = compilePartyEvent(
    "OrganizePartySlot",
    [3, -2, 12, 0, -1],
    tables,
  );
  assert.deepEqual(compiled, {
    kind: "party",
    command: {
      kind: "organize-slot",
      slot: 2,
      members: [null, 12, null, null],
      refreshActors: true,
    },
    dependencies: [{ table: "character_status.csv", id: 12 }],
  });
  const edited = previewPartyCommand(
    emptyPartyState(),
    roster,
    compiled.command,
  );
  const selected = previewPartyCommand(
    edited.state,
    roster,
    compilePartyEvent("ChangePartySlot", [3, 0], {}).command,
  );
  assert.deepEqual(selected.activeMembers, [
    { id: "owned:a", index: 1, row: "front" },
  ]);
});

test("ChangePartySlot any nonzero refresh value remains a real actor refresh request", () => {
  for (const value of [-2, -1, 1, 2])
    assert.deepEqual(
      compilePartyEvent("ChangePartySlot", [1, value], {}).command,
      { kind: "select-slot", slot: 0, refreshActors: true },
    );
  assert.equal(
    compilePartyEvent("ChangePartySlot", [2, 0], {}).command.refreshActors,
    false,
  );
});

test("party compiler rejects unknown dependencies, duplicated references and malformed values", () => {
  for (const values of [
    [0, 0],
    [4, 0],
    [1.5, 0],
    [1],
    [1, NaN],
    [1, 2147483648],
  ])
    assert.throws(() => compilePartyEvent("ChangePartySlot", values, tables));
  for (const values of [
    [1, 12],
    [1, 88, 0, 0, 0],
    [1, 12, 12, 0, 0],
    [1, 12, NaN, 0, 0],
  ])
    assert.throws(() => compilePartyEvent("OrganizePartySlot", values, tables));
  assert.throws(() =>
    compilePartyEvent("OrganizePartySlot", [1, 12, 0, 0, 0], {}),
  );
  assert.throws(() =>
    compilePartyEvent("OrganizePartySlot", [1, 12, 0, 0, 0], {
      ...tables,
      "character_status.csv": [...tables["character_status.csv"], { id: "12" }],
    }),
  );
});

test("master character rows do not implicitly create owned characters during organization", () => {
  const compiled = compilePartyEvent(
    "OrganizePartySlot",
    [1, 12, 17, 0, 9],
    tables,
  );
  assert.throws(
    () => previewPartyCommand(emptyPartyState(), roster, compiled.command),
    /unowned source character 9/,
  );
});

test("initial party takes numbered keys rather than source row order and preserves rows and absent positions", () => {
  const before = structuredClone(roster);
  const compiled = compileInitialPartyState(
    {
      ...tables,
      "initialize_data.csv": [...tables["initialize_data.csv"]].reverse(),
    },
    roster,
  );
  assert.deepEqual(activePartyMembers(compiled.state), [
    { id: "owned:b", index: 0, row: "front" },
    { id: "owned:a", index: 2, row: "back" },
  ]);
  assert.deepEqual(compiled.state.slots[0][3], { id: null, row: "back" });
  assert.deepEqual(compiled.state.slots[1], emptyPartyState().slots[1]);
  assert.deepEqual(compiled.dependencies, [
    { table: "initialize_data.csv", id: 20 },
    { table: "character_status.csv", id: 17 },
    { table: "initialize_data.csv", id: 30 },
    { table: "initialize_data.csv", id: 40 },
    { table: "character_status.csv", id: 12 },
    { table: "initialize_data.csv", id: 41 },
  ]);
  assert.deepEqual(roster, before);
});

test("initial projection filters disabled members while organize includes them", () => {
  const disabled = roster.map((r) => ({ ...r, enabled: r.sourceId !== 17 }));
  const initial = compileInitialPartyState(tables, disabled);
  assert.equal(initial.state.slots[0][0].id, null);
  const restored = previewPartyCommand(
    initial.state,
    disabled,
    compilePartyEvent("OrganizePartySlot", [1, 17, -2, -2, -2], tables).command,
  );
  assert.deepEqual(restored.activeMembers, [
    { id: "owned:b", index: 0, row: "front" },
  ]);
  assert.equal(disabled[1]!.enabled, false);
});

test("initial party rejects missing ownership, duplicate settings, invalid rows and unsupported fifth creation", () => {
  assert.throws(
    () => compileInitialPartyState(tables, roster.slice(0, 1)),
    /not owned/,
  );
  for (const extra of [
    { id: "90", key_name: "INIT_PARTY_1", value1: "12" },
    { id: "90", key_name: "INIT_PARTY_5", value1: "9" },
    { id: "90", key_name: "INIT_CORPS_2", value1: "3" },
    { id: "90", key_name: "INIT_PARTY_2", value1: "0" },
  ])
    assert.throws(() =>
      compileInitialPartyState(
        {
          ...tables,
          "initialize_data.csv": [...tables["initialize_data.csv"], extra],
        },
        roster,
      ),
    );
});

test("field decoder retains source site and sends party op through the shared contract", () => {
  const input = raw("OrganizePartySlot", [2, -2, 12, -2, 17]);
  assert.deepEqual(decodeFieldOp(input, site, {}, tables), {
    ...site,
    ...compilePartyEvent("OrganizePartySlot", input.operands.iValues, tables),
  });
  assert.equal(
    decodeFieldOp(raw("OrganizePartySlot", [1, 999, 0, 0, 0]), site, {}, tables)
      .kind,
    "blocked",
  );
});

test("party field admission rejects unknown operand families and truncated source shapes", () => {
  const change = raw("ChangePartySlot", [1, 0]);
  const changed = (mutate: (copy: typeof change) => void) => {
    const copy = structuredClone(change);
    mutate(copy);
    return copy;
  };
  for (const invalid of [
    changed((v) => (v.type = 2)),
    changed((v) => (v.operands.iValues[2] = 1)),
    changed((v) => (v.operands.rValues[0] = 0.25)),
    changed((v) => (v.operands.sValues[0] = "not supported")),
    changed((v) => v.operands.iValues.pop()),
    changed((v) => v.operands.rValues.pop()),
    changed((v) => v.operands.sValues.pop()),
  ])
    assert.equal(decodeFieldOp(invalid, site, {}, tables).kind, "blocked");
});

test("source joining and departure selectors cannot accidentally become plain slot edits", () => {
  for (const selector of [
    "メンバー加入：ティナ",
    "メンバー離脱：ビックス",
    "メンバー離脱：ウェッジ",
  ]) {
    const instruction = raw("SysCall", []);
    instruction.operands.sValues[0] = selector;
    assert.equal(decodeFieldOp(instruction, site, {}, tables).kind, "blocked");
  }
});
