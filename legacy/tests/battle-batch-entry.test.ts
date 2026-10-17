import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleBatchEntryPolicy, parseBattleBatchEntryPolicy } from "../src/compiler/battle-batch-entry.js";
import { hash } from "../src/compiler/content.js";
import type { SourceBattleEncounter } from "../src/compiler/battle-encounters.js";

function fixture() {
  const source = { assetPath: "Synthetic/ordinary.json", file: "synthetic.bundle", objectId: "9007199254740993",
    serializedFile: "Synthetic", sha256: "a".repeat(64), sourceSetHash: "b".repeat(64), battleSourceSetHash: "c".repeat(64) };
  const encounter: Pick<SourceBattleEncounter, "patterns" | "metadata" | "script"> = {
    patterns: [1, 1, 0, 1, 1, 0], script: { source, data: { Mnemonics: [{ mnemonic: "Unimplemented" }] } },
    metadata: { scriptId: 20, battleFlagGroupId: 10,
      battleFlags: [{ values: { id: "5", group_id: "10", battle_flag_id: "14" }, source: { ...source, rowId: "5" } }],
      backgroundId: 1, bgmId: 0, appearanceProduction: 1, notEscape: 0, getAp: 0, getValue: 1 },
  };
  const policy = { kind: "framework-battle-batch-entry-v1", id: "synthetic-entry",
    formations: { kind: "framework-battle-formations-v1", id: "synthetic-normal", weights: [1, 0, 0, 0, 0, 0] },
    scripts: [{ id: 20, sourceHash: hash(encounter.script), reason: "Authored ordinary turns omit this source script." }],
    flagGroups: [{ id: 10, sourceHash: hash(encounter.metadata.battleFlags), reason: "Source flags remain unavailable." }],
  };
  return { encounter, policy };
}

test("batch entry binds all shared source scripts and flags without mutating their data", () => {
  const { encounter, policy } = fixture(), original = structuredClone(encounter);
  const resolved = compileBattleBatchEntryPolicy(policy, [encounter, structuredClone(encounter)]);
  assert.deepEqual(resolved.scripts[0]?.source, encounter.script!.source);
  assert.deepEqual(resolved.flagGroups[0]?.rows, encounter.metadata.battleFlags);
  resolved.flagGroups[0]!.rows[0]!.values.battle_flag_id = "99";
  assert.deepEqual(encounter, original);
  assert.equal(resolved.formations?.weights[1], 0);
});

test("changed script body or flag identity rejects the whole development entry", () => {
  const { encounter, policy } = fixture();
  const changed = structuredClone(encounter);
  changed.script!.data = { Mnemonics: [] };
  assert.throws(() => compileBattleBatchEntryPolicy(policy, [encounter, changed]), /conflicting.*script/);
  changed.script = structuredClone(encounter.script);
  changed.metadata.battleFlags[0]!.source.objectId = "9007199254740994";
  assert.throws(() => compileBattleBatchEntryPolicy(policy, [encounter, changed]), /conflicting.*flag group/);
});

test("unused, missing or duplicate omissions cannot be granted by a batch declaration", () => {
  const { encounter, policy } = fixture();
  assert.throws(() => compileBattleBatchEntryPolicy(policy, []), /Missing/);
  const missing = structuredClone(encounter); missing.script = null;
  assert.throws(() => compileBattleBatchEntryPolicy(policy, [missing]), /Missing/);
  const unused = structuredClone(policy); unused.flagGroups[0]!.id = 11;
  assert.throws(() => compileBattleBatchEntryPolicy(unused, [encounter]), /Missing/);
  const duplicate = structuredClone(policy); duplicate.scripts.push(duplicate.scripts[0]!);
  assert.throws(() => parseBattleBatchEntryPolicy(duplicate), /Duplicate/);
});

test("unsupported formation weights and unknown policy fields remain blocked", () => {
  const { encounter, policy } = fixture();
  policy.formations.weights[1] = 1;
  assert.throws(() => parseBattleBatchEntryPolicy(policy), /Unsupported positive/);
  policy.formations.weights[1] = 0;
  assert.throws(() => parseBattleBatchEntryPolicy({ ...policy, permission: "source" }));
  encounter.patterns = [0, 1, 0, 0, 0, 0];
  assert.throws(() => compileBattleBatchEntryPolicy(policy, [encounter]), /intersection/);
});
