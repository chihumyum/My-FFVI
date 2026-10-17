import assert from "node:assert/strict";
import { GameSession } from "../../src/core/game-session.js";
import { NewGameFieldEntry } from "../../src/core/new-game-field-entry.js";
import { createNewGame } from "../../src/core/new-game.js";
import type { GameCheckpoint } from "../../src/core/game-session.js";
import type { FieldAbilityCatalog } from "../../src/core/field-abilities.js";
import type { BattleAbilityCatalog } from "../../src/core/battle-abilities.js";
import { compileBattleHandoffContent } from "../../src/compiler/battle-handoff.js";
import { battleTableIndex } from "../../src/compiler/battle.js";
import { sealBatchContent } from "./content-batch.js";
import { sourceNewGameFixture } from "./source-new-game.js";
import { magicStoneGrowthFixture } from "./magic-stones.js";
import { cyclingAI } from "./battle-ai.js";

/** Entirely authored stones, growth and combat on the controlled new-game
 * initializer/factory. Both enabled owners are declared in that initializer;
 * native state is never patched onto a development checkpoint. */
export function magicStonesSessionFixture() {
  const f = sourceNewGameFixture(), growth = magicStoneGrowthFixture(), owner = f.battle.gameState;
  const firstId = f.battle.common.players[0]!.id, secondId = "authored-stone-owner-3";
  const playerIds = [firstId, secondId] as const, stoneIds = [901, 902, 903, 904] as const;
  const templates = [structuredClone(growth.template), structuredClone(growth.template)];
  templates[1]!.initial.sourceId = 3; templates[1]!.equipmentCharacter.sourceId = 3;
  templates[1]!.nameKey = "AUTHORED_SECOND_OWNER"; templates[1]!.nameTag = "AUTHORED_SECOND_OWNER";
  templates[1]!.initial.name = "Authored second owner";
  for (const template of templates) template.initial.abilities.commandIds.push(100);
  const initial = owner.sourceNewGame!;
  initial.characters = playerIds.map((id, index) => ({ id, template: templates[index]! }));
  initial.party.slots[0][1] = { id: secondId, row: "front" };
  for (const template of templates)
    initial.equipment.characters[template.initial.sourceId] = structuredClone(template.equipmentCharacter);
  const fresh = createNewGame(initial);
  owner.initialParty = structuredClone(fresh.owned.party); owner.initialGil = fresh.owned.gil;
  owner.initialItems = structuredClone(fresh.owned.items);
  owner.characterInitializations = Object.fromEntries(playerIds.map((id, index) => [id, structuredClone(templates[index]!)]));
  owner.equipment = Object.fromEntries(fresh.owned.roster.map(member => [member.id, [...member.equipment]]));
  owner.rosterLifecycle.initial = Object.fromEntries(fresh.owned.roster.map(member => [member.id, {
    ownedId: member.ownedId, jobId: member.jobId, additionalLevel: member.additionalLevel,
    magicStoneId: member.magicStoneId, ownedJobs: structuredClone(member.ownedJobs),
  }]));
  owner.equipmentSystem!.catalog = structuredClone(initial.equipment);
  owner.equipmentSystem!.initialStock = structuredClone(fresh.owned.equipmentStock);
  owner.equipmentSystem!.contexts = Object.fromEntries(playerIds.map((id, index) => [id, structuredClone(templates[index]!.parameterContext)]));
  owner.magicStones = structuredClone(growth.catalog);
  owner.characterGrowth = Object.fromEntries(playerIds.map((id, index) => {
    const plan = structuredClone(growth.plan);
    plan.sourceId = templates[index]!.initial.sourceId;
    plan.initialAbilities = structuredClone(templates[index]!.initial.abilities);
    plan.commands.push({ id: 100, abilityTypes: [] });
    return [id, plan];
  }));
  owner.partyActors!.characterAssets.push({ id: 9093, sourceId: 3, jobId: 12, fieldAssetId: 3 });
  f.battle.common.players = fresh.owned.roster.map((member, index) => ({
    ...structuredClone(f.battle.common.players[0]!), ...templates[index]!.confirmed,
    id: member.id, sourceId: member.sourceId, name: member.name,
    level: member.level, exp: member.exp, hp: member.hp, mp: member.mp,
    conditionIds: [...member.conditionIds], commands: [...member.abilities.commandIds],
  }));
  const command = (id: number, types: number[], direct = false): BattleAbilityCatalog["commands"][number] => ({
    id, nameKey: "authored-command-" + id, type: 1, listType: direct ? 0 : 3,
    executionType: direct ? 1 : 2, abilityId: direct ? 10 : 0, contentId: null, abilityTypes: types,
    releaseType: 0, releaseValues: [0, 0], forbiddenConditionIds: [], blockers: [],
  });
  const commands = [command(100, [], true), command(7, [1, 2]), command(31, [1, 2]),
    ...growth.plan.initialAbilities.commandIds.map(id => command(id,
      growth.plan.commands.find(entry => entry.id === id)?.abilityTypes ?? []))];
  f.battle.common.battleAbilities = {
    kind: "battle-abilities-v1", characters: templates.map(template => ({ sourceId: template.initial.sourceId,
      jobId: template.initial.jobId, blockers: [] })), commands,
    abilities: [{ id: 10, typeId: 3, groupId: 1, range: 3 },
      ...growth.plan.abilities.map(ability => ({ id: ability.id, typeId: ability.typeId, groupId: ability.groupId, range: 3 }))],
    conditions: f.battle.common.conditions.rules.definitions.map(({ id, type }) => ({ id, type })),
  };
  f.battle.common.qualificationContext = { mode: "source", conditionContext: "current", battleType: 0,
    magicLearningValue: null, invalidContentIds: [], itemMenuAvailable: null };
  f.battle.common.commands[100] = { id: 100, name: "Authored attack", kind: "ability", abilityIds: [10],
    forbiddenConditionIds: [], referencedAbility: null };
  f.battle.common.commands[7] = { id: 7, name: "Authored ordinary magic", kind: "ability", abilityIds: [102],
    forbiddenConditionIds: [], referencedAbility: null };
  f.battle.common.abilities[10]!.cost = 0;
  f.battle.common.abilities[102] = { ...structuredClone(f.battle.common.abilities[10]!), id: 102,
    name: "Authored learned field spell", cost: 5 };
  f.battle.common.abilities[102]!.program.abilityId = 102;
  const spell: FieldAbilityCatalog = {
    kind: "field-abilities-v1", rules: { kind: "field-ability-rules-v1", profile: "framework",
      random: { kind: "web-field-random-v1", seed: 0x72f6c0de } }, commands: structuredClone(commands),
    abilities: { 102: { id: 102, contentId: 606, name: "Authored learned field healing", typeId: 1,
      menuFunctionGroupId: 70002, menuRange: 6, cost: 5, power: 12,
      program: { groupId: 70002, range: 6,
        functions: [{ slot: 1, functionId: 1, type: 1, series: 0, values: [2, 2, 0] }],
        process: { key: "None", values: [0, 0, 0] }, forbiddenConditionIds: [], contentFlags: [1, 2] },
      plan: { kind: "field-ability-plan-v1", modes: ["single", "all"],
        effects: [{ slot: 1, kind: "recovery", resource: "hp", calculation: "magic" }],
        magic: { accuracy: 255, contentFlags: [1, 2], forceDefense: false, elements: [] } }, blockers: [] } },
  };
  owner.fieldAbilities = spell;
  owner.fieldConditions = {
    definitions: f.battle.common.conditions.rules.definitions.map(({ id, type }) => ({ id, type })),
    behaviors: f.battle.common.conditions.rules.definitions.map(({ id }) => ({ id, kind: "none" })),
    dying: structuredClone(f.battle.common.conditions.dying),
    transportations: initial.transportation.definitions.map(({ id, type }) => ({ id, type })),
  };
  owner.partyActors!.conditionTypes = Object.fromEntries(f.battle.common.conditions.rules.definitions.map(({ id, type }) => [id, type]));
  f.battle.common.battleEntry = { kind: "battle-entry-v1", maps: [{ id: f.map.mapId, sleepingAvailability: 1, movingAvailability: 1 }],
    sleepingContents: [], movingContents: [], transportationContents: [], beastFieldContents: [],
    encounterExclusions: "constant-absent", changeEquipmentSlots: [1, 2], characterItemRestrictions: "empty-source-provider",
    items: [
      ...Object.values(owner.equipmentSystem!.catalog.definitions).map(gear => ({ id: gear.id,
        type: gear.kind === "weapon" ? 2 as const : 3 as const, listType: gear.empty ? 2 : 1,
        throwFlag: 0, battleFunctionGroupId: 0 })),
      { id: 701, type: 1, listType: 1, throwFlag: 0, battleFunctionGroupId: 1 },
    ] };
  const encounter = Object.values(f.battle.encounters)[0]!;
  encounter.enemies = [encounter.enemies[0]!];
  Object.assign(encounter.enemies[0]!, { hp: 10, exp: 100, gil: 7, abilities: [13], ai: cyclingAI([13]) });
  encounter.rewardPolicy = { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 25 };
  encounter.escapePolicy = { kind: "framework-battle-escape-v1", id: "authored-magic-stone-retreat" };
  const tables = { "monster_party.csv": [{ id: String(encounter.encounterId), battle_background_asset_id: "1",
    battle_bgm_asset_id: "0", appearance_production: "0", not_escape: "0" }],
    "battle_background_asset.csv": [{ id: "1", asset_name: encounter.background }] };
  const reader = battleTableIndex(tables, Object.fromEntries(Object.keys(tables).map((table, index) => [table, {
    file: "tests/fixtures/magic-stones-session.ts", assetPath: "controlled/magic-stones/" + table,
    serializedFile: "controlled-magic-stones", objectId: String(90071992547409951n + BigInt(index)),
  }])));
  encounter.handoff = compileBattleHandoffContent(reader, {
    partyId: encounter.encounterId, source: reader.row("monster_party.csv", encounter.encounterId).source,
    patterns: [1, 0, 0, 0, 0, 0], enemies: [], script: null, background: encounter.background,
    metadata: { backgroundId: 1, bgmId: 0, appearanceProduction: 0, notEscape: 0,
      battleFlagGroupId: 0, battleFlags: [], getAp: 0, getValue: 0, scriptId: 0 },
  }, { kind: "framework-battle-handoff-v1", id: "authored-magic-stone-session", audio: "retain-field", introduction: "omit" });
  f.battle.common.initialAtb = { player: [0, 0], enemy: [100, 100] };
  f.map.scripts["stone-battle"] = [{ kind: "encounter", party: encounter.encounterId, continuation: "after-stone-battle",
    script: "stone-battle", index: 0, source: f.source }];
  f.map.scripts["after-stone-battle"] = [{ kind: "exit", script: "after-stone-battle", index: 0, source: f.source }];
  for (const [name, char] of [["stone-battle", "d"], ["after-stone-battle", "e"]])
    f.map.scriptPuppetContexts![name!] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: char!.repeat(64) };
  f.map.walkEncounters = { kind: "framework-walk-encounters-v1", id: "authored-stone-walking",
    minSteps: 1, maxSteps: 1, transportationIds: [1], parties: [{ partyId: encounter.encounterId, weight: 1 }] };
  const profile = { kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
    sourceContentHash: "f".repeat(64), omissions: [] };
  f.map.developmentProfile = structuredClone(profile); f.world.developmentProfile = structuredClone(profile);
  f.content.developmentProfile = structuredClone(profile);
  f.battle = sealBatchContent(f.battle); f.map = sealBatchContent(f.map);
  f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash; f.world = sealBatchContent(f.world);
  f.content.battleCatalogHash = f.battle.contentHash; f.content.mapContentHash = f.map.contentHash;
  f.content.worldCatalogHash = f.world.contentHash; f.content = sealBatchContent(f.content);
  const make = () => {
    const entry = new NewGameFieldEntry(f.content.entry, f.presentation);
    const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
    let fade = start.fade; fade.advance(0.5);
    for (let i = 0; i < 3; i++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
    const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
    const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
    game.advance(10); return game;
  };
  const startBattle = (game: GameSession) => {
    game.field.startEvent("stone-battle"); game.advance(10); assert.ok(game.battle);
    return game.battle;
  };
  const previewVictory = (game: GameSession) => {
    assert.ok(game.battle);
    const battle = game.battle;
    for (let i = 0; battle.phase === "active"; i++) {
      assert.ok(i < 2000, "Authored ordinary battle did not complete");
      for (const actor of battle.ready) battle.command(actor.id, 10, battle.enemies[0]!.id, 100);
      game.advance(10);
    }
    assert.equal(battle.phase, "victory"); return battle.previewVictory()!;
  };
  const win = (game: GameSession) => {
    startBattle(game); const preview = previewVictory(game);
    assert.equal(game.continueVictory(), true); game.advance(10);
    assert.equal(game.checkpointReady, true); return preview;
  };
  const escape = (game: GameSession) => {
    assert.equal(game.field.move("right"), true); game.advance(240);
    assert.ok(game.battle); assert.equal(game.canEscape, true);
    assert.equal(game.requestEscape(), true); game.advance(10); assert.equal(game.battle!.phase, "escaped");
    const result = game.battle!.previewEscape()!;
    assert.equal(game.continueEscape(), true); game.advance(10);
    assert.equal(game.checkpointReady, true); return result;
  };
  return { ...f, playerIds, stoneIds, abilityId: 102, encounterId: encounter.encounterId,
    make, win, startBattle, previewVictory, escape,
    grant: (game: GameSession, id: number, count = 1) => game.state.fieldInventory.prepare({ kind: "grant-magic-stone", id, count }).commit(),
    remove: (game: GameSession, id: number, count = 1) => game.state.fieldInventory.prepare({ kind: "remove-magic-stone", id, count }).commit(),
    restore: (checkpoint: GameCheckpoint) => GameSession.restore(checkpoint, undefined, f.battle,
      { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } }),
  };
}
