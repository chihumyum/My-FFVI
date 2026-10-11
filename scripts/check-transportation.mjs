// Source tables, pinned prelude scripts and controlled identity lifecycle.
// Neither these probes nor the checkpoint proof admit complete vehicle events.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>",
);
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) =>
  import(pathToFileURL(resolve(compiled, "src", name)).href);
const { readSnapshot, snapshotFile } = await module("compiler/integrity.js");
const { battleTableIndex } = await module("compiler/battle.js");
const { loadCorpus } = await module("compiler/corpus.js");
const { compileTransportationCatalog, compileNarsheTransportationCheckpoint } =
  await module("compiler/transportation.js");
const { Transportations } = await module("core/transportation.js");
const { compileBattleConditionCatalog } = await module(
  "compiler/conditions.js",
);
const { compileFieldConditionCatalog } = await module(
  "compiler/field-conditions.js",
);
const { FieldConditions } = await module("core/field-conditions.js");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const reportPath = root + "build/reports/transportation-check.json";
await rm(reportPath, { force: true });
execFileSync(
  process.execPath,
  [root + "scripts/check-transportation-native.mjs"],
  { cwd: root, stdio: "pipe" },
);
const nativeBytes = await readFile(
  root + "build/reports/transportation-native-check.json",
);
const native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const imported = await readSnapshot(root + "build/import");
const project = JSON.parse(snapshotFile(imported, "project.json"));
const tables = JSON.parse(snapshotFile(imported, "tables.json"));
const battle = JSON.parse(
  snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"),
);
assert.equal(battle.parentSourceSetHash, project.sourceSetHash);
assert.equal(
  project.sources.find((s) => s.file === "GameAssembly.dll")?.sha256,
  native.nativeSha256,
);
const corpus = await loadCorpus(root);
assert.equal(corpus.manifest.parentSourceSetHash, project.sourceSetHash);
for (const original of project.sources)
  assert.ok(
    corpus.manifest.sources.some(
      (s) =>
        s.file === original.file &&
        s.sha256 === original.sha256 &&
        s.bytes === original.bytes,
    ),
    original.file,
  );
const index = battleTableIndex(tables, battle.tableSources);
const source = compileTransportationCatalog(
  index,
  tables["transportation.csv"].map((r) => Number(r.id)),
);
const model = new Transportations(source.catalog);
const expected = [
  [1, 1, 0, 900],
  [2, 2, 33, 901],
  [3, 9, 34, 902],
  [4, 8, 36, 903],
  [5, 8, 37, 904],
  [6, 12, 38, 905],
  [7, 8, 35, 906],
  [8, 8, 47, 907],
];
assert.deepEqual(
  source.catalog.definitions.map((r) => [
    r.id,
    r.type,
    r.assetId,
    r.releaseFlag,
  ]),
  expected,
);
assert.deepEqual(source.catalog.newGame, {
  mapId: 609,
  entrance: 1,
  scriptId: 1,
  transportationId: 1,
});
const cases = [];
function check(name, body) {
  body();
  cases.push({ name, pass: true });
}
const allEnabled = Object.fromEntries(expected.map(([id]) => [id, true]));
check("new game resolves ID1 with only player release enabled", () => {
  assert.deepEqual(model.newGameIdentity(), { id: 1, type: 1, assetId: 0 });
  assert.deepEqual(
    model.newGameAvailability(),
    Object.fromEntries(expected.map(([id]) => [id, id === 1])),
  );
});
for (const [id, type, assetId, flag] of expected) {
  check(`source identity ${id} has independent type and asset`, () =>
    assert.deepEqual(model.identity(id), { id, type, assetId }),
  );
  check(`source identity ${id} release flag is in TreasureFlag4`, () =>
    assert.deepEqual(model.releaseFlagRef(id), {
      category: "TreasureFlag4",
      index: flag - 768,
    }),
  );
  check(`existing source identity ${id} survives PointIn load ID1`, () => {
    const next = model.projectMapEntry({
      currentId: id,
      loadId: 1,
      mapId: 3,
      stayMapIds: {},
      availability: allEnabled,
    });
    assert.equal(next.currentId, id);
    assert.equal(next.currentType, type);
  });
  check(`known disabled source identity ${id} cannot replace current`, () => {
    const next = model.projectChange(1, id, { [id]: false });
    assert.equal(next.currentId, 1);
    assert.equal(next.selected, false);
  });
  check(`source identity ${id} restore is data detached`, () => {
    const restored = model.restoreIdentity(id);
    restored.id = 999;
    assert.equal(model.restoreIdentity(id).id, id);
  });
}
check("new controller restores armor without a parked-map assumption", () => {
  assert.equal(
    model.projectMapEntry({
      currentId: null,
      loadId: 6,
      mapId: 3,
      stayMapIds: {},
      availability: { 6: true },
    }).currentId,
    6,
  );
});
for (const id of [2, 3, 4, 5, 7, 8])
  check(`parked symbol ${id} only restores on its actual map`, () => {
    const input = {
      currentId: null,
      loadId: id,
      mapId: 3,
      stayMapIds: { [id]: 3 },
      availability: allEnabled,
    };
    assert.equal(model.projectMapEntry(input).currentId, id);
    assert.equal(
      model.projectMapEntry({ ...input, stayMapIds: { [id]: 20 } }).currentId,
      1,
    );
    assert.throws(
      () => model.projectMapEntry({ ...input, stayMapIds: {} }),
      /Unknown.*stay map/,
    );
  });
check(
  "source auto-selection does not infer available armor or ship from appearance",
  () => assert.equal(model.selectForMap(1, allEnabled).id, 1),
);
check("unknown flag cannot enable a transport", () =>
  assert.throws(() => model.projectChange(1, 6, {}), /Unknown.*availability/),
);
check("missing or forged identity is rejected", () => {
  for (const id of [0, 38, 999, null])
    assert.throws(() => model.restoreIdentity(id));
});
const checkpoint = compileNarsheTransportationCheckpoint(
  source.catalog,
  corpus.assets,
);
check(
  "prelude proves boarded checkpoint6 and view0 independently from new-game1",
  () => {
    assert.deepEqual(checkpoint.identity, { id: 6, type: 12, assetId: 38 });
    assert.equal(checkpoint.viewType, 0);
    assert.deepEqual(checkpoint.knownReleaseFlags, [
      { ref: { category: "TreasureFlag4", index: 137 }, value: 1 },
    ]);
    assert.equal(checkpoint.scripts.length, 3);
    for (const dependency of checkpoint.scripts)
      assert.equal(typeof dependency.source.objectId, "string");
  },
);
const selectedScripts = corpus.assets.filter((a) =>
  checkpoint.scripts.some((s) => s.source.assetPath === a.source.assetPath),
);
check("checkpoint needs every unique prior script", () => {
  assert.throws(
    () =>
      compileNarsheTransportationCheckpoint(
        source.catalog,
        selectedScripts.slice(1),
      ),
    /Missing or ambiguous/,
  );
  assert.throws(
    () =>
      compileNarsheTransportationCheckpoint(source.catalog, [
        ...selectedScripts,
        selectedScripts[0],
      ]),
    /Missing or ambiguous/,
  );
});
check("any prelude instruction mutation requires review", () => {
  const changed = structuredClone(selectedScripts);
  changed[0].data.Mnemonics[1].mnemonic = "unproven";
  assert.throws(
    () => compileNarsheTransportationCheckpoint(source.catalog, changed),
    /needs review/,
  );
});
check("checkpoint never accepts rounded numeric Unity object identity", () => {
  const changed = structuredClone(selectedScripts);
  changed[0].source.objectId = Number(changed[0].source.objectId);
  assert.throws(
    () => compileNarsheTransportationCheckpoint(source.catalog, changed),
    /needs review/,
  );
});
const battleConditions = compileBattleConditionCatalog(
  index,
  tables["condition.csv"].map((r) => Number(r.id)),
  (key) => key,
);
const fieldSource = compileFieldConditionCatalog(
  index,
  battleConditions.catalog,
  expected.map(([id]) => id),
);
const field = new FieldConditions(fieldSource.catalog);
check(
  "proven armor checkpoint skips field poison while actual walking takes poison",
  () => {
    const members = [
      {
        id: "controlled-source-member",
        hp: 320,
        maxHp: 320,
        conditionIds: [10],
      },
    ];
    assert.equal(
      field.projectStep(members, checkpoint.identity.id).members[0].hp,
      320,
    );
    assert.equal(
      field.projectStep(members, model.newGameIdentity().id).members[0].hp,
      310,
    );
  },
);
const report = {
  kind: "source-transportation-check",
  sourceSetHash: project.sourceSetHash,
  corpusSourceSetHash: corpus.sourceSetHash,
  nativeReportSha256: sha(nativeBytes),
  nativeSemanticsVerified: false,
  catalog: source.catalog,
  sources: source.sources,
  checkpoint,
  controlledProbes: cases.length,
  cases,
  limitations: [
    "The pinned prelude supplies this development checkpoint's identity; it is not a migrated opening cinematic or all transportation events.",
    "Vehicle placement, availability writes, collision/media switching and full native save format are not admitted by this checker.",
    "Controlled field poison linkage is distinct from live browser and original runtime parity.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    ok: true,
    report: reportPath,
    identities: expected.length,
    controlledProbes: cases.length,
    checkpointIdentity: checkpoint.identity.id,
    nativeSemanticsVerified: false,
  }),
);
