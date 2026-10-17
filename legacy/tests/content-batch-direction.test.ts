import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContentBatchManifest, planContentBatch } from "../src/compiler/content-batch.js";
import { GameContentRepository } from "../src/core/game-content.js";
import type { GameCheckpoint } from "../src/core/game-session.js";
import type { GameState } from "../src/core/game-state.js";
import type { FieldEntity } from "../src/field/types.js";
import { hash } from "../src/compiler/content.js";
import { contentBatchFixture, sealBatchContent } from "./fixtures/content-batch.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

type Input = ContentBatchManifest["routes"][number]["inputs"][number];
type Trace = { kind: string; inputIndex?: number; result?: { kind: string }; entityId?: string; regionId?: string };
type Owned = ReturnType<GameState["snapshot"]>;
type Run = {
  receipt: { result: string; boundary: { kind: string; reason?: string } | null; controls: string[];
    program?: { inputCount: number; menuCount: number; restoreCount: number; postRestoreInputCount: number } };
  trace: Trace[]; execution: { loadsCommitted: number; staleCommandChannelsRejected: number };
  finalState?: { initialOwned: Owned | null; finalOwned: Owned | null; checkpoint: GameCheckpoint | null };
};
const root = process.cwd(), compiled = fileURLToPath(new URL("../", import.meta.url));
const { runContentBatchRoute }: { runContentBatchRoute(options: {
  root: string; compiled: string; plan: ReturnType<typeof planContentBatch>; routeId: string;
  repository: GameContentRepository; runtimeHash: string; captureFinalState?: boolean;
}): Promise<Run> } = await import(pathToFileURL(resolve(root, "scripts/content-batch-route.mjs")).href);

/** A minimal authored contact-door and ordinary Talk on the existing shared
 * fixture owners. This is not a source scene or original-game acceptance. */
function fixture(inputs: Input[], door = true, alter?: (npc: FieldEntity) => void) {
  const f = contentBatchFixture(), base = checkpointFixture(), field = f.packages.entry;
  const point = field.map.entities.find(entity => entity.kind === 0)!;
  const npc: FieldEntity = { ...structuredClone(base.field.map.entities.find(entity => entity.kind === 6)!),
    id: "clerk", kind: 17, x: door ? 3 : 2, y: 1,
    npc: { moveType: 0, collision: true, pushed: false, eyeContact: false, turnAround: false,
      acceptDirection: 15, soundId: 0, talkMounts: [""],
      interaction: { kind: "talk", message: { key: "CONTROLLED_TALK", text: "Continue", speaker: "Clerk" } } } };
  alter?.(npc);
  const entities = [point, ...(door ? base.field.map.entities.filter(entity => entity.kind === 8 || entity.kind === 1) : []), npc];
  field.map.entities = structuredClone(entities);
  field.map.groups = { entity_default: { name: "entity_default", entities: field.map.entities, blockers: [], source: field.map.source } };
  field.scripts = {};
  f.packages.entry = sealBatchContent(field);
  const map = f.packages.maps[0]!;
  map.map = structuredClone(field.map); map.scripts = {}; map.initializer = null;
  f.packages.maps = [sealBatchContent(map)];
  f.packages.catalog.maps = { 1: { ...f.packages.catalog.maps[1]!, contentHash: f.packages.maps[0]!.contentHash } };
  f.packages.catalog = sealBatchContent(f.packages.catalog);
  f.manifest.mapIds = [1];
  Object.assign(f.manifest.routes[0]!, { expectedMapId: 1, requiredMapIds: [1], requiredEncounterIds: [],
    inputs, battleAbilityIds: [] });
  const plan = planContentBatch(f.manifest, f.packages), { entry, battle, catalog, maps } = f.packages;
  const files = new Map<string, unknown>([["/game/content.json", entry], ["/game/battle.json", battle],
    ["/world/catalog.json", catalog], ...maps.map(map => [catalog.maps[map.mapId]!.url, map] as [string, unknown])]);
  const repository = new GameContentRepository(async url => {
    assert.ok(files.has(url), "Unexpected controlled batch dependency " + url);
    return files.get(url);
  });
  return { plan, repository };
}
const face = (): Input => ({ kind: "face", direction: "right", mapId: 1, entityId: "clerk" });
async function run(f: ReturnType<typeof fixture>, captureFinalState = false): Promise<Run> {
  return runContentBatchRoute({ root, compiled, plan: f.plan, routeId: f.plan.manifest.routes[0]!.id,
    repository: f.repository, runtimeHash: hash("controlled-direction-input-tests"), captureFinalState });
}
function player(result: Run) { return result.finalState!.checkpoint!.world.field.actors.find(actor => actor.id === "-1001")!; }

test("facing declarations bind strict map/entity identities and preserve the legacy move shape", () => {
  const f = fixture([face()]);
  const parsed = ContentBatchManifest.parse(f.plan.manifest);
  assert.deepEqual(parsed.routes[0]!.inputs, [face()]);
  parsed.routes[0]!.inputs[0] = { kind: "move", direction: "up" };
  assert.deepEqual(f.plan.manifest.routes[0]!.inputs, [face()]);
  for (const input of [
    { kind: "face", direction: "right", entityId: "clerk" },
    { kind: "face", direction: "right", mapId: 0, entityId: "clerk" },
    { kind: "face", direction: "right", mapId: "1", entityId: "clerk" },
    { kind: "face", direction: "right", mapId: 1, entityId: " " },
    { kind: "face", direction: "right", mapId: 1, entityId: " clerk" },
    { kind: "face", direction: "diagonal", mapId: 1, entityId: "clerk" },
    { ...face(), teleport: true }, { kind: "move", direction: "right", entityId: "clerk" },
  ]) assert.throws(() => ContentBatchManifest.parse({ ...f.plan.manifest,
    routes: [{ ...f.plan.manifest.routes[0], inputs: [input] }] }));
});

test("one shared door completes before the next move; exact facing, Talk and restore continue through public owners", async () => {
  const result = await run(fixture([
    { kind: "move", direction: "right" }, { kind: "move", direction: "right" }, face(),
    { kind: "confirm" }, { kind: "save-restore" }, face(), { kind: "confirm" }, { kind: "move", direction: "down" },
  ]), true);
  assert.equal(result.receipt.result, "completed", JSON.stringify(result.receipt));
  assert.deepEqual(result.trace.filter(row => row.kind === "direction-input").map(row => row.result!.kind),
    ["door", "movement", "facing", "facing", "movement"]);
  const done = result.trace.findIndex(row => row.kind === "door-complete"), next = result.trace.findIndex(row => row.kind === "input" && row.inputIndex === 1);
  assert.ok(done >= 0 && done < next);
  assert.equal(result.trace[done]!.entityId, "door"); assert.equal(result.trace[done]!.regionId, "region");
  assert.ok(result.receipt.controls.includes("door-contact map:1 entity:door region:region"));
  assert.equal(result.execution.loadsCommitted, 2); assert.equal(result.execution.staleCommandChannelsRejected, 2);
  assert.deepEqual(result.receipt.program, { inputCount: 8, menuCount: 0, restoreCount: 2, postRestoreInputCount: 3 });
  assert.deepEqual(result.finalState!.initialOwned, result.finalState!.finalOwned);
  assert.deepEqual(result.finalState!.checkpoint!.world.field.doors.opened, ["door"]);
  assert.deepEqual({ x: player(result).x, y: player(result).y }, { x: 2, y: 2 });
  result.finalState!.initialOwned!.gil++;
  assert.notEqual(result.finalState!.initialOwned!.gil, result.finalState!.finalOwned!.gil);
  assert.deepEqual(result.finalState!.finalOwned, result.finalState!.checkpoint!.owned);
});

test("an undeclared blocked-cell facing never satisfies a legacy move", async () => {
  const result = await run(fixture([{ kind: "move", direction: "right" }], false), true);
  assert.equal(result.receipt.result, "blocked"); assert.equal(result.receipt.boundary!.kind, "rejected-player-input");
  assert.equal(result.trace.find(row => row.kind === "direction-input")!.result!.kind, "facing");
  assert.deepEqual({ x: player(result).x, y: player(result).y }, { x: 1, y: 1 });
  assert.deepEqual(result.finalState!.initialOwned, result.finalState!.finalOwned);
  assert.equal(result.trace.filter(row => row.kind === "input").length, 0);
});

test("facing cannot borrow a foreign map, absent/blocked interaction or a different layer/direction", async () => {
  for (const [input, alter] of [
    [{ ...face(), mapId: 2 }, undefined], [{ ...face(), entityId: "absent" }, undefined],
    [face(), (npc: FieldEntity) => { npc.layer = 2; }],
    [face(), (npc: FieldEntity) => { npc.npc!.interaction = { kind: "none" }; }],
    [face(), (npc: FieldEntity) => { npc.npc!.interaction = { kind: "blocked", reason: "unsupported" }; }],
    [face(), (npc: FieldEntity) => { npc.npc!.acceptDirection = 0; }],
  ] as [Input, ((npc: FieldEntity) => void) | undefined][]) {
    const result = await run(fixture([input], false, alter), true);
    assert.equal(result.receipt.result, "blocked", JSON.stringify(result.receipt));
    assert.equal(result.receipt.boundary!.kind, "rejected-face-input");
    assert.equal(result.trace.some(row => row.kind === "direction-input"), false, "Rejected identity must not send a direction gesture");
    assert.deepEqual({ x: player(result).x, y: player(result).y }, { x: 1, y: 1 });
    assert.deepEqual(result.finalState!.initialOwned, result.finalState!.finalOwned);
  }
});

test("default route results omit optional owned/checkpoint captures", async () => {
  const result = await run(fixture([], false));
  assert.equal(result.receipt.result, "completed", JSON.stringify(result.receipt));
  assert.equal(Object.hasOwn(result, "finalState"), false);
  assert.equal(Object.hasOwn(result.receipt, "finalState"), false);
});
