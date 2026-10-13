import test from "node:test";
import assert from "node:assert/strict";
import { compileBattleSourceEntry } from "../src/compiler/battle-source-entry.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";

test("shared entry providers do not require a development prelude or seed state", () => {
  const { reader, tables, misc, catalog } = battleEntryFixture();
  const result = compileBattleSourceEntry(reader, tables, misc, "shared", []);
  assert.deepEqual(result.providers.catalog, catalog);
  assert.equal(result.checkpoint, null);
  assert.equal(Object.hasOwn(result.providers, "ownedConditionCheckpoint"), false);
  assert.equal(result.providers.assetSources[0]!.objectId, "9007199254740998");
  assert.throws(() => compileBattleSourceEntry(reader, tables, misc, "development-checkpoint", []),
    /checkpoint script/);
});

test("substituted checkpoint evidence cannot contaminate shared capabilities", () => {
  const { reader, tables, misc } = battleEntryFixture();
  const substituted = [{ ...misc, source: { ...misc.source,
    assetPath: "Assets/GameAssets/Serial/Res/Map/Map_40037/Map_40037/sc_e_0001.json" },
    data: { Mnemonics: [{ mnemonic: "AddCondition", type: 1,
      operands: { iValues: [607, 0, 0, 0, 0, 0, 0, 0] } }] } }];
  const before = structuredClone({ tables, misc, substituted });
  const plain = compileBattleSourceEntry(reader, tables, misc, "shared", []);
  const withUntrustedSeed = compileBattleSourceEntry(reader, tables, misc, "shared", substituted);
  assert.deepEqual(withUntrustedSeed, plain);
  assert.deepEqual({ tables, misc, substituted }, before);
  assert.throws(() => compileBattleSourceEntry(reader, tables, misc, "development-checkpoint", substituted),
    /needs review/);
});

test("independence from checkpoint proofs does not bypass shared source validation", () => {
  const { reader, tables, misc } = battleEntryFixture();
  assert.throws(() => compileBattleSourceEntry(reader, tables, { ...misc, data: {} }, "shared", []),
    /beast-field/);
  tables["game_constant_int.csv"]!.push({ id: "7", key_name: "FOR_ENCOUNTER_CONTENTS_DECISION_1", value1: "10002", value2: "0" });
  assert.throws(() => compileBattleSourceEntry(reader, tables, misc, "shared", []),
    /encounter-content/);
});
