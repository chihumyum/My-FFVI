import test from "node:test";
import assert from "node:assert/strict";
import {
  Transportations,
  type TransportationCatalog,
  type TransportationMapEntry,
} from "../src/core/transportation.js";
import { compileTransportationCatalog } from "../src/compiler/transportation.js";
import type { BattleRow } from "../src/compiler/battle.js";

const catalog = (): TransportationCatalog => ({
  definitions: [
    { id: 1, type: 1, assetId: 0, releaseFlag: 900 },
    { id: 42, type: 2, assetId: 33, releaseFlag: 901 },
    { id: 73, type: 9, assetId: 34, releaseFlag: 902 },
    { id: 96, type: 12, assetId: 38, releaseFlag: 905 },
  ],
  newGame: { mapId: 609, entrance: 1, scriptId: 1, transportationId: 1 },
});
const model = () => new Transportations(catalog());
const entry = (
  patch: Partial<TransportationMapEntry> = {},
): TransportationMapEntry => ({
  currentId: null,
  loadId: 1,
  mapId: 609,
  stayMapIds: {},
  availability: { "1": true },
  ...patch,
});

test("new-game selection uses the unique player type, while PointIn stores literal ID 1", () => {
  const data = catalog();
  data.definitions[0]!.id = 501;
  data.definitions[1]!.id = 1;
  data.newGame.transportationId = 501;
  const transport = new Transportations(data);
  assert.deepEqual(transport.newGameIdentity(), {
    id: 501,
    type: 1,
    assetId: 0,
  });
  assert.deepEqual(transport.pointInIdentity(), {
    id: 1,
    type: 2,
    assetId: 33,
  });
  assert.deepEqual(transport.restoreIdentity(96), {
    id: 96,
    type: 12,
    assetId: 38,
  });
  assert.throws(
    () => transport.restoreIdentity(undefined as unknown as number),
    /Invalid/,
  );
  assert.throws(() => transport.restoreIdentity(38), /Unknown/);
});

test("release flags use the treasure domain and retain unknown values", () => {
  const transport = model();
  assert.deepEqual(transport.releaseFlagRef(1), {
    category: "TreasureFlag4",
    index: 132,
  });
  assert.deepEqual(transport.releaseFlagRef(96), {
    category: "TreasureFlag4",
    index: 137,
  });
  const seen: string[] = [];
  const available = transport.availability((ref) => {
    seen.push(ref.category + ":" + ref.index);
    return ref.index === 132 ? 1 : ref.index === 133 ? 0 : null;
  });
  assert.deepEqual(available, {
    "1": true,
    "42": false,
    "73": null,
    "96": null,
  });
  assert.deepEqual(seen, [
    "TreasureFlag4:132",
    "TreasureFlag4:133",
    "TreasureFlag4:134",
    "TreasureFlag4:137",
  ]);
  assert.throws(() => transport.availability(() => 2), /Invalid.*flag value/);
  assert.deepEqual(transport.newGameAvailability(), {
    "1": true,
    "42": false,
    "73": false,
    "96": false,
  });
});

test("ordinary first setup selects the player and never infers a riding asset", () => {
  const transport = model();
  assert.deepEqual(transport.projectMapEntry(entry()), {
    previousId: null,
    requestedId: 1,
    currentId: 1,
    currentType: 1,
    selected: true,
  });
  // Even known, enabled vehicles are excluded from auto-selection by type.
  assert.equal(
    transport.selectForMap(1, { "1": true, "42": true, "73": true, "96": true })
      .id,
    1,
  );
  assert.equal(
    transport.projectMapEntry(
      entry({ loadId: 96, availability: { "96": true } }),
    ).currentId,
    96,
  );
});

test("an existing current symbol or armor survives a PointIn load ID of one", () => {
  for (const id of [42, 73, 96]) {
    const result = model().projectMapEntry(
      entry({ currentId: id, availability: { [String(id)]: true } }),
    );
    assert.equal(result.currentId, id);
    assert.equal(result.requestedId, id);
  }
  const disabled = model().projectMapEntry(
    entry({ currentId: 96, availability: { "96": false } }),
  );
  assert.equal(disabled.currentId, 96);
  assert.equal(disabled.selected, false);
});

test("first setup restores a symbol only when its stored map matches the destination", () => {
  const transport = model();
  const input = entry({
    loadId: 42,
    stayMapIds: { "42": 609 },
    availability: { "1": true, "42": true },
  });
  assert.equal(transport.projectMapEntry(input).currentId, 42);
  input.stayMapIds = { "42": 600 };
  assert.equal(transport.projectMapEntry(input).currentId, 1);
  input.stayMapIds = { "42": -1 };
  assert.equal(transport.projectMapEntry(input).currentId, 1);
  input.stayMapIds = {};
  assert.throws(
    () => transport.projectMapEntry(input),
    /Unknown transportation stay map/,
  );
  input.stayMapIds = { "42": null };
  assert.throws(
    () => transport.projectMapEntry(input),
    /Unknown transportation stay map/,
  );
});

test("map setup converts an old seamless identity before terrain selection", () => {
  const data = catalog();
  data.definitions.push({ id: 55, type: 5, assetId: 50, releaseFlag: 903 });
  const transport = new Transportations(data);
  const input = entry({
    currentId: 55,
    availability: { "1": true, "55": false },
  });
  assert.equal(transport.projectMapEntry(input).currentId, 1);
  input.availability = { "1": true, "55": true };
  assert.throws(
    () => transport.projectMapEntry(input),
    /Missing transportation terrain provider/,
  );
  input.allowsAttribute = () => false;
  assert.equal(transport.projectMapEntry(input).currentId, 1);
  input.allowsAttribute = () => true;
  assert.equal(transport.projectMapEntry(input).currentId, 55);
});

test("automatic selection needs real enabled and terrain inputs and preserves source order", () => {
  const data = catalog();
  data.definitions.push(
    { id: 55, type: 5, assetId: 50, releaseFlag: 903 },
    { id: 56, type: 5, assetId: 51, releaseFlag: 904 },
  );
  const transport = new Transportations(data);
  assert.throws(
    () => transport.selectForMap(1, {}),
    /Unknown transportation availability: 55/,
  );
  assert.equal(transport.selectForMap(1, { "55": false, "56": false }).id, 1);
  assert.equal(
    transport.selectForMap(1, { "55": true, "56": true }, () => true).id,
    55,
  );
  const calls: number[] = [];
  assert.equal(
    transport.selectForMap(1, { "55": true, "56": true }, (id) => {
      calls.push(id);
      return id === 56;
    }).id,
    56,
  );
  assert.deepEqual(calls, [55, 56]);
  assert.throws(
    () =>
      transport.selectForMap(
        1,
        { "55": true },
        () => null as unknown as boolean,
      ),
    /Unknown.*terrain/,
  );
});

test("disabled transport assignment retains the old identity and pure inputs", () => {
  const transport = model();
  const available = { "1": true, "96": false };
  const before = structuredClone(available);
  assert.deepEqual(transport.projectChange(1, 96, available), {
    previousId: 1,
    requestedId: 96,
    currentId: 1,
    currentType: 1,
    selected: false,
  });
  assert.deepEqual(transport.projectChange(null, 96, available), {
    previousId: null,
    requestedId: 96,
    currentId: null,
    currentType: 0,
    selected: false,
  });
  assert.deepEqual(available, before);
  assert.throws(
    () => transport.projectChange(1, 96, {}),
    /Unknown.*availability/,
  );
  assert.throws(
    () => transport.projectChange(1, 999, available),
    /Unknown.*identity/,
  );
  assert.throws(
    () => transport.projectChange(999, 1, available),
    /Unknown.*identity/,
  );
});

test("catalog and identity results cannot mutate subsequent projections", () => {
  const data = catalog();
  const transport = new Transportations(data);
  data.definitions[0]!.type = 12;
  data.newGame.transportationId = 96;
  const identity = transport.identity(1);
  identity.id = 96;
  identity.type = 12;
  const available = transport.newGameAvailability();
  available["1"] = false;
  assert.deepEqual(transport.newGameIdentity(), { id: 1, type: 1, assetId: 0 });
  assert.equal(transport.newGameAvailability()["1"], true);
  assert.deepEqual(
    new Transportations(
      JSON.parse(JSON.stringify(catalog())),
    ).newGameIdentity(),
    transport.newGameIdentity(),
  );
});

test("malformed or ambiguous catalogs fail before any projection", () => {
  const cases: ((value: TransportationCatalog) => void)[] = [
    (c) => {
      c.definitions.push({ ...c.definitions[0]! });
    },
    (c) => {
      c.definitions[1]!.type = 1;
    },
    (c) => {
      c.newGame.transportationId = 96;
    },
    (c) => {
      c.definitions[0]!.id = 501;
      c.newGame.transportationId = 501;
    },
    (c) => {
      c.definitions[1]!.releaseFlag = 1024;
    },
    (c) => {
      c.definitions[1]!.type = 13;
    },
    (c) => {
      c.definitions[1]!.assetId = NaN;
    },
  ];
  for (const corrupt of cases) {
    const data = catalog();
    corrupt(data);
    assert.throws(() => new Transportations(data));
  }
});

test("compiler retains source-row provenance and rejects mismatched or missing identities", () => {
  const table: Record<string, Record<string, string>[]> = {
    "transportation.csv": catalog().definitions.map((d) => ({
      id: String(d.id),
      type_id: String(d.type),
      asset_id: String(d.assetId),
      release_flag: String(d.releaseFlag),
    })),
    "initialize_data.csv": [
      { id: "43", key_name: "INT_START_MAP_ID", value1: "609", value2: "1" },
      { id: "44", key_name: "INT_MAP_POINTIN", value1: "1", value2: "0" },
    ],
  };
  const wrap = (name: string, values: Record<string, string>): BattleRow => ({
    values,
    source: {
      file: "synthetic",
      assetPath: name,
      objectId: "9007199254740993001",
      serializedFile: "synthetic.assets",
      rowId: values.id!,
    },
  });
  const reader = {
    row(name: string, id: string | number) {
      const rows = table[name]!.filter((r) => r.id === String(id));
      if (rows.length !== 1) throw new Error("Missing or ambiguous source row");
      return wrap(name, rows[0]!);
    },
    unique(name: string, key: string, value: string) {
      const rows = table[name]!.filter((r) => r[key] === value);
      if (rows.length !== 1) throw new Error("Missing or ambiguous source key");
      return wrap(name, rows[0]!);
    },
  };
  const compiled = compileTransportationCatalog(reader, [1, 42, 73, 96]);
  assert.deepEqual(compiled.catalog, catalog());
  assert.equal(compiled.sources.length, 6);
  assert.ok(
    compiled.sources.every((r) => r.source.objectId === "9007199254740993001"),
  );
  assert.throws(
    () => compileTransportationCatalog(reader, [1, 999]),
    /Missing/,
  );
  assert.throws(
    () =>
      compileTransportationCatalog(
        {
          ...reader,
          row: (name, id) => ({
            ...reader.row(name, id),
            values: { ...reader.row(name, id).values, id: "999" },
          }),
        },
        [1],
      ),
    /identity mismatch/,
  );
  table["initialize_data.csv"]!.push({ ...table["initialize_data.csv"]![0]! });
  assert.throws(
    () => compileTransportationCatalog(reader, [1, 42, 73, 96]),
    /ambiguous source key/,
  );
});
