import { sourceNewGameFixture } from "./source-new-game.js";
import { characterLearningFixture } from "./character-learning.js";
import { cyclingAI } from "./battle-ai.js";
import { GameSession } from "../../src/core/game-session.js";
import { NewGameFieldEntry } from "../../src/core/new-game-field-entry.js";
import { createNewGame } from "../../src/core/new-game.js";
import { battleTableIndex } from "../../src/compiler/battle.js";
import { compileBattleHandoffContent } from "../../src/compiler/battle-handoff.js";
import type { BattleAbilityCatalog } from "../../src/core/battle-abilities.js";
import type { DevelopmentProfile } from "../../src/core/development-profile.js";

/** Controlled framework new-game/session host. This authorizes no story
 * acquisition: source8, ability74, the opponent and skill effects are authored
 * test inputs. It uses the source initializer/actor owners with an explicit
 * development handoff, and makes no native handoff or story parity claim. */
export function characterLearningSessionFixture() {
  const f = sourceNewGameFixture(), learning = characterLearningFixture();
  const id = f.battle.common.players[0]!.id;
  const initial = f.battle.gameState.sourceNewGame!;
  initial.characters[0]!.template = structuredClone(learning.template);
  initial.equipment.characters[8] = structuredClone(learning.template.equipmentCharacter);
  const owner = f.battle.gameState;
  owner.characterInitializations![id] = structuredClone(learning.template);
  owner.characterGrowth = { [id]: structuredClone(learning.plan) };
  owner.equipmentSystem!.catalog.characters[8] = structuredClone(learning.template.equipmentCharacter);
  owner.partyActors!.characterAssets.push({ id: 908, sourceId: 8, jobId: 12, fieldAssetId: 2 });
  f.battle.common.players[0]!.sourceId = 8;
  f.battle.common.players[0]!.commands = [100,17];
  f.battle.common.observedLearning = structuredClone(learning.catalog);
  f.battle.common.abilities[142] = { ...structuredClone(f.battle.common.abilities[10]!), id: 142,
    name: "Controlled observed magic", power: 1, cost: 0 };
  f.battle.common.abilities[142]!.program.abilityId = 142;
  f.battle.common.abilities[142]!.program.rules.type_id = 504;
  f.battle.common.commands[17] = { id: 17, name: "Controlled Lore", kind: "ability", abilityIds: [],
    forbiddenConditionIds: [], referencedAbility: null };
  // The direct command is explicitly owned in this synthetic initializer.
  for (const template of [initial.characters[0]!.template, owner.characterInitializations![id]!])
    template.initial.abilities.commandIds.push(100);
  owner.characterGrowth[id]!.initialAbilities.commandIds.push(100);
  owner.characterGrowth[id]!.commands.push({ id: 100, abilityTypes: [] });
  const commands: BattleAbilityCatalog["commands"] = [
    { id: 100, nameKey: "direct", type: 1, listType: 0, executionType: 1, abilityId: 10,
      contentId: null, abilityTypes: [], releaseType: 0, releaseValues: [0,0], forbiddenConditionIds: [], blockers: [] },
    { id: 17, nameKey: "lore", type: 1, listType: 3, executionType: 2, abilityId: 0,
      contentId: null, abilityTypes: [504], releaseType: 0, releaseValues: [0,0], forbiddenConditionIds: [], blockers: [] },
  ];
  // Initial command lists can contain already known noncombat commands; keep
  // their entries explicit while only the two test commands can execute.
  for (const commandId of learning.plan.initialAbilities.commandIds.filter((c) => c !== 17)) {
    commands.push({ ...structuredClone(commands[1]!), id: commandId, blockers: ["Controlled fixture excludes this command"] });
    f.battle.common.commands[commandId] = { ...f.battle.common.commands[17]!, id: commandId };
  }
  f.battle.common.battleAbilities = { kind: "battle-abilities-v1", characters: [{ sourceId: 8, jobId: 12, blockers: [] }], commands,
    abilities: [{ id: 10, typeId: 3, groupId: 1, range: 3 },
      ...learning.plan.abilities.map((a) => ({ id: a.id, typeId: a.typeId, groupId: a.groupId, range: 3 }))],
    conditions: f.battle.common.conditions.rules.definitions.map(({ id, type }) => ({ id, type })) };
  f.battle.common.qualificationContext = { mode: "source", conditionContext: "current", battleType: 0,
    magicLearningValue: null, invalidContentIds: [], itemMenuAvailable: null };
  f.battle.common.battleEntry = { kind: "battle-entry-v1",
    maps: [{ id: f.map.mapId, sleepingAvailability: 1, movingAvailability: 0 }],
    sleepingContents: [], movingContents: [], transportationContents: [], beastFieldContents: [],
    encounterExclusions: "constant-absent", changeEquipmentSlots: [1, 2],
    characterItemRestrictions: "empty-source-provider",
    items: [
      ...Object.values(owner.equipmentSystem!.catalog.definitions).map((gear) => ({ id: gear.id,
        type: (gear.kind === "weapon" ? 2 : 3) as 2 | 3, listType: gear.empty ? 2 : 1,
        throwFlag: 0, battleFunctionGroupId: 0 })),
      { id: 701, type: 1, listType: 1, throwFlag: 0, battleFunctionGroupId: 1 },
    ] };
  owner.fieldConditions = {
    definitions: structuredClone(f.battle.common.conditions.rules.definitions),
    behaviors: f.battle.common.conditions.rules.definitions.filter((row) => [4,5,6,9,607].includes(row.type))
      .map(({ id }) => ({ id, kind: "none" })),
    dying: { conditionId: f.battle.common.conditions.rules.definitions.find((row) => row.type === 4)!.id,
      thresholdDivisor: 8 },
    transportations: initial.transportation.definitions.map(({ id, type }) => ({ id, type })),
  };
  const encounter = Object.values(f.battle.encounters)[0]!;
  // Bind the handoff to actual authored rows in this fixture, never invented
  // original-game provenance or a default policy inferred from catalog names.
  const handoffTables = {
    "monster_party.csv": [{ id: String(encounter.encounterId), battle_background_asset_id: "1",
      battle_bgm_asset_id: "0", appearance_production: "0", not_escape: "0" }],
    "battle_background_asset.csv": [{ id: "1", asset_name: encounter.background }],
  };
  const handoffReader = battleTableIndex(handoffTables, Object.fromEntries(
    Object.keys(handoffTables).map((table, index) => [table, {
      file: "tests/fixtures/character-learning-session.ts", serializedFile: "controlled-character-learning",
      objectId: String(90071992547409937n + BigInt(index)), assetPath: "controlled/character-learning/" + table,
    }])));
  encounter.handoff = compileBattleHandoffContent(handoffReader, {
    partyId: encounter.encounterId, source: handoffReader.row("monster_party.csv", encounter.encounterId).source,
    patterns: [1, 0, 0, 0, 0, 0], enemies: [], script: null, background: encounter.background,
    metadata: { backgroundId: 1, bgmId: 0, appearanceProduction: 0, notEscape: 0,
      battleFlagGroupId: 0, battleFlags: [], getAp: 0, getValue: 0, scriptId: 0 },
  }, { kind: "framework-battle-handoff-v1", id: "controlled-character-learning",
    audio: "retain-field", introduction: "omit" });
  encounter.enemies = [encounter.enemies[0]!];
  encounter.enemies[0]!.abilities = [142];
  encounter.enemies[0]!.ai = cyclingAI([142]);
  f.battle.common.initialAtb.enemy = [100,100];
  f.battle.common.abilities[10]!.cost = 0;
  f.map.scripts.learning = [
    { kind: "encounter", party: encounter.encounterId, continuation: "after-learning", script: "learning", index: 0, source: f.source },
    { kind: "exit", script: "learning", index: 1, source: f.source },
  ];
  f.map.scriptPuppetContexts!.learning = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "d".repeat(64) };
  f.map.scripts["after-learning"] = [{ kind: "exit", script: "after-learning", index: 0, source: f.source }];
  f.map.scriptPuppetContexts!["after-learning"] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "e".repeat(64) };
  const profile: DevelopmentProfile = { kind: "framework-development-v1",
    policy: "omit-anonymous-environment-particles-v1", sourceContentHash: "f".repeat(64), omissions: [] };
  f.content.developmentProfile = structuredClone(profile);
  f.world.developmentProfile = structuredClone(profile);
  f.map.developmentProfile = structuredClone(profile);
  f.content.contentHash = "controlled-character-learning-framework";
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
  let fade = start.fade; fade.advance(0.5);
  for (let i = 0; i < 3; i++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
  const make = () => {
    const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
    const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
    game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
    return game;
  };
  return { ...f, learning, id, make, plan: createNewGame(initial), handoffTables, handoffReader };
}
