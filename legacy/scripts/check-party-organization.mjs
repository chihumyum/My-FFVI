// Real built source owners and shared game APIs in an explicitly controlled
// development route. This never grants source-story or browser acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = resolve(import.meta.dirname, ".."), options = new Map(), args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  assert.ok(["--compiled-dir", "--package-root", "--report"].includes(args[index]) && args[index + 1] && !options.has(args[index]),
    "Use --compiled-dir/--package-root/--report <path>");
  options.set(args[index], args[index + 1]);
}
const compiled = options.get("--compiled-dir") ?? "dist";
const packageRoot = resolve(root, options.get("--package-root") ?? "build/content-packages");
const output = resolve(root, options.get("--report") ?? "build/reports/party-organization-check.json");
const module = path => import(pathToFileURL(resolve(root, compiled, "src", path + ".js")));
const [{ GameContentRepository, fieldMediaUrls }, { parseGameContentRefs }, { GameSession }, { GameFlow },
  { GameEntryLoader }, { GameMapLoader }, { GameBattleHandoff }, { GameCommands }, { CheckpointStorage },
  { prepareGameDevelopmentEntry }, { verifyContent, contentDigest }, { compileDevelopmentMapEntry },
  { compileRosterLifecycleEvent }, { loadCorpus }, { battleTableIndex }, { readSnapshot, snapshotFile }, { hash }] = await Promise.all([
  "core/game-content", "core/game-content-refs", "core/game-session", "core/game-flow", "core/game-entry-loader",
  "core/game-map-loader", "core/game-battle-handoff", "core/game-commands", "core/saved-game", "core/game-development-entry",
  "core/content-integrity", "compiler/development-map-entry", "compiler/roster", "compiler/corpus", "compiler/battle",
  "compiler/integrity", "compiler/content",
].map(module));
const tests = [], report = { kind: "party-organization-check-v1", result: "running", tests, trace: [],
  evidence: { lane: "controlled-source-owners-and-framework-organization", sourceGameplayAdmitted: false,
    browserVerified: false, originalGameExecuted: false, sourceMultiPartyMapVerified: false, fullGameMigration: false,
    content: "Built source/development catalogs; private hashed map derivation adds source-compiled Join/Secede events and the exact source2 field media reference",
    owners: "No checker writes to HP, native flags, enabled state, actors or persistent roster; source lifecycle and menu transactions perform all changes",
    host: "10ms headless clock, controlled audio readiness, real PNG bytes without browser decoding",
    persistence: "GameSession codec, exact Repository pins, EntryLoader and package-scoped in-memory CheckpointStorage" } };
await mkdir(resolve(output, ".."), { recursive: true });
const record = (name, detail = {}) => tests.push({ name, passed: true, ...detail });
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const originalFiles = new Map(), privateFiles = new Map(), requests = [], images = new Set();
async function readBuilt(path) {
  const absolute = resolve(root, path), bytes = await readFile(absolute);
  originalFiles.set(absolute, sha256(bytes)); return JSON.parse(bytes.toString("utf8"));
}
function mediaPath(url) {
  assert.match(url, /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.png$/);
  const mounts = ["/world-media/", "/map-ui/", "/battle/sprites/", "/field/sprites/", "/field-background-media/"];
  assert.ok(url.startsWith("/imports/textures/") || mounts.some(prefix => url.startsWith(prefix)), "Unserved media " + url);
  const base = resolve(root, "build"), suffix = url.startsWith("/imports/textures/")
    ? "import/textures/" + url.slice("/imports/textures/".length) : url.slice(1), path = resolve(base, suffix);
  assert.ok(path.startsWith(base + sep)); return path;
}
async function prepareImages(urls) {
  assert.ok(urls.length > 0, "Missing prepared media closure");
  for (const url of new Set(urls)) {
    const bytes = await readFile(mediaPath(url));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", url);
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0); images.add(url);
  }
}
function seal(raw) { const { contentHash: _, ...payload } = raw; return { ...payload, contentHash: hash(payload) }; }
const ready = { visible: true, mediaReady: true, overlayOpen: false };
const owned = h => h.current().state.snapshot();
const held = (state, id) => { const member = state.roster.find(member => member.id === id); assert.ok(member, "Missing held " + id); return member; };
const selected = state => state.party.slots[state.party.selectedSlot].filter(cell => cell.id !== null);
const idle = h => !h.current().battle && !h.current().field.busy && !h.current().field.player.motion && h.current().checkpointReady;

async function createControlledPackage() {
  const packageRefs = parseGameContentRefs(await readBuilt(resolve(packageRoot, "systems-playground.json")));
  assert.equal(packageRefs.profile, "framework"); assert.equal(packageRefs.source, null); assert.ok(packageRefs.development);
  const packagePath = url => resolve(packageRoot, url.slice("/content-packages/".length));
  const [base, battle, sourceCatalog, world, sourceMaps, corpus, battleSnapshot, packageEntry] = await Promise.all([
    readBuilt("build/game/narshe.json"), readBuilt(packagePath(packageRefs.development.battle.url)),
    readBuilt("build/game/source-catalog.json"), readBuilt(packagePath(packageRefs.world.url)),
    Promise.all([900001, 900002].map(id => readBuilt(resolve(packageRoot, "systems-playground/maps", id + ".json")))),
    loadCorpus(root + sep), readSnapshot(resolve(root, "build/battle")), readBuilt(packagePath(packageRefs.development.entry.url)),
  ]);
  await Promise.all([base, battle, sourceCatalog, world, packageEntry, ...sourceMaps].map(value => verifyContent(value)));
  assert.equal(battle.contentHash, packageRefs.development.battle.contentHash);
  assert.equal(world.contentHash, packageRefs.world.contentHash);
  assert.equal(packageEntry.contentHash, packageRefs.development.entry.contentHash);
  assert.equal(packageEntry.developmentEntry.baseFieldHash, base.contentHash);
  assert.ok(battle.gameState.characterInitializations["player:2"] && battle.gameState.characterGrowth["player:2"], "Source2 initializer/growth is not closed");
  assert.deepEqual(battle.gameState.characterInitializations["player:2"], sourceCatalog.gameState.characterInitializations["player:2"]);
  assert.deepEqual(battle.gameState.characterGrowth["player:2"], sourceCatalog.gameState.characterGrowth["player:2"]);
  const definitions = battle.gameState.battleDefinitions.filter(definition => definition.sourceId === 2);
  assert.equal(definitions.length, 1); assert.equal(definitions[0].id, "player:2");
  assert.deepEqual(definitions, sourceCatalog.gameState.battleDefinitions.filter(definition => definition.sourceId === 2));
  const character = world.characters.mo_ff6_p002;
  assert.ok(character?.source && Object.keys(character.sprites).length > 0, "Source2 field media is not closed");
  const join = compileRosterLifecycleEvent("メンバー加入：ロック", corpus.tables);
  const secede = compileRosterLifecycleEvent("メンバー離脱：ロック", corpus.tables);
  assert.deepEqual(join.command, { kind: "join", sourceId: 2, position: null, row: "front", refreshActors: true, recovery: false, refitEquipment: false });
  const rawBattle = JSON.parse(snapshotFile(battleSnapshot, "battle.json"));
  const reader = battleTableIndex(corpus.tables, rawBattle.tableSources);
  const dependencies = [...new Map([...join.dependencies, ...secede.dependencies].map(ref => [ref.table + ":" + ref.id, ref])).values()]
    .map(ref => {
      const source = reader.row(ref.table, ref.id).source;
      const files = corpus.manifest.sources.filter(file => file.file === source.file || file.file.endsWith("/" + source.file));
      assert.equal(files.length, 1, "Missing or ambiguous source file digest " + source.file);
      return { ...ref, source: { ...source, sha256: files[0].sha256 } };
    });
  const source = { file: "scripts/check-party-organization.mjs", assetPath: "Controlled/PartyOrganization",
    sha256: sha256(await readFile(resolve(root, "scripts/check-party-organization.mjs"))) };
  for (const original of sourceMaps) {
    assert.equal(world.maps[String(original.mapId)].contentHash, original.contentHash);
    const map = structuredClone(original);
    map.characterAssets = [...new Set([...map.characterAssets, "mo_ff6_p002"])];
    for (const [name, op] of [["controlled_party_join", join], ["controlled_party_secede", secede]]) {
      assert.equal(Object.hasOwn(map.scripts, name), false);
      map.scripts[name] = [{ ...op, script: name, index: 0, source }, { kind: "exit", script: name, index: 1, source }];
      map.scriptLocals[name] = null;
      map.scriptSystemFlags[name] = { keepBadStatusVisual: false };
    }
    map.limitations.push("Controlled party-organization probe: source lifecycle operands; no original story reachability or multi-party map authorization");
    const derived = seal(map), url = `/content-packages/party-organization/maps/${map.mapId}.json`;
    privateFiles.set(url, derived);
    world.maps[String(map.mapId)] = { ...world.maps[String(map.mapId)], url, contentHash: derived.contentHash };
  }
  const derivedWorld = seal(world), startMap = privateFiles.get("/content-packages/party-organization/maps/900001.json");
  const entry = await compileDevelopmentMapEntry({ baseField: base, baseBattle: battle, catalog: derivedWorld, map: startMap, entrance: 1 });
  privateFiles.set("/content-packages/party-organization/entry.json", entry);
  privateFiles.set("/content-packages/party-organization/battle.json", battle);
  privateFiles.set("/content-packages/party-organization/world.json", derivedWorld);
  const refs = parseGameContentRefs({ kind: "game-content-refs-v1", profile: "framework", source: null,
    development: { entry: { url: "/content-packages/party-organization/entry.json", contentHash: entry.contentHash },
      battle: { url: "/content-packages/party-organization/battle.json", contentHash: battle.contentHash } },
    world: { url: "/content-packages/party-organization/world.json", contentHash: derivedWorld.contentHash } });
  report.refs = refs;
  report.source = { sourceSetHash: corpus.sourceSetHash, sourceCatalogHash: sourceCatalog.contentHash,
    rawBaseFieldHash: base.contentHash, unchangedBattleCatalogHash: battle.contentHash, packageWorldHash: packageRefs.world.contentHash,
    sourceJoin: join, sourceSecede: secede, dependencies, fieldCharacter: character.source,
    ownerInitializerHash: hash(battle.gameState.characterInitializations["player:2"]), growthHash: hash(battle.gameState.characterGrowth["player:2"]),
    derivedMaps: sourceMaps.map(map => ({ mapId: map.mapId, originalHash: map.contentHash,
      derivedHash: privateFiles.get(`/content-packages/party-organization/maps/${map.mapId}.json`).contentHash })) };
  return refs;
}

async function createHost(refs) {
  const repository = new GameContentRepository(async url => {
    requests.push(url); assert.ok(privateFiles.has(url), "Unexpected compatibility fallback " + url);
    return structuredClone(privateFiles.get(url));
  }, "framework", refs);
  const flow = new GameFlow(), bytes = new Map(); let commands = null, ticks = 0, writes = 0;
  const runtime = { ...controlledAudioRuntime(), battleHandoff: "prepared", transportationTimestamp: () => "639273600000000000" };
  const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { writes++; bytes.set(key, value); } }, "framework", "party-organization");
  const entries = new GameEntryLoader(flow, { discard: () => {} }), current = () => flow.session;
  const trace = (kind, detail = {}) => report.trace.push({ kind, tick: ticks, mapId: flow.currentSession?.field.content.map.identity?.mapId, ...detail });
  const handoff = new GameBattleHandoff(flow, { prepareStart: async candidate => {
    assert.equal(flow.phase, "battle-entry"); assert.equal(current().battle, null);
    const fieldTime = current().field.time; await prepareImages(candidate.mediaUrls); flow.advance(500, ready);
    assert.equal(current().field.time, fieldTime); return { encounterId: candidate.content.encounterId };
  }, prepareReturn: async candidate => {
    assert.equal(flow.phase, "battle-return"); const before = owned({ current }), battle = current().battle;
    await prepareImages(fieldMediaUrls(current().field.content)); flow.advance(500, ready);
    assert.equal(current().battle, battle); assert.deepEqual(owned({ current }), before); return { outcome: candidate.outcome };
  }, discard: () => {} });
  const maps = new GameMapLoader(flow, repository, { prepare: async field => { await prepareImages(fieldMediaUrls(field.content)); return { field }; }, discard: () => {} });
  const tick = () => { flow.advance(10, ready); ticks++; };
  async function start() {
    const result = await entries.begin("new-game").prepare(async context => {
      const { field, battle, development } = await repository.opening(); assert.ok(development && context.isCurrent());
      const session = await prepareGameDevelopmentEntry(field, battle, development.catalog, development.map, runtime, 314);
      await prepareImages(fieldMediaUrls(session.field.content)); return { session, presentation: { field: session.field } };
    });
    assert.equal(result.status, "committed", String(result.error?.stack ?? result.error)); commands = new GameCommands(flow, result.session);
    flow.observeHost(ready); return result.session;
  }
  async function saveRestore() {
    const previous = current(), previousCommands = commands, checkpoint = previous.checkpoint();
    assert.equal(flow.pause(true), true); const ticket = flow.beginOperation("save"), prepared = await storage.prepareSave(checkpoint, ticks);
    assert.ok(ticket.isCurrent()); prepared.commit(); assert.equal(ticket.finish(), true);
    const result = await entries.begin("load").prepare(async context => {
      const saved = await storage.load(); assert.ok(saved && context.isCurrent());
      const content = await repository.restoreSessionContent(saved.checkpoint); assert.ok(context.isCurrent());
      const session = GameSession.restore(saved.checkpoint, content.initial, content.battle, content.world, runtime);
      await prepareImages(fieldMediaUrls(session.field.content)); return { session, presentation: { field: session.field }, options: { paused: true } };
    });
    assert.equal(result.status, "committed", String(result.error?.stack ?? result.error)); assert.notEqual(current(), previous);
    assert.deepEqual(current().checkpoint(), checkpoint); commands = new GameCommands(flow, current()); flow.observeHost(ready);
    assert.equal(previousCommands.menu({ kind: "change-party", change: { kind: "select-slot", slot: checkpoint.owned.party.selectedSlot } }), false);
    assert.deepEqual(previous.checkpoint(), checkpoint); assert.equal(flow.pause(false), true); flow.observeHost(ready);
    trace("restore", { selectedSlot: checkpoint.owned.party.selectedSlot, checkpointHash: await contentDigest(checkpoint), previousCommandsRejected: true });
    return checkpoint;
  }
  return { repository, flow, handoff, maps, start, saveRestore, tick, trace, current,
    get commands() { return commands; }, get ticks() { return ticks; }, get writes() { return writes; } };
}

function menu(h, change) {
  assert.equal(idle(h), true); assert.equal(h.flow.pause(true), true); assert.equal(h.commands.menuReady, true);
  const before = owned(h), result = h.commands.menu({ kind: "change-party", change });
  assert.equal(result, true, "Organization request had no accepted effect: " + JSON.stringify(change));
  const after = owned(h); assert.deepEqual(after.roster, before.roster, "Organization cannot change resources, gear, abilities or enabled ownership");
  assert.deepEqual({ ...after, party: before.party }, before, "Only PartyState may change");
  h.trace("menu", { change, selectedSlot: after.party.selectedSlot });
  assert.equal(h.flow.pause(false), true); h.flow.observeHost(ready); return { before, after };
}
function rejectMenu(h, change, pattern) {
  assert.equal(idle(h), true); assert.equal(h.flow.pause(true), true);
  const before = h.current().checkpoint();
  assert.throws(() => h.commands.menu({ kind: "change-party", change }), pattern);
  assert.deepEqual(h.current().checkpoint(), before, "Rejected organization must preserve both owned and field owners");
  assert.equal(h.flow.pause(false), true); h.flow.observeHost(ready);
}
async function playToIdle(h, encounterId = null) {
  let baseline = null, battle = null, returned = null, accepted = 0; const acceptedByOwner = {};
  for (let count = 0; count < 50000; count++) {
    const owner = h.current(), field = owner.field;
    assert.notEqual(field.stop?.kind, "unsupported", JSON.stringify(field.stop));
    if (field.stop?.kind === "map-transition") {
      const result = await h.maps.load(); assert.equal(result.status, "committed", String(result.error?.stack ?? result.error));
    } else if (!owner.battle && field.stop?.kind === "encounter") {
      assert.equal(battle, null); assert.equal(field.stop.party, encounterId); baseline = owned(h);
      const result = await h.handoff.start(); assert.equal(result.status, "committed", String(result.error?.stack ?? result.error));
      battle = owner.battle; assert.ok(battle); assert.equal(battle.content.encounterId, encounterId);
      assert.deepEqual(battle.players.map(player => ({ id: player.id, row: player.row })), selected(baseline), "Lease uses the actual selected saved group and rows");
      assert.deepEqual(owned(h), baseline);
      h.trace("battle-entry", { encounterId, selectedSlot: baseline.party.selectedSlot, players: battle.players.map(player => ({ id: player.id, sourceId: player.sourceId, row: player.row })) });
    } else if (owner.battle) {
      assert.equal(owner.battle, battle); assert.notEqual(battle.phase, "defeat", "Source-party inputs lost this controlled battle");
      if (battle.phase === "victory") {
        const reward = structuredClone(battle.reward); assert.ok(reward && reward.each > 0);
        assert.deepEqual(owned(h), baseline, "Victory presentation does not settle owned resources");
        assert.equal((await h.handoff.return()).status, "committed");
        const after = owned(h), activeIds = new Set(selected(baseline).map(cell => cell.id));
        assert.equal(after.gil, baseline.gil + reward.gil); assert.equal(after.completedBattles.length, baseline.completedBattles.length + 1);
        assert.deepEqual(after.party, baseline.party);
        for (const member of baseline.roster) {
          const actual = held(after, member.id);
          if (!activeIds.has(member.id)) assert.deepEqual(actual, member, "Off-party held resources and abilities cannot receive another participant's result");
          else {
            const runtimePlayer = battle.players.find(player => player.id === member.id);
            assert.equal(actual.exp, member.exp + (runtimePlayer.hp > 0 ? reward.each : 0));
            assert.deepEqual(actual.equipment, member.equipment);
          }
        }
        await assert.rejects(h.handoff.return(), /pending encounter or terminal battle/); assert.deepEqual(owned(h), after);
        returned = { baseline, after, reward, accepted, acceptedByOwner };
        h.trace("reward", { encounterId, reward, acceptedByOwner, duplicateReturnRejected: true });
      } else {
        assert.equal(battle.phase, "active");
        for (const actor of battle.ready) {
          const choices = battle.commandMenu(actor.id).filter(command => command.available && command.kind === "ability");
          // Steal and unknown plans are not replaced. Only real menu-admitted
          // Fight or the already-owned magitek command is submitted here.
          const injured = battle.players.find(player => player.hp > 0 && player.hp < player.maxHp * 0.4);
          const heal = injured && choices.find(command => command.abilityIds.includes(222));
          const choice = heal ?? choices.find(command => command.abilityIds.includes(218)) ?? choices.find(command => command.id === 1 && command.abilityIds.includes(1));
          assert.ok(choice, "No admitted ordinary Fight/Magitek action for owned " + actor.id);
          const abilityId = heal ? 222 : choice.abilityIds.includes(218) ? 218 : 1;
          const targets = battle.targetChoices(actor.id, abilityId), target = heal ? targets.find(target => target.targetIds.includes(injured.id)) : targets[0];
          assert.ok(target, "No current target for admitted ability " + abilityId);
          if (h.commands.command(battle, actor.id, abilityId, target.selection, choice.id)) {
            accepted++; acceptedByOwner[actor.id] = (acceptedByOwner[actor.id] ?? 0) + 1;
          }
        }
      }
    } else if (field.dialogue) assert.equal(h.flow.confirm(), true);
    else if (idle(h)) { if (encounterId !== null) assert.ok(returned?.accepted > 0); return returned; }
    h.tick();
  }
  throw new Error("Controlled organization route did not settle to an idle shared owner");
}
async function event(h, script) {
  assert.equal(idle(h), true); assert.equal(h.current().field.startEvent(script), true); await playToIdle(h);
  h.trace("source-lifecycle-event", { script });
}
async function move(h, direction, encounterId = null) {
  assert.equal(idle(h), true); assert.equal(h.flow.move(direction), true); return playToIdle(h, encounterId);
}

try {
  const refs = await createControlledPackage(), h = await createHost(refs); await h.start(); await playToIdle(h);
  const initial = owned(h); assert.equal(initial.roster.length, 3); assert.equal(initial.roster.some(member => member.sourceId === 2), false);
  const model = h.current().partyMenu(); assert.equal(model.slots.length, 3); assert.deepEqual(model.expected, initial.party);
  rejectMenu(h, { kind: "set-member", slot: 0, position: 3, ownedId: "player:2", row: "front" }, /unowned/);
  record("actual-initial-owners-and-all-three-saved-groups-are-read-without-granting-a-template");

  for (const slot of [1, 2]) menu(h, { kind: "set-member", slot, position: 3, ownedId: null, row: "back" });
  rejectMenu(h, { kind: "select-slot", slot: 1 }, /empty/);
  assert.equal(owned(h).party.selectedSlot, 0);
  record("inactive-groups-can-retain-empty-cells-and-rows-but-empty-selection-is-rejected");

  await event(h, "controlled_party_join");
  const joined = owned(h), newOwner = held(joined, "player:2");
  assert.equal(joined.roster.length, 4); assert.equal(newOwner.sourceId, 2); assert.equal(newOwner.ownedId, 4); assert.equal(newOwner.enabled, true);
  assert.equal(newOwner.hp, h.current().battleCatalog.gameState.characterInitializations["player:2"].initial.hp);
  assert.equal(newOwner.mp, h.current().battleCatalog.gameState.characterInitializations["player:2"].initial.mp);
  assert.equal(joined.party.slots[0][3].id, newOwner.id); assert.ok(h.current().field.partyActorCheckpoint);
  report.newOwner = structuredClone(newOwner);
  record("source-join-creates-the-fourth-held-owner-through-initialization-growth-and-real-party-actor-preparation");

  const removed = menu(h, { kind: "set-member", slot: 0, position: 1, ownedId: null, row: "back" });
  assert.deepEqual(held(removed.after, "player:31"), held(removed.before, "player:31"));
  menu(h, { kind: "set-member", slot: 1, position: 0, ownedId: "player:2", row: "front" });
  menu(h, { kind: "set-member", slot: 1, position: 2, ownedId: "player:1", row: "back" });
  menu(h, { kind: "set-member", slot: 2, position: 3, ownedId: "player:32", row: "back" });
  menu(h, { kind: "select-slot", slot: 2 });
  rejectMenu(h, { kind: "set-member", slot: 2, position: 3, ownedId: null, row: "front" }, /retain a member/);
  rejectMenu(h, { kind: "set-member", slot: 2, position: 0, ownedId: "player:32", row: "front" }, /[Dd]uplicate|[Rr]epeat/);
  rejectMenu(h, { kind: "set-member", slot: 2, position: 0, ownedId: "player:9999", row: "front" }, /unowned/);
  record("saved-group-selection-and-held-removal-preserve-resources-and-reject-active-empty-duplicate-and-unheld-members");

  await event(h, "controlled_party_secede"); const disabled = owned(h);
  assert.equal(held(disabled, "player:2").enabled, false);
  rejectMenu(h, { kind: "set-member", slot: 2, position: 0, ownedId: "player:2", row: "front" }, /unavailable/);
  rejectMenu(h, { kind: "select-slot", slot: 1 }, /unavailable/);
  assert.deepEqual(owned(h), disabled, "Organization never enables an owner disabled by the source lifecycle");
  await event(h, "controlled_party_join"); assert.equal(owned(h).roster.length, 4);
  record("disabled-held-owner-is-not-enabled-by-menu-and-source-rejoin-reuses-the-existing-owner");

  const stale = h.current().partyMenu().expected;
  menu(h, { kind: "set-member", slot: 0, position: 1, ownedId: "player:31", row: "front" });
  assert.equal(h.flow.pause(true), true); const beforeStale = h.current().checkpoint();
  assert.throws(() => h.commands.changeParty({ expected: stale, change: { kind: "select-slot", slot: 1 } }), /Stale/);
  assert.deepEqual(h.current().checkpoint(), beforeStale); assert.equal(h.flow.pause(false), true); h.flow.observeHost(ready);
  menu(h, { kind: "select-slot", slot: 1 });
  assert.equal(h.current().state.activeParty[0].id, "player:2");
  record("stale-ui-model-cannot-publish-and-source2-can-lead-the-actual-current-party");

  const first = await move(h, "up", 3002);
  assert.deepEqual(selected(first.baseline).map(cell => cell.id), ["player:2", "player:1"]);
  assert.ok(first.acceptedByOwner["player:2"] > 0, "New source2 owner must execute its actual admitted Fight command");
  assert.equal(first.after.completedBattles.at(-1).encounterId, 3002);
  record("selected-new-held-owner-and-rows-enter-the-real-lease-and-return-one-reward-with-off-party-resources-unchanged");

  const saved = await h.saveRestore(); assert.equal(saved.owned.party.selectedSlot, 1);
  assert.deepEqual(h.current().state.snapshot().party, first.after.party);
  menu(h, { kind: "set-member", slot: 2, position: 0, ownedId: null, row: "back" });
  menu(h, { kind: "set-member", slot: 2, position: 1, ownedId: "player:31", row: "front" });
  menu(h, { kind: "select-slot", slot: 2 });
  const secondSaved = await h.saveRestore(); assert.equal(secondSaved.owned.party.selectedSlot, 2);
  record("all-saved-layouts-and-selected-group-survive-real-checkpoint-storage-and-owner-rebinding");

  await move(h, "right"); assert.equal(h.current().field.content.map.identity.mapId, 900002);
  assert.deepEqual(owned(h), secondSaved.owned);
  const second = await move(h, "up", 517);
  assert.deepEqual(selected(second.baseline).map(cell => cell.id), ["player:31", "player:32"]);
  assert.deepEqual(held(second.after, "player:2"), held(second.baseline, "player:2"));
  assert.equal(second.after.completedBattles.length, 2); assert.equal(second.after.gil, initial.gil + first.reward.gil + second.reward.gil);
  await h.saveRestore();
  record("map-transition-and-next-battle-use-restored-selected-members-and-settle-once-with-new-owner-held-off-party");

  for (const [path, digest] of originalFiles) assert.equal(sha256(await readFile(path)), digest, "Checker changed or consumed changing source content " + path);
  report.runtimeSha256 = await runtimeDigest(root, compiled);
  report.originalFiles = Object.fromEntries([...originalFiles].map(([path, digest]) => [relative(root, path), digest]));
  report.requests = requests; report.requiredMedia = [...images].sort();
  report.journey = { maps: [900001, 900002], encounters: [3002, 517], selectedSlots: [0, 2, 1, 2],
    ticks: h.ticks, storageWrites: h.writes, initialGil: initial.gil, finalGil: h.current().gil,
    completedBattles: owned(h).completedBattles, finalParty: owned(h).party, finalCheckpointHash: await contentDigest(h.current().checkpoint()) };
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally { await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, tests: tests.length, report: relative(root, output) })); }
