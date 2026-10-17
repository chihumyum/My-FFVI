import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { compileFieldScriptShopInstruction, fieldScriptShopSelectors } from "../src/compiler/field-script-shop.js";
import type { FieldContent, Op } from "../src/field/types.js";

const source = { file: "synthetic", assetPath: "script-shop" };
const site = (index: number) => ({ script: "main", index, source });
const shop = (index: number, groupId = 64): Op => ({ ...site(index), kind: "field-script-shop", groupId,
  selector: fieldScriptShopSelectors[groupId === 64 ? 2 : groupId === 65 ? 4 : 6]! });
const message = (index: number, key: string): Op => ({ ...site(index), kind: "message",
  key, text: key, speaker: "" });
function content(ops: Op[]): FieldContent {
  return { formatVersion: 1, kind: "field-development", sourceSetHash: "synthetic", parentSourceSetHash: "synthetic",
    contentHash: "synthetic-script-shop", map: { id: "synthetic", width: 5, height: 5, tileSize: 16,
      layers: [], tilesets: [], textures: {}, collisions: { 1: Array(25).fill(0) }, entities: [], source },
    characters: {}, scripts: { main: ops }, entry: { player: { x: 2, y: 2, layer: 1, direction: "up", asset: "hero", mount: "" },
      description: "Controlled source shop task lifecycle", evidence: [source] }, limitations: [] };
}
function game(ops: Op[], validate?: (group: number) => void) {
  const field = new FieldGame(content(ops), EventState.initialized(), undefined, undefined,
    validate ? { shop: { validate } } : {});
  assert.equal(field.startEvent("main"), true);
  return field;
}
const exit = (index: number): Op => ({ ...site(index), kind: "exit" });

const readDialogue = (field: FieldGame) => field.dialogue;
const readShop = (field: FieldGame) => field.currentShop;

test("source shop closes into the original task message and cannot checkpoint or move while open", () => {
  const calls: number[] = [], field = game([message(0, "original-greeting"), shop(1), message(2, "original-farewell"), exit(3)],
    id => calls.push(id));
  assert.equal(readDialogue(field)?.key, "original-greeting");
  assert.equal(readShop(field), null);
  field.confirm(); field.advance(10);
  const opened = readShop(field)!; assert.equal(opened.groupId, 64); assert.deepEqual(calls, [64]);
  assert.equal(readDialogue(field), null); assert.equal(field.checkpointReady, false);
  assert.equal(field.move("up"), false); assert.throws(() => field.checkpoint());
  field.advance(300); assert.equal(readShop(field)?.id, opened.id); assert.deepEqual(calls, [64]);
  assert.equal(field.closeShop(readShop(field)?.id), true); assert.equal(field.closeShop(readShop(field)?.id), false);
  field.advance(10); assert.equal(readDialogue(field)?.key, "original-farewell"); assert.equal(readShop(field), null);
  field.confirm(); field.advance(10); assert.equal(field.stop, null); assert.equal(field.checkpointReady, true);
});

test("a refused shop admission never opens or executes its following instruction", () => {
  for (const validate of [undefined, () => { throw new Error("Unknown product group"); }]) {
    const field = game([shop(0), message(1, "must-not-run"), exit(2)], validate);
    assert.equal(readShop(field), null); assert.equal(readDialogue(field), null);
    assert.equal(field.stop?.kind, "unsupported"); assert.equal(field.checkpointReady, false);
  }
});

test("a changed suspended opcode cannot authorize closing and resuming another source instruction", () => {
  const field = game([shop(0), message(1, "must-not-run"), exit(2)], () => {});
  const id = readShop(field)!.id;
  field.content.scripts.main![0] = shop(0, 65);
  assert.equal(field.closeShop(readShop(field)?.id), false); assert.match(field.stop!.message, /suspended script owner/);
  assert.equal(readDialogue(field), null); assert.equal(field.checkpointReady, false);
  assert.ok(id > 0);
});

test("sequential script shops keep distinct visits and resume once each", () => {
  const calls: number[] = [], field = game([shop(0), shop(1, 67), exit(2)], id => calls.push(id));
  const first = readShop(field)!.id;
  assert.equal(field.closeShop(readShop(field)?.id), true); field.advance(10);
  assert.equal(readShop(field)?.groupId, 67); assert.notEqual(readShop(field)?.id, first);
  assert.deepEqual(calls, [64, 67]);
  assert.equal(field.closeShop(readShop(field)?.id), true); field.advance(10);
  assert.equal(readShop(field), null); assert.equal(field.checkpointReady, true); assert.equal(field.closeShop(readShop(field)?.id), false);
});

test("a repeated close from the prior visit cannot close a synchronously opened successor", () => {
  const calls: number[] = [], field = game([shop(0), shop(1, 67), exit(2)], id => calls.push(id));
  const first = readShop(field)!.id;
  field.advance(300);
  assert.equal(field.closeShop(), false, "a close must name its visit");
  assert.equal(field.closeShop(first), true);
  const second = readShop(field)!.id;
  assert.notEqual(second, first);
  assert.deepEqual(calls, [64, 67]);
  assert.equal(field.closeShop(first), false);
  assert.equal(readShop(field)?.id, second);
  assert.equal(field.checkpointReady, false);
  assert.equal(field.closeShop(second), true);
  field.advance(10);
  assert.equal(field.checkpointReady, true);
});

test("script shop decoding rejects reserved, incomplete and unknown callback shapes", () => {
  const raw = { type: 1, mnemonic: "SysCall", operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0),
    sValues: [fieldScriptShopSelectors[0]!, ...Array(7).fill("")] } };
  assert.equal(compileFieldScriptShopInstruction(raw).groupId, 66);
  for (const alter of [
    (x: typeof raw) => { x.type = 2; },
    (x: typeof raw) => { x.operands.iValues[7] = 1; },
    (x: typeof raw) => { x.operands.rValues[3] = 1; },
    (x: typeof raw) => { x.operands.sValues[1] = "unbound"; },
    (x: typeof raw) => { x.operands.sValues[0] = "unknown callback"; },
    (x: typeof raw) => { x.operands.iValues.pop(); },
  ]) { const bad = structuredClone(raw); alter(bad); assert.throws(() => compileFieldScriptShopInstruction(bad)); }
});
