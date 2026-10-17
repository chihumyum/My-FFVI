import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContentBatchManifest, planContentBatch } from "../src/compiler/content-batch.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { contentBatchProgramFixture } from "./fixtures/content-batch-program.js";
import { sealBatchContent } from "./fixtures/content-batch.js";

type Program = NonNullable<ContentBatchManifest["routes"][number]["battleInputs"]>[number];
const compiled = resolve(dirname(fileURLToPath(import.meta.url)), ".."), root = process.cwd();
const driver = await import(pathToFileURL(resolve(root, "scripts/content-batch-route.mjs")).href);
const runContentBatchRoute = driver.runContentBatchRoute;
function singleTarget(rule: Program["rules"][number]) {
  assert.ok("id" in rule.target); return rule.target;
}

function fixture(healing: "item" | "ability" = "item") {
  const f = contentBatchProgramFixture(), battle = f.packages.battle;
  battle.common.commands[101] = { id: 101, name: "Synthetic item command", kind: "item", abilityIds: [],
    forbiddenConditionIds: [], referencedAbility: null };
  for (const player of battle.common.players) player.commands.push(101);
  f.packages.battle = sealBatchContent(battle);
  const route = f.manifest.routes[0]!;
  route.battleAbilityIds = [];
  route.battleInputs = [1000, 1001].map(encounterId => ({ encounterId, rules: [
    { actor: { id: "a", sourceId: 1 }, commandId: healing === "item" ? 101 : 100,
      action: healing === "item" ? { kind: "item" as const, itemId: 10 } : { kind: "ability" as const, abilityId: 11 },
      target: { id: "b", sourceId: 2, ended: "skip" as const },
      when: { kind: "target-resource-below" as const, resource: "hp" as const, percent: 99 },
      ...(healing === "item" ? { minimumItemCount: 1 } : { minimumActorMp: 2 }) },
    ...[{ id: "a", sourceId: 1 }, { id: "b", sourceId: 2 }].map(actor => ({ actor, commandId: 100,
      action: { kind: "ability" as const, abilityId: 10 },
      target: { id: "enemy:5", sourceId: 9101, ended: "skip" as const }, when: { kind: "target-alive" as const } })),
  ] }));
  return f;
}

async function execute(f: ReturnType<typeof fixture>) {
  const plan = planContentBatch(f.manifest, f.packages), { entry, battle, catalog, maps } = f.packages;
  const files = new Map<string, unknown>([["/game/content.json", entry], ["/game/battle.json", battle],
    ["/framework/world/catalog.json", catalog], ...maps.map(map => [catalog.maps[map.mapId]!.url, map] as [string, unknown])]);
  const repository = new GameContentRepository(async url => {
    assert.ok(files.has(url), "Unprovided synthetic battle input content: " + url); return files.get(url);
  }, "framework");
  return await runContentBatchRoute({ root, compiled, plan, routeId: plan.manifest.routes[0]!.id, repository,
    runtimeHash: "a".repeat(64), captureFinalState: true });
}

test("declared battle input schema preserves exact identity and rejects incomplete or ambiguous gestures", () => {
  const f = fixture(), original = structuredClone(f.manifest);
  assert.deepEqual(ContentBatchManifest.parse(f.manifest), original);
  const invalid = [
    (r: Program["rules"][number]) => { r.actor.sourceId = 0; },
    (r: Program["rules"][number]) => { Object.assign(r.target, { ended: "retarget" }); },
    (r: Program["rules"][number]) => { Object.assign(r.action, { fallbackAbilityId: 10 }); },
    (r: Program["rules"][number]) => { r.minimumActorMp = -1; },
    (r: Program["rules"][number]) => { Object.assign(r.when, { percent: 0 }); },
  ];
  for (const change of invalid) {
    const value = structuredClone(original); change(value.routes[0]!.battleInputs![0]!.rules[0]!);
    assert.throws(() => ContentBatchManifest.parse(value));
  }
  const mixed = structuredClone(original); mixed.routes[0]!.battleAbilityIds = [10];
  assert.throws(() => planContentBatch(mixed, f.packages), /mix/);
  const duplicate = structuredClone(original); duplicate.routes[0]!.battleInputs!.push(duplicate.routes[0]!.battleInputs![0]!);
  assert.throws(() => planContentBatch(duplicate, f.packages), /Duplicate/);
});

test("battle rule order, identity and resource conditions bind dependency identity", () => {
  const f = fixture(), before = planContentBatch(f.manifest, f.packages);
  const changed = structuredClone(f.manifest), rules = changed.routes[0]!.battleInputs![0]!.rules;
  [rules[0], rules[1]] = [rules[1]!, rules[0]!];
  const after = planContentBatch(changed, f.packages);
  assert.notEqual(before.manifestHash, after.manifestHash); assert.notEqual(before.dependencyHash, after.dependencyHash);
  assert.deepEqual(f.manifest.routes[0]!.battleInputs![0]!.rules[0]!.actor, { id: "a", sourceId: 1 });
});

for (const healing of ["item", "ability"] as const)
  test(`continuous declared ${healing} healing and exact attacks use real battle return and restore owners`, async () => {
    const run = await execute(fixture(healing));
    assert.equal(run.receipt.result, "completed", JSON.stringify(run.receipt.boundary));
    assert.deepEqual(run.receipt.completedEncounterIds, [1000, 1001]);
    assert.equal(run.execution.committedStarts, 2); assert.equal(run.execution.committedReturns, 2);
    assert.equal(run.execution.duplicateReturnsRejected, 2); assert.equal(run.execution.staleCommandChannelsRejected, 2);
    const inputs = run.trace.filter((row: { kind: string }) => row.kind === "declared-battle-input");
    const heals = inputs.filter((row: { rule: Program["rules"][number] }) => row.rule.action.kind === healing &&
      singleTarget(row.rule).id === "b");
    assert.ok(heals.length >= 1); assert.ok(heals.every((row: { before: { target: { hp: number } }; ownerBound: boolean }) =>
      row.before.target.hp < 120 && row.ownerBound));
    const healingResults = run.trace.filter((row: { kind: string; action?: { source: { kind: string; id: number } } }) =>
      row.kind === "declared-battle-action-resolved" && row.action?.source.kind === healing &&
      row.action.source.id === (healing === "item" ? 10 : 11));
    assert.ok(healingResults.length >= 1 && healingResults.every((row: {
      action: { results: { target: string; effects: { resource?: string; recovery?: boolean; amount?: number }[] }[] };
    }) => row.action.results.some(result => result.target === "b" && result.effects.some(effect =>
      effect.resource === "hp" && effect.recovery === true && (effect.amount ?? 0) > 0))), "Accepted gestures must produce real healing effects");
    assert.ok(inputs.every((row: { selection: { id: string }; rule: Program["rules"][number] }) =>
      row.selection.id === singleTarget(row.rule).id));
    const initial = run.finalState.initialOwned, final = run.finalState.finalOwned;
    assert.equal(final.completedBattles.length, 2); assert.equal(final.gil - initial.gil, 14);
    assert.equal(run.receipt.program.restoreCount, 2); assert.ok(run.receipt.program.postRestoreInputCount > 0);
    const actor = final.roster.find((member: { id: string }) => member.id === "a");
    assert.equal(actor.mp, healing === "ability" ? 28 - 2 * heals.length : 28);
    assert.deepEqual(run.finalState.checkpoint.owned, final);
  });

test("never-existing actor, target, source or command is rejected before a live owner", () => {
  for (const change of [
    (r: Program["rules"][number]) => { r.actor.id = "not-held"; },
    (r: Program["rules"][number]) => { r.actor.sourceId = 9; },
    (r: Program["rules"][number]) => { singleTarget(r).id = "not-an-enemy"; },
    (r: Program["rules"][number]) => { singleTarget(r).sourceId = 99; },
    (r: Program["rules"][number]) => { r.commandId = 999; },
  ]) {
    const f = fixture(); change(f.manifest.routes[0]!.battleInputs![0]!.rules[0]!);
    assert.throws(() => planContentBatch(f.manifest, f.packages), /identity|command/);
  }
});

test("an exact but illegal target blocks instead of falling back to another target or rule", async () => {
  const f = fixture(), rule = f.manifest.routes[0]!.battleInputs![0]!.rules[0]!;
  Object.assign(rule, { commandId: 100, action: { kind: "ability", abilityId: 10 },
    target: { id: "b", sourceId: 2, ended: "skip" }, when: { kind: "target-alive" } });
  delete rule.minimumItemCount;
  const run = await execute(f);
  assert.equal(run.receipt.result, "blocked"); assert.equal(run.receipt.boundary.kind, "rejected-battle-input");
  assert.match(run.receipt.boundary.reason, /legal exact/); assert.equal(run.commands, 0);
  assert.equal(run.execution.committedReturns, 0); assert.equal(run.receipt.saveRestored, false);
  assert.equal(run.finalState.finalOwned.completedBattles.length, 0);
});

test("a real command belonging to another actor cannot redirect a declared gesture", async () => {
  const f = fixture();
  f.packages.battle.common.commands[102] = { ...f.packages.battle.common.commands[100]!, id: 102 };
  f.packages.battle = sealBatchContent(f.packages.battle);
  const rule = f.manifest.routes[0]!.battleInputs![0]!.rules[0]!;
  Object.assign(rule, { commandId: 102, action: { kind: "ability", abilityId: 10 }, when: { kind: "target-alive" } });
  delete rule.minimumItemCount;
  const run = await execute(f);
  assert.equal(run.receipt.result, "blocked"); assert.match(run.receipt.boundary.reason, /owned or released/);
  assert.equal(run.commands, 0); assert.equal(run.finalState.finalOwned.completedBattles.length, 0);
});

test("explicit ended-target rules skip a naturally defeated exact enemy before selecting the next declared identity", async () => {
  const f = fixture("ability"), battle = f.packages.battle;
  f.manifest.routes[0]!.inputs = f.manifest.routes[0]!.inputs.filter(input =>
    input.kind !== "menu" || input.command.kind !== "use-item");
  for (const encounter of Object.values(battle.encounters)) {
    const extra = { ...structuredClone(encounter.enemies[0]!), id: "enemy:6", sourceId: 9102, hp: 1000,
      placement: { x: 15, y: 8, group: 1 } };
    encounter.enemies.push(extra);
    const { id: _, placement: __, ...definition } = extra;
    encounter.participants!.enemyDefinitions["9102"] = definition;
    encounter.participants!.initial.push({ id: "enemy:6", sourceId: 9102, uniqueId: 6 });
    encounter.participants!.slots["6"] = { x: 15, y: 8, group: 1 };
    battle.encounterReport!.entries.find(entry => entry.partyId === encounter.encounterId)!.enemyCount = 2;
  }
  battle.common.drops!.monsters.push({ ...structuredClone(battle.common.drops!.monsters[0]!), id: 9102 });
  f.packages.battle = sealBatchContent(battle);
  for (const program of f.manifest.routes[0]!.battleInputs!) for (const actor of [{ id: "a", sourceId: 1 }, { id: "b", sourceId: 2 }])
    program.rules.push({ actor, commandId: 100, action: { kind: "ability", abilityId: 10 },
      target: { id: "enemy:6", sourceId: 9102, ended: "skip" }, when: { kind: "target-alive" } });
  const run = await execute(f);
  assert.equal(run.receipt.result, "completed", JSON.stringify(run.receipt.boundary));
  const switched = run.trace.filter((row: { kind: string; rule?: Program["rules"][number] }) =>
    row.kind === "declared-battle-input" && row.rule && singleTarget(row.rule).id === "enemy:6");
  assert.ok(switched.length > 0 && switched.some((row: { skippedTargets: { target: { id: string }; reason: string }[] }) =>
    row.skippedTargets.some(skipped => skipped.target.id === "enemy:5" && skipped.reason === "dead")));
  assert.ok(switched.every((row: { selection: { id: string } }) => row.selection.id === "enemy:6"));
  assert.equal(run.execution.committedReturns, 2); assert.equal(run.receipt.saveRestored, true);
});

test("declared whole-side healing binds every source member and uses the actual side target projection", async () => {
  const f = fixture("ability"), ability = f.packages.battle.common.abilities[11]!;
  ability.program.range = 6; ability.plan!.targeting.modes = ["single", "side"];
  f.packages.battle = sealBatchContent(f.packages.battle);
  for (const program of f.manifest.routes[0]!.battleInputs!) program.rules[0]!.target = {
    kind: "side", side: "player", members: [{ id: "a", sourceId: 1 }, { id: "b", sourceId: 2 }], ended: "skip",
  };
  const run = await execute(f);
  assert.equal(run.receipt.result, "completed", JSON.stringify(run.receipt.boundary));
  const inputs = run.trace.filter((row: { kind: string; rule?: Program["rules"][number] }) =>
    row.kind === "declared-battle-input" && row.rule && "kind" in row.rule.target && row.rule.target.kind === "side");
  assert.ok(inputs.length > 0 && inputs.every((row: { selection: { kind: string; side: string } }) =>
    row.selection.kind === "side" && row.selection.side === "player"));
  const broken = fixture("ability");
  broken.manifest.routes[0]!.battleInputs![0]!.rules[0]!.target = {
    kind: "side", side: "player", members: [{ id: "a", sourceId: 1 }], ended: "skip",
  };
  assert.throws(() => planContentBatch(broken.manifest, broken.packages), /every original member/);
});

test("pending recovery observation suppresses a duplicate healer gesture without predicting or changing HP", async () => {
  const f = fixture("ability");
  for (const program of f.manifest.routes[0]!.battleInputs!) {
    program.rules[0]!.avoidPendingRecovery = true;
    program.rules.splice(1, 0, { ...structuredClone(program.rules[0]!), actor: { id: "b", sourceId: 2 } });
  }
  const run = await execute(f);
  assert.equal(run.receipt.result, "completed", JSON.stringify(run.receipt.boundary));
  const heals = run.trace.filter((row: { kind: string; rule?: Program["rules"][number] }) =>
    row.kind === "declared-battle-input" && row.rule?.action.kind === "ability" && row.rule.action.abilityId === 11);
  assert.ok(heals.length > 0 && heals.every((row: { rule: Program["rules"][number] }) => row.rule.actor.id === "a"));
  assert.equal(run.finalState.finalOwned.roster.find((member: { id: string }) => member.id === "b").mp, 28);
});
