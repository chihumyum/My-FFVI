import test from "node:test";
import assert from "node:assert/strict";
import { observeBattleMonsters, recordBattleMonsters, bestiaryRecords } from "./bestiary.js";

test("bestiary retains revealed replacements and excludes unseen hidden combatants", () => {
  const first = { monsterId: 1, hp: 10 },
    hidden = { monsterId: 2, hp: 10, hidden: true },
    battle = { context: {}, banks: {}, enemies: [first, hidden] };
  observeBattleMonsters(battle);
  first.hp = 0;
  const replacement = { monsterId: 3, hp: 20 };
  battle.enemies = [replacement];
  observeBattleMonsters(battle);
  replacement.hp = 0;
  recordBattleMonsters(battle);
  assert.deepEqual(battle.banks.PlaySystems.monsterRecords, {
    1: { seen: 1, defeated: 1 },
    3: { seen: 1, defeated: 1 },
  });
});

test("old-save book reconstruction is read-only and excludes failed encounters", () => {
  const game = {
      battles: [
        { encounterId: 1, outcome: "victory" },
        { encounterId: 2, outcome: "escape" },
      ],
    },
    data = { parties: { 1: { members: [{ monsterId: 5 }] }, 2: { members: [{ monsterId: 6 }] } } };
  const before = structuredClone(game);
  assert.deepEqual(Object.keys(bestiaryRecords(game, data)), ["5"]);
  assert.deepEqual(game, before);
});

test("new observations keep the old-save prefix without revealing hidden current enemies", () => {
  const game = {
      banks: {
        PlaySystems: {
          monsterRecordsLegacyCount: 1,
          monsterRecords: { 6: { seen: 1, defeated: 1 } },
        },
      },
      battles: [
        { encounterId: 1, outcome: "victory" },
        { encounterId: 2, outcome: "victory" },
      ],
    },
    data = {
      parties: {
        1: { members: [{ monsterId: 5 }] },
        2: { members: [{ monsterId: 6 }, { monsterId: 7 }] },
      },
    };
  assert.deepEqual(Object.keys(bestiaryRecords(game, data)), ["5", "6"]);
});
