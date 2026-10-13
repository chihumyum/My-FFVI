import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical } from "../src/core/canonical.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { GameContentRepository } from "../src/core/game-content.js";
import type { GameContentRefsV1 } from "../src/core/game-content-refs.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

const compiledDir = fileURLToPath(new URL("../", import.meta.url));
const script = pathToFileURL(resolve(process.cwd(), "scripts/content-package-pipeline.mjs")).href;
type Result = { result: string; published: boolean; stages: unknown[] };
type ArchiveInput = { root: string; compiledDir: string; packageDirectory: string; out?: string };
type Archive = (input: ArchiveInput) => Promise<{ packages: string[]; reports: unknown[] }>;
type Options = { root: string; compiledDir: string; reportPath: string;
  compile: () => Promise<{ payloads: Map<string, unknown>; reports?: unknown[] }>; archive: Archive };
const publish = async (options: Options): Promise<Result> => (await import(script)).publishContentPackages(options);
const raw = (value: unknown) => Buffer.from(canonical(value) + "\n");
const primaryURL = "/content-packages/primary.json";
const battleURL = "/content-packages/ordinary/battle.json";

async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...payload } = structuredClone(value);
  return { ...payload, contentHash: await contentDigest(payload) } as T;
}

/** Complete synthetic entry packages over the existing source initializer.
 * Maps use external world URLs so the publisher must track reads beyond its
 * own payloads. This is package-publication evidence, not playable coverage. */
async function bundle(generation: string, derived = false) {
  const f = sourceNewGameFixture(), map = await seal(f.map);
  const futureDraft = structuredClone(map);
  futureDraft.mapId = map.mapId + 1; futureDraft.name = "Unvisited indexed map";
  futureDraft.map!.identity!.mapId = futureDraft.mapId;
  futureDraft.map!.entryContext!.mapId = futureDraft.mapId;
  futureDraft.partyEntry!.mapId = futureDraft.mapId;
  const future = await seal(futureDraft);
  const battle = await seal({ ...f.battle, common: { ...f.battle.common,
    limitations: [...f.battle.common.limitations, "Controlled package generation: " + generation] } });
  const worldDraft = structuredClone(f.world);
  worldDraft.limitations = [...worldDraft.limitations, "Controlled package generation: " + generation];
  worldDraft.maps = Object.fromEntries([map, future].map(value => [value.mapId, {
    url: `/world/maps/${value.mapId}.json`, contentHash: value.contentHash, name: value.name,
    areaId: value.areaId, geometryReady: true, defaultGroupReady: true, blockers: [],
  }]));
  const world = await seal(worldDraft), entry = await seal({ ...f.content,
    worldCatalogHash: world.contentHash, mapContentHash: map.contentHash, battleCatalogHash: battle.contentHash });
  const refs: GameContentRefsV1 = { kind: "game-content-refs-v1", profile: "source", development: null,
    world: { url: "/content-packages/primary/world.json", contentHash: world.contentHash },
    source: { entry: { url: "/content-packages/primary/entry.json", contentHash: entry.contentHash },
      battle: { url: battleURL, contentHash: battle.contentHash } } };
  const payloads = new Map<string, unknown>([[primaryURL, refs], [refs.world.url, world],
    [refs.source!.entry.url, entry], [battleURL, battle]]);
  if (derived) {
    const selected = structuredClone(refs); selected.source!.entry.url = "/content-packages/derived/entry.json";
    payloads.set("/content-packages/derived.json", selected);
    payloads.set(selected.source!.entry.url, entry);
  }
  return { payloads, refs, entry, world, battle, map, future,
    external: new Map<string, unknown>([map, future].map(value =>
      [world.maps[value.mapId]!.url, value] as [string, unknown])) };
}
type Bundle = Awaited<ReturnType<typeof bundle>>;

async function put(root: string, url: string, value: unknown): Promise<void> {
  const file = resolve(root, "build", url.slice(1)); await mkdir(dirname(file), { recursive: true });
  await writeFile(file, raw(value));
}
async function snapshot(directory: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  async function visit(path: string, prefix: string): Promise<void> {
    for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(path, item.name), name = prefix + item.name;
      if (item.isDirectory()) await visit(file, name + "/");
      else { assert.equal(item.isFile(), true); result.set(name, await readFile(file)); }
    }
  }
  await visit(directory, ""); return result;
}
async function withRoot(work: (root: string, old: Bundle, before: Map<string, Buffer>) => Promise<void>) {
  const root = await mkdtemp(resolve(tmpdir(), "ffvi-package-pipeline-"));
  try {
    const old = await bundle("old");
    for (const [url, value] of [...old.payloads, ...old.external]) await put(root, url, value);
    await put(root, "/content-packages/independent/manifest.json", { kind: "independent-author-manifest", note: "Keep original bytes" });
    const file = resolve(root, "build/content-packages/independent/kept.bin");
    await writeFile(file, Buffer.from([0, 255, 3, 128]));
    await work(root, old, await snapshot(resolve(root, "build/content-packages")));
  } finally { await rm(root, { recursive: true, force: true }); }
}
function archiver(onCall?: (input: ArchiveInput, index: number) => Promise<void>) {
  const calls: ArchiveInput[] = [];
  const archive: Archive = async input => {
    calls.push(input); await onCall?.(input, calls.length - 1);
    return { packages: ["primary"], reports: [{ kind: "controlled-archive-hook", bytesVerified: false }] };
  };
  return { calls, archive };
}
function options(root: string, candidate: Bundle, archive: Archive, name = "pipeline-test"): Options {
  return { root, compiledDir, reportPath: "build/reports/" + name + ".json",
    compile: async () => ({ payloads: candidate.payloads, reports: [{ kind: "controlled-package-compile" }] }), archive };
}
async function failed(run: Promise<Result>, published: boolean, expected: RegExp): Promise<void> {
  let caught: unknown;
  try { await run; } catch (error) { caught = error; }
  assert.ok(caught instanceof Error, "A failed publication must reject, not return a passing result");
  assert.match(caught.message, expected);
  const report = (caught as Error & { report?: Result }).report;
  assert.ok(report, "Failure must expose its actual publication boundary");
  assert.equal(report.result, "failed"); assert.equal(report.published, published);
}
function deferred() {
  let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test("a later compiled producer failure keeps the entire previous registry byte-for-byte", async () => {
  await withRoot(async (root, _, before) => {
    const next = await bundle("new"), hook = archiver(), input = options(root, next, hook.archive);
    input.compile = async () => {
      const firstProducer = structuredClone(next.payloads);
      assert.ok(firstProducer.has(primaryURL));
      throw new Error("Second compiled producer rejected its source dependencies");
    };
    await failed(publish(input), false, /Second compiled producer/);
    assert.deepEqual(await snapshot(resolve(root, "build/content-packages")), before);
    assert.equal(hook.calls.length, 0, "Failed compilation cannot reach either closure archive");
  });
});

test("real Repository validation rejects absent pins, changed hashes and unvisited map identity faults before publication", async () => {
  for (const fault of ["missing-battle", "changed-hash", "missing-unvisited-map", "map-id", "map-parent"] as const) {
    await withRoot(async (root, _, before) => {
      const next = await bundle("new"), hook = archiver();
      if (fault === "missing-battle") next.payloads.delete(battleURL);
      else if (fault === "changed-hash") next.payloads.set(next.refs.world.url, { ...next.world, limitations: ["Unsealed change"] });
      else if (fault === "missing-unvisited-map") await rm(resolve(root, "build", next.world.maps[next.future.mapId]!.url.slice(1)));
      else {
        const future = await seal({ ...next.future, ...(fault === "map-id"
          ? { mapId: next.future.mapId + 100 } : { parentSourceSetHash: "different-controlled-parent" }) });
        const world = await seal({ ...next.world, maps: { ...next.world.maps,
          [next.future.mapId]: { ...next.world.maps[next.future.mapId]!, contentHash: future.contentHash } } });
        const entry = await seal({ ...next.entry, worldCatalogHash: world.contentHash });
        next.refs.world.contentHash = world.contentHash; next.refs.source!.entry.contentHash = entry.contentHash;
        next.payloads.set(next.refs.world.url, world); next.payloads.set(next.refs.source!.entry.url, entry);
        await put(root, next.world.maps[next.future.mapId]!.url, future);
      }
      await failed(publish(options(root, next, hook.archive)), false, /hash|identity|source|payload|ENOENT|missing|declared/i);
      assert.deepEqual(await snapshot(resolve(root, "build/content-packages")), before, fault);
      assert.equal(hook.calls.length, 0, fault);
    });
  }
});

test("two validated packages publish together from candidate dependencies and preserve independent namespaces", async () => {
  await withRoot(async (root, old, before) => {
    const next = await bundle("new", true), live = await realpath(resolve(root, "build/content-packages"));
    assert.notEqual(next.battle.contentHash, old.battle.contentHash);
    const hook = archiver(async (input, index) => {
      if (index === 0) {
        assert.notEqual(input.packageDirectory, live);
        assert.deepEqual(await snapshot(live), before, "Candidate archive precedes all live writes");
        const refs = JSON.parse(await readFile(resolve(input.packageDirectory, "derived.json"), "utf8")) as GameContentRefsV1;
        const repo = new GameContentRepository(async url => JSON.parse(await readFile(url.startsWith("/content-packages/")
          ? resolve(input.packageDirectory, url.slice("/content-packages/".length))
          : resolve(root, "build", url.slice(1)), "utf8")), refs.profile, refs);
        const loaded = await repo.sourceNewGame();
        assert.equal(loaded.battle.contentHash, next.battle.contentHash, "Derived entry must not read the old ordinary battle");
      }
    });
    const result = await publish(options(root, next, hook.archive));
    assert.equal(result.result, "passed"); assert.equal(result.published, true); assert.ok(result.stages.length);
    assert.equal(hook.calls.length, 3);
    assert.equal(hook.calls[1]!.packageDirectory, live); assert.equal(hook.calls[2]!.packageDirectory, live);
    const after = await snapshot(live);
    for (const [url, value] of next.payloads) assert.deepEqual(after.get(url.slice("/content-packages/".length)), raw(value));
    for (const [file, value] of before) if (file.startsWith("independent/")) assert.deepEqual(after.get(file), value);
  });
});

test("one root build lock rejects a concurrent publisher before it compiles or archives", async () => {
  await withRoot(async (root, _, before) => {
    const next = await bundle("new"), gate = deferred(), begun = deferred(), firstHook = archiver();
    const firstInput = options(root, next, firstHook.archive, "first");
    firstInput.compile = async () => { begun.resolve(); await gate.promise; return { payloads: next.payloads }; };
    const first = publish(firstInput); await begun.promise;
    let secondCompiles = 0; const secondHook = archiver(), secondInput = options(root, next, secondHook.archive, "second");
    secondInput.reportPath = firstInput.reportPath;
    const runningReport = await readFile(resolve(root, firstInput.reportPath));
    secondInput.compile = async () => { secondCompiles++; return { payloads: next.payloads }; };
    try {
      await failed(publish(secondInput), false, /lock|already|running|progress/i);
      assert.equal(secondCompiles, 0); assert.equal(secondHook.calls.length, 0);
      assert.deepEqual(await snapshot(resolve(root, "build/content-packages")), before);
      assert.deepEqual(await readFile(resolve(root, firstInput.reportPath)), runningReport, "A refused publisher cannot overwrite the active report");
    } finally { gate.resolve(); }
    assert.equal((await first).published, true);
  });
});

test("an external indexed JSON change after preparation invalidates the candidate before live publication", async () => {
  await withRoot(async (root, _, before) => {
    const next = await bundle("new"), url = next.world.maps[next.future.mapId]!.url;
    const hook = archiver(async (_, index) => {
      if (index === 0) await put(root, url, await seal({ ...next.future, name: "Late valid but different external version" }));
    });
    await failed(publish(options(root, next, hook.archive)), false, /chang|stale|digest|hash|identity/i);
    assert.equal(hook.calls.length, 2);
    assert.deepEqual(await snapshot(resolve(root, "build/content-packages")), before);
  });
});

test("a post-publication archive failure reports published and never rolls the installed packages back", async () => {
  await withRoot(async (root, _, before) => {
    const next = await bundle("new", true), hook = archiver(async (_, index) => {
      if (index === 2) throw new Error("Published closure archive failed");
    });
    const input = options(root, next, hook.archive);
    await failed(publish(input), true, /Published closure archive failed/);
    assert.equal(hook.calls.length, 3);
    const after = await snapshot(resolve(root, "build/content-packages"));
    assert.notDeepEqual(after, before);
    for (const [url, value] of next.payloads) assert.deepEqual(after.get(url.slice("/content-packages/".length)), raw(value));
    const persisted = JSON.parse(await readFile(resolve(root, input.reportPath), "utf8")) as Result;
    assert.equal(persisted.result, "failed"); assert.equal(persisted.published, true);
  });
});
