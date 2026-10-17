import test from "node:test";
import assert from "node:assert/strict";
import type { BattleCatalog, BattleEncounter } from "../src/core/battle-content.js";
import { createBattleFormationPlan } from "../src/core/battle-formations.js";
import type { DevelopmentProfile } from "../src/core/development-profile.js";
import { GameSession } from "../src/core/game-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { assertSourceGameCatalog, sourceCatalogProfile } from "../src/core/source-catalog.js";
import { sourceNewGameFixture, reservedFlag } from "./fixtures/source-new-game.js";

function frameworkProfile(): DevelopmentProfile {
  return { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: "a".repeat(64), omissions: [] };
}

function firstEncounter(catalog: BattleCatalog): BattleEncounter {
  return Object.values(catalog.encounters)[0]!;
}

function prepareTitle(f: ReturnType<typeof sourceNewGameFixture>) {
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" });
  start.commit();
  let fade = start.fade;
  fade.advance(0.5);
  for (const phase of ["scene-loading", "scene-activated", "field-preparing"] as const) {
    const next = entry.prepareResume(fade, true);
    assert.ok(next); next.commit(); fade = next.fade;
    assert.equal(entry.phase, phase);
  }
  return { entry, fade };
}

function finishedSourceGame() {
  const f = sourceNewGameFixture(), { entry, fade } = prepareTitle(f);
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
  const world = { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } };
  return { f, game, world, saved: game.checkpoint() };
}

test("source composition and legacy opening remain independent; 607 definitions remain available", () => {
  const f = sourceNewGameFixture(), before = { battle: structuredClone(f.battle),
    developmentBattle: structuredClone(f.developmentBattle) };
  assertSourceGameCatalog(f.battle);
  assert.equal(Object.hasOwn(f.battle.gameState, "initialOwnedConditions"), false);
  assert.deepEqual(f.battle.common.players[0]!.conditionIds, []);
  assert.equal(f.battle.common.conditions.rules.definitions.find((row) => row.id === 9007)?.type, 607);
  assert.deepEqual(f.developmentBattle.common.players[0]!.conditionIds, [9007]);
  assert.deepEqual(f.developmentBattle.gameState.initialOwnedConditions,
    [{ id: f.plan.owned.roster[0]!.id, conditionIds: [9007] }]);
  assert.notEqual(f.battle.contentHash, f.developmentBattle.contentHash);
  assert.deepEqual(f.battle, before.battle); assert.deepEqual(f.developmentBattle, before.developmentBattle);
});

test("an owned-condition seed property is forbidden even when empty or undefined and explicitly framework", () => {
  for (const seed of [[], undefined, [{ id: "1", conditionIds: [9007] }]]) {
    for (const profile of ["source", "framework"] as const) {
      const catalog = sourceNewGameFixture().battle;
      Object.assign(catalog.gameState, { initialOwnedConditions: seed });
      const before = structuredClone(catalog);
      assert.throws(() => assertSourceGameCatalog(catalog, profile), /owned-condition seed/);
      assert.deepEqual(catalog, before);
    }
  }
});

test("initial shared player identity and resources must match the source initializer", () => {
  const changes: [string, (catalog: BattleCatalog) => void][] = [
    ["owner", (catalog) => { catalog.common.players[0]!.id = "different-owner"; }],
    ["source", (catalog) => { catalog.common.players[0]!.sourceId++; }],
    ["side", (catalog) => { catalog.common.players[0]!.side = "enemy"; }],
    ["name", (catalog) => { catalog.common.players[0]!.name += " changed"; }],
    ["level", (catalog) => { catalog.common.players[0]!.level++; }],
    ["EXP", (catalog) => { catalog.common.players[0]!.exp++; }],
    ["HP", (catalog) => { catalog.common.players[0]!.hp--; }],
    ["MP", (catalog) => { catalog.common.players[0]!.mp++; }],
    ["condition seed", (catalog) => { catalog.common.players[0]!.conditionIds = [9007]; }],
    ["missing player", (catalog) => { catalog.common.players.length = 0; }],
    ["extra player", (catalog) => { catalog.common.players.push(structuredClone(catalog.common.players[0]!)); }],
    ["sparse player", (catalog) => { delete catalog.common.players[0]; }],
  ];
  for (const [label, change] of changes) {
    const catalog = sourceNewGameFixture().battle;
    change(catalog); const before = structuredClone(catalog);
    assert.throws(() => assertSourceGameCatalog(catalog), /initial player/, label);
    assert.throws(() => assertSourceGameCatalog(catalog, "framework"), /initial player/, label);
    assert.deepEqual(catalog, before, label);
  }
});

test("missing initializer and an unknown catalog profile cannot silently select compatibility", () => {
  const catalog = sourceNewGameFixture().battle;
  delete catalog.gameState.sourceNewGame;
  assert.throws(() => assertSourceGameCatalog(catalog), /source new-game initializer/);
  assert.throws(() => assertSourceGameCatalog(sourceNewGameFixture().battle, "opening" as "source"), /Unknown.*profile/);
});

test("framework authority comes from a valid explicit field declaration", () => {
  assert.equal(sourceCatalogProfile(undefined), "source");
  assert.equal(sourceCatalogProfile(frameworkProfile()), "framework");
  for (const change of [
    { kind: "opening-development" }, { policy: "allow-unknown" },
    { sourceContentHash: "controlled" }, { omissions: undefined }, { transportation: "native" },
  ]) {
    assert.throws(() => sourceCatalogProfile({ ...frameworkProfile(), ...change } as DevelopmentProfile),
      /development profile mismatch/);
  }
  assert.throws(() => sourceCatalogProfile(null as unknown as DevelopmentProfile), /development profile mismatch/);
});

test("strict source admission rejects deliberate formation, escape and lifecycle omission policies", () => {
  const changes: [RegExp, (catalog: BattleCatalog) => void][] = [
    [/formation/, (catalog) => {
      const encounter = firstEncounter(catalog); encounter.formation = null;
      encounter.formationPlan = createBattleFormationPlan([1, 1, 0, 0, 0, 0], {
        kind: "framework-battle-formations-v1", id: "ordinary-only", weights: [1, 0, 0, 0, 0, 0],
      });
    }],
    [/escape/, (catalog) => { firstEncounter(catalog).escapePolicy = {
      kind: "framework-battle-escape-v1", id: "controlled-retreat" }; }],
    [/lifecycle/, (catalog) => { firstEncounter(catalog).lifecycle = {
      kind: "battle-lifecycle-v1", mode: "development-omission", scriptId: 8123,
      source: { sourceSetHash: "a".repeat(64), battleSourceSetHash: "b".repeat(64), sha256: "c".repeat(64),
        file: "synthetic", serializedFile: "synthetic", objectId: "8123", assetPath: "synthetic" },
      reason: "Controlled omission" }; }],
    [/omission diagnostics/, (catalog) => { catalog.encounterDiagnostics = [{ partyId: 7,
      kind: "development-omission", code: "OMITTED", reason: "Controlled omission", source: null }]; }],
    [/omission diagnostics/, (catalog) => { catalog.encounterReport = {
      requested: 1, compiledDefinitions: 1, blocked: 0, withRuntimeDependencies: 0,
      withDevelopmentOmissions: 1, originalGameExecuted: false, entries: [],
    }; }],
  ];
  for (const [reason, change] of changes) {
    const catalog = sourceNewGameFixture().battle;
    change(catalog); const before = structuredClone(catalog);
    assert.throws(() => assertSourceGameCatalog(catalog), reason);
    assertSourceGameCatalog(catalog, "framework");
    assert.deepEqual(catalog, before);
  }
});

test("an unvisited unsupported encounter is a diagnostic rather than development policy", () => {
  const catalog = sourceNewGameFixture().battle;
  catalog.encounterDiagnostics = [{ partyId: 999, kind: "blocked", code: "UNKNOWN_SOURCE",
    reason: "Unvisited source consumer", source: null }, { partyId: 7, kind: "runtime-dependency",
    code: "CONDITIONAL_PARTY", reason: "Current owned party is needed", source: null }];
  assertSourceGameCatalog(catalog);
});

test("encounter policies cannot become common defaults in either profile", () => {
  for (const key of ["escapePolicy", "lifecycle", "rewardPolicy", "participants", "playerParticipants", "formationPlan"]) {
    const catalog = sourceNewGameFixture().battle;
    Object.assign(catalog.common, { [key]: undefined });
    for (const profile of ["source", "framework"] as const)
      assert.throws(() => assertSourceGameCatalog(catalog, profile), /misplaced/, key);
  }
});

test("direct source preparation applies the shared assertion before publishing any new owned or actor state", () => {
  for (const profile of [undefined, frameworkProfile()]) {
    const f = sourceNewGameFixture(), { fade } = prepareTitle(f);
    if (profile) {
      f.content.developmentProfile = profile;
      f.world.developmentProfile = structuredClone(profile);
      f.map.developmentProfile = structuredClone(profile);
    }
    Object.assign(f.battle.gameState, { initialOwnedConditions: [] });
    const before = { battle: structuredClone(f.battle), fade: fade.snapshot(), content: structuredClone(f.content) };
    assert.throws(() => GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation),
      /owned-condition seed/);
    assert.deepEqual(f.battle, before.battle); assert.deepEqual(fade.snapshot(), before.fade);
    assert.deepEqual(f.content, before.content);
  }
  const f = sourceNewGameFixture(), { fade } = prepareTitle(f);
  f.battle.common.players[0]!.conditionIds = [9007];
  assert.throws(() => GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation),
    /initial player seed/);
});

test("source-origin restore repeats source catalog admission and retains the original live session on failure", () => {
  const { f, game, saved, world } = finishedSourceGame();
  for (const change of ["owned-seed", "player-seed", "escape"] as const) {
    const battle = structuredClone(f.battle);
    if (change === "owned-seed") Object.assign(battle.gameState, { initialOwnedConditions: [] });
    if (change === "player-seed") battle.common.players[0]!.conditionIds = [9007];
    if (change === "escape") firstEncounter(battle).escapePolicy = {
      kind: "framework-battle-escape-v1", id: "controlled-retreat" };
    const before = structuredClone(battle);
    assert.throws(() => GameSession.restore(saved, undefined, battle, world),
      /owned-condition seed|initial player seed|development escape/);
    assert.deepEqual(battle, before); assert.deepEqual(game.checkpoint(), saved);
  }
});

test("a source save cannot be automatically relabelled to an independently built catalog", () => {
  const { f, game, saved, world } = finishedSourceGame();
  const battle = structuredClone(f.battle); battle.contentHash = f.developmentBattle.contentHash;
  assert.throws(() => GameSession.restore(saved, undefined, battle, world), /source\/version mismatch/);
  const alienSource = structuredClone(world); alienSource.source.content.contentHash = "other-source-entry";
  assert.throws(() => GameSession.restore(saved, undefined, f.battle, alienSource), /trusted native/);
  assert.deepEqual(game.checkpoint(), saved);
});

test("607 gained through a real owned condition event remains held source state across save and restore", () => {
  const f = sourceNewGameFixture(), { entry, fade } = prepareTitle(f);
  f.battle.gameState.partyActors!.conditionTypes[9007] = 607;
  f.battle.gameState.partyActors!.viewpointOffsets = [{ fieldAssetId: 2, x: 3, y: 16 }];
  f.map.scriptSystemFlags = { reserved: { keepBadStatusVisual: false } };
  f.map.scripts.reserved = [{ kind: "owned-condition", script: "reserved", index: 0, source: f.source,
    command: { kind: "add-condition", conditionType: 607, target: 0 }, dependencies: [] },
  { kind: "flag", ref: reservedFlag, operation: "set", script: "reserved", index: 1, source: f.source },
  { kind: "wait", seconds: 0, script: "reserved", index: 2, source: f.source },
  { kind: "exit", script: "reserved", index: 3, source: f.source }];
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
  const saved = game.checkpoint(), before = structuredClone(f.battle);
  assert.deepEqual(saved.owned.roster[0]!.conditionIds, [9007]);
  assert.deepEqual(f.battle.common.players[0]!.conditionIds, []);
  const restored = GameSession.restore(saved, undefined, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } });
  assert.deepEqual(restored.state.snapshot().roster[0]!.conditionIds, [9007]);
  assert.equal(restored.field.eventState.read(reservedFlag), 1);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.deepEqual(f.battle, before);
});
