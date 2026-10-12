import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldNativeFoot } from "../src/compiler/field-native-foot.js";
import { readFieldNativeFoot, validateFieldNativeFoot, type FieldNativeFootDefinition,
  type FieldNativeFootSource } from "../src/core/field-native-foot.js";

const source = (): FieldNativeFootSource => ({ file: "synthetic.bundle", assetPath: "Synthetic/Map/package.json",
  objectId: "-9007199254740999", serializedFile: "synthetic-serialized", sha256: "a".repeat(64) });
const input = (map: Record<string, unknown> = {}): { asset_group_name: string; map: Record<string, unknown>[] } =>
  ({ asset_group_name: "synthetic", map: [{ name: "Map_A", ...map }] });

test("native visual foot admits only the selected package map's absent attribute representation", () => {
  for (const [map, representation] of [[{}, "missing"], [{ attribute: null }, "null"], [{ attribute: "" }, "empty"]] as const) {
    const definition = compileFieldNativeFoot(input(map), source(), "Map_A");
    assert.equal(definition.attributeRepresentation, representation);
    assert.equal(definition.basis, "package-attribute-absent");
    assert.equal(definition.source.pointer, "/map/0/attribute");
    assert.equal(definition.source.objectId, "-9007199254740999");
    assert.equal(readFieldNativeFoot(definition, { x: 0, y: 0, z: 0 }), 0);
  }
});

test("matching a later map never borrows a different map's attribute capability", () => {
  const packageData = { map: [{ name: "Map_A", attribute: "Map_A/attribute" }, { name: "Map_B" }] };
  const definition = compileFieldNativeFoot(packageData, source(), "Map_B");
  assert.equal(definition.mapName, "Map_B"); assert.equal(definition.source.pointer, "/map/1/attribute");
  assert.throws(() => compileFieldNativeFoot(packageData, source(), "Map_A"), /attribute grid is not implemented/);
  assert.throws(() => validateFieldNativeFoot(definition, "Map_A"), /another source map/);
});

test("default encounter metadata cannot suppress a real native attribute grid", () => {
  const pkg = input({ attribute: "Map_A/attribute", monster_set_id: 129 });
  assert.throws(() => compileFieldNativeFoot(pkg, source(), "Map_A"), /attribute grid is not implemented/);
  const definition = compileFieldNativeFoot(input({ monster_set_id: 0 }), source(), "Map_A");
  assert.equal(readFieldNativeFoot(definition, { x: 128.5, y: -37, z: 349 }), 0);
});

test("missing and duplicate selected map identities reject instead of selecting a first row", () => {
  assert.throws(() => compileFieldNativeFoot({ map: [{ name: "Map_B" }] }, source(), "Map_A"), /Missing or ambiguous/);
  assert.throws(() => compileFieldNativeFoot({ map: [{ name: "Map_A" }, { name: "Map_A" }] }, source(), "Map_A"), /Missing or ambiguous/);
  assert.throws(() => compileFieldNativeFoot(input(), source(), "map_a"), /Missing or ambiguous/);
  assert.throws(() => compileFieldNativeFoot({}, source(), "Map_A"), /package maps/);
});

test("non-string and whitespace attribute references never become absent", () => {
  for (const attribute of [undefined, 0, false, [], {}])
    assert.throws(() => compileFieldNativeFoot(input({ attribute }), source(), "Map_A"), /Unknown source native foot attribute/);
  assert.throws(() => compileFieldNativeFoot(input({ attribute: " " }), source(), "Map_A"), /attribute grid is not implemented/);
});

test("native foot capability preserves detached package provenance and never owns actor coordinates", () => {
  const pkg = input(), evidence = source(), before = structuredClone({ pkg, evidence });
  const definition = compileFieldNativeFoot(pkg, evidence, "Map_A");
  assert.deepEqual({ pkg, evidence }, before);
  pkg.map[0]!.attribute = "later-source-mutation";
  evidence.objectId = "42";
  assert.equal(definition.attributeRepresentation, "missing");
  assert.equal(definition.source.objectId, "-9007199254740999");
  for (const position of [{ x: -16384.5, y: 4096.25, z: 0 }, { x: 0, y: 0, z: -64 }]) {
    const copy = structuredClone(position);
    assert.equal(readFieldNativeFoot(definition, position), 0); assert.deepEqual(position, copy);
  }
  assert.equal(Object.hasOwn(definition, "position"), false);
});

test("unknown definitions, source provenance and non-native numeric positions reject", () => {
  const good = compileFieldNativeFoot(input(), source(), "Map_A");
  const mutations: ((definition: FieldNativeFootDefinition) => void)[] = [
    (d) => { d.basis = "default-monster-set" as FieldNativeFootDefinition["basis"]; },
    (d) => { d.kindOfFoot = "unresolved" as FieldNativeFootDefinition["kindOfFoot"]; },
    (d) => { d.source.objectId = 9007199254740999 as unknown as string; },
    (d) => { d.source.sha256 = ""; },
    (d) => { d.source.pointer = "/map/other/attribute"; },
    (d) => { d.source.assetPath = "Synthetic/collision.json"; },
  ];
  for (const mutate of mutations) {
    const definition = structuredClone(good); mutate(definition);
    assert.throws(() => readFieldNativeFoot(definition, { x: 0, y: 0, z: 0 }));
  }
  assert.throws(() => readFieldNativeFoot(undefined as unknown as FieldNativeFootDefinition, { x: 0, y: 0, z: 0 }), /unavailable/);
  for (const x of [NaN, Infinity, -Infinity, Number.MAX_VALUE, "0" as unknown as number])
    assert.throws(() => readFieldNativeFoot(good, { x, y: 0, z: 0 }), /Invalid native foot actor position/);
});
