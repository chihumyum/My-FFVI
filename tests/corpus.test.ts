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
test("missing continuations, invalid instruction targets and omitted audio remain visible", () => {
  const { assets, tables } = fixture();
  assets[1] = script("start", [
    op("Call", [999]),
    op("Encount", [3], ["missing"]),
    op("PlaySE", [102, 0, 0]),
  ]);
  const r = analyzeCorpus(assets, tables, {}, sha);
  assert.equal(r.counts.unresolvedReferences, 2);
  assert.equal(r.maps[0]!.unresolvedReferences.length, 2);
  const sound = r.priorities.find((p) => p.id === "PlaySE")!;
  assert.equal(sound.decodedSites, 0);
  assert.equal(sound.omittedSites, 1);
  assert.deepEqual(sound.blockedMaps, ["1"]);
});
test("source instructions without operands are retained as decoder gaps, not discarded", () => {
  const { assets, tables } = fixture();
  assets[1] = script("start", [{ mnemonic: "Nop", type: 1 }]);
  const r = analyzeCorpus(assets, tables, {}, sha);
  assert.equal(r.counts.instructions, 2);
  assert.deepEqual(r.maps[0]!.blockers, ["Nop"]);
  assert.equal(r.priorities.find((p) => p.id === "Nop")!.blockedSites, 1);
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
