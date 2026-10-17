import assert from "node:assert/strict";
import test from "node:test";
import { encounterContent } from "../src/core/battle-content.js";
import { assessBattleHandoff, LEGACY_DEVELOPMENT_HANDOFF_POLICY, parseBattleHandoffContent,
  parseBattleHandoffPolicy, type BattleHandoffContent, type BattleHandoffProfile,
  type BattleHandoffSourceRef, type FrameworkBattleHandoffPolicy } from "../src/core/battle-handoff-content.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const policy = (): FrameworkBattleHandoffPolicy => ({ kind: "framework-battle-handoff-v1", id: "controlled-handoff",
  audio: "retain-field", introduction: "omit" });
const row = (id: number, table: string): BattleHandoffSourceRef => ({ file: "synthetic.bundle", serializedFile: "synthetic",
  objectId: "90071992547409937", assetPath: "synthetic/" + table, rowId: String(id) });
const content = (encounterId = 901): BattleHandoffContent => ({ kind: "battle-handoff-content-v1", policy: policy(), source: {
  encounterId, row: row(encounterId, "monster_party.csv"),
  metadata: { backgroundId: 21, bgmId: 31, appearanceProduction: 1, notEscape: 2 },
  dependencies: [{ table: "monster_party.csv", id: encounterId, binding: "bound", source: row(encounterId, "monster_party.csv") },
    { table: "battle_background_asset.csv", id: 21, binding: "bound", source: row(21, "battle_background_asset.csv") },
    { table: "battle_bgm_asset.csv", id: 31, binding: "bound", source: row(31, "battle_bgm_asset.csv") }],
} });

test("handoff preserves source metadata, decimal identities and dependency bindings without aliasing inputs", () => {
  const original = content(), before = structuredClone(original), parsed = parseBattleHandoffContent(original, 901);
  assert.deepEqual(parsed, original); assert.equal(parsed.source.row.objectId, "90071992547409937");
  assert.deepEqual(parseBattleHandoffContent(JSON.parse(JSON.stringify(parsed))), parsed);
  parsed.source.row.objectId = "8"; parsed.source.dependencies[0]!.source!.file = "changed";
  parsed.source.metadata.bgmId = 99; parsed.policy!.id = "changed";
  assert.deepEqual(original, before);
});

test("only the explicit field-audio retention and omitted-introduction development rule parses", () => {
  for (const raw of [null, {}, { ...policy(), kind: "source" }, { ...policy(), audio: "battle" },
    { ...policy(), introduction: "native" }, { ...policy(), id: "" }, { ...policy(), id: " bad " },
    { ...policy(), escape: true }, { ...policy(), providerReady: true }]) assert.throws(() => parseBattleHandoffPolicy(raw));
  let reads = 0;
  const getter = { ...policy() };
  Object.defineProperty(getter, "audio", { enumerable: true, get: () => { reads++; return "retain-field"; } });
  assert.throws(() => parseBattleHandoffPolicy(getter), /fields/); assert.equal(reads, 0);
  const symbol = { ...policy(), [Symbol("hidden")]: true };
  assert.throws(() => parseBattleHandoffPolicy(symbol), /fields/);
});

test("positive source music references require their own bound row even when development audio is retained", () => {
  const missing = content(); missing.source.dependencies.pop();
  assert.throws(() => parseBattleHandoffContent(missing), /dependency closure/);
  const wrong = content(); wrong.source.dependencies[2]!.source!.rowId = "32";
  assert.throws(() => parseBattleHandoffContent(wrong), /row identity/);
  const duplicate = content(); duplicate.source.dependencies[2] = structuredClone(duplicate.source.dependencies[1]!);
  assert.throws(() => parseBattleHandoffContent(duplicate), /dependency closure/);
  const noMusic = content(); noMusic.source.metadata.bgmId = 0; noMusic.source.dependencies.pop();
  assert.equal(parseBattleHandoffContent(noMusic).source.metadata.bgmId, 0);
  const extra = content(); extra.source.metadata.bgmId = 0;
  assert.throws(() => parseBattleHandoffContent(extra), /dependency closure/);
});

test("identity substitutions, sparse arrays and rounded Unity IDs cannot hide in a handoff declaration", () => {
  const badRow = content(); badRow.source.dependencies[0]!.source!.file = "foreign.bundle";
  assert.throws(() => parseBattleHandoffContent(badRow), /dependency closure/);
  assert.throws(() => parseBattleHandoffContent(content(), 902), /encounter identity/);
  for (const value of [90071992547409937, "1e6", "9223372036854775808", "-9223372036854775809", "01", "-0"]) {
    const invalid = content() as unknown as { source: { row: { objectId: unknown } } };
    invalid.source.row.objectId = value;
    assert.throws(() => parseBattleHandoffContent(invalid), /object identity/);
  }
  const sparse = content(); delete sparse.source.dependencies[1];
  assert.throws(() => parseBattleHandoffContent(sparse), /dependency array|Sparse/);
  let reads = 0; const accessor = content();
  Object.defineProperty(accessor.source.dependencies[2], "source", { enumerable: true, get: () => { reads++; return row(31, "battle_bgm_asset.csv"); } });
  assert.throws(() => parseBattleHandoffContent(accessor), /fields/); assert.equal(reads, 0);
});

test("only explicitly unresolved music may retain a positive source reference without fabricated row provenance", () => {
  const declaration = content();
  declaration.source.dependencies[2] = { table: "battle_bgm_asset.csv", id: 31, binding: "unresolved", source: null,
    reason: "The verified synthetic source table has no row 31" };
  const parsed = parseBattleHandoffContent(declaration);
  assert.equal(parsed.source.metadata.bgmId, 31);
  assert.equal(parsed.source.dependencies[2]!.source, null);
  assert.equal(assessBattleHandoff(parsed, "framework").status, "ready");
  assert.equal(assessBattleHandoff(parsed, "source").status, "blocked");
  for (const table of ["monster_party.csv", "battle_background_asset.csv"] as const) {
    const invalid = content(); invalid.source.dependencies[0] = { table, id: table === "monster_party.csv" ? 901 : 21,
      binding: "unresolved", source: null, reason: "missing" };
    assert.throws(() => parseBattleHandoffContent(invalid), /unresolved/);
  }
  const noReason = structuredClone(declaration);
  (noReason.source.dependencies[2] as { reason: string }).reason = " ";
  assert.throws(() => parseBattleHandoffContent(noReason), /unresolved/);
  const alias = content(); alias.source.dependencies[2]!.source!.assetPath = "synthetic/bgm_asset.csv";
  assert.throws(() => parseBattleHandoffContent(alias), /source table mismatch/);
});

test("source handoff remains blocked even when an explicit development policy describes ready host work", () => {
  for (const value of [undefined, content(), { ...content(), policy: null }]) {
    const result = assessBattleHandoff(value, "source");
    assert.equal(result.status, "blocked"); assert.ok(result.requirements.includes("native-source-handoff-contract"));
    assert.equal(Object.hasOwn(result, "policy"), false);
  }
  const unsupported = content(); unsupported.source.metadata.appearanceProduction = 27;
  assert.equal(assessBattleHandoff(unsupported, "source").status, "blocked", "Unknown source metadata is preserved, not admitted");
});

test("framework requires content authorization while trusted legacy origin selects a fixed detached compatibility rule", () => {
  assert.equal(assessBattleHandoff(undefined, "framework").status, "blocked");
  assert.equal(assessBattleHandoff({ ...content(), policy: null }, "framework").status, "blocked");
  assert.equal(assessBattleHandoff({ ...content(), policy: null }, "development-checkpoint").status, "blocked");
  const framework = assessBattleHandoff(content(), "framework");
  assert.equal(framework.status, "ready");
  if (framework.status === "ready") assert.deepEqual(framework.policy, policy());
  const legacy = assessBattleHandoff(undefined, "development-checkpoint");
  assert.equal(legacy.status, "ready");
  if (legacy.status === "ready") {
    assert.deepEqual(legacy.policy, LEGACY_DEVELOPMENT_HANDOFF_POLICY);
    legacy.policy.id = "modified"; legacy.requirements.length = 0;
  }
  assert.equal(LEGACY_DEVELOPMENT_HANDOFF_POLICY.id, "legacy-development-checkpoint-v1");
  assert.throws(() => assessBattleHandoff(undefined, "narshe-playability-v35" as BattleHandoffProfile), /profile/);
});

test("encounter selection parses handoff bindings, rejects shared defaults and preserves legacy absence", () => {
  const f = checkpointFixture(), id = Number(Object.keys(f.battle.encounters)[0]);
  assert.equal(Object.hasOwn(encounterContent(f.battle, id)!, "handoff"), false);
  f.battle.encounters[id]!.handoff = content(id);
  const projected = encounterContent(f.battle, id)!;
  assert.deepEqual(projected.handoff, content(id)); projected.handoff!.policy!.id = "changed";
  assert.deepEqual(f.battle.encounters[id]!.handoff, content(id));
  f.battle.encounters[id]!.handoff = content(id + 1);
  assert.throws(() => encounterContent(f.battle, id), /encounter identity/);
  (f.battle.common as unknown as Record<string, unknown>).handoff = content(id);
  assert.throws(() => encounterContent(f.battle, id), /must belong to an encounter/);
});
