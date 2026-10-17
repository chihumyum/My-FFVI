import { battleTableIndex } from "../../src/compiler/battle.js";
import type { BattleEncounterRuntimeInput } from "../../src/compiler/battle-encounter-runtime.js";
import type { SourceBattleEncounter } from "../../src/compiler/battle-encounters.js";
import { aiSource } from "./battle-ai.js";
import { fixture as battleFixture } from "./battle-content.js";

/** Authored source-shaped records; no original table rows or game text. */
export function encounterRuntimeFixture() {
  const source = { file: "synthetic.bundle", serializedFile: "synthetic", objectId: "90071992547409937" };
  const rowSource = (table: string, id: number) => ({ ...source, assetPath: "synthetic/" + table, rowId: String(id) });
  const aiIdentity = { ...source, assetPath: "synthetic/ai.json", sourceSetHash: "s".repeat(64),
    battleSourceSetHash: "b".repeat(64), sha256: "a".repeat(64) };
  const monster = (id: number): Record<string, string> => ({
    id: String(id), mes_id_name: "SYNTHETIC_ENEMY", lv: "2", hp: "35", mp: "9", ability_attack: "12",
    vitality: "20", attack: "11", defense: "12", ability_defense: "13", agility: "14", weight: "0",
    evasion_rate: "0", magic_evasion_rate: "0", accuracy_rate: "100", critical_rate: "0", exp: "8", gill: "7",
    attack_attribute: "0", attack_plus: "0", attack_plus_grop: "0", resistance_condition: "0",
    resistance_attribute: "0", initial_condition: "0", drop_rate: "0",
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [
      [`drop_content_id${i + 1}`, "0"], [`drop_content_id${i + 1}_value`, "0"],
    ]).flat()),
  });
  const tables: Record<string, Record<string, string>[]> = {
    "monster.csv": [monster(9101), monster(9102)],
    "game_constant_int.csv": Array.from({ length: 8 }, (_, i) => ({ id: String(i + 1),
      key_name: `MONSTER_DROP_RATE_${i + 1}`, value1: i === 0 ? "100" : "0" })),
    "attribute_group.csv": [], "content.csv": [], "item.csv": [],
  };
  const reader = () => battleTableIndex(tables,
    Object.fromEntries(Object.keys(tables).map((table) => [table, { ...source, assetPath: "synthetic/" + table }])));
  const rawAI = aiSource([["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [13]],
    ["EndTable"], ["JumpBattleAI", [0]]]);
  const encounter = (partyId: number, monsterId = 9101): SourceBattleEncounter => ({
    partyId, source: rowSource("monster_party.csv", partyId), patterns: [1, 0, 0, 0, 0, 0],
    background: "synthetic-background", script: null,
    metadata: { backgroundId: 1, bgmId: 0, appearanceProduction: 0, notEscape: 0,
      getAp: 0, getValue: 0, scriptId: 0, battleFlagGroupId: 0, battleFlags: [] },
    enemies: [{ slot: 5, monsterId, group: 1, x: 12, y: -8, sprite: "synthetic-enemy", aiAbilityIds: [13],
      ai: { source: { ...aiIdentity }, data: structuredClone(rawAI) } }],
  });
  const zero = { hp: 0, mp: 0, magic: 0, vitality: 0, attack: 0, defense: 0,
    magicDefense: 0, agility: 0, weight: 0, evasion: 0, magicEvasion: 0 };
  const battle = battleFixture();
  const input: BattleEncounterRuntimeInput = {
    requestedPartyIds: [9201, 9202], encounters: [encounter(9201), encounter(9202, 9102)], sourceDiagnostics: [],
    abilities: battle.abilities, conditions: battle.conditions,
    sprites: { "synthetic-background": { file: "/synthetic/bg.png", width: 32, height: 16 },
      "synthetic-enemy": { file: "/synthetic/enemy.png", width: 4, height: 8 } },
    name: (key) => { if (key !== "SYNTHETIC_ENEMY") throw new Error("Missing synthetic name"); return "Synthetic enemy"; },
    parameters: { temporary: zero, limits: { hp: 9999, mp: 999, magic: 128, naturalMagic: 128, vitality: 128,
      attack: 255, defense: 255, magicDefense: 255, agility: 128, evasion: 255, magicEvasion: 255,
      evasionPercent: 100, magicEvasionPercent: 100 } },
    physical: { temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 },
      limits: { attack: 255, strength: 128, accuracy: 255, criticalRate: 100, criticalPercent: 100 } },
    development: { scripts: [], flagGroups: [] },
  };
  return { input, tables, reader, encounter, rowSource, aiIdentity, battle };
}
