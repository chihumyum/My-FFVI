import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical } from "../src/core/canonical.js";

const moduleURL = pathToFileURL(resolve(process.cwd(), "scripts/plan-story-runtime.mjs")).href;
const { assessStoryRuntimePublication } = await import(moduleURL);
const h = (letter: string) => letter.repeat(64);
const stages = ["compile-private-candidate", "validate-all-package-closures", "validate-complete-json-and-media-archive",
  "archive-published-before-publication", "validate-retained-CAS-compatibility", "validate-unchanged-inputs",
  "publish-complete-collection", "archive-published-after-publication", "verify-published-source-objects"].map(name => ({ name, status: "passed" }));
function fixture() {
  const refs = { kind: "game-content-refs-v1", profile: "source", world: {
    url: "/content-packages/source/world.json", contentHash: h("a") },
    source: { entry: { url: "/content-packages/source/entry.json", contentHash: h("b") } } };
  const mapInventory = [1, 2].map(mapId => ({ mapId, contentHash: h(String(mapId)),
    url: `/content-packages/source/maps/${mapId}.json`, sha256: h(String(mapId + 4)), bytes: 100 + mapId }));
  const inputFiles = [{ url: "/content-packages/source.json", sha256: h("3"), bytes: 80, contentHash: null },
    { url: refs.world.url, sha256: h("4"), bytes: 100, contentHash: refs.world.contentHash },
    ...mapInventory.map(map => ({ url: `/content-packages/source/maps/${map.mapId}.json`,
      sha256: h(String(map.mapId + 4)), bytes: 100 + map.mapId, contentHash: map.contentHash }))];
  const source = { kind: "source-prerequisite-candidate-v1", compilerDigest: h("c"), sourceSetHash: h("d"),
    parentSourceSetHash: h("e"), strict: { maps: 2, catalogHash: h("f"), entryHash: h("0") },
    stages: ["capture-inputs", "battle-capability-rebuild", "source-world", "source-new-game", "framework-derivation",
      "revalidate-inputs"].map(name => ({ name, status: "passed" })),
    payloads: [{ url: "/world/catalog.json", contentHash: h("f") }, { url: "/game/source-new-game.json", contentHash: h("0") },
      ...mapInventory.map(map => ({ url: `/world/maps/${map.mapId}.json`, contentHash: map.contentHash }))] };
  const linked = { kind: "linked-source-prerequisites-v1", sourceMaps: 2, originalWorldHash: h("f"),
    originalEntryHash: h("0"), linkedWorldHash: h("a"), linkedEntryHash: h("b") };
  const base = { kind: "game-content-package-build-v1", packages: [{ id: "source", refs }] };
  const receipt = { kind: "versioned-content-package-build-v2", result: "passed", published: true, stages,
    sourceInputLock: { kind: "source-prerequisite-input-lock-v1", runtimeSha256: h("9"), compilerDigest: h("c"),
      compiledDir: "dist", sourceSetHash: h("d"), parentSourceSetHash: h("e") },
    producers: [{ id: "source-prerequisites", report: source }, { id: "linked-source-prerequisites", report: linked },
      { id: "base", report: base }], publishedObjects: structuredClone(inputFiles),
    after: { packages: ["source"], reports: [{ kind: "content-release-archive-v1", packageId: "source", mapIndexCount: 2,
      releaseId: h("6"), indexHash: h("7"), originalJSONBytesPreserved: true }] } };
  return { receipt, refs, manifest: { sourceSetHash: h("d"), parentSourceSetHash: h("e"), worldContentHash: h("a"),
    refsURL: "/content-packages/source.json", refsSha256: h("3") },
    runtimeSha256: h("9"), compiledDirectory: resolve(process.cwd(), "dist"), mapInventory, inputFiles, canonical };
}

test("a complete same-runtime source producer chain and every scanned byte establish rebuild provenance only", () => {
  const f = fixture(), before = canonical(f.receipt), result = assessStoryRuntimePublication(f);
  assert.equal(result.status, "verified"); assert.equal(result.rebuiltForThisRuntime, true);
  assert.equal(result.scannedFilesVerified, 4); assert.equal(result.sourceMapsVerified, 2);
  assert.equal(result.runtimeAdmission, undefined); assert.equal(result.sourceStoryReachable, undefined);
  assert.equal(canonical(f.receipt), before, "Assessment cannot mutate publication or source metadata");
});

test("absent, failed, partially published and drifting receipts leave static provenance unassessed", () => {
  const attempts = [undefined, null, {}, { ...fixture().receipt, result: "running" },
    { ...fixture().receipt, result: "failed" }, { ...fixture().receipt, published: false }];
  for (const receipt of attempts) {
    const result = assessStoryRuntimePublication({ ...fixture(), receipt });
    assert.equal(result.status, "unassessed"); assert.equal(result.rebuiltForThisRuntime, "unassessed");
    assert.ok(result.reasons.length);
  }
  const changed = assessStoryRuntimePublication({ ...fixture(), receiptStable: false });
  assert.match(changed.reasons[0], /changed-during-scan/);
});

test("matching one entry or compiler digest cannot replace complete runtime, source and publication-stage proof", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.receipt.sourceInputLock.runtimeSha256 = h("8"); },
    (f: ReturnType<typeof fixture>) => { delete (f.receipt.sourceInputLock as Partial<typeof f.receipt.sourceInputLock>).runtimeSha256; },
    (f: ReturnType<typeof fixture>) => { f.receipt.sourceInputLock.compiledDir = "build/wip/another-runtime"; },
    (f: ReturnType<typeof fixture>) => { f.receipt.sourceInputLock.sourceSetHash = h("8"); },
    (f: ReturnType<typeof fixture>) => { f.receipt.sourceInputLock.parentSourceSetHash = h("8"); },
    (f: ReturnType<typeof fixture>) => { f.receipt.stages = f.receipt.stages.filter(stage => stage.name !== "validate-unchanged-inputs"); },
    (f: ReturnType<typeof fixture>) => { f.receipt.stages = [...f.receipt.stages, { name: "publication-failed", status: "failed" }]; },
    (f: ReturnType<typeof fixture>) => { f.receipt.after.reports[0]!.mapIndexCount = 1; },
  ]) {
    const f = fixture(); change(f); assert.equal(assessStoryRuntimePublication(f).status, "unassessed");
  }
});

test("all source map producer objects and actual published raw bytes must match, including refs serialization", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.receipt.producers[0]!.report = { ...f.receipt.producers[0]!.report,
      payloads: (f.receipt.producers[0]!.report as { payloads: unknown[] }).payloads.slice(0, 3) } as typeof f.receipt.producers[0]["report"]; },
    (f: ReturnType<typeof fixture>) => { f.receipt.publishedObjects[3]!.contentHash = h("8"); },
    (f: ReturnType<typeof fixture>) => { f.receipt.publishedObjects[3]!.sha256 = h("8"); },
    (f: ReturnType<typeof fixture>) => { f.receipt.publishedObjects[0]!.sha256 = h("8"); },
    (f: ReturnType<typeof fixture>) => { f.receipt.publishedObjects[3]!.bytes++; },
    (f: ReturnType<typeof fixture>) => { f.receipt.publishedObjects.pop(); },
    (f: ReturnType<typeof fixture>) => { f.receipt.publishedObjects.push(f.receipt.publishedObjects[0]!); },
    (f: ReturnType<typeof fixture>) => { f.receipt.producers.push(f.receipt.producers[0]!); },
    (f: ReturnType<typeof fixture>) => { f.inputFiles.pop(); },
  ]) {
    const f = fixture(); change(f); assert.equal(assessStoryRuntimePublication(f).status, "unassessed");
  }
});


test("v2 source-input locks retain the complete runtime/source/byte proof and unknown versions stay unassessed", () => {
  for(const kind of ["source-prerequisite-input-lock-v1","source-prerequisite-input-lock-v2"]) {
    const f = fixture();f.receipt.sourceInputLock.kind = kind;
    assert.equal(assessStoryRuntimePublication(f).status,"verified");
    for(const mutate of [
      (x:ReturnType<typeof fixture>) => { x.receipt.sourceInputLock.runtimeSha256 = h("8"); },
      (x:ReturnType<typeof fixture>) => { x.receipt.sourceInputLock.sourceSetHash = h("8"); },
      (x:ReturnType<typeof fixture>) => { x.receipt.publishedObjects.pop(); },
      (x:ReturnType<typeof fixture>) => { x.receipt.stages = x.receipt.stages.filter(row => row.name !== "verify-published-source-objects"); },
    ]) { const changed = fixture();changed.receipt.sourceInputLock.kind = kind;mutate(changed);
      assert.equal(assessStoryRuntimePublication(changed).status,"unassessed"); }
  }
  for(const kind of ["source-prerequisite-input-lock-v0","source-prerequisite-input-lock-v3","source-prerequisite-input-lock-v2-unverified"]) {
    const f = fixture();f.receipt.sourceInputLock.kind = kind;
    assert.equal(assessStoryRuntimePublication(f).status,"unassessed");
  }
});

test("v3 Skybox publication provenance requires explicit policy and the same locked media producer scope",()=>{const prepare=()=>{const f=fixture();f.receipt.sourceInputLock.kind='source-prerequisite-input-lock-v3';Object.assign(f.receipt.sourceInputLock,{skyboxPresentation:'web-flat-skybox-panorama-v1'});const source=f.receipt.producers[0]!.report;Object.assign(source,{skyboxPresentation:{policy:'web-flat-skybox-panorama-v1',catalogHash:h('1'),mediaSourceSetHash:h('2'),models:18,images:18},inputScope:{snapshotRoots:['build/field-skybox-media']}});return f;};const f=prepare();assert.equal(assessStoryRuntimePublication(f).status,'verified');for(const mutate of[(f:any)=>{f.receipt.sourceInputLock.skyboxPresentation='unknown'},(f:any)=>{delete f.receipt.producers[0].report.skyboxPresentation},(f:any)=>{f.receipt.producers[0].report.skyboxPresentation.catalogHash='invalid'},(f:any)=>{f.receipt.producers[0].report.inputScope.snapshotRoots=[]},(f:any)=>{f.receipt.sourceInputLock.kind='source-prerequisite-input-lock-v2'}]){const x=prepare();mutate(x);assert.equal(assessStoryRuntimePublication(x).status,'unassessed');}});
