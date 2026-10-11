// Real source records exercise the pure lifecycle. These are controlled inputs,
// not claims that all source chests or scripts are currently story-reachable.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const buildIndex = process.argv.indexOf("--build-dir");
const build = resolve(root, buildIndex < 0 ? "dist" : process.argv[buildIndex + 1]);
const module = (path) => import(pathToFileURL(build + "/src/" + path + ".js"));
const { loadCorpus } = await module("compiler/corpus");
const { loadSystemMessages } = await module("compiler/system-messages");
const { hash } = await module("compiler/content");
const { compileTreasureInventory, compileTreasureInventoryLimits, compileTreasureInteraction,
  compileTreasureTaskMessages, compileTreasureBoxInstruction } = await module("compiler/treasure-inventory");
const { createTreasureTask, advanceTreasureTask } = await module("core/treasure-task");
const { compileEntityGroup } = await module("compiler/entity-group");
const { bindMapPackages } = await module("compiler/map-package");
const { decodeFieldOp } = await module("compiler/field");
const { GameSession } = await module("core/game-session");
const { encodeSavedGame, decodeSavedGame } = await module("core/saved-game");
const { verifyContent } = await module("core/content-integrity");
const corpus = await loadCorpus(root);
const system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources);
const native = JSON.parse(await readFile(root + "build/reports/treasure-task-native-check.json", "utf8"));
assert.equal(native.nativeSha256, "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc");
assert.equal(native.semanticsVerified, false);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const systemMessages = system.messages;
const catalog = await verifyContent(JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8")));
const limits = compileTreasureInventoryLimits(corpus.tables).limits;
const expectedLimits = Object.fromEntries([["item", "MAX_ITEM"], ["gil", "MAX_GIL"]].map(([name, key]) =>
  [name, +corpus.tables["game_constant_int.csv"].find((r) => r.key_name === key).value1]));
assert.deepEqual(limits, expectedLimits);
const entries = [], instructions = [], probes = [];
for (const asset of corpus.assets) {
  let group;
  for (const [li, layer] of (asset.data?.layers ?? []).entries()) for (const [oi, object] of (layer.objects ?? []).entries()) {
    const p = Object.fromEntries((object.properties ?? []).map((p) => [p.name, p.value]));
    if (p.object_type !== 7) continue;
    const source = { ...asset.source, sourceSetHash: corpus.sourceSetHash, pointer: `/layers/${li}/objects/${oi}` };
    const def = compileTreasureInventory(p, corpus.tables, source);
    const request = compileTreasureInteraction(def);
    const messages = compileTreasureTaskMessages(def, corpus.messages, systemMessages, request);
    group ??= compileEntityGroup(basename(asset.source.assetPath, ".json"), asset, corpus.tables,
      { ...corpus.messages, system_zhc: systemMessages });
    const compiledEntities = group.entities.filter((e) => e.source.pointer === source.pointer);
    assert.equal(compiledEntities.length, 1);
    const entity = compiledEntities[0];
    assert.deepEqual(entity.mapObject.interaction, { kind: "treasure", request });
    assert.deepEqual(entity.treasureMessages, messages);
    assert.deepEqual(entity.treasure, Object.fromEntries(Object.entries(def).filter(([k]) => k !== "source")));
    assert.deepEqual(group.blockers.filter((b) => b.source.pointer === source.pointer), []);
    const content = corpus.tables["content.csv"].find((r) => +r.id === p.content_id);
    const type = +content.type_id;
    assert.ok([1, 2, 3, 5].includes(type));
    const important = type === 1 && +corpus.tables["item.csv"].find((r) => +r.id === +content.type_value).type_id === 2;
    assert.equal(def.ownedList, type === 5 ? "gil" : important ? "important" : "normal");
    const rawName = systemMessages[content.mes_id_name];
    assert.equal(typeof rawName, "string");
    const expectedToken = type === 5 ? "NUM" : "ITEM_N";
    // Independent expected value from the uncompiled localized source.
    const iconEnd = rawName.indexOf(">");
    const expectedValue = type === 5 ? String(p.content_num) : iconEnd < 0 ? rawName : rawName.slice(iconEnd + 1);
    const rawReward = corpus.messages.story_mes_zhc[p.message_key];
    const expectedText = rawReward.split(`(${expectedToken})`).join(expectedValue).replace(/^<CT>/, "").replaceAll("\\n", "\n");
    if (messages.reward) {
      assert.equal(messages.reward.text, expectedText);
      assert.equal(messages.reward.alignment, rawReward.startsWith("<CT>") ? "center" : undefined);
    } else {
      assert.ok(p.script_id > 0);
      assert.equal(type, 5); assert.equal(p.content_num, 0);
      assert.ok(rawReward.includes("(ITEM_N)"));
      assert.throws(() => compileTreasureTaskMessages(def, corpus.messages, systemMessages), /substitution/);
    }
    assert.equal(messages.parameter.value, expectedValue);
    assert.equal(messages.parameter.token, expectedToken);
    assert.deepEqual(request, { kind: "treasure-box", entityId: p.entity_id, after: false, message: true, actionSoundId: p.se_id });
    entries.push({ assetId: asset.id, source, raw: p, definition: def, messages, request, type, important, entity });
  }
  for (const [index, m] of (asset.data?.Mnemonics ?? []).entries()) if (m.mnemonic === "TreasureBox") {
    const request = compileTreasureBoxInstruction(m);
    assert.equal(request.entityId, m.operands.iValues[0]);
    assert.equal(request.message, m.operands.iValues[2] !== 1);
    assert.equal(request.after, true); assert.equal(request.actionSoundId, 0);
    const source = { ...asset.source, pointer: `/Mnemonics/${index}` };
    const site = { source, script: basename(asset.source.assetPath, ".json"), index };
    const op = decodeFieldOp(m, site, { ...corpus.messages, system_zhc: systemMessages }, corpus.tables);
    assert.deepEqual(op, { ...site, ...request });
    instructions.push({ source, request, op });
  }
}

function probe(entry, request, opened, full) {
  const def = entry.definition, amount = entry.raw.content_num;
  let flag = opened, count = full ? limits.item : 0, gil = full ? limits.gil : 0;
  const read = () => ({ flag, owned: { gil, normalOwnedItems: entry.type !== 5 && !entry.important ? [{ id: entry.raw.content_id, count }] : [] }, limits });
  const transcript = [], messages = [];
  let next = advanceTreasureTask(createTreasureTask(def, request), { kind: "start", ...read() });
  for (let steps = 0; ; steps++) {
    assert.ok(steps < 30, "Task did not complete");
    for (const effect of next.effects) {
      transcript.push(effect);
      if (effect.kind === "grant") {
        if (effect.command.kind === "grant-gil") gil = Math.min(limits.gil, gil + effect.command.amount);
        else count = Math.min(limits.item, count + effect.command.count);
      }
      if (effect.kind === "flag") {
        assert.equal(effect.ref.category, `TreasureFlag${Math.floor(entry.raw.flag_id / 256) + 1}`);
        assert.equal(effect.ref.index, entry.raw.flag_id % 256); flag = true;
      }
      if (effect.kind === "message") {
        const m = Object.values(entry.messages).filter((m) => m?.key === effect.key);
        assert.equal(m.length, 1); messages.push({ ...effect, textHash: hash(m[0].text) });
        assert.equal(flag, opened, "Flag published before the message completed");
      }
    }
    if (next.wait === "complete") break;
    const input = next.wait === "sound" ? { kind: "sound-complete", ...read() } :
      { kind: next.wait === "message" ? "message-complete" : "frame" };
    next = advanceTreasureTask(next.state, input);
  }
  const empty = request.message && opened;
  const script = !empty && !request.after && entry.raw.script_id > 0;
  const grants = transcript.filter((e) => e.kind === "grant");
  const flags = transcript.filter((e) => e.kind === "flag");
  assert.equal(grants.length, empty || script ? 0 : 1);
  assert.equal(flags.length, empty || script ? 0 : 1);
  assert.equal(transcript.filter((e) => e.kind === "run-script").length, script ? 1 : 0);
  assert.equal(transcript.filter((e) => e.kind === "sound").length, request.actionSoundId > 0 && !opened ? 1 : 0);
  const over = !empty && !script && full && amount > 0 && !entry.important;
  assert.equal(messages.length, empty ? 1 : script || !request.message ? 0 : over ? 2 : 1);
  if (over && request.message) assert.deepEqual(messages.map((m) => m.close), [false, true]);
  if (grants.length) {
    const grant = grants[0].command;
    assert.equal(grant.kind === "grant-gil" ? grant.amount : grant.count, amount);
    assert.equal(def.ownedList === "gil" ? gil : count,
      Math.min(def.ownedList === "gil" ? limits.gil : limits.item,
        (full ? def.ownedList === "gil" ? limits.gil : limits.item : 0) + amount));
    if (request.message) assert.ok(transcript.findIndex((e) => e.kind === "grant") < transcript.findIndex((e) => e.kind === "message"));
  }
  probes.push({ source: entry.source, request, opened, full, branch: empty ? "empty" : script ? "script" : "grant",
    messages, flag, count, gil, transcriptHash: hash(transcript) });
}
for (const entry of entries) for (const [opened, full] of [[false, false], [false, true], [true, true]])
  probe(entry, entry.request, opened, full);
for (const instruction of instructions) {
  const candidates = entries.filter((e) => e.source.file === instruction.source.file &&
    e.source.assetPath.slice(0, e.source.assetPath.lastIndexOf("/")) === instruction.source.assetPath.slice(0, instruction.source.assetPath.lastIndexOf("/")) &&
    e.raw.entity_id === instruction.request.entityId);
  assert.equal(candidates.length, 1);
  for (const [opened, full] of [[false, false], [false, true], [true, true]])
    probe(candidates[0], instruction.request, opened, full);
}
assert.equal(entries.length, 320);
assert.equal(entries.filter((e) => e.raw.script_id > 0).length, 25);
assert.equal(entries.filter((e) => e.messages.reward === null).length, 17);
assert.equal(instructions.length, 25);
assert.equal(instructions.filter((i) => i.request.message).length, 3);
// Check the published world packages as well as direct compiler calls. Some
// map IDs share the same source group, so retain occurrences and source counts.
const world = await verifyContent(JSON.parse(await readFile(root + "build/world/catalog.json", "utf8")));
assert.equal(world.sourceSetHash, corpus.sourceSetHash);
assert.deepEqual(world.systemMessageSource, system.source);
const sourceKey = (s) => JSON.stringify([s.file, s.sha256, s.assetPath, s.objectId, s.pointer]);
const expectedEntries = new Map(entries.map((entry) => [sourceKey(entry.source), entry]));
assert.equal(expectedEntries.size, entries.length);
const worldChecks = [], worldExclusions = [], worldTargets = new Map();
const bindings = bindMapPackages(corpus.assets, corpus.tables);
for (const [id, indexed] of Object.entries(world.maps)) {
  const target = await verifyContent(JSON.parse(await readFile(root + `build/world/maps/${id}.json`, "utf8")));
  assert.equal(target.contentHash, indexed.contentHash);
  worldTargets.set(Number(id), target);
  for (const [groupName, group] of Object.entries(target.map?.groups ?? {})) {
    for (const entity of group.entities.filter((e) => e.kind === 7)) {
      const expected = expectedEntries.get(sourceKey(entity.source));
      assert.ok(expected, "Published world treasure lacks a source record");
      assert.deepEqual(entity.treasure, expected.entity.treasure);
      assert.deepEqual(entity.treasureMessages, expected.messages);
      assert.deepEqual(entity.mapObject.interaction, { kind: "treasure", request: expected.request });
      assert.deepEqual(group.blockers.filter((b) => b.source.pointer === entity.source.pointer), []);
      worldChecks.push({ mapId: Number(id), group: groupName, source: entity.source, contentHash: target.contentHash });
    }
  }
}
const publishedKeys = new Set(worldChecks.map((e) => sourceKey(e.source)));
for (const entry of entries.filter((e) => !publishedKeys.has(sourceKey(e.source)))) {
  const sourceBindings = bindings.filter((binding) => Object.values(binding.groups).includes(entry.assetId));
  assert.ok(sourceBindings.length, "Source treasure has no world package binding");
  const excluded = sourceBindings.map((binding) => {
    const target = worldTargets.get(Number(binding.id));
    assert.ok(target, "Source treasure target is absent from world catalog");
    assert.equal(target.map, null, "Source treasure omitted from a compiled world map");
    assert.ok(target.blockers.length, "World map excluded without an explicit blocker");
    return { mapId: target.mapId, blockers: target.blockers, contentHash: target.contentHash };
  });
  worldExclusions.push({ source: entry.source, maps: excluded });
}
assert.equal(publishedKeys.size + worldExclusions.length, entries.length);
// Actual source message instructions in a controlled shared-owner/field host.
// There is deliberately no source-map media/linked region in this harness.
const fieldChecks = [];
for (const instruction of instructions.filter((i) => i.request.message)) {
  const entry = entries.find((e) => e.source.file === instruction.source.file &&
    e.source.assetPath.slice(0, e.source.assetPath.lastIndexOf("/")) === instruction.source.assetPath.slice(0, instruction.source.assetPath.lastIndexOf("/")) &&
    e.raw.entity_id === instruction.request.entityId);
  assert.ok(entry);
  for (const [opened, full] of [[false, false], [false, true], [true, true]]) {
    const flag = { category: `TreasureFlag${Math.floor(entry.raw.flag_id / 256) + 1}`, index: entry.raw.flag_id % 256 };
    const width = Math.ceil(entry.entity.x) + 2, height = Math.ceil(entry.entity.y) + 2;
    const content = {
      formatVersion: 1, kind: "field-development", sourceSetHash: catalog.common.fieldSourceSetHash,
      parentSourceSetHash: corpus.sourceSetHash,
      map: { id: "controlled-source-treasure-message", width, height, tileSize: 16,
        layers: [], tilesets: [], textures: {}, collisions: { 1: Array(width * height).fill(0) },
        entities: [entry.entity], source: entry.source },
      characters: {}, treasureInventoryLimits: limits,
      scripts: { probe: [{ ...instruction.op, script: "probe", index: 0 },
        { kind: "exit", script: "probe", index: 1, source: instruction.source }] },
      entry: { player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
        initialEventValues: [{ ref: flag, value: Number(opened) }], evidence: [entry.source, instruction.source],
        description: "Controlled source message task; no source-map visuals" },
      limitations: ["controlled-source-instruction", "no-linked-region", "no-story-reachability", "no-native-oracle"],
    };
    content.contentHash = hash(content);
    const game = new GameSession(content, catalog);
    if (full) game.state.fieldTreasure.prepare(entry.type === 5 ? { kind: "grant-gil", amount: limits.gil } :
      { kind: entry.type === 1 ? "grant-item" : "grant-equipment", id: entry.raw.content_id, count: limits.item }).commit();
    const count = () => entry.type === 5 ? game.state.snapshot().gil :
      (entry.type === 1 ? game.state.snapshot().items : game.state.snapshot().equipmentStock)
        .find((i) => i.id === entry.raw.content_id)?.count ?? 0;
    const before = count(), messages = [];
    assert.equal(game.field.startEvent("probe"), true);
    assert.equal(game.field.stop, null);
    assert.equal(game.field.eventState.read(flag), Number(opened));
    assert.equal(count(), opened ? before : Math.min(entry.type === 5 ? limits.gil : limits.item, before + entry.raw.content_num));
    assert.throws(() => game.checkpoint(), /Cannot save during/);
    for (let i = 0; !game.field.checkpointReady; i++) {
      assert.ok(i < 30);
      if (game.field.dialogue) {
        assert.equal(game.field.eventState.read(flag), Number(opened));
        messages.push({ key: game.field.dialogue.key, textHash: hash(game.field.dialogue.text) });
        game.advance(10); game.field.confirm();
      } else game.advance(10);
      assert.equal(game.field.stop, null);
    }
    assert.equal(messages.length, opened ? 1 : full && !entry.important ? 2 : 1, JSON.stringify({ source: instruction.source.assetPath,
      contentId: entry.raw.content_id, opened, full, before, read: game.state.fieldTreasure.read(), messages }));
    assert.equal(game.field.eventState.read(flag), 1);
    assert.equal(game.field.messageWindow, null);
    assert.equal(game.field.presentationOmissions.length, 0, "Explicit caller does not copy property SE");
    const checkpoint = game.checkpoint();
    const saved = await decodeSavedGame(await encodeSavedGame(checkpoint, 0));
    const restored = GameSession.restore(saved.checkpoint, content, catalog);
    assert.deepEqual(restored.checkpoint(), checkpoint);
    const after = restored.state.snapshot(); restored.advance(100);
    assert.deepEqual(restored.state.snapshot(), after, "No reward replay after restore");
    fieldChecks.push({ source: instruction.source, propertySource: entry.source, opened, full, before,
      after: count(), messages, checkpointHash: hash(checkpoint) });
  }
}
const ordinaryFieldChecks = [];
const direct = entries.find((e) => e.raw.script_id === 0 && e.raw.content_num === 1 && e.type === 1 &&
  e.definition.ownedList === "normal" && e.entity.x >= 1 && e.entity.mapObject.talkMounts.includes("") && !e.raw.pick_up);
const scripted = entries.find((e) => e.definition.scriptName === "sc_e_0880" && e.entity.x >= 1 && e.entity.mapObject.talkMounts.includes(""));
const blockedScript = entries.find((e) => e.definition.scriptName === "sc_e_0021" && e.entity.x >= 1 && e.entity.mapObject.talkMounts.includes(""));
assert.ok(direct); assert.ok(scripted); assert.ok(blockedScript);
for (const mode of ["reward", "full", "empty", "script-handoff", "script-blocked"]) {
  const handoff = mode.startsWith("script-");
  const entry = mode === "script-handoff" ? scripted : mode === "script-blocked" ? blockedScript : direct;
  const opened = mode === "empty", full = mode === "full";
  const flag = { category: `TreasureFlag${Math.floor(entry.raw.flag_id / 256) + 1}`, index: entry.raw.flag_id % 256 };
  const width = Math.ceil(entry.entity.x) + 2, height = Math.ceil(entry.entity.y) + 2;
  let scriptSource = null;
  const scripts = {};
  if (handoff) {
    const candidates = corpus.assets.filter((a) => a.kind === "script" && a.source.file === entry.source.file &&
      a.source.assetPath === entry.source.assetPath.replace(/[^/]+$/, `${entry.definition.scriptName}.json`));
    assert.equal(candidates.length, 1);
    const asset = candidates[0]; scriptSource = asset.source;
    scripts[entry.definition.scriptName] = asset.data.Mnemonics.map((m, index) => decodeFieldOp(m,
      { source: { ...asset.source, pointer: `/Mnemonics/${index}` }, script: entry.definition.scriptName, index },
      { ...corpus.messages, system_zhc: systemMessages }, corpus.tables));
    assert.deepEqual(scripts[entry.definition.scriptName].slice(0, 3).map((op) => op.kind),
      ["nop", "treasure-box", mode === "script-blocked" ? "blocked" : "flag"]);
  }
  const content = {
    formatVersion: 1, kind: "field-development", sourceSetHash: catalog.common.fieldSourceSetHash,
    parentSourceSetHash: corpus.sourceSetHash,
    map: { id: "controlled-source-manual-treasure", width, height, tileSize: 16,
      layers: [], tilesets: [], textures: {}, collisions: { [entry.entity.layer]: Array(width * height).fill(0) },
      entities: [entry.entity], source: entry.source },
    characters: {}, treasureInventoryLimits: limits, scripts,
    entry: { player: { x: entry.entity.x - 1, y: entry.entity.y, layer: entry.entity.layer,
      direction: "right", asset: "", mount: "" }, initialEventValues: [{ ref: flag, value: Number(opened) }],
      evidence: [entry.source, ...(scriptSource ? [scriptSource] : [])], description: "Controlled adjacent player and flag; source chest action" },
    limitations: ["controlled-player-and-flag", "no-source-map-visuals", "no-linked-region", "muted-development-SE", "no-story-reachability", "no-native-oracle"],
  };
  content.contentHash = hash(content);
  const game = new GameSession(content, catalog);
  if (full) game.state.fieldTreasure.prepare({ kind: "grant-item", id: entry.raw.content_id, count: limits.item }).commit();
  const before = game.state.snapshot(), messages = [];
  game.field.confirm();
  assert.equal(game.field.stop, null);
  assert.equal(game.field.presentationOmissions.filter((o) => o.kind === "sound").length, opened ? 0 : 1);
  if (!opened) assert.equal(game.field.presentationOmissions.find((o) => o.kind === "sound").soundId, entry.raw.se_id);
  if (mode === "script-blocked") {
    for (let i = 0; !game.field.stop; i++) { assert.ok(i < 10); game.advance(10); }
    const blocked = scripts[entry.definition.scriptName][2];
    assert.equal(blocked.mnemonic, "Msg");
    assert.equal(blocked.reason, "Message contains an unsupported inline control");
    assert.equal(game.field.stop.kind, "unsupported");
    assert.equal(game.field.stop.site.script, entry.definition.scriptName);
    assert.equal(game.field.stop.site.index, 2);
    assert.equal(game.field.stop.message, `${blocked.mnemonic}：${blocked.reason}`);
    assert.equal(game.field.eventState.read(flag), 1, "Real child script executes its silent explicit TreasureBox");
    assert.deepEqual(game.state.snapshot(), before, "Zero Gil from the child is not a fabricated placeholder reward");
    assert.equal(game.field.dialogue, null);
    assert.throws(() => game.checkpoint(), /Cannot save during/);
    ordinaryFieldChecks.push({ mode, source: entry.source, scriptSource, observedBlocker: game.field.stop,
      doesNotEstablish: "Source Msg uses unimplemented automatic controls before Encount(516)" });
    continue;
  }
  if (mode === "script-handoff") {
    for (let i = 0; !game.field.dialogue; i++) { assert.ok(i < 10); game.advance(10); assert.equal(game.field.stop, null); }
    assert.equal(game.field.dialogue.key, entry.messages.reward.key);
    assert.equal(game.field.eventState.read(flag), 0);
    game.advance(30);
    assert.equal(game.field.dialogue.key, entry.messages.reward.key, "Independent child survives wrapper completion");
    assert.equal(game.field.busy, true);
    assert.throws(() => game.checkpoint(), /Cannot save during/);
  }
  for (let i = 0; !game.field.checkpointReady; i++) {
    assert.ok(i < 30);
    if (game.field.dialogue) {
      assert.equal(game.field.eventState.read(flag), Number(opened));
      messages.push(game.field.dialogue.key);
      game.advance(10); game.field.confirm();
    } else game.advance(10);
    assert.equal(game.field.stop, null);
  }
  assert.equal(messages.length, full ? 2 : 1);
  assert.equal(game.field.eventState.read(flag), 1);
  assert.equal(game.field.messageWindow, null);
  const stock = entry.type === 1 ? "items" : "equipmentStock";
  const beforeCount = before[stock].find((i) => i.id === entry.raw.content_id)?.count ?? 0;
  assert.equal(game.state.snapshot()[stock].find((i) => i.id === entry.raw.content_id)?.count ?? 0,
    opened ? beforeCount : Math.min(limits.item, beforeCount + entry.raw.content_num));
  if (mode === "script-handoff") {
    const sourceFlag = scripts[entry.definition.scriptName][2];
    assert.equal(game.field.eventState.read(sourceFlag.ref), 1, "Independent child continues after its treasure message");
  }
  const checkpoint = game.checkpoint();
  const restored = GameSession.restore((await decodeSavedGame(await encodeSavedGame(checkpoint, 0))).checkpoint, content, catalog);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  const after = restored.state.snapshot(); restored.advance(100); assert.deepEqual(restored.state.snapshot(), after);
  ordinaryFieldChecks.push({ mode, source: entry.source, ...(scriptSource ? { scriptSource } : {}), messages, checkpointHash: hash(checkpoint) });
}
const report = {
  lane: "source-record-treasure-task-mechanisms", sourceSetHash: corpus.sourceSetHash,
  nativeEvidenceHash: hash(native), counts: { entities: entries.length,
    ordinaryDirectReward: entries.filter((e) => e.raw.script_id === 0).length,
    ordinaryScriptHandoffs: entries.filter((e) => e.raw.script_id > 0).length,
    explicitInstructions: instructions.length, explicitMessage: instructions.filter((i) => i.request.message).length,
    anonymousEntities: entries.filter((e) => e.raw.entity_id === 0).length,
    unusedRewardTemplatesBlocked: entries.filter((e) => e.messages.reward === null).length,
    zeroRewards: entries.filter((e) => e.raw.content_num === 0).length, probes: probes.length,
    controlledMessageFieldSaves: fieldChecks.length, controlledOrdinaryFieldBranches: ordinaryFieldChecks.length,
    worldTreasureOccurrences: worldChecks.length, worldTreasureSourceRecords: publishedKeys.size,
    worldTreasureExcludedSourceRecords: worldExclusions.length },
  catalogHash: catalog.contentHash, worldCatalogHash: world.contentHash, systemMessageSource: system.source,
  entries, instructions, probes, fieldChecks, ordinaryFieldChecks, worldChecks, worldExclusions, semanticsVerified: false,
  doesNotEstablish: ["original-game-execution", "audible-SE-parity", "native-frame-parity", "all-source-script-admission", "story-reachability"],
};
await writeFile(root + "build/reports/treasure-task-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report.counts, reportHash: hash(report), semanticsVerified: false }));
