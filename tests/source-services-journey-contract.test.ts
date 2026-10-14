import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const load = () => import(pathToFileURL(resolve(process.cwd(), "scripts/check-source-services-journey.mjs")).href);

test("the service nomination retains all eight counters and source identities without authorizing a story phase", async () => {
  const { parseSourceServicesJourneyContract } = await load(), input = JSON.parse(await readFile(
    resolve(process.cwd(), "content-batches/south-figaro-services.journey.json"), "utf8")), result = parseSourceServicesJourneyContract(input);
  assert.equal(result.shops.length, 8); assert.equal(result.areaMapIds.length, 56); assert.equal(result.pointInCount, 135);
  result.shops[0].standingPoint.x++;
  assert.notEqual(result.shops[0].standingPoint.x, input.shops[0].standingPoint.x);
  for (const mutate of [
    (value: typeof input) => { value.shops.pop(); },
    (value: typeof input) => { value.shops[7] = structuredClone(value.shops[0]); },
    (value: typeof input) => { value.areaMapIds.pop(); },
    (value: typeof input) => { value.shops[0].source.objectId = 9223372036854776000; },
    (value: typeof input) => { value.shops[0].groupIds = []; },
    (value: typeof input) => { value.shops[0].normalGroupId = 999; },
    (value: typeof input) => { value.worldPhase = "late-game"; },
    (value: typeof input) => { value.sourceStoryReachability = true; },
  ]) { const changed = structuredClone(input); mutate(changed); assert.throws(() => parseSourceServicesJourneyContract(changed)); }
});

/** Authored evidence records exercise the checker's rejection boundary only.
 * They are not a session fixture or a source/runtime acceptance receipt. */
function evidenceFixture() {
  const shop = { routeId: "controlled-counter", mapId: 40, entityId: "6", normalGroupId: 5,
    contentId: 275, standingPoint: { x: 9, y: 11, layer: 2, direction: "left" } },
    before = { x: 9, y: 11, layer: 2 },
    inputs = [
      { kind: "face", direction: "left", mapId: 40, entityId: "6" }, { kind: "confirm" },
      { kind: "shop", groupId: 5, request: { kind: "buy", productId: 27, count: 1 } },
      { kind: "leave-shop", groupId: 5 }, { kind: "save-restore" }, { kind: "confirm" },
      { kind: "shop", groupId: 5, request: { kind: "sell", contentId: 275, count: 1 } },
      { kind: "leave-shop", groupId: 5 }, { kind: "save-restore" }, { kind: "confirm" },
      { kind: "leave-shop", groupId: 5 }, { kind: "move", direction: "down" },
    ], initialOwned = { gil: 1000, totalGil: 1000, items: [{ id: 2, count: 1 }], equipmentStock: [{ id: 275, count: 2 }],
      roster: [], party: {}, completedBattles: [], releasedJobIds: [], learnedAbilityIds: [], characterNames: [] },
    finalOwned = { ...structuredClone(initialOwned), gil: 950, totalGil: 1050 }, trace: any[] = [],
    expectedMessages: { key: string; documentHash: string }[] = [];
  const message = (key: string) => { const value = { key, documentHash: (key === "hello" ? "a" : "b").repeat(64) };
    expectedMessages.push(value); trace.push({ kind: "message-confirm", mapId: 40, ...value }); };
  for (const [inputIndex, input] of inputs.entries()) {
    if (input.kind === "face" || input.kind === "move") trace.push({ kind: "direction-input", inputIndex, input,
      result: { kind: input.kind === "face" ? "facing" : "movement" }, before, after: before, accepted: true });
    if (input.kind === "confirm") message("hello");
    if (input.kind === "shop" || input.kind === "leave-shop") {
      const visit = inputIndex < 4 ? 10 : inputIndex < 8 ? 11 : 12;
      trace.push({ kind: "shop-command", inputIndex, input, shop: { id: visit, groupId: 5, entityId: "6" },
        ownerBound: true, accepted: true, result: input.kind === "leave-shop" ? true : {
          kind: input.request!.kind, groupId: 5, contentId: 275, count: 1,
          unitPrice: input.request!.kind === "buy" ? 100 : 50, totalPrice: input.request!.kind === "buy" ? 100 : 50 } });
    }
    if (input.kind === "save-restore") trace.push({ kind: "save-restore", final: false, inputIndex,
      checkpointHash: "c".repeat(64), entry: "GameEntryLoader", staleCommandsRejected: true, ownerRebound: true, continued: true });
    trace.push({ kind: "input", inputIndex, input });
    if (input.kind === "leave-shop") message("bye");
  }
  trace.push({ kind: "save-restore", final: true, inputIndex: null, checkpointHash: "d".repeat(64),
    entry: "GameEntryLoader", staleCommandsRejected: true, ownerRebound: true, continued: false });
  return { shop, route: { inputs }, product: { buy: 100 }, content: { sell: 50 }, expectedMessages,
    finalPlayer: { x: 9, y: 12, layer: 2, direction: "down" }, run: {
      receipt: { routeId: shop.routeId, result: "completed", boundary: null, finalMapId: 40, visitedMapIds: [40],
        completedEncounterIds: [], checkpointReady: true, saveRestored: true,
        program: { inputCount: inputs.length, menuCount: 0, restoreCount: 3, postRestoreInputCount: 6 } },
      trace, execution: { loadsCommitted: 3, staleCommandChannelsRejected: 3 },
      finalState: { initialOwned, finalOwned, checkpoint: { owned: structuredClone(finalOwned) } },
    } };
}

test("service evidence requires three genuine visits, restored continuation and the original net transaction", async () => {
  const { assertSourceServiceJourneyEvidence } = await load(), value = evidenceFixture(), before = structuredClone(value);
  const result = assertSourceServiceJourneyEvidence(value);
  assert.equal(result.visits, 3); assert.equal(result.gilDelta, -50); assert.deepEqual(value, before);
});

test("a short, stale, wrong-counter, wall, lost-message or duplicated-reward receipt cannot pass", async () => {
  const { assertSourceServiceJourneyEvidence } = await load();
  for (const mutate of [
    (value: ReturnType<typeof evidenceFixture>) => { value.run.receipt.result = "blocked"; },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.receipt.program.restoreCount = 1; },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.receipt.program.postRestoreInputCount = 0; },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.trace.find(row => row.kind === "shop-command").shop.entityId = "wrong"; },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.trace.find(row => row.kind === "shop-command").shop.groupId = 64; },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.trace.find(row => row.kind === "save-restore").staleCommandsRejected = false; },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.trace.find(row => row.kind === "direction-input").result.kind = "rejected"; },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.trace = value.run.trace.filter(row => row.kind !== "message-confirm"); },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.trace.find(row => row.kind === "message-confirm").documentHash = "f".repeat(64); },
    (value: ReturnType<typeof evidenceFixture>) => { value.run.finalState.finalOwned.equipmentStock[0]!.count++; },
    (value: ReturnType<typeof evidenceFixture>) => { value.finalPlayer.y++; },
  ]) { const value = evidenceFixture(); mutate(value); assert.throws(() => assertSourceServiceJourneyEvidence(value)); }
});
