import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldScriptShopInstruction, fieldScriptShopSelectors } from "../src/compiler/field-script-shop.js";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import type { FieldContent, Op } from "../src/field/types.js";

const helperURL = new URL("../../scripts/named-shop-bindings.mjs", import.meta.url).href;
const { assertNamedShopBindings } = await import(helperURL);
const raw = (selector: string) => ({ type: 1, mnemonic: "SysCall", operands: { iValues: Array(8).fill(0),
  rValues: Array(8).fill(0), sValues: [selector, ...Array(7).fill("")] } });
const weapon = "ショップを開く:モブリズの村(武器屋)";
const tool = "ショップを開く:モブリズの村(道具屋)";
const source = { file: "authored-shop-batch", assetPath: "Fixtures/ShopBatch", objectId: "9007199254740993" };
const emit = (value: Record<string, unknown>, index: number): Op => ({ ...value, script: "source", index, source } as Op);
function fixture(selector: string, available: readonly number[]) {
  const op = emit(compileFieldScriptShopInstruction(raw(selector)), 0);
  const content: FieldContent = { formatVersion: 1, kind: "field-development", sourceSetHash: "authored", parentSourceSetHash: "authored",
    contentHash: "authored-shop-batch", map: { id: "authored", width: 4, height: 4, tileSize: 16,
      layers: [], tilesets: [], textures: {}, collisions: { 1: Array(16).fill(0) }, entities: [], source },
    characters: {}, scripts: { source: [op, emit({ kind: "message", key: "AFTER", speaker: "", text: "Original continuation" }, 1),
      emit({ kind: "exit" }, 2)] }, entry: { player: { x: 1, y: 1, layer: 1, direction: "up", asset: "hero", mount: "" },
      description: "Authored failure fixture; original story reachability is not granted", evidence: [source] }, limitations: [] };
  const field = new FieldGame(content, EventState.initialized(), undefined, undefined, { shop: { validate(group) {
    if (!available.includes(group)) throw new Error("Dangling product_group source identity " + group);
  } } });
  field.startEvent("source"); return { field, content };
}

test("phase, leader, left/right and source dictionary names preserve distinct exact product identities", () => {
  const first = compileFieldScriptShopInstruction(raw("ショップを開く:フィガロ城(初期)道具屋_右"));
  const moved = compileFieldScriptShopInstruction(raw("ショップを開く:フィガロ城(城移動可能後)道具屋_右"));
  const edgar = compileFieldScriptShopInstruction(raw("ショップを開く:フィガロ城(初期_エドガー先頭)道具屋_左"));
  assert.deepEqual([first.groupId, moved.groupId, edgar.groupId], [1, 22, 84]);
  assert.equal(compileFieldScriptShopInstruction(raw(weapon)).groupId, 10);
  assert.equal(compileFieldScriptShopInstruction(raw("ショップを開く:一軒家_行商")).groupId, 8);
  assert.equal(fieldScriptShopSelectors.length, 25);
  assert.throws(() => compileFieldScriptShopInstruction(raw("ショップを開く:魔列車_道具屋")), /Unbound/,
    "An unused native wrapper or English method name is not permission to add a new source binding");
  assert.throws(() => compileFieldScriptShopInstruction(raw("ショップを開く:モブリズの村(武器屋) ")), /Unbound/);
});

test("new bindings retain all reserved operand, generated puppet and unknown selector gates", () => {
  for (const alter of [
    (x: ReturnType<typeof raw>) => { x.type = 2; },
    (x: ReturnType<typeof raw>) => { x.operands.iValues[0] = 1; },
    (x: ReturnType<typeof raw>) => { x.operands.iValues[7] = 1; },
    (x: ReturnType<typeof raw>) => { x.operands.rValues[0] = 0.01; },
    (x: ReturnType<typeof raw>) => { x.operands.sValues[1] = "extra"; },
    (x: ReturnType<typeof raw>) => { x.operands.sValues[0] = "unknown source shop"; },
    (x: ReturnType<typeof raw>) => { x.operands.iValues.pop(); },
  ]) {
    const bad = raw(weapon); alter(bad); const original = structuredClone(bad);
    assert.throws(() => compileFieldScriptShopInstruction(bad)); assert.deepEqual(bad, original);
  }
});

test("independently verified native bindings reject changed, duplicate, missing or unproven source identities", () => {
  const verified = [{ selector: "registered A", groupId: 1 }, { selector: "registered B", groupId: 2 }];
  const before = structuredClone(verified);
  assert.equal(assertNamedShopBindings(verified, verified, [1, 2]).result, "passed");
  for (const actual of [
    [{ selector: "registered A", groupId: 2 }, verified[1]],
    [verified[0], verified[0]], [verified[0]],
    [verified[0], { selector: "registered B ", groupId: 2 }],
    [verified[0], { selector: "registered B", groupId: 2, sourceAdmission: true }],
    new Array(2),
  ]) assert.throws(() => assertNamedShopBindings(actual, verified, [1, 2]));
  assert.throws(() => assertNamedShopBindings(verified, verified, [1]), /Dangling source product group/);
  assert.throws(() => assertNamedShopBindings(verified, verified, [1, 1, 2]), /Duplicate source product group/);
  assert.deepEqual(verified, before);
});

test("a verified callback still refuses a dangling source product group on the actual shared field owner", () => {
  const { field } = fixture(weapon, [13]);
  assert.equal(field.currentShop, null); assert.equal(field.dialogue, null);
  assert.match(field.stop!.message, /Dangling product_group/); assert.equal(field.checkpointReady, false);
});

test("a suspended callback cannot be replaced by another valid native selector while closing", () => {
  const { field, content } = fixture(weapon, [10, 13]), visit = field.currentShop!.id;
  content.scripts.source![0] = emit(compileFieldScriptShopInstruction(raw(tool)), 0);
  assert.equal(field.closeShop(visit), false); assert.equal(field.dialogue, null);
  assert.match(field.stop!.message, /suspended script owner/); assert.equal(field.checkpointReady, false);
});

test("new source callbacks close exactly once into their existing source task continuation", () => {
  const { field } = fixture(weapon, [10]), visit = field.currentShop!.id;
  assert.equal(field.move("right"), false); assert.throws(() => field.checkpoint());
  assert.equal(field.closeShop(visit), true); assert.equal(field.closeShop(visit), false);
  field.advance(10); assert.equal(field.dialogue!.key, "AFTER");
  field.confirm(); field.advance(10); assert.equal(field.stop, null); assert.equal(field.checkpointReady, true);
  assert.equal(field.closeShop(visit), false); assert.equal(field.currentShop, null);
});
