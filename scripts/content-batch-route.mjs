// One reusable player-input driver. It never starts a script directly, edits
// flags/HP, swaps maps behind WorldSession, or constructs reward outcomes.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

export async function runContentBatchRoute({ root, compiled = "dist", plan: suppliedPlan, routeId, repository, runtimeHash }) {
  // Capture the entire nominated route before any await. A caller supplies only
  // its ID, never a different input program borrowing the manifest's identity.
  const plan = structuredClone(suppliedPlan), candidates = plan.manifest.routes.filter(route => route.id === routeId);
  assert.equal(candidates.length, 1, "Route must have one identity in the bound manifest");
  const route = candidates[0];
  const load = name => import(pathToFileURL(resolve(root, compiled, "src/core", name + ".js")));
  const [{ GameSession }, { GameFlow }, { GameMapLoader }, { CheckpointStorage }, { GameEventSaveCoordinator },
    { GameEntryLoader }, { GameBattleHandoff }, { GameCommands },
    { NewGameFieldEntry }, { FieldFadeState }, { createSourcePresentationContext }, { contentDigest }] = await Promise.all([
    load("game-session"), load("game-flow"), load("game-map-loader"), load("saved-game"), load("game-event-save"),
    load("game-entry-loader"), load("game-battle-handoff"), load("game-commands"),
    load("new-game-field-entry"), load("field-fade"), load("source-presentation"), load("content-integrity"),
  ]);
  const runtime = { ...controlledAudioRuntime(), battleHandoff: "prepared",
    transportationTimestamp: () => "639273600000000000" };
  const host = { visible: true, mediaReady: true, overlayOpen: false };
  const receipt = { kind: "content-batch-route-receipt-v1", routeId: route.id,
    manifestHash: plan.manifestHash, dependencyHash: plan.dependencyHash, runtimeHash,
    contentHashes: structuredClone(plan.contentHashes), profile: plan.manifest.profile,
    lane: route.entry === "source-new-game" ? "source-profile" : "synthetic-controlled",
    result: "blocked", visitedMapIds: [], completedEncounterIds: [], finalMapId: route.expectedMapId,
    checkpointReady: false, saveRestored: false,
    controls: ["10ms headless host; media and audio output immediately ready", "in-memory real checkpoint codec/storage",
      "GameEntryLoader entry/restore, prepared GameBattleHandoff and owner-bound GameCommands",
      "fixed explicit transportation timestamp", "manifest player inputs, choice answers and battle abilities",
      "pause-menu readiness only; no undeclared menu mutation"], boundary: null };
  const trace = [], flow = new GameFlow();
  const entries = new GameEntryLoader(flow, { discard: () => {} });
  const execution = { entry: "GameEntryLoader", battleHandoff: "prepared", commands: "GameCommands",
    entriesCommitted: 0, loadsCommitted: 0, preparedStarts: 0, committedStarts: 0,
    preparedReturns: 0, committedReturns: 0, duplicateReturnsRejected: 0, staleCommandChannelsRejected: 0 };
  let commandChannel = null, maps = null, saves = null;
  let ticks = 0, inputIndex = 0, answerIndex = 0, commands = 0, checkpointHash = null;
  const current = () => flow.session;
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
    const startAttempt = entries.begin("new-game");
    let started;
    if (route.entry === "source-new-game") {
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
        const { field, battle } = await repository.opening();
        assert.ok(context.isCurrent(), "Route entry was cancelled");
        assert.equal(field.contentHash, plan.contentHashes.entry); assert.equal(battle.contentHash, plan.contentHashes.battle);
        return { session: new GameSession(field, battle, 314, runtime),
          presentation: { mapId: field.map.identity.mapId } };
      });
    }
    if (started.status !== "committed") throw started.error ?? new Error("Route entry did not commit: " + started.status);
    execution.entriesCommitted++;
    commandChannel = new GameCommands(flow, started.session);
    assert.equal(commandChannel.settingsReady, false, "An entry clears previous media readiness");
    flow.advance(0, host); visit(); trace.push({ kind: "start", mapId: receipt.finalMapId,
      entry: "GameEntryLoader", battleHandoff: "prepared", commandOwnerBound: commandChannel.owner === current() });
    const owner = current(), state = owner.state, world = owner.world;
    maps = new GameMapLoader(flow, boundMaps, {
      prepare: async field => { assert.notEqual(field, current().field); return null; }, discard: () => {},
    });
    const bytes = new Map();
    const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
      setItem: (key, value) => bytes.set(key, value) }, "framework");
    saves = new GameEventSaveCoordinator(flow, storage);
    let seenBattle = null;
    while (ticks < route.maxTicks) {
      assert.equal(current(), owner); assert.equal(current().state, state); assert.equal(current().world, world);
      const game = current(), field = game.field;
      if (game.eventSaveRequest) {
        const result = await saves.save(ticks);
        if (result.status !== "committed") throw new Error("Event save did not commit: " + result.status);
        trace.push({ kind: "event-save", mapId: receipt.finalMapId }); tick(); continue;
      }
      if (field.stop?.kind === "unsupported") { receipt.boundary = structuredClone(field.stop); break; }
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
        const request = field.stop, before = await contentDigest(state.snapshot()), result = await handoff.start();
        if (result.status !== "committed") {
          assert.equal(game.battle, null); assert.equal(field.stop, request);
          assert.equal(await contentDigest(state.snapshot()), before);
          receipt.boundary = { kind: "battle-entry", status: result.status, reason: String(result.error ?? result.status) }; break;
        }
        execution.committedStarts++;
        assert.equal(result.session, owner); assert.equal(result.request, request);
        flow.advance(0, host); tick(); continue;
      }
      const battle = game.battle;
      if (battle) {
        assert.ok(plan.dependencies.encounterIds.includes(battle.content.encounterId),
          "Route reached an encounter outside the scanned dependencies");
        if (battle !== seenBattle) { trace.push({ kind: "battle", id: battle.content.encounterId }); seenBattle = battle; }
        if (battle.phase === "victory") {
          const id = battle.content.encounterId, before = game.gil;
          assert.equal(commandChannel.canReturnBattle(battle), true);
          const result = await handoff.return();
          if (result.status !== "committed") {
            assert.equal(game.battle, battle); assert.equal(game.gil, before);
            receipt.boundary = { kind: "battle-return", status: result.status, reason: String(result.error ?? result.status) }; break;
          }
          execution.committedReturns++;
          const returned = await contentDigest(state.snapshot());
          await assert.rejects(handoff.return(), /pending encounter or terminal battle/);
          assert.equal(await contentDigest(state.snapshot()), returned, "Duplicate return cannot settle another reward");
          execution.duplicateReturnsRejected++;
          receipt.completedEncounterIds.push(id);
          trace.push({ kind: "victory", id, gilAward: game.gil - before, handoff: "prepared",
            completedBattles: state.snapshot().completedBattles.length, duplicateReturnRejected: true }); tick(); continue;
        }
        if (battle.phase === "defeat") { receipt.boundary = { kind: "defeat", encounterId: battle.content.encounterId }; break; }
        if (route.battleAbilityIds.length === 0) { receipt.boundary = { kind: "missing-battle-input", encounterId: battle.content.encounterId }; break; }
        for (const actor of battle.ready) {
          for (const abilityId of route.battleAbilityIds) {
            const target = battle.targetChoices(actor.id, abilityId)[0];
            if (target && commandChannel.command(battle, actor.id, abilityId, target.selection)) { commands++; break; }
          }
        }
      } else if (field.choice) {
        const answer = route.choiceAnswers[answerIndex++];
        if (answer === undefined) { receipt.boundary = { kind: "missing-choice-input", requestId: field.choice.id }; break; }
        assert.equal(flow.choose(field.choice.id, answer), true);
      } else if (field.dialogue) {
        assert.equal(flow.confirm(), true);
      } else if (field.currentShop) {
        receipt.boundary = { kind: "shop-input-not-declared" }; break;
      } else if (game.checkpointReady) {
        const input = route.inputs[inputIndex];
        if (input) {
          const accepted = input.kind === "move" ? flow.move(input.direction) : flow.confirm();
          if (!accepted) { receipt.boundary = { kind: "rejected-player-input", inputIndex, input }; break; }
          trace.push({ kind: "input", inputIndex, input }); inputIndex++;
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
          const checkpoint = game.checkpoint(); checkpointHash = await contentDigest(checkpoint);
          const saveTicket = flow.beginOperation("save"), prepared = await storage.prepareSave(checkpoint, ticks);
          assert.equal(saveTicket.isCurrent(), true); prepared.commit(); assert.equal(saveTicket.finish(), true);
          const previousCommands = commandChannel, loadAttempt = entries.begin("load");
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
            }
            const restored = GameSession.restore(saved.checkpoint, packages.initial, packages.battle, packages.world, runtime);
            assert.equal(await contentDigest(restored.checkpoint()), checkpointHash, "Restore replayed or lost state");
            return { session: restored, presentation: { mapId: receipt.finalMapId }, options: { paused: true } };
          });
          if (loaded.status !== "committed") throw loaded.error ?? new Error("Route restore did not commit: " + loaded.status);
          execution.loadsCommitted++;
          const restored = loaded.session;
          commandChannel = new GameCommands(flow, restored);
          assert.equal(flow.paused, true); assert.equal(commandChannel.menuReady, false);
          assert.equal(previousCommands.setBattlePreferences(game.battlePreferences), false);
          assert.equal(await contentDigest(game.checkpoint()), checkpointHash);
          assert.equal(await contentDigest(restored.checkpoint()), checkpointHash, "An obsolete command cannot edit the restored owner");
          execution.staleCommandChannelsRejected++;
          flow.advance(0, host); assert.equal(commandChannel.menuReady, true);
          receipt.saveRestored = true; receipt.result = "completed";
          trace.push({ kind: "save-restore", checkpointHash, menuReady: commandChannel.menuReady,
            entry: "GameEntryLoader", paused: flow.paused, staleCommandsRejected: true }); break;
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
  return { receipt, trace, execution, elapsedMs: ticks * 10, commands, checkpointHash };
}
