// Runs the package served to the playable systems page through shared owners.
// The host supplies time/readiness and player inputs, never flags, HP or results.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = resolve(import.meta.dirname, ".."), options = new Map(), args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--compiled-dir", "--package-root", "--report"].includes(args[i]) && args[i + 1] && !options.has(args[i]),
    "Use --compiled-dir/--package-root/--report <path>");
  options.set(args[i], args[i + 1]);
}
const compiled = options.get("--compiled-dir") ?? "dist";
// This flag changes only the /content-packages mount (an isolated builder
// collection). Source media keep the server's existing build mounts.
const packageRoot = resolve(root, options.get("--package-root") ?? "build/content-packages"), mediaRoot = resolve(root, "build");
const output = resolve(root, options.get("--report") ?? "build/reports/systems-playground-check.json");
const load = name => import(pathToFileURL(resolve(root, compiled, "src/core", name + ".js")));
const [{ GameContentRepository, fieldMediaUrls }, { parseGameContentRefs }, { GameSession }, { GameFlow },
  { GameEntryLoader }, { GameMapLoader }, { GameBattleHandoff }, { GameCommands },
  { CheckpointStorage }, { GameEventSaveCoordinator }, { prepareGameDevelopmentEntry }, { selectEmptyEquipment },
  { contentDigest }] = await Promise.all([
  "game-content", "game-content-refs", "game-session", "game-flow", "game-entry-loader", "game-map-loader",
  "game-battle-handoff", "game-commands", "saved-game", "game-event-save", "game-development-entry", "equipment", "content-integrity",
].map(load));
const tests = [], report = { kind: "systems-playground-check-v1", result: "running", tests,
  packageId: "systems-playground", profile: "framework", trace: [],
  evidence: { lane: "source-content-with-authored-systems-route", browserVerified: false, originalGameExecuted: false,
    sourceCampaignComplete: false, fullGameMigration: false,
    content: "Actual built package also loaded by the game page; authored stages and inputs, unchanged development baseline and real ordinary enemies; no checker-side content or state edits",
    host: "10ms deterministic headless updates; controlled audio readiness/output; real PNG bytes checked without browser decoding",
    inputs: "GameFlow movement/confirmation, owner-bound public commands and prepared handoff",
    persistence: "Real checkpoint codec and package-scoped storage; in-memory storage port" } };
await mkdir(resolve(output, ".."), { recursive: true });
const record = (name, detail = {}) => tests.push({ name, passed: true, ...detail });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const ready = { visible: true, mediaReady: true, overlayOpen: false };
const files = new Map(), requests = [], images = new Set();
function localPath(url) {
  assert.match(url, /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:json|png)$/);
  // Match serve.mjs, including its singular import directory. Verify the
  // existing asset bytes; do not manufacture another copy for this check.
  const served = ["/content-packages/", "/framework/", "/world/maps/", "/world-media/", "/map-ui/",
    "/battle/sprites/", "/field/sprites/", "/field-background-media/"];
  assert.ok(url.startsWith("/imports/textures/") || served.some(prefix => url.startsWith(prefix)),
    "Package requested an unserved content/media route: " + url);
  const base = url.startsWith("/content-packages/") ? packageRoot : mediaRoot;
  const suffix = url.startsWith("/content-packages/") ? url.slice("/content-packages/".length) :
    url.startsWith("/imports/textures/") ? "import/textures/" + url.slice("/imports/textures/".length) : url.slice(1);
  const path = resolve(base, suffix);
  assert.ok(path.startsWith(base + sep), "Package URL leaves its trusted server mount");
  return path;
}
async function json(url) {
  const bytes = await readFile(localPath(url));
  files.set(url, sha256(bytes));
  return JSON.parse(bytes.toString("utf8"));
}
async function prepareImages(urls) {
  assert.ok(urls.length > 0, "No media closure for prepared view");
  for (const url of new Set(urls)) {
    const bytes = await readFile(localPath(url));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Required PNG is missing or corrupt: " + url);
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
    images.add(url);
  }
}
const itemCount = (owned, id) => owned.items.find(item => item.id === id)?.count ?? 0;
const member = (owned, id) => {
  const result = owned.roster.find(unit => unit.id === id);
  assert.ok(result, "Missing owned member " + id); return result;
};

async function createHost(refs, traceTarget = report.trace) {
  const repository = new GameContentRepository(async url => {
    requests.push(url);
    assert.ok(!["/game/content.json", "/game/battle.json", "/world/catalog.json"].includes(url),
      "Systems package must not load a compatibility fallback");
    return json(url);
  }, "framework", refs);
  const flow = new GameFlow(), bytes = new Map();
  let writes = 0, ticks = 0, commands = null;
  const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { writes++; bytes.set(key, value); } }, "framework", "systems-playground");
  const runtime = { ...controlledAudioRuntime(), battleHandoff: "prepared",
    transportationTimestamp: () => "639273600000000000" };
  const entries = new GameEntryLoader(flow, { discard: () => {} });
  const current = () => flow.session;
  const trace = (kind, detail = {}) => traceTarget.push({ kind, tick: ticks,
    mapId: flow.currentSession?.field.content.map.identity?.mapId ?? null, ...detail });
  const handoff = new GameBattleHandoff(flow, {
    prepareStart: async view => {
      const owner = current(), field = owner.field, before = field.time;
      assert.equal(flow.phase, "battle-entry"); assert.equal(owner.battle, null);
      assert.equal(owner.state.inBattle, true); assert.equal(commands.battleReady, false);
      await prepareImages(view.mediaUrls);
      flow.advance(500, ready);
      assert.equal(field.time, before); assert.equal(owner.battle, null);
      trace("battle-prepare", { operation: view.kind, encounterId: view.content.encounterId, elapsedDropped: true });
      return { kind: "battle", encounterId: view.content.encounterId };
    },
    prepareReturn: async view => {
      const owner = current(), battle = owner.battle, before = owner.state.snapshot();
      assert.equal(flow.phase, "battle-return"); assert.ok(["victory", "escaped"].includes(battle.phase));
      assert.equal(commands.canReturnBattle(battle), false);
      await prepareImages(fieldMediaUrls(owner.field.content));
      flow.advance(500, ready);
      assert.equal(owner.battle, battle); assert.deepEqual(owner.state.snapshot(), before);
      trace("battle-return-prepare", { encounterId: view.content.encounterId, outcome: view.outcome, ownedUnchanged: true });
      return { kind: "field", encounterId: view.content.encounterId };
    }, discard: () => {},
  });
  const maps = new GameMapLoader(flow, repository, { prepare: async field => {
    assert.notEqual(field, current().field); await prepareImages(fieldMediaUrls(field.content));
    return { field };
  }, discard: () => {} });
  const eventSaves = new GameEventSaveCoordinator(flow, storage);
  const tick = () => { flow.advance(10, ready); ticks++; };
  async function start() {
    assert.equal(flow.phase, "title"); assert.equal(flow.currentSession, null);
    const result = await entries.begin("new-game").prepare(async context => {
      const { field, battle, development } = await repository.opening();
      assert.ok(development, "The systems package requires its declared development map entry");
      assert.ok(context.isCurrent());
      const session = await prepareGameDevelopmentEntry(field, battle, development.catalog, development.map, runtime, 314);
      assert.ok(context.isCurrent());
      await prepareImages(fieldMediaUrls(session.field.content));
      return { session, presentation: { field: session.field } };
    });
    assert.equal(result.status, "committed", String(result.error?.stack ?? result.error ?? result.status));
    commands = new GameCommands(flow, result.session);
    assert.equal(commands.settingsReady, false); flow.observeHost(ready);
    trace("entry", { entryHash: refs.development.entry.contentHash });
    return result.session;
  }
  async function saveRestore() {
    const old = current(), oldCommands = commands, checkpoint = old.checkpoint(), digest = await contentDigest(checkpoint);
    assert.equal(old.checkpointReady, true); assert.equal(flow.pause(true), true);
    const operation = flow.beginOperation("save");
    try {
      const prepared = await storage.prepareSave(checkpoint, ticks);
      assert.equal(operation.isCurrent(), true); prepared.commit(); assert.equal(operation.finish(), true);
    } catch (error) { operation.cancel(); throw error; }
    const result = await entries.begin("load").prepare(async context => {
      const saved = await storage.load(); assert.ok(saved); assert.ok(context.isCurrent());
      const packages = await repository.restoreSessionContent(saved.checkpoint); assert.ok(context.isCurrent());
      const session = GameSession.restore(saved.checkpoint, packages.initial, packages.battle, packages.world, runtime);
      assert.deepEqual(session.checkpoint(), checkpoint);
      await prepareImages(fieldMediaUrls(session.field.content));
      return { session, presentation: { field: session.field }, options: { paused: true } };
    });
    assert.equal(result.status, "committed", String(result.error?.stack ?? result.error ?? result.status)); assert.notEqual(result.session, old);
    assert.notEqual(result.session.state, old.state); assert.notEqual(result.session.world, old.world);
    commands = new GameCommands(flow, result.session);
    assert.equal(commands.menuReady, false); flow.observeHost(ready); assert.equal(commands.menuReady, true);
    assert.equal(oldCommands.menu({ kind: "set-preferences", preferences: old.battlePreferences }), false);
    assert.deepEqual(old.checkpoint(), checkpoint); assert.deepEqual(current().checkpoint(), checkpoint);
    assert.equal(flow.pause(false), true); flow.observeHost(ready);
    trace("save-restore", { checkpointHash: digest, oldCommandsRejected: true, continued: true });
    return { checkpoint, digest, old, oldCommands };
  }
  return { repository, flow, entries, handoff, maps, storage, eventSaves, start, saveRestore, tick, trace, current,
    get commands() { return commands; }, get ticks() { return ticks; }, get writes() { return writes; } };
}

const idle = h => !h.current().battle && !h.current().field.busy && !h.current().field.player.motion && h.current().checkpointReady;
function battleInput(h, battle, { awaitInjury = false } = {}) {
  if (awaitInjury && !battle.players.some(player => player.hp < player.maxHp)) return 0;
  let accepted = 0;
  for (const actor of battle.ready) {
    const choices = battle.commandMenu(actor.id).filter(command => command.available && command.kind === "ability");
    const injured = battle.players.find(player => player.hp > 0 && player.hp < player.maxHp * 0.3);
    const abilityId = injured ? 222 : 218;
    const command = choices.find(command => command.abilityIds.includes(abilityId));
    assert.ok(command, "Owned actor has no admitted input ability " + abilityId);
    const targets = battle.targetChoices(actor.id, abilityId);
    const target = injured ? targets.find(target => target.targetIds.includes(injured.id)) : targets[0];
    assert.ok(target, "Public battle menu has no eligible target for " + abilityId);
    if (h.commands.command(battle, actor.id, abilityId, target.selection, command.id)) accepted++;
  }
  return accepted;
}

async function playToIdle(h, { encounterId = null, awaitInjury = false } = {}) {
  let active = null, baseline = null, accepted = 0, confirmations = 0, returned = null;
  for (let count = 0; count < 50000; count++) {
    const owner = h.current(), field = owner.field;
    assert.notEqual(field.stop?.kind, "unsupported", JSON.stringify(field.stop));
    if (owner.eventSaveRequest) {
      assert.equal((await h.eventSaves.save(h.ticks)).status, "committed");
    } else if (field.stop?.kind === "map-transition") {
      const from = field.content.map.identity.mapId, result = await h.maps.load();
      assert.equal(result.status, "committed", String(result.error?.stack ?? result.error ?? result.status)); assert.equal(result.session, h.current());
      assert.equal(result.field, h.current().field);
      h.trace("map", { from, to: result.field.content.map.identity.mapId });
    } else if (!owner.battle && field.stop?.kind === "encounter") {
      assert.equal(active, null, "One declared movement must not invoke two encounters");
      baseline = owner.state.snapshot();
      h.trace("encounter-request", { encounterId: field.stop.party, site: field.stop.site,
        item2: itemCount(baseline, 2), pendingBattle: owner.battle === null });
      const request = field.stop, result = await h.handoff.start();
      assert.equal(result.status, "committed", String(result.error?.stack ?? result.error ?? result.status));
      assert.equal(result.request, request); assert.equal(result.session, owner);
      active = owner.battle; assert.ok(active);
      assert.equal(active.content.encounterId, encounterId);
      assert.deepEqual(owner.state.snapshot(), baseline, "Battle entry must not publish a resource copy");
      h.trace("battle", { encounterId, item2: itemCount(baseline, 2), completedBattles: baseline.completedBattles.length });
    } else if (owner.battle) {
      const battle = owner.battle;
      assert.equal(battle, active); assert.notEqual(battle.phase, "defeat", "The declared win inputs lost the battle");
      if (battle.phase === "victory") {
        assert.equal(h.commands.canReturnBattle(battle), true);
        assert.deepEqual(owner.state.snapshot(), baseline, "A victory display must not settle resources");
        const reward = structuredClone(battle.reward); assert.ok(reward);
        assert.equal(reward.gil, battle.content.enemies.reduce((sum, enemy) => sum + enemy.gil, 0));
        assert.ok(reward.each > 0);
        const result = await h.handoff.return();
        assert.equal(result.status, "committed", String(result.error?.stack ?? result.error ?? result.status));
        assert.equal(result.session, owner); assert.equal(owner.battle, null); assert.equal(owner.state.inBattle, false);
        const after = owner.state.snapshot();
        assert.equal(after.gil, baseline.gil + reward.gil);
        assert.equal(after.completedBattles.length, baseline.completedBattles.length + 1);
        assert.equal(after.completedBattles.at(-1).encounterId, encounterId);
        assert.deepEqual(after.party, baseline.party);
        for (const player of battle.players) {
          const beforePlayer = member(baseline, player.id), afterPlayer = member(after, player.id);
          assert.equal(afterPlayer.exp, beforePlayer.exp + (player.hp > 0 ? reward.each : 0));
          assert.deepEqual(afterPlayer.equipment, beforePlayer.equipment);
        }
        await assert.rejects(h.handoff.return(), /pending encounter or terminal battle/);
        assert.deepEqual(owner.state.snapshot(), after, "Duplicate return cannot pay a second reward");
        returned = { baseline, reward, after, confirmations, accepted };
        h.trace("reward", { encounterId, gil: reward.gil, eachExp: reward.each,
          receiptCount: after.completedBattles.length, duplicateReturnRejected: true });
      } else {
        assert.equal(battle.phase, "active"); accepted += battleInput(h, battle, { awaitInjury });
      }
    } else if (field.dialogue) {
      assert.equal(h.flow.confirm(), true); confirmations++;
    } else {
      assert.equal(field.choice, null, "The practice route declares no choice answer");
      assert.equal(field.currentShop, null, "The practice route declares no shop input");
      if (idle(h)) {
        if (encounterId !== null) {
          assert.ok(returned, "Declared encounter was not reached through movement/confirmation");
          assert.ok(accepted > 0); assert.ok(confirmations > 0);
        }
        return returned;
      }
    }
    h.tick();
  }
  throw new Error("Systems route did not reach a stable field through its declared inputs");
}

async function move(h, direction, expectedEncounter = null, awaitInjury = false) {
  assert.equal(idle(h), true); assert.equal(h.flow.move(direction), true, "Declared movement was rejected: " + direction);
  h.trace("input", { input: "move", direction });
  return playToIdle(h, { encounterId: expectedEncounter, awaitInjury });
}
function menu(h, command) {
  assert.equal(idle(h), true); assert.equal(h.flow.pause(true), true); assert.equal(h.commands.menuReady, true);
  const before = h.current().checkpoint();
  assert.equal(h.commands.menu(command), true, "Declared menu action had no accepted effect: " + JSON.stringify(command));
  const after = h.current().checkpoint();
  h.trace("menu", { command: structuredClone(command), ownerBound: h.commands.owner === h.current() });
  assert.equal(h.flow.pause(false), true); h.flow.observeHost(ready);
  return { before, after };
}

try {
  const refs = parseGameContentRefs(await json("/content-packages/systems-playground.json"));
  assert.equal(refs.profile, "framework"); assert.equal(refs.source, null); assert.ok(refs.development);
  assert.ok([refs.world.url, refs.development.entry.url, refs.development.battle.url]
    .every(url => url.startsWith("/content-packages/systems-playground/")));
  report.refs = refs;
  const h = await createHost(refs), firstOwner = await h.start();
  await playToIdle(h);
  assert.equal(h.current(), firstOwner); assert.equal(h.current().field.content.map.identity.mapId, 900001);
  assert.deepEqual([h.current().field.player.x, h.current().field.player.y], [38, 49]);
  const initial = h.current().checkpoint();
  assert.equal(initial.owned.completedBattles.length, 0);
  record("title-loads-the-page-package-through-the-shared-development-entry");

  const first = await move(h, "up", 3002, true);
  assert.deepEqual([h.current().field.player.x, h.current().field.player.y], [38, 48]);
  assert.equal(itemCount(first.baseline, 2), itemCount(initial.owned, 2) + 2,
    "Supplies must come from the walking-triggered event, before its battle");
  assert.ok(first.confirmations > 0); assert.ok(first.accepted > 0);
  record("walking-and-confirmation-trigger-supplies-and-a-real-ordinary-enemy-party");
  assert.equal(first.after.completedBattles.length, 1); assert.equal(first.after.completedBattles[0].encounterId, 3002);
  record("prepared-battle-victory-returns-once-to-the-same-owned-resources");

  const injured = h.current().state.snapshot().roster.find(player => player.hp > 0 && player.hp < player.maxHp);
  assert.ok(injured, "Enemy actions must leave an observable potion target without editing HP");
  const potion = menu(h, { kind: "use-item", itemId: 2, targetId: injured.id });
  assert.equal(itemCount(potion.after.owned, 2), itemCount(potion.before.owned, 2) - 1);
  assert.ok(member(potion.after.owned, injured.id).hp > injured.hp);
  record("public-item-menu-heals-actual-battle-injury-and-consumes-one-owned-potion");

  const owner = h.current(), gearOwner = owner.state.snapshot().roster.find(player => player.sourceId === 1);
  assert.ok(gearOwner); const weapon = gearOwner.equipment[0];
  const empty = selectEmptyEquipment(owner.battleCatalog.gameState.equipmentSystem.catalog,
    owner.state.snapshot().equipmentStock, gearOwner.sourceId, 1);
  assert.ok(empty !== null && empty !== weapon);
  const gear = menu(h, { kind: "change-equipment", playerId: gearOwner.id, slot: 1, contentId: empty });
  assert.equal(member(gear.after.owned, gearOwner.id).equipment[0], empty);
  assert.deepEqual(gear.after.owned.equipmentStock, gear.before.owned.equipmentStock);
  record("public-equipment-menu-changes-occupancy-without-duplicating-owned-stock");

  const party = menu(h, { kind: "change-party", change: { kind: "swap", from: 0, to: 1 } });
  const beforeCells = party.before.owned.party.slots[party.before.owned.party.selectedSlot];
  const afterCells = party.after.owned.party.slots[party.after.owned.party.selectedSlot];
  assert.deepEqual(afterCells[0], beforeCells[1]); assert.deepEqual(afterCells[1], beforeCells[0]);
  assert.equal(h.current().state.activeParty[0].id, beforeCells[1].id);
  menu(h, { kind: "set-preferences", preferences: { mode: "wait", speedIndex: 3 } });
  record("public-party-and-preference-menus-update-the-shared-session");

  const restored = await h.saveRestore();
  assert.equal(h.current().field.content.map.identity.mapId, 900001);
  assert.deepEqual([h.current().field.player.x, h.current().field.player.y], [38, 48], "Restore must not relocate to PointIn");
  assert.equal(member(h.current().state.snapshot(), gearOwner.id).equipment[0], empty);
  assert.equal(restored.oldCommands.menu({ kind: "change-equipment", playerId: gearOwner.id, slot: 1, contentId: weapon }), false);
  const equipped = menu(h, { kind: "change-equipment", playerId: gearOwner.id, slot: 1, contentId: weapon });
  assert.equal(member(equipped.after.owned, gearOwner.id).equipment[0], weapon);
  assert.deepEqual(equipped.after.owned.equipmentStock, restored.checkpoint.owned.equipmentStock);
  record("save-restore-preserves-menu-effects-and-rebinds-all-public-commands");

  const beforeRepeat = h.current().state.snapshot();
  await move(h, "down"); await move(h, "up");
  assert.deepEqual(h.current().state.snapshot(), beforeRepeat, "Repeated source inputs cannot replay stage supplies or rewards");
  assert.equal(h.current().battle, null);
  record("saved-stage-local-guard-prevents-repeated-supplies-and-encounters");

  await move(h, "right");
  assert.equal(h.current().field.content.map.identity.mapId, 900002);
  assert.deepEqual([h.current().field.player.x, h.current().field.player.y], [38, 49]);
  assert.deepEqual(h.current().state.snapshot(), beforeRepeat);
  assert.deepEqual(h.current().world.transitions.map(({ from, to }) => [from, to]), [[900001, 900002]]);
  record("restored-player-input-crosses-the-real-map-loader-transaction");

  const second = await move(h, "up", 517, true);
  assert.equal(second.baseline.completedBattles.length, 1);
  assert.deepEqual(second.after.completedBattles.map(({ serial, encounterId, outcome }) => [serial, encounterId, outcome]),
    [[0, 3002, "victory"], [1, 517, "victory"]]);
  assert.equal(second.after.gil, initial.owned.gil + first.reward.gil + second.reward.gil);
  record("a-second-battle-after-restore-and-travel-grants-one-new-reward");

  const caster = h.current().state.snapshot().roster.find(player => player.sourceId === 1);
  assert.ok(caster?.abilities?.owned.some(ability => ability.abilityId === 31 && ability.skillLevel === 100),
    "The actual initialized held character must own Cure; the checker grants no ability");
  h.flow.pause(true);
  const beforeModels = h.current().checkpoint();
  const spells = h.current().menuAbilities(caster.id);
  const cure = spells.find(ability => ability.abilityId === 31);
  assert.equal(cure?.available, true, JSON.stringify(cure));
  const choices = h.current().menuAbilityTargets(caster.id, 31);
  const choice = choices.find(choice => choice.selection.kind === "single");
  assert.ok(choice, "A real battle must leave a source Cure target without checker-side resource edits");
  assert.deepEqual(h.current().checkpoint(), beforeModels, "Reading field spell models must not consume random draws");
  h.flow.pause(false); h.flow.observeHost(ready);
  const spell = menu(h, { kind: "use-ability", actorId: caster.id, abilityId: 31, selection: choice.selection });
  const targetId = choice.targetIds[0];
  assert.ok(member(spell.after.owned, targetId).hp > member(spell.before.owned, targetId).hp);
  assert.equal(member(spell.after.owned, caster.id).mp, member(spell.before.owned, caster.id).mp - cure.cost.mp);
  assert.ok(spell.after.owned.fieldRandom.draws > spell.before.owned.fieldRandom.draws);
  assert.deepEqual(spell.after.owned.items, spell.before.owned.items);
  assert.deepEqual(spell.after.owned.party, spell.before.owned.party);
  for (const player of spell.after.owned.roster) {
    const before = member(spell.before.owned, player.id);
    assert.deepEqual(player.abilities, before.abilities);
    assert.deepEqual(player.equipment, before.equipment);
    assert.deepEqual(player.growth, before.growth);
  }
  record("source-owned-menu-cure-heals-real-injury-and-pays-mp-with-one-field-random-transaction");

  const final = await h.saveRestore();
  assert.equal(h.current().field.content.map.identity.mapId, 900002);
  assert.deepEqual([h.current().field.player.x, h.current().field.player.y], [38, 48]);
  assert.deepEqual(h.current().checkpoint(), final.checkpoint);
  assert.deepEqual(h.current().state.snapshot().fieldRandom, spell.after.owned.fieldRandom,
    "Real package storage and owner rebind must preserve the successful spell's random continuation");
  assert.equal(final.oldCommands.menu({ kind: "use-ability", actorId: caster.id, abilityId: 31,
    selection: choice.selection }), false);
  record("field-spell-state-and-random-continuation-survive-package-save-and-owner-rebinding");
  const savedFinal = h.current().checkpoint(); await move(h, "down"); await move(h, "up");
  assert.deepEqual(h.current().state.snapshot(), savedFinal.owned);
  assert.equal(h.current().state.snapshot().completedBattles.length, 2);
  record("final-restore-and-new-inputs-preserve-both-once-only-battle-receipts");

  assert.ok(requests.every(url => url.startsWith("/content-packages/systems-playground/")));
  for (const [url, digest] of files) assert.equal(sha256(await readFile(localPath(url))), digest,
    "A package changed while its playthrough was running: " + url);
  report.runtimeSha256 = await runtimeDigest(root, compiled);
  report.packages = Object.fromEntries(files); report.requests = requests; report.requiredMedia = [...images].sort();
  report.journey = { mapIds: [900001, 900002], encounterIds: [3002, 517], ticks: h.ticks, storageWrites: h.writes,
    menuKinds: [...new Set(report.trace.filter(step => step.kind === "menu").map(step => step.command.kind))],
    restores: report.trace.filter(step => step.kind === "save-restore").length,
    completedBattles: h.current().state.snapshot().completedBattles, initialGil: initial.owned.gil,
    finalGil: h.current().gil, checkpointHash: await contentDigest(h.current().checkpoint()) };
  record("the-same-built-content-pins-and-required-media-remain-valid-through-the-whole-journey");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: tests.length, report: relative(root, output) }));
}
