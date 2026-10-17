import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "../src/compiler/content.js";
import { bindSourceFormatFlags, decodeSourceSystemFlags, SOURCE_FORMAT_FLAG_IMPORT } from "../src/compiler/source-system-flags.js";
import { compileFieldPuppetScriptContext } from "../src/compiler/field-puppet-actors.js";
import { decodeConditionVisualFlag } from "../src/compiler/field.js";

const source = { file: "authored.bundle", sha256: "8".repeat(64), assetPath: "Fixtures/Format.json", objectId: "9007199254740993", serializedFile: "authored" };
const sources = [{ file: "GameAssembly.dll", sha256: SOURCE_FORMAT_FLAG_IMPORT.nativeSha256 }, { file: source.file, sha256: source.sha256 }];
const manifest = { sourceSetHash: hash(sources), parentSourceSetHash: "a".repeat(64), sources };
const zero = { SkipInitialize: 0, KeepPlayerPuppet: 0, KeepBadStatusVisual: 0, RidingVehicle: 0 };
const binding = (data: unknown) => bindSourceFormatFlags(manifest, { source, data });

test("the fixed JSON importer defaults omitted int32 members, preserving raw absence and source identity", () => {
  for (const SystemFlag of [zero, { SkipInitialize: 0, KeepPlayerPuppet: 0, KeepBadStatusVisual: 0 }, { SkipInitialize: 0 }, {}]) {
    const raw = { SystemFlag, Mnemonics: [] }, before = structuredClone(raw), bound = binding(raw), result = decodeSourceSystemFlags(raw, bound);
    assert.deepEqual(result.values, zero); assert.equal(result.defaulted.length, 4 - Object.keys(SystemFlag).length);
    assert.equal(result.rawScriptHash, hash(before)); assert.deepEqual(raw, before);
    assert.equal(result.source.objectId, "9007199254740993");
    result.source.assetPath = "mutated projection"; assert.equal(bound.source.assetPath, source.assetPath);
  }
  assert.notEqual(binding({ SystemFlag: zero }).rawScriptHash, binding({ SystemFlag: { SkipInitialize: 0 } }).rawScriptHash);
});

test("explicit native int32 values retain nonzero semantics rather than being overwritten by defaults", () => {
  const raw = { SystemFlag: { SkipInitialize: -1, KeepPlayerPuppet: 1, KeepBadStatusVisual: 0, RidingVehicle: 2147483647 } };
  assert.deepEqual(decodeSourceSystemFlags(raw, binding(raw)).values, raw.SystemFlag);
  const context = compileFieldPuppetScriptContext(raw, { characteristics: true }, binding(raw));
  assert.deepEqual([context.skipInitialize, context.keepPlayerPuppet, context.keepBadStatusVisual, context.ridingVehicle], [true, true, false, true]);
});

test("missing or null whole objects, malformed members, aliases and inherited fields are never filled", () => {
  for (const raw of [{}, { SystemFlag: null }, { SystemFlag: [] }, { SystemFlag: "" }, { SystemFlag: 0 },
    { SystemFlag: { skipInitialize: 1 } }, { SystemFlag: { ...zero, Ridingvehicle: 0 } }])
    assert.throws(() => decodeSourceSystemFlags(raw, binding(raw)));
  for (const value of [null, undefined, false, "0", NaN, Infinity, 0.1, 2147483648, -2147483649]) {
    const raw = { SystemFlag: { ...zero, RidingVehicle: value } };
    assert.throws(() => decodeSourceSystemFlags(raw, binding(raw)));
  }
  const inherited = Object.create({ SystemFlag: zero });
  assert.throws(() => decodeSourceSystemFlags(inherited, binding(inherited)));
  const getter = { get SystemFlag() { throw new Error("Accessor evaluated"); } };
  assert.throws(() => decodeSourceSystemFlags(getter, binding(getter)));
});

test("raw, physical source, manifest, loader and metadata mismatches cannot reuse an import binding", () => {
  const raw = { SystemFlag: { SkipInitialize: 0 } }, bound = binding(raw);
  assert.throws(() => decodeSourceSystemFlags({ SystemFlag: { SkipInitialize: 1 } }, bound), /binding changed/);
  const altered = structuredClone(bound); altered.source.objectId = "9007199254740995";
  assert.throws(() => decodeSourceSystemFlags(raw, altered), /binding changed/);
  for (const key of ["nativeSha256", "symbolsSha256", "headerSha256"] as const) {
    const altered = { ...bound, [key]: "b".repeat(64) };
    assert.throws(() => decodeSourceSystemFlags(raw, altered), /binding changed/);
  }
  assert.throws(() => bindSourceFormatFlags({ ...manifest, sourceSetHash: "f".repeat(64) }, { source, data: raw }), /fingerprint/);
  assert.throws(() => bindSourceFormatFlags(manifest, { source: { ...source, sha256: "c".repeat(64) }, data: raw }), /another native build/);
  const wrongNative = [{ file: "GameAssembly.dll", sha256: "0".repeat(64) }, sources[1]];
  assert.throws(() => bindSourceFormatFlags({ ...manifest, sources: wrongNative, sourceSetHash: hash(wrongNative) }, { source, data: raw }), /another native build/);
});

test("legacy explicit contexts stay identical; absent flags require the source import binding", () => {
  const explicit = { SystemFlag: { ...zero, KeepPlayerPuppet: 1 } }, misc = { characteristics: true };
  assert.deepEqual(compileFieldPuppetScriptContext(explicit, misc), compileFieldPuppetScriptContext(explicit, misc, binding(explicit)));
  const omitted = { SystemFlag: { SkipInitialize: 0 } };
  assert.throws(() => compileFieldPuppetScriptContext(omitted, misc));
  const context = compileFieldPuppetScriptContext(omitted, misc, binding(omitted));
  assert.equal(context.scriptHash, hash(omitted)); assert.equal(context.miscHash, hash(misc));
  assert.deepEqual(decodeConditionVisualFlag(omitted, binding(omitted)), { keepBadStatusVisual: false });
  assert.equal(decodeConditionVisualFlag(omitted), null);
  assert.equal(decodeConditionVisualFlag({}), null);
});
