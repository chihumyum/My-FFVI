import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical } from "../src/core/canonical.js";
import { hash } from "../src/compiler/content.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";
import type { SourceNewGameContent } from "../src/core/source-new-game.js";
import type { WorldCatalog, WorldMapContent } from "../src/field/world.js";

const compiledDir = fileURLToPath(new URL("../", import.meta.url));
const load = () => import(pathToFileURL(resolve(process.cwd(), "scripts/link-source-prerequisites.mjs")).href);
function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _, ...body } = structuredClone(value); return { ...body, contentHash: hash(body) } as T;
}
function fixture() {
  const f = sourceNewGameFixture(), map = seal(f.map);
  const world = seal({ ...f.world, maps: { [map.mapId]: { ...f.world.maps[map.mapId]!,
    url: `/world/maps/${map.mapId}.json`, contentHash: map.contentHash } } });
  const entry = seal({ ...f.content, worldCatalogHash: world.contentHash, mapContentHash: map.contentHash });
  return { map, world, entry, inputs: new Map<string, unknown>([
    ["/world/catalog.json", world], ["/game/source-new-game.json", entry], [world.maps[map.mapId]!.url, map] ]) };
}

test("source and framework map catalogs are contained together and preserve their full provenance chain", async () => {
  const f = fixture(), before = canonical([...f.inputs]), { linkSourcePrerequisites } = await load();
  const linked = await linkSourcePrerequisites({ payloads: f.inputs, compiledDir }) as {
    inputs: Map<string, unknown>; payloads: Map<string, WorldMapContent> };
  const world = linked.inputs.get("/world/catalog.json") as WorldCatalog;
  const entry = linked.inputs.get("/game/source-new-game.json") as SourceNewGameContent;
  const framework = linked.inputs.get("/framework/world/catalog.json") as WorldCatalog;
  const frameworkEntry = linked.inputs.get("/framework/new-game.json") as SourceNewGameContent;
  assert.equal(world.maps[f.map.mapId]!.url, `/content-packages/source/maps/${f.map.mapId}.json`);
  assert.equal(entry.worldCatalogHash, world.contentHash); assert.equal(entry.mapContentHash, f.map.contentHash);
  assert.equal(frameworkEntry.worldCatalogHash, framework.contentHash);
  assert.equal(frameworkEntry.developmentProfile!.sourceContentHash, entry.contentHash);
  assert.equal(framework.developmentProfile!.sourceContentHash, world.contentHash);
  assert.equal(linked.payloads.size, 2);
  assert.equal(canonical([...f.inputs]), before, "Logical compiler outputs remain detached");
  (linked.inputs.get("/world/maps/" + f.map.mapId + ".json") as WorldMapContent).name = "Private edit";
  assert.equal(canonical([...f.inputs]), before);
});

test("a missing indexed map or mismatched entry stops the whole candidate before publication", async () => {
  const f = fixture(), { linkSourcePrerequisites } = await load();
  const missing = new Map(f.inputs); missing.delete(f.world.maps[f.map.mapId]!.url);
  await assert.rejects(linkSourcePrerequisites({ payloads: missing, compiledDir }), /Missing candidate/);
  const changed = new Map(f.inputs); changed.set("/game/source-new-game.json", seal({ ...f.entry, mapContentHash: "f".repeat(64) }));
  await assert.rejects(linkSourcePrerequisites({ payloads: changed, compiledDir }), /entry map mismatch/);
  assert.ok([...f.inputs.keys()].every(url => !url.startsWith("/content-packages/")));
});
