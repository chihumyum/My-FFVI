import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCorpus,
  instructionFamily,
  type CorpusAsset,
} from "../src/compiler/corpus.js";
const sha = "a".repeat(64);
const op = (
  mnemonic: string,
  iValues: number[] = [],
  sValues: string[] = [],
) => ({
  mnemonic,
  type: 1,
  operands: { iValues, rValues: [], sValues },
});
const asset = (
  path: string,
  kind: CorpusAsset["kind"],
  data: unknown,
  bundle = "fixture.bundle",
): CorpusAsset => ({
  id: bundle + "::" + path,
  kind,
  data,
  source: {
    file: bundle,
    assetPath: path,
    objectId: "9127841932506724402",
    serializedFile: "synthetic",
    sha256: sha,
  },
});
const script = (name: string, ops: unknown[], bundle = "fixture.bundle") =>
  asset(
    `Assets/Fixture/Room/${name}.json`,
    "script",
    { Mnemonics: ops },
    bundle,
  );
function fixture() {
  const assets = [
    asset("Assets/Fixture/package.json", "map-package", {
      asset_group_name: "fixture",
      map: [
        {
          name: "Room",
          script: [
            { asset: "Room/start", name: "start" },
            { asset: "Room/after", name: "after" },
          ],
        },
      ],
    }),
    script("start", [op("Encount", [3], ["after"])]),
    script("after", [op("Exit")]),
  ];
  const tables = {
    "map.csv": [
      { id: "1", asset_name: "fixture", map_name: "Room", area_id: "1" },
    ],
  };
  return { assets, tables };
}
test("shared capability grouping does not create a task for each coordinate; syscalls remain separate", () => {
  assert.equal(
    instructionFamily(op("Move", [0, 2, 0])),
    instructionFamily(op("Move", [1, 8, 2])),
  );
  assert.notEqual(
    instructionFamily(op("SysCall", [], ["party"])),
    instructionFamily(op("SysCall", [], ["camera"])),
  );
});
test("package-scoped references do not choose a same-named script from another bundle", () => {
  const { assets, tables } = fixture();
  assets.push(script("after", [op("Mystery")], "unrelated.bundle"));
  const r = analyzeCorpus(assets, tables, {}, sha);
  assert.equal(r.counts.mappedRecords, 1);
  assert.equal(r.dependencies[0]!.resolved, true);
  assert.deepEqual(r.dependencies[0]!.candidates, [assets[2]!.id]);
  assert.equal(r.counts.decodedOnlyFieldScripts, 2);
  assert.equal(
    r.scripts.find((s) => s.id === assets[3]!.id)!.domain,
    "not-assessed-by-field-runtime",
  );
  assert.equal(r.maps[0]!.status, "not-playable-certified");
});
test("missing continuations and invalid targets remain visible while SE decode remains distinct from runtime admission", () => {
  const { assets, tables } = fixture();
  assets[1] = script("start", [
    op("Call", [999]),
    op("Encount", [3], ["missing"]),
    {
      mnemonic: "PlaySE", type: 1,
      operands: {
        iValues: [102, 0, 0, 0, 0, 0, 0, 0],
        rValues: Array(8).fill(0), sValues: Array(8).fill(""),
      },
    },
    op("Jump", [999]),
    op("Branch", [0, 1, 999], ["ScenarioFlag1", "＝", "imm"]),
  ]);
  const r = analyzeCorpus(assets, tables, {}, sha);
  assert.equal(r.counts.unresolvedReferences, 4);
  assert.equal(r.maps[0]!.unresolvedReferences.length, 4);
  const sound = r.priorities.find((p) => p.id === "PlaySE")!;
  assert.equal(sound.decodedSites, 1);
  assert.equal(sound.omittedSites, 0);
  assert.deepEqual(sound.blockedMaps, []);
  assert.equal(r.maps[0]!.status, "not-playable-certified");
});
test("source instructions requiring missing operands are retained as decoder gaps, not discarded", () => {
  const { assets, tables } = fixture();
  assets[1] = script("start", [{ mnemonic: "Jump", type: 1 }]);
  const r = analyzeCorpus(assets, tables, {}, sha);
  assert.equal(r.counts.instructions, 2);
  assert.deepEqual(r.maps[0]!.blockers, ["Jump"]);
  assert.equal(r.priorities.find((p) => p.id === "Jump")!.blockedSites, 1);
});
test("map binding ambiguity, instruction domains and determinism survive corpus ordering", () => {
  const { assets, tables } = fixture();
  const original = analyzeCorpus(assets, tables, {}, sha);
  assert.equal(
    analyzeCorpus([...assets].reverse(), tables, {}, sha).contentHash,
    original.contentHash,
  );
  assert.throws(
    () => analyzeCorpus([...assets, assets[1]!], tables, {}, sha),
    /Duplicate corpus/,
  );
  assets.push({
    ...assets[0]!,
    id: "duplicate-package",
    source: { ...assets[0]!.source, file: "other" },
  });
  const bad = analyzeCorpus(assets, tables, {}, sha);
  assert.equal(bad.counts.mappedRecords, 0);
  assert.deepEqual(bad.maps[0]!.issues, ["map-package:ambiguous"]);
});

test("Resident script dependencies are evaluated in each map's alias scope", () => {
  const { assets, tables } = fixture();
  assets[0] = asset("Assets/Fixture/package.json", "map-package", {
    asset_group_name: "fixture",
    map: [
      { name: "Room", script: [{ name: "start", asset: "Room/start" }] },
      {
        name: "Other",
        script: [
          { name: "start", asset: "Room/start" },
          { name: "shared", asset: "Room/after" },
        ],
      },
    ],
  });
  assets[1] = script("start", [op("ChangeScript", [], ["shared"])]);
  const shared = asset(
    "Assets/Shared/Resident/shared.json",
    "script",
    { Mnemonics: [op("UnreviewedSharedInstruction")] },
    "resident.bundle",
  );
  assets.push(
    asset(
      "Assets/Shared/package.json",
      "map-package",
      {
        asset_group_name: "map_script",
        map: [
          {
            name: "Resident",
            script: [{ name: "shared", asset: "Resident/shared" }],
          },
        ],
      },
      "resident.bundle",
    ),
    shared,
  );
  tables["map.csv"].push({
    id: "2",
    asset_name: "fixture",
    map_name: "Other",
    area_id: "1",
  });
  const report = analyzeCorpus(assets, tables, {}, sha);
  assert.deepEqual(report.scripts.find((s) => s.id === shared.id)!.maps, ["1"]);
  assert.ok(report.maps[0]!.blockers.includes("UnreviewedSharedInstruction"));
  assert.ok(!report.maps[1]!.blockers.includes("UnreviewedSharedInstruction"));
  assert.deepEqual(
    report.dependencies
      .filter((d) => d.kind === "script")
      .map((d) => [d.mapId, d.candidates]),
    [
      ["1", [shared.id]],
      ["2", [assets[2]!.id]],
    ],
  );
});
