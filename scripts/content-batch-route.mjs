import { sourceWebReplayRuntimePorts } from './source-web-replay-runtime.mjs';
// One reusable player-input driver. It never starts a script directly, edits
// flags/HP, swaps maps behind WorldSession, or constructs reward outcomes.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const contactDirection = { up: 1, right: 2, down: 4, left: 8 };
const position = player => ({ x: player.x, y: player.y, layer: player.layer });

/** A facing declaration consumes Field's same read-only target projection as
 * confirm, including declared counter relays. It never dispatches the VM. */
function facingTarget(field, input) {
  if (field.content.map.identity?.mapId !== input.mapId) return null;
  if (!field.collisionState.interactiveObservation || field.player.motion) return null;
  const entity = field.interactionTarget(input.direction), properties = entity?.npc ?? entity?.mapObject;
  if (!entity || entity.id !== input.entityId || !properties || ["none", "blocked"].includes(properties.interaction.kind))
    return null;
  if (properties.interaction.kind === "script" &&
      (!properties.interaction.script || !field.content.scripts[properties.interaction.script])) return null;
  return entity;
}

function declaredBattleReferences(battle, program) {
  const refs = new Map();
  for (const rule of program.rules) {
    const targets = rule.target.kind === "side" ? rule.target.members : [rule.target];
    for (const [role, identity] of [["actor", rule.actor], ...targets.map(target => ["target", target])]) {
      const matches = battle.combatants.filter(unit => unit.id === identity.id);
      assert.equal(matches.length, 1, `Declared battle ${role} was never present: ${identity.id}`);
      const unit = matches[0];
      assert.equal(unit.sourceId, identity.sourceId, `Declared battle ${role} source identity changed: ${identity.id}`);
      if (role === "actor") assert.equal(unit.side, "player", "Declared battle actor must be an owned player");
      refs.set(identity.id, unit);
    }
    const command = battle.content.commands[rule.commandId];
    assert.ok(command && command.kind === rule.action.kind, "Declared battle command identity or kind changed");
    assert.ok(battle.commandMenu(rule.actor.id).some(entry => entry.id === rule.commandId),
      "Declared battle command is not owned or released by its exact actor");
    if (rule.action.kind === "ability")
      assert.ok(command.abilityIds.includes(rule.action.abilityId) && battle.content.abilities[rule.action.abilityId],
        "Declared ability does not belong to its exact command");
    else assert.ok(battle.items[rule.action.itemId], "Declared battle item is unknown");
    if (rule.target.kind === "side") {
      const actual = battle.combatants.filter(unit => unit.side === rule.target.side)
        .map(unit => ({ id: unit.id, sourceId: unit.sourceId })).sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual([...targets].sort((a, b) => a.id.localeCompare(b.id)), actual,
        "Declared side does not bind the complete original live member domain");
    }
  }
  return refs;
}

/** Select one explicitly declared gesture for one ready player. No effect,
 * resource, target substitution or readiness is owned by this input driver. */
function declaredBattleInput(battle, program, refs, actor, channel) {
  const skippedTargets = [];
  const rules = program.rules.map((rule, ruleIndex) => ({ rule, ruleIndex }))
    .filter(({ rule }) => rule.actor.id === actor.id);
  assert.ok(rules.length, `Ready player has no declared battle inputs: ${actor.id}`);
  for (const { rule, ruleIndex } of rules) {
    assert.equal(actor, refs.get(rule.actor.id), "Declared battle actor instance changed");
    assert.equal(actor.sourceId, rule.actor.sourceId, "Declared battle actor source changed");
    const identities = rule.target.kind === "side" ? rule.target.members : [rule.target], targets = [];
    for (const identity of identities) {
      const target = battle.combatants.find(unit => unit.id === identity.id);
      assert.equal(target, refs.get(identity.id), "Declared battle target instance disappeared or changed");
      assert.equal(target.sourceId, identity.sourceId, "Declared battle target source changed");
      // Exit is an independent core projection, never guessed from absent target
      // choices, zero HP, an ability ID or a source condition name.
      const exited = target.side === "enemy" && typeof battle.enemyExitState === "function"
        ? battle.enemyExitState(target.id) : null;
      if (rule.target.ended === "skip" && (target.hp <= 0 || exited?.kind === "escaped")) {
        skippedTargets.push({ ruleIndex, target: structuredClone(identity),
          reason: exited?.kind === "escaped" ? "escaped" : "dead", exit: structuredClone(exited) }); continue;
      }
      targets.push(target);
    }
    if (!targets.length) continue;
    if (rule.when.kind === "target-resource-below") {
      const below = targets.some(target => { const maximum = rule.when.resource === "hp" ? target.maxHp : target.maxMp;
        return maximum > 0 && target[rule.when.resource] * 100 < maximum * rule.when.percent; });
      if (!below) continue;
      if (rule.avoidPendingRecovery) {
        const pending = [...battle.pendingActions, ...(battle.action && !battle.action.resolved ? [battle.action] : [])];
        const covered = pending.some(action => {
          const plan = action.source.kind === "ability" ? battle.content.abilities[action.source.id]?.plan
            : battle.items[action.source.id]?.uses.battle.plan;
          return plan?.effects.some(effect => effect.kind === "recovery" && effect.resource === rule.when.resource) &&
            action.targetIds.some(id => targets.some(target => target.id === id));
        });
        if (covered) continue;
      }
    }
    if (rule.minimumActorMp !== undefined && actor.mp < rule.minimumActorMp) continue;
    if (rule.minimumItemCount !== undefined &&
        (battle.inventory.find(stack => stack.id === rule.action.itemId)?.available ?? 0) < rule.minimumItemCount) continue;
    const menu = battle.commandMenu(actor.id).find(entry => entry.id === rule.commandId);
    assert.ok(menu?.available && menu.kind === rule.action.kind, "Selected battle command is unavailable for its declared actor");
    const choices = rule.action.kind === "ability"
      ? battle.targetChoices(actor.id, rule.action.abilityId)
      : battle.itemTargetChoices(actor.id, rule.action.itemId);
    const choice = choices.find(choice => rule.target.kind === "side"
      ? choice.selection.kind === "side" && choice.selection.side === rule.target.side &&
        JSON.stringify([...choice.targetIds].sort()) === JSON.stringify(targets.map(target => target.id).sort())
      : choice.selection.kind === "single" && choice.selection.id === targets[0].id &&
        choice.targetIds.length === 1 && choice.targetIds[0] === targets[0].id);
    assert.ok(choice, "Selected battle target is not a legal exact single target or complete declared side");
    const before = { actor: { hp: actor.hp, mp: actor.mp }, target: rule.target.kind === "side"
      ? { members: targets.map(target => ({ id: target.id, hp: target.hp, mp: target.mp })) }
      : { hp: targets[0].hp, mp: targets[0].mp },
      inventory: battle.inventory };
    const accepted = rule.action.kind === "ability"
      ? channel.command(battle, actor.id, rule.action.abilityId, choice.selection, rule.commandId)
      : channel.commandItem(battle, actor.id, rule.action.itemId, choice.selection, rule.commandId);
    assert.equal(accepted, true, "Selected declared battle input was rejected; no fallback is permitted");
    return { ruleIndex, rule: structuredClone(rule), before, selection: structuredClone(choice.selection),
      skippedTargets, ownerBound: channel.ownsBattle(battle) };
  }
  return null;
}

export async function runContentBatchRoute({ root, compiled = "dist", plan: suppliedPlan, routeId, repository, runtimeHash,
  captureFinalState = false, continuation = null }) {
  assert.equal(typeof captureFinalState, "boolean", "Final state capture must be an explicit boolean");
  // A continuation is independently identified evidence. It must never borrow
  // the new-game lane or be admitted as a route started from initialization.
  const resumed = continuation === null ? null : structuredClone(continuation);
  if (resumed) {
    assert.deepEqual(Object.keys(resumed).sort(), ["checkpoint", "checkpointHash", "predecessorRouteId"]);
    assert.equal(typeof resumed.predecessorRouteId, "string");
    assert.ok(resumed.predecessorRouteId.length > 0);
    assert.match(resumed.checkpointHash, /^[a-f0-9]{64}$/);
  }
  // Capture the entire nominated route before any await. A caller supplies only
  // its ID, never a different input program borrowing the manifest's identity.
  const plan = structuredClone(suppliedPlan), candidates = plan.manifest.routes.filter(route => route.id === routeId);
  assert.equal(candidates.length, 1, "Route must have one identity in the bound manifest");
  const route = candidates[0];
  const load = name => import(pathToFileURL(resolve(root, compiled, "src/core", name + ".js")));
  const [{ GameSession }, { GameFlow }, { GameMapLoader }, { CheckpointStorage }, { GameEventSaveCoordinator },
    { GameEntryLoader }, { GameBattleHandoff }, { GameCommands }, { prepareGameDevelopmentEntry },
    { NewGameFieldEntry }, { FieldFadeState }, { createSourcePresentationContext }, { contentDigest },
    { WEB_SOURCE_ENCOUNTER_POLICY }] = await Promise.all([
    load("game-session"), load("game-flow"), load("game-map-loader"), load("saved-game"), load("game-event-save"),
    load("game-entry-loader"), load("game-battle-handoff"), load("game-commands"), load("game-development-entry"),
    load("new-game-field-entry"), load("field-fade"), load("source-presentation"), load("content-integrity"),
    load("source-encounter-entry"),
  ]);
  const runtime = { ...sourceWebReplayRuntimePorts(), ...controlledAudioRuntime(), battleHandoff: "prepared", sourceEncounterPolicy: WEB_SOURCE_ENCOUNTER_POLICY,
    transportationTimestamp: () => "639273600000000000" };
  const host = { visible: true, mediaReady: true, overlayOpen: false };
  const extended = route.inputs.some(input => input.kind === "menu" || input.kind === "save-restore" ||
    input.kind === "shop" || input.kind === "leave-shop");
  const program = { inputCount: 0, menuCount: 0, restoreCount: 0, postRestoreInputCount: 0 };
  let restoredDuringProgram = false;
  const receipt = { kind: "content-batch-route-receipt-v1", routeId: route.id,
    manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: structuredClone(plan.contentHashes), profile: plan.manifest.profile,
    lane: resumed ? "story-checkpoint-continuation" : route.entry === "source-new-game" ? "source-profile" :
      route.entry === "development-map" ? "source-content-development" :
      route.entry === "framework-new-game" ? "framework-initialized" : "synthetic-controlled",
    result: "blocked", visitedMapIds: [], completedEncounterIds: [], finalMapId: route.expectedMapId,
    checkpointReady: false, saveRestored: false,
    controls: ["10ms headless host; media and audio output immediately ready", "in-memory real checkpoint codec/storage",
      "GameEntryLoader entry/restore, prepared GameBattleHandoff and owner-bound GameCommands",
      "fixed explicit transportation timestamp", "manifest player inputs, choice answers and battle abilities",
      extended ? "only declared menu/shop mutations and stable-field restore relays"
        : "pause-menu readiness only; no undeclared menu mutation"], boundary: null,
    ...(extended ? { program } : {}) };
  const trace = [], flow = new GameFlow();
  const entries = new GameEntryLoader(flow, { discard: () => {} });
  const execution = { entry: "GameEntryLoader", battleHandoff: "prepared", commands: "GameCommands",
    entriesCommitted: 0, loadsCommitted: 0, preparedStarts: 0, committedStarts: 0,
    preparedReturns: 0, committedReturns: 0, duplicateReturnsRejected: 0, staleCommandChannelsRejected: 0 };
  let commandChannel = null, maps = null, saves = null;
  let initialOwned = null, firstStableCheckpoint = null, pendingDoor = null;
  let ticks = 0, inputIndex = 0, answerIndex = 0, commands = 0, checkpointHash = null;
  const current = () => flow.session;
  const completeInput = input => {
    program.inputCount++;
    if (restoredDuringProgram && input.kind !== "save-restore") program.postRestoreInputCount++;
    trace.push({ kind: "input", inputIndex, input }); inputIndex++;
  };
  const handoff = new GameBattleHandoff(flow, {
    prepareStart: async view => {
      const owner = current(), field = owner.field, time = field.time;
      assert.equal(owner.battle, null, "A pending batch encounter must not publish an active battle");
      assert.equal(owner.state.inBattle, true, "Preparation uses the existing owned battle lease");
      assert.equal(flow.phase, "battle-entry"); assert.equal(commandChannel.battleReady, false);
      assert.ok(plan.dependencies.encounterIds.includes(view.content.encounterId), "Unscanned battle preparation");
      const mediaUrls = [...view.mediaUrls];
      assert.ok(mediaUrls.length > 0 && mediaUrls.every(url => typeof url === "string" && url.length > 0));
      // This host declares media immediately ready, but still crosses the real
      // asynchronous preparation fence. Elapsed while preparing is dropped.
      flow.advance(10, host); await Promise.resolve();
      assert.equal(owner.field, field); assert.equal(field.time, time); assert.equal(owner.battle, null);
      execution.preparedStarts++;
      trace.push({ kind: "battle-preparation", operation: view.kind, encounterId: view.content.encounterId,
        phase: flow.phase, activeBattle: false, elapsedDropped: true, mediaUrls });
      return { kind: "battle", encounterId: view.content.encounterId, mediaUrls };
    },
    prepareReturn: async view => {
      const owner = current(), battle = owner.battle, before = await contentDigest(owner.state.snapshot());
      assert.equal(view.outcome, "victory"); assert.equal(battle?.phase, "victory");
      assert.equal(owner.state.inBattle, true); assert.equal(flow.phase, "battle-return");
      assert.equal(commandChannel.canReturnBattle(battle), false, "The I/O ticket fences terminal buttons too");
      flow.advance(10, host); await Promise.resolve();
      assert.equal(owner.battle, battle); assert.equal(await contentDigest(owner.state.snapshot()), before);
      execution.preparedReturns++;
      trace.push({ kind: "battle-preparation", operation: view.kind, encounterId: view.content.encounterId,
        phase: flow.phase, terminalBattleRetained: true, ownedUnchanged: true, elapsedDropped: true });
      return { kind: "field", encounterId: view.content.encounterId };
    },
    discard: () => {},
  });
  const visit = () => {
    const mapId = current().field.content.map.identity?.mapId;
    assert.ok(Number.isInteger(mapId), "Missing current map identity");
    receipt.finalMapId = mapId;
    if (!receipt.visitedMapIds.includes(mapId)) receipt.visitedMapIds.push(mapId);
    assert.ok(plan.manifest.mapIds.includes(mapId), "Route reached a map outside its batch");
  };
  const tick = () => { flow.advance(10, host); ticks++; };
  const bound = (key, value) => {
    assert.equal(value.contentHash, plan.contentHashes[key], `Route dependency changed: ${key}`);
    return value;
  };
  const boundMaps = {
    world: async () => bound("world", await repository.world()),
    map: async (id, catalog) => {
      bound("world", catalog);
      return bound(`map:${id}`, await repository.map(id, catalog));
    },
  };
  try {
    assert.equal(await contentDigest(plan.manifest), plan.manifestHash, "Route manifest payload changed");
    // This also binds controlled entries which do not otherwise fetch a world
    // catalog until their first transition. Every later map read is rechecked
    // before WorldSession prepares or publishes any state.
    await boundMaps.world();
    const startAttempt = entries.begin(resumed ? "load" : "new-game");
    let started;
    if (resumed) {
      assert.equal(await contentDigest(resumed.checkpoint), resumed.checkpointHash, "Continuation checkpoint changed");
      started = await startAttempt.prepare(async context => {
        const packages = await repository.restoreSessionContent(resumed.checkpoint);
        assert.ok(context.isCurrent(), "Story continuation restore was cancelled");
        bound("battle", packages.battle);
        if (packages.initial) bound("entry", packages.initial);
        if (packages.world) {
          bound("world", packages.world.catalog); bound(`map:${packages.world.map.mapId}`, packages.world.map);
          if (packages.world.source) {
            bound("entry", packages.world.source.content);
            bound(`map:${packages.world.source.initialMap.mapId}`, packages.world.source.initialMap);
          }
          if (packages.world.initialized) {
            bound("entry", packages.world.initialized.content);
            bound(`map:${packages.world.initialized.initialMap.mapId}`, packages.world.initialized.initialMap);
          }
        }
        const session = GameSession.restore(resumed.checkpoint, packages.initial, packages.battle, packages.world, runtime);
        assert.equal(await contentDigest(session.checkpoint()), resumed.checkpointHash, "Story continuation replayed initialization");
        return { session, presentation: { mapId: session.field.content.map.identity.mapId } };
      });
      trace.push({ kind: "story-continuation", predecessorRouteId: resumed.predecessorRouteId,
        checkpointHash: resumed.checkpointHash, entry: "GameEntryLoader", initializationReplayed: false });
    } else if (route.entry === "framework-new-game") {
      started = await startAttempt.prepare(async context => {
        const { content, catalog, map, battle } = await repository.initializedNewGame();
        assert.ok(context.isCurrent(), "Initialized framework route entry was cancelled");
        assert.equal(content.contentHash, plan.contentHashes.entry);
        assert.equal(battle.contentHash, plan.contentHashes.battle);
        bound("world", catalog); bound(`map:${map.mapId}`, map);
        const session = await GameSession.prepareFrameworkNewGame(content, catalog, map, battle, runtime, 314);
        assert.ok(context.isCurrent(), "Initialized framework route entry became obsolete");
        return { session, presentation: { mapId: map.mapId } };
      });
    } else if (route.entry === "source-new-game") {
      // This path deliberately does not fetch the legacy opening field package.
      const { content, catalog, map, battle } = await repository.sourceNewGame();
      assert.equal(content.contentHash, plan.contentHashes.entry);
      assert.equal(catalog.contentHash, plan.contentHashes.world);
      assert.equal(battle.contentHash, plan.contentHashes.battle);
      bound(`map:${map.mapId}`, map);
      const presentation = createSourcePresentationContext({ kind: "title-new-game",
        titleCleanupComplete: true, openingCallbackStarted: false });
      const entry = new NewGameFieldEntry(content.entry, presentation);
      const titleFade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
        rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
      const start = entry.prepareStart(titleFade, { active: true, callbacks: "absent" });
      start.commit(); let fade = start.fade; fade.advance(0.51);
      for (let i = 0; entry.phase !== "field-preparing"; i++) {
        assert.ok(i < 16, "Title entry did not finish");
        const next = entry.prepareResume(fade, true); assert.ok(next); next.commit(); fade = next.fade;
      }
      const game = GameSession.prepareNewGame(content, catalog, map, battle, fade, presentation, runtime);
      const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
      game.launchNewGame(launch.launch); launch.commit();
      started = startAttempt.commit({ session: game, presentation: { mapId: map.mapId } });
    } else {
      started = await startAttempt.prepare(async context => {
        const { field, battle, development } = await repository.opening();
        assert.ok(context.isCurrent(), "Route entry was cancelled");
        assert.equal(field.contentHash, plan.contentHashes.entry); assert.equal(battle.contentHash, plan.contentHashes.battle);
        let session;
        if (route.entry === "development-map") {
          assert.ok(development, "Declared development map entry is missing its trusted dependencies");
          bound("world", development.catalog); bound(`map:${development.map.mapId}`, development.map);
          session = await prepareGameDevelopmentEntry(field, battle, development.catalog, development.map, runtime, 314);
          assert.ok(context.isCurrent(), "Development map entry became obsolete");
        } else {
          assert.equal(development, undefined, "A controlled fixture cannot borrow a development map entry");
          session = new GameSession(field, battle, 314, runtime);
        }
        return { session, presentation: { mapId: session.field.content.map.identity.mapId } };
      });
    }
    if (started.status !== "committed") throw started.error ?? new Error("Route entry did not commit: " + started.status);
    execution.entriesCommitted++;
    if (captureFinalState) initialOwned = structuredClone(started.session.state.snapshot());
    commandChannel = new GameCommands(flow, started.session);
    assert.equal(commandChannel.settingsReady, false, "An entry clears previous media readiness");
    flow.advance(0, host); visit(); trace.push({ kind: "start", mapId: receipt.finalMapId,
      entry: "GameEntryLoader", battleHandoff: "prepared", commandOwnerBound: commandChannel.owner === current() });
    let owner = current(), state = owner.state, world = owner.world;
    maps = new GameMapLoader(flow, boundMaps, {
      prepare: async field => { assert.notEqual(field, current().field); return null; }, discard: () => {},
    });
    const bytes = new Map();
    const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
      setItem: (key, value) => bytes.set(key, value) }, "framework");
    saves = new GameEventSaveCoordinator(flow, storage);
    // Final and declared mid-route restores use the same storage, trusted
    // Repository, runtime options and entry publication transaction. A restore
    // never replays field initialization or grants another battle result.
    const saveRestore = async final => {
      const previous = current(), previousState = previous.state, previousWorld = previous.world,
        previousCommands = commandChannel, previousPaused = flow.paused;
      assert.equal(previous.checkpointReady, true);
      assert.equal(flow.pause(true), true);
      const checkpoint = previous.checkpoint(), digest = await contentDigest(checkpoint);
      checkpointHash = digest;
      const saveTicket = flow.beginOperation("save");
      try {
        const prepared = await storage.prepareSave(checkpoint, ticks);
        assert.equal(saveTicket.isCurrent(), true); prepared.commit(); assert.equal(saveTicket.finish(), true);
      } catch (error) {
        saveTicket.cancel();
        assert.equal(current(), previous); assert.equal(await contentDigest(previous.checkpoint()), digest);
        assert.equal(flow.pause(previousPaused), true); flow.observeHost(host);
        throw error;
      }
      const loadAttempt = entries.begin("load");
      const loaded = await loadAttempt.prepare(async context => {
        const saved = await storage.load(); assert.ok(saved);
        assert.ok(context.isCurrent(), "Route restore was cancelled");
        const packages = await repository.restoreSessionContent(saved.checkpoint);
        assert.ok(context.isCurrent(), "Route restore content became obsolete");
        bound("battle", packages.battle);
        if (packages.initial) bound("entry", packages.initial);
        if (packages.world) {
          bound("world", packages.world.catalog); bound(`map:${packages.world.map.mapId}`, packages.world.map);
          if (packages.world.source) {
            bound("entry", packages.world.source.content);
            bound(`map:${packages.world.source.initialMap.mapId}`, packages.world.source.initialMap);
          }
          if (packages.world.initialized) {
            bound("entry", packages.world.initialized.content);
            bound(`map:${packages.world.initialized.initialMap.mapId}`, packages.world.initialized.initialMap);
          }
        }
        const restored = GameSession.restore(saved.checkpoint, packages.initial, packages.battle, packages.world, runtime);
        assert.equal(await contentDigest(restored.checkpoint()), digest, "Restore replayed or lost state");
        return { session: restored, presentation: { mapId: receipt.finalMapId }, options: { paused: true } };
      });
      if (loaded.status !== "committed") {
        assert.equal(current(), previous); assert.equal(current().state, previousState); assert.equal(current().world, previousWorld);
        assert.equal(await contentDigest(previous.checkpoint()), digest, "Failed restore changed the published owner");
        assert.equal(flow.pause(previousPaused), true); flow.observeHost(host);
        trace.push({ kind: "save-restore-failed", final, status: loaded.status, ownerRetained: true,
          checkpointHash: digest, paused: flow.paused });
        receipt.boundary = { kind: "save-restore", status: loaded.status, reason: String(loaded.error ?? loaded.status) };
        return false;
      }
      execution.loadsCommitted++;
      owner = loaded.session; state = owner.state; world = owner.world;
      commandChannel = new GameCommands(flow, owner);
      assert.equal(flow.paused, true); assert.equal(commandChannel.menuReady, false);
      assert.equal(previousCommands.setBattlePreferences(previous.battlePreferences), false);
      assert.equal(await contentDigest(previous.checkpoint()), digest);
      assert.equal(await contentDigest(owner.checkpoint()), digest, "An obsolete command cannot edit the restored owner");
      execution.staleCommandChannelsRejected++;
      flow.observeHost(host); assert.equal(commandChannel.menuReady, true);
      assert.equal(flow.pause(final), true); flow.observeHost(host);
      visit(); program.restoreCount++;
      trace.push({ kind: "save-restore", checkpointHash: digest, menuReady: commandChannel.menuReady,
        entry: "GameEntryLoader", paused: flow.paused, staleCommandsRejected: true,
        ...(extended ? { final, inputIndex: final ? null : inputIndex,
          continued: !final, ownerRebound: commandChannel.owner === owner, completedBattles: state.snapshot().completedBattles.length } : {}) });
      return true;
    };
    let seenBattle = null, battleProgram = null, battleRefs = null;
    const actionStarts = new WeakSet(), actionResolutions = new WeakSet();
    const battleUnits = battle => battle.combatants.map(unit => ({ id: unit.id, sourceId: unit.sourceId,
      side: unit.side, hp: unit.hp, maxHp: unit.maxHp, mp: unit.mp, maxMp: unit.maxMp,
      conditionIds: [...unit.conditionIds], exit: unit.side === "enemy" && typeof battle.enemyExitState === "function"
        ? battle.enemyExitState(unit.id) : null }));
    const ordinaryReturns=new Map();
    while (ticks < route.maxTicks) {
      assert.equal(current(), owner); assert.equal(current().state, state); assert.equal(current().world, world);
      const game = current(), field = game.field;
      if (game.eventSaveRequest) {
        const result = await saves.save(ticks);
        if (result.status !== "committed") throw new Error("Event save did not commit: " + result.status);
        trace.push({ kind: "event-save", mapId: receipt.finalMapId }); tick(); continue;
      }
      if (field.stop?.kind === "unsupported") { receipt.boundary = structuredClone(field.stop); break; }
      if (pendingDoor) {
        assert.equal(game, pendingDoor.owner, "A door cannot transfer the session owner");
        assert.equal(field, pendingDoor.field, "A door must finish in its existing field");
        if (game.checkpointReady) {
          assert.equal(field.player.motion, null);
          assert.deepEqual(position(field.player), pendingDoor.position, "Door opening cannot move the player");
          assert.ok(field.checkpoint().doors.opened.includes(pendingDoor.entityId), "Declared door did not finish");
          assert.equal(field.tileAnimations.isPlaying(pendingDoor.regionId), false);
          trace.push({ kind: "door-complete", inputIndex: pendingDoor.inputIndex, mapId: pendingDoor.mapId,
            entityId: pendingDoor.entityId, regionId: pendingDoor.regionId, ownerRetained: true });
          pendingDoor = null;
        }
      }
      if (field.stop?.kind === "map-transition") {
        const request = field.stop.request, from = receipt.finalMapId;
        if (!plan.manifest.mapIds.includes(request.mapId)) {
          receipt.boundary = { kind: "outside-batch", request: structuredClone(request) }; break;
        }
        const before = await contentDigest(state.snapshot()), result = await maps.load();
        if (result.status !== "committed") {
          assert.equal(current().field, field); assert.equal(await contentDigest(state.snapshot()), before);
          receipt.boundary = { kind: "map-load", status: result.status, reason: String(result.error ?? result.status) }; break;
        }
        // Repository validates payload and catalog links; the batch additionally
        // binds its exact declared package version.
        assert.equal(result.field.content.contentHash, plan.contentHashes[`map:${request.mapId}`]);
        visit(); trace.push({ kind: "map", from, to: receipt.finalMapId }); tick(); continue;
      }
      if (!game.battle && field.stop?.kind === "encounter") {
        const request = field.stop, before = await contentDigest(state.snapshot()),
          position={x:field.player.x,y:field.player.y,layer:field.player.layer},result = await handoff.start();
        if (result.status !== "committed") {
          assert.equal(game.battle, null); assert.equal(field.stop, request);
          assert.equal(await contentDigest(state.snapshot()), before);
          receipt.boundary = { kind: "battle-entry", status: result.status, reason: String(result.error ?? result.status) }; break;
        }
        execution.committedStarts++;
        assert.equal(result.session, owner); assert.equal(result.request, request);
        if(request.returnTo?.kind==='field-idle'){
          assert.ok(game.battle);ordinaryReturns.set(game.battle,{field,position});
          trace.push({kind:'ordinary-walking-entry',id:game.battle.content.encounterId,position,
            sourceSetBound:field.content.walkEncounters!==undefined});
        }
        flow.advance(0, host); tick(); continue;
      }
      const battle = game.battle;
      if (battle) {
        assert.ok(plan.dependencies.encounterIds.includes(battle.content.encounterId),
          "Route reached an encounter outside the scanned dependencies");
        if (battle !== seenBattle) {
          trace.push({ kind: "battle", id: battle.content.encounterId }); seenBattle = battle;
          if (route.battleInputs) {
            battleProgram = route.battleInputs.find(input => input.encounterId === battle.content.encounterId);
            assert.ok(battleProgram, "Encounter has no exact declared battle input program");
            try { battleRefs = declaredBattleReferences(battle, battleProgram); }
            catch (error) {
              receipt.boundary = { kind: "rejected-battle-input", encounterId: battle.content.encounterId,
                reason: String(error.message ?? error) }; break;
            }
          }
        }
        if (route.battleInputs && battle.action) {
          const action = battle.action;
          if (!actionStarts.has(action)) {
            actionStarts.add(action);
            trace.push({ kind: "declared-battle-action-start", encounterId: battle.content.encounterId,
              battleSerial: game.state.snapshot().completedBattles.length, time: battle.time,
              action: structuredClone(action) });
          }
          if (action.resolved && !actionResolutions.has(action)) {
            actionResolutions.add(action);
            trace.push({ kind: "declared-battle-action-resolved", encounterId: battle.content.encounterId,
              battleSerial: game.state.snapshot().completedBattles.length, time: battle.time,
              action: structuredClone(action), units: battleUnits(battle), inventory: battle.inventory });
          }
        }
        if (battle.phase === "victory") {
          const id = battle.content.encounterId, before = game.gil;
          if (route.battleInputs) trace.push({ kind: "declared-battle-outcome", encounterId: id,
            battleSerial: game.state.snapshot().completedBattles.length, phase: battle.phase,
            units: battleUnits(battle), inventory: battle.inventory,
            participants: battle.participantExecution, reward: structuredClone(battle.reward) });
          assert.equal(commandChannel.canReturnBattle(battle), true);
          const result = await handoff.return();
          if (result.status !== "committed") {
            assert.equal(game.battle, battle); assert.equal(game.gil, before);
            receipt.boundary = { kind: "battle-return", status: result.status, reason: String(result.error ?? result.status) }; break;
          }
          execution.committedReturns++;
          const ordinary=ordinaryReturns.get(battle);
          if(ordinary){
            assert.equal(game.field,ordinary.field,'Ordinary battle must return to the same published field');
            assert.deepEqual({x:game.field.player.x,y:game.field.player.y,layer:game.field.player.layer},ordinary.position,
              'Ordinary return must not reinitialize or relocate the player');
            trace.push({kind:'ordinary-walking-return',id,position:ordinary.position,sameField:true,positionRetained:true});
          }
          const returned = await contentDigest(state.snapshot());
          await assert.rejects(handoff.return(), /pending encounter or terminal battle/);
          assert.equal(await contentDigest(state.snapshot()), returned, "Duplicate return cannot settle another reward");
          execution.duplicateReturnsRejected++;
          receipt.completedEncounterIds.push(id);
          trace.push({ kind: "victory", id, gilAward: game.gil - before, handoff: "prepared",
            completedBattles: state.snapshot().completedBattles.length, duplicateReturnRejected: true }); tick(); continue;
        }
        if (battle.phase === "defeat") { receipt.boundary = { kind: "defeat", encounterId: battle.content.encounterId }; break; }
        if (route.battleInputs) {
          for (const actor of battle.ready) {
            let dispatched;
            try { dispatched = declaredBattleInput(battle, battleProgram, battleRefs, actor, commandChannel); }
            catch (error) {
              receipt.boundary = { kind: "rejected-battle-input", encounterId: battle.content.encounterId,
                actorId: actor.id, reason: String(error.message ?? error) }; break;
            }
            if (dispatched) {
              commands++;
              trace.push({ kind: "declared-battle-input", encounterId: battle.content.encounterId,
                battleSerial: game.state.snapshot().completedBattles.length, time: battle.time, ...dispatched });
            }
          }
          if (receipt.boundary) break;
        } else {
          if (route.battleAbilityIds.length === 0) { receipt.boundary = { kind: "missing-battle-input", encounterId: battle.content.encounterId }; break; }
          for (const actor of battle.ready) {
            for (const abilityId of route.battleAbilityIds) {
              const target = battle.targetChoices(actor.id, abilityId)[0];
              if (target && commandChannel.command(battle, actor.id, abilityId, target.selection)) { commands++; break; }
            }
          }
        }
      } else if (field.choice) {
        const answer = route.choiceAnswers[answerIndex++];
        if (answer === undefined) { receipt.boundary = { kind: "missing-choice-input", requestId: field.choice.id }; break; }
        assert.equal(flow.choose(field.choice.id, answer), true);
      } else if (field.dialogue) {
        const message = field.dialogue;
        trace.push({ kind: "message-confirm", mapId: receipt.finalMapId, taskId: message.task,
          key: message.key, speaker: message.speaker, text: message.text,
          documentHash: await contentDigest({ key: message.key, speaker: message.speaker, text: message.text }) });
        assert.equal(flow.confirm(), true);
      } else if (field.currentShop) {
        const input = route.inputs[inputIndex], shop = field.currentShop;
        if (!input || input.kind !== "shop" && input.kind !== "leave-shop") {
          receipt.boundary = { kind: "shop-input-not-declared" }; break;
        }
        const shopOwner = current(), channel = commandChannel, before = await contentDigest(state.snapshot());
        const matchesRequest = () => current() === shopOwner && shopOwner.field === field &&
          channel.owner === shopOwner && field.currentShop?.id === shop.id &&
          field.currentShop?.groupId === shop.groupId && field.currentShop?.entityId === shop.entityId;
        if (input.groupId !== shop.groupId || !matchesRequest() || !channel.shopReady) {
          assert.equal(await contentDigest(state.snapshot()), before);
          receipt.boundary = { kind: "rejected-shop-input", inputIndex, input,
            reason: input.groupId !== shop.groupId ? "shop-group-mismatch" : "shop-owner-or-request-unavailable" };
          break;
        }
        let result;
        try {
          result = input.kind === "shop" ? channel.tradeShop(input.request) : channel.closeShop(shop.id);
        } catch (error) {
          assert.equal(await contentDigest(state.snapshot()), before, "A rejected shop transaction cannot partly publish");
          throw error;
        }
        const accepted = input.kind === "shop" ? result !== null : result === true;
        if (!accepted) {
          assert.equal(await contentDigest(state.snapshot()), before);
          receipt.boundary = { kind: "rejected-shop-input", inputIndex, input, reason: "shop-command-rejected" }; break;
        }
        assert.equal(current(), shopOwner); assert.equal(shopOwner.field, field);
        if (input.kind === "shop") {
          assert.ok(matchesRequest(), "A trade must retain its field shop request");
          assert.equal(result.groupId, shop.groupId);
        }
        trace.push({ kind: "shop-command", inputIndex, shop: structuredClone(shop), input: structuredClone(input),
          ownerBound: channel.owner === shopOwner, accepted, result: structuredClone(result) });
        completeInput(input);
      } else if (game.checkpointReady) {
        if (captureFinalState && firstStableCheckpoint === null)
          firstStableCheckpoint = structuredClone(game.checkpoint());
        const input = route.inputs[inputIndex];
        if (input) {
          let accepted;
          if (input.kind === "save-restore") {
            accepted = await saveRestore(false);
            if (!accepted) break;
            restoredDuringProgram = true;
          } else if (input.kind === "menu") {
            const menuOwner = current(), paused = flow.paused;
            assert.equal(flow.pause(true), true); assert.equal(commandChannel.menuReady, true);
            const before = await contentDigest(menuOwner.checkpoint());
            const beforeOwned = route.battleInputs ? structuredClone(menuOwner.state.snapshot()) : null;
            try {
              accepted = commandChannel.menu(input.command);
              if (!accepted) assert.equal(await contentDigest(menuOwner.checkpoint()), before,
                "A rejected declared menu command cannot change owned state");
            } finally {
              assert.equal(current(), menuOwner); assert.equal(flow.pause(paused), true); flow.observeHost(host);
            }
            if (accepted) program.menuCount++;
            trace.push({ kind: "menu-command", inputIndex, command: structuredClone(input.command),
              accepted, ownerBound: commandChannel.owner === menuOwner, pauseRestored: flow.paused === paused,
              ...(route.battleInputs ? { beforeOwned, afterOwned: structuredClone(menuOwner.state.snapshot()) } : {}) });
          } else if (input.kind === "move" || input.kind === "face") {
            const before = position(field.player), beforeMotion = field.player.motion;
            if (input.kind === "face" && !facingTarget(field, input)) {
              receipt.boundary = { kind: "rejected-face-input", inputIndex, input,
                reason: "live-facing-target-unavailable" }; break;
            }
            const result = flow.directionInput(input.direction);
            assert.equal(current(), game); assert.equal(game.field, field);
            if (input.kind === "face") {
              accepted = result.kind === "facing" && beforeMotion === null && field.player.motion === null &&
                field.player.x === before.x && field.player.y === before.y && field.player.layer === before.layer &&
                field.player.direction === input.direction && facingTarget(field, input) !== null;
            } else {
              accepted = result.kind === "movement" || result.kind === "door";
              if (result.kind === "door") {
                const entity = field.entities.find(entity => entity.id === result.entityId);
                const region = field.entities.find(entity => entity.id === result.regionId);
                assert.ok(entity?.kind === 8 && field.isEntityVisible(entity.id) && region?.kind === 1 &&
                  entity.openTrigger?.linkObject === (region.objectId ?? 0) &&
                  (entity.openTrigger.direction & contactDirection[input.direction]), "Unbound source door contact");
                assert.equal(field.player.motion, null); assert.deepEqual(position(field.player), before);
                assert.equal(field.busy, true, "A door input must await its existing owner");
                pendingDoor = { owner: game, field, position: before, inputIndex,
                  mapId: receipt.finalMapId, entityId: entity.id, regionId: region.id };
                receipt.controls.push(`door-contact map:${receipt.finalMapId} entity:${entity.id} region:${region.id}`);
              }
            }
            trace.push({ kind: "direction-input", inputIndex, input: structuredClone(input),
              result: structuredClone(result), before, after: position(field.player), accepted });
          }
          else if (input.kind === "confirm") accepted = flow.confirm();
          else if (input.kind === "shop" || input.kind === "leave-shop") {
            receipt.boundary = { kind: "rejected-shop-input", inputIndex, input, reason: "no-open-shop" }; break;
          }
          else throw new Error("Unknown declared route input: " + input.kind);
          if (!accepted) { receipt.boundary = { kind: "rejected-player-input", inputIndex, input }; break; }
          completeInput(input);
        } else {
          const missingMaps = route.requiredMapIds.filter(id => !receipt.visitedMapIds.includes(id));
          const missingEncounters = route.requiredEncounterIds.filter(id => !receipt.completedEncounterIds.includes(id));
          if (receipt.finalMapId !== route.expectedMapId || missingMaps.length || missingEncounters.length || answerIndex !== route.choiceAnswers.length) {
            receipt.boundary = { kind: "wrong-route-exit", missingMaps, missingEncounters, unusedAnswers: route.choiceAnswers.length - answerIndex }; break;
          }
          assert.equal(game.menuReady, true, "Stable exit must support the shared menu");
          assert.equal(flow.pause(true), true); assert.equal(commandChannel.menuReady, true);
          trace.push({ kind: "menu-ready", ownerBound: commandChannel.owner === game, commandReady: true,
            mutation: "none", phase: flow.phase });
          if (!await saveRestore(true)) break;
          receipt.saveRestored = true; receipt.result = "completed";
          break;
        }
      }
      tick();
    }
    if (ticks >= route.maxTicks && receipt.result !== "completed") receipt.boundary = { kind: "time-limit", ticks };
  } catch (error) {
    receipt.result = "failed"; receipt.boundary = { kind: "exception", reason: String(error.stack ?? error) };
  } finally {
    // Release only these coordinators' pending candidates. Fatal publication
    // still remains a failed receipt, never a successful retry or new reward.
    for (const coordinator of [entries, handoff, maps, saves]) {
      try { coordinator?.cancel(); }
      catch (error) {
        if (receipt.boundary === null) {
          receipt.result = "failed"; receipt.boundary = { kind: "cleanup", reason: String(error.stack ?? error) };
        }
      }
    }
  }
  if (flow.hasSession) {
    receipt.finalMapId = current().field.content.map.identity?.mapId ?? receipt.finalMapId;
    receipt.checkpointReady = current().checkpointReady;
  }
  receipt.completedEncounterIds = [...new Set(receipt.completedEncounterIds)];
  return { receipt, trace, execution, elapsedMs: ticks * 10, commands, checkpointHash,
    ...(captureFinalState ? { finalState: structuredClone({ initialOwned, firstStableCheckpoint,
      finalOwned: flow.hasSession ? current().state.snapshot() : null,
      checkpoint: flow.hasSession && current().checkpointReady ? current().checkpoint() : null }) } : {}) };
}
