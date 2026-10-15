import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/compiler/content.js";
import { importFieldAnimationNext, NATIVE_ANIMATION_JSON, type NativeAnimationJsonImport } from "../src/compiler/field-animation-import.js";
import { compileWorldCharacter } from "../src/compiler/world.js";
const source = { file: "synthetic.bundle", assetPath: "Assets/ANIM/anim_info.json", objectId: "-9223372036854775801", serializedFile: "CAB-synthetic", sha256: "1".repeat(64) };
const dll = { file: "GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" };
const data = (next?: unknown) => ({ shader_type: 0, animation: [{ name: "Default", play_speed: .5, play_mode: 1, is_reverse: false,
  frames: [{ sprite_name: "frame", offsetx: 0, offsety: 0, flip: false, alpha: 1, rgb: { r: 1, g: 1, b: 1 } }],
  ...(next === undefined ? {} : { next_anim_name: next }) }] });
const bind = (raw: unknown): NativeAnimationJsonImport => ({ kind: NATIVE_ANIMATION_JSON, source, rawHash: hash(raw), sources: [{ file: source.file, sha256: source.sha256 }, dll] });
test("physical native JSON import distinguishes missing/null strings from authored input without changing raw bytes", () => {
  for (const [raw, original] of [[data(), "missing"], [data(null), "null"]] as const) {
    const before = hash(raw), imported = importFieldAnimationNext(raw, source, 0, bind(raw));
    assert.equal(imported.next, ""); assert.equal(imported.observation!.original, original);
    assert.equal(imported.observation!.interpretation, "no-successor"); assert.equal(hash(raw), before);
    assert.throws(() => importFieldAnimationNext(raw, source, 0), /bound native JSON/);
  }
  for (const next of ["", "WalkF"]) assert.deepEqual(importFieldAnimationNext(data(next), source, 0), { next });
});
test("native import rejects foreign object/raw/DLL identity, aliases and explicit malformed next fields", () => {
  const raw = data(), good = bind(raw);
  for (const bad of [ { ...good, source: { ...source, objectId: "99" } }, { ...good, rawHash: "f".repeat(64) },
    { ...good, sources: good.sources.filter(row => row.file !== "GameAssembly.dll") },
    { ...good, source: { ...source, serializedFile: "" } }, { ...good, sources: [...good.sources, dll] } ])
    assert.throws(() => importFieldAnimationNext(raw, source, 0, bad), /bound native JSON/);
  for (const value of [0, false, [], {}]) assert.throws(() => importFieldAnimationNext(data(value), source, 0, bind(data(value))), /Invalid source animation/);
  const alias = data(); Object.assign(alias.animation[0]!, { nextAnimName: "WalkF" });
  assert.throws(() => importFieldAnimationNext(alias, source, 0, bind(alias)), /bound native JSON/);
});
test("world animation compiler keeps unbound authored missing next blocked while a bound physical source gets the Default pose", () => {
  const rawData = data(), raw = { animation: { source, data: rawData }, sprites: { frame: {
    file: "frame.png", sha256: "synthetic", width: 16, height: 16, pivot: [.5, 0], source } } };
  const unknown = compileWorldCharacter(raw, () => {}); assert.equal(unknown.character.animations.Default, undefined);
  assert.match(unknown.issues[0]!.reason, /expected string/);
  const imported = compileWorldCharacter(raw, () => {}, bind(rawData));
  assert.equal(imported.character.animations.Default!.next, ""); assert.equal(imported.imports.length, 1);
  assert.deepEqual(imported.issues, []); assert.equal(hash(raw.animation.data), bind(rawData).rawHash);
});
