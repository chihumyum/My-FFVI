import test from "node:test";
import assert from "node:assert/strict";
import { compilePlayerVisibilityFactory } from "../src/compiler/player-visibility.js";
import { projectPlayerVisibility } from "../src/core/player-visibility.js";

const sources = () => [
  { file: "GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" },
  { file: "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle",
    sha256: "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa" },
];
test("source factory admission binds both the recovered executable and exact player prefab bundle", () => {
  const input = sources(), before = structuredClone(input), factory = compilePlayerVisibilityFactory(input);
  assert.equal(factory.factory, "native-field-player-v1");
  assert.deepEqual(factory.capability, { childEntityObject: "absent" });
  assert.deepEqual(factory.sources, input);
  assert.deepEqual(input, before);
  input[0]!.sha256 = "changed";
  assert.deepEqual(factory.sources, before);
  const plan = projectPlayerVisibility({ kind: "hide-player" },
    { ...factory.capability, playerId: "native-factory:actual-player", partyPlayerId: "native-factory:actual-player" }, new Set());
  assert.deepEqual([...plan.hiddenEntities], ["native-factory:actual-player"]);
});
test("unreviewed source or ambiguous manifest never grants child absence", () => {
  for (const bad of [[], sources().slice(0, 1), [...sources(), sources()[0]!],
    sources().map((source, i) => i === 0 ? { ...source, sha256: "0".repeat(64) } : source),
    sources().map((source, i) => i === 1 ? { ...source, sha256: "0".repeat(64) } : source),
    sources().map((source, i) => i === 1 ? { ...source, file: "another-prefab.bundle" } : source)])
    assert.throws(() => compilePlayerVisibilityFactory(bad), /Unreviewed player factory/);
});
