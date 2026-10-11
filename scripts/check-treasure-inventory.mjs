// Pure source mechanisms, not story reachability or original-game parity.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const index = process.argv.indexOf("--build-dir");
const build = resolve(root, index < 0 ? "dist" : process.argv[index + 1]);
const { loadCorpus } = await import(pathToFileURL(build + "/src/compiler/corpus.js"));
const { compileTreasureInventory, compileTreasureInventoryLimits, compileTreasureBoxInstruction } =
  await import(pathToFileURL(build + "/src/compiler/treasure-inventory.js"));
const { planTreasureInventory, checkTreasureCapacity } =
  await import(pathToFileURL(build + "/src/core/treasure-inventory.js"));
const { hash } = await import(pathToFileURL(build + "/src/compiler/content.js"));
const { decodeFieldOp } = await import(pathToFileURL(build + "/src/compiler/field.js"));
const { compileEntityGroup } = await import(pathToFileURL(build + "/src/compiler/entity-group.js"));
const { GameSession } = await import(pathToFileURL(build + "/src/core/game-session.js"));
const { encodeSavedGame, decodeSavedGame } = await import(pathToFileURL(build + "/src/core/saved-game.js"));
const { verifyContent } = await import(pathToFileURL(build + "/src/core/content-integrity.js"));
const catalog = await verifyContent(JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8")));
const native = JSON.parse(await readFile(root + "build/reports/treasure-inventory-native-check.json", "utf8"));
assert.equal(native.nativeSha256, "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc");
assert.equal(native.semanticsVerified, false);
const corpus = await loadCorpus(root);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const constant = (key) => {
  const rows = corpus.tables["game_constant_int.csv"].filter((r) => r.key_name === key);
  assert.equal(rows.length, 1); return Number(rows[0].value1);
};
const expectedLimits = { item: constant("MAX_ITEM"), gil: constant("MAX_GIL") };
const { limits } = compileTreasureInventoryLimits(corpus.tables);
assert.deepEqual(limits, expectedLimits);
const entities = [], instructions = [], categories = new Set(), syscalls = new Set();
for (const asset of corpus.assets) {
  let fieldGroup;
  for (const [li, layer] of (asset.data?.layers ?? []).entries()) {
    for (const [oi, object] of (layer.objects ?? []).entries()) {
      const p = Object.fromEntries((object.properties ?? []).map((p) => [p.name, p.value]));
      if (p.object_type !== 7) continue;
      assert.equal(new Set(object.properties.map((p) => p.name)).size, object.properties.length);
      const source = { ...asset.source, sourceSetHash: corpus.sourceSetHash, pointer: `/layers/${li}/objects/${oi}` };
      const definition = compileTreasureInventory(p, corpus.tables, source);
      fieldGroup ??= compileEntityGroup(basename(asset.source.assetPath, ".json"), asset, corpus.tables);
      const fieldEntities = fieldGroup.entities.filter((e) => e.source.pointer === source.pointer);
      assert.equal(fieldEntities.length, 1, `${source.assetPath} ${source.pointer}`);
      const fieldEntity = fieldEntities[0];
      assert.deepEqual(fieldEntity.treasure, Object.fromEntries(Object.entries(definition).filter(([key]) => key !== "source")));
      assert.equal(fieldEntity.mapObject.collision, p.collision);
      assert.equal(fieldEntity.mapObject.interaction.kind, "blocked");
      const fieldBlockers = fieldGroup.blockers.filter((b) => b.source.pointer === source.pointer);
      assert.equal(fieldBlockers.some((b) => /Ordinary treasure/.test(b.reason)), false);
      const rawContent = corpus.tables["content.csv"].filter((r) => +r.id === p.content_id);
      assert.equal(rawContent.length, 1);
      const type = +rawContent[0].type_id;
      const important = type === 1 && +corpus.tables["item.csv"].find((r) => +r.id === +rawContent[0].type_value).type_id === 2;
      const expectedCommand = type === 5 ? { kind: "grant-gil", amount: p.content_num } :
        { kind: type === 1 ? "grant-item" : "grant-equipment", id: p.content_id, count: p.content_num };
      assert.deepEqual(definition.reward, expectedCommand);
      assert.equal(definition.ownedList, type === 5 ? "gil" : important ? "important" : "normal");
      assert.equal(definition.entityId, p.entity_id);
      assert.equal(definition.presentation.linkObjectId, p.link_object_id);
      assert.equal(definition.messages.contentNameKey, rawContent[0].mes_id_name);
      for (const [field, key] of [["emptyKey", "NO_TREASURE_BOX_CONTENT"], ["countOverKey", "MAX_POSSESSION_TREASURE_BOX_CONTENT"]]) {
        const rows = corpus.tables["message_conclusion.csv"].filter((r) => r.key_name === key);
        assert.equal(rows.length, 1); assert.equal(definition.messages[field], rows[0].message_id);
      }
      const probes = [];
      for (const atLimit of [false, true]) {
        const count = atLimit ? expectedLimits.item : 0;
        const gil = atLimit ? expectedLimits.gil : 0;
        const owned = { gil, normalOwnedItems: type === 5 || important ? [] : [{ id: p.content_id, count }] };
        const expectedOver = type === 5 ? gil + p.content_num > expectedLimits.gil :
          !important && count + p.content_num > expectedLimits.item;
        assert.equal(checkTreasureCapacity(definition, owned, limits), expectedOver);
        const request = { kind: "treasure-box", entityId: p.entity_id, after: true, message: false, actionSoundId: 0 };
        // Deliberately opened=true verifies the explicit no-message bypass.
        const plan = planTreasureInventory(definition, request, true, owned, limits);
        assert.equal(plan.kind, "grant"); assert.deepEqual(plan.command, expectedCommand);
        assert.equal(plan.overCapacity, expectedOver);
        assert.deepEqual(plan.effects.map((e) => e.kind), ["open", "tile-animation", "grant", "flag", "yield"]);
        assert.equal(plan.effects[1].firstObjectId, p.link_object_id);
        assert.equal(plan.prelude.soundId, null); // source instruction does not copy se_id
        const bank = Math.floor(p.flag_id / 256) + 1;
        assert.deepEqual(plan.flagWrite, { ref: { category: `TreasureFlag${bank}`, index: p.flag_id % 256 }, value: 1 });
        probes.push({ count, gil, expectedOver, planHash: hash(plan) });
      }
      entities.push({ asset: asset.id, source, raw: p, definition, fieldEntity, fieldBlockers, probes });
    }
  }
  for (const [i, mnemonic] of (asset.data?.Mnemonics ?? []).entries()) {
    if (["Calc", "Branch"].includes(mnemonic.mnemonic))
      for (const value of mnemonic.operands.sValues) if (/Variable|Flag|Selection|^imm$/.test(value)) categories.add(value);
    if (mnemonic.mnemonic === "SysCall") syscalls.add(JSON.stringify(mnemonic.operands.sValues));
    if (mnemonic.mnemonic !== "TreasureBox") continue;
    const request = compileTreasureBoxInstruction(mnemonic), ints = mnemonic.operands.iValues;
    assert.equal(request.entityId, ints[0]); assert.equal(request.after, true);
    assert.equal(request.message, ints[2] !== 1); assert.equal(request.actionSoundId, 0);
    const site = { script: basename(asset.source.assetPath, ".json"), index: i,
      source: { ...asset.source, pointer: `/Mnemonics/${i}` } };
    const op = decodeFieldOp(mnemonic, site, {}, corpus.tables);
    if (request.message) {
      assert.equal(op.kind, "blocked"); assert.match(op.reason, /message tasks/);
    } else assert.deepEqual(op, { ...site, ...request });
    instructions.push({ asset: asset.id, source: site.source, index: i, request, op });
  }
}
for (const instruction of instructions) {
  const candidates = entities.filter((e) => e.source.file === instruction.source.file &&
    dirname(e.source.assetPath) === dirname(instruction.source.assetPath) &&
    e.raw.entity_id === instruction.request.entityId);
  assert.equal(candidates.length, 1, instruction.source.assetPath);
  instruction.propertySource = candidates[0].source;
  // This binds the local source entity definition; active-group/story reachability remains unknown.
}
const fieldHostChecks = [];
for (const instruction of instructions.filter((i) => i.op.kind === "treasure-box")) {
  const e = entities.find((e) => e.source.assetPath === instruction.propertySource.assetPath &&
    e.source.pointer === instruction.propertySource.pointer && e.source.file === instruction.propertySource.file);
  assert.deepEqual(e.fieldBlockers, []);
  for (const opened of [false, true]) {
    const flag = { category: `TreasureFlag${Math.floor(e.raw.flag_id / 256) + 1}`, index: e.raw.flag_id % 256 };
    const field = {
      formatVersion: 1, kind: "field-development", sourceSetHash: catalog.common.fieldSourceSetHash,
      parentSourceSetHash: corpus.sourceSetHash,
      map: { id: "isolated-source-treasure", width: Math.ceil(e.fieldEntity.x) + 2,
        height: Math.ceil(e.fieldEntity.y) + 2, tileSize: 16, layers: [], tilesets: [], textures: {},
        collisions: { 1: Array((Math.ceil(e.fieldEntity.x) + 2) * (Math.ceil(e.fieldEntity.y) + 2)).fill(0) },
        entities: [e.fieldEntity], source: e.source },
      characters: {}, treasureInventoryLimits: expectedLimits,
      scripts: { probe: [{ ...instruction.op, script: "probe", index: 0 },
        { kind: "exit", script: "probe", index: 1, source: instruction.source }] },
      entry: { player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
        initialEventValues: [{ ref: flag, value: Number(opened) }],
        evidence: [e.source, instruction.source], description: "Controlled source treasure instruction; no source map visuals" },
      limitations: ["isolated-source-instruction", "controlled-registry-with-no-linked-region", "no-story-reachability", "no-original-oracle"],
    };
    field.contentHash = hash(field);
    const game = new GameSession(field, catalog);
    const type = +corpus.tables["content.csv"].find((r) => +r.id === e.raw.content_id).type_id;
    if (opened) {
      const fill = type === 5 ? { kind: "grant-gil", amount: expectedLimits.gil } :
        { kind: type === 1 ? "grant-item" : "grant-equipment", id: e.raw.content_id, count: expectedLimits.item };
      game.state.fieldTreasure.prepare(fill).commit();
    }
    const readCount = (state) => type === 5 ? state.gil :
      (type === 1 ? state.items : state.equipmentStock).find((entry) => entry.id === e.raw.content_id)?.count ?? 0;
    const before = game.state.snapshot(), initialCount = readCount(before);
    assert.equal(game.field.startEvent("probe"), true);
    assert.equal(game.field.stop, null);
    assert.equal(game.field.eventState.read(flag), 1);
    assert.equal(readCount(game.state.snapshot()), Math.min(initialCount + e.raw.content_num,
      type === 5 ? expectedLimits.gil : expectedLimits.item));
    assert.equal(game.state.snapshot().totalGil, before.totalGil + (type === 5 ? e.raw.content_num : 0));
    if (type !== 5) assert.ok((type === 1 ? game.state.snapshot().items : game.state.snapshot().equipmentStock)
      .some((entry) => entry.id === e.raw.content_id), "zero reward must preserve/create its record");
    assert.equal(game.field.checkpointReady, false);
    game.advance(10);
    assert.equal(game.field.stop, null);
    const checkpoint = game.checkpoint();
    const saved = await decodeSavedGame(await encodeSavedGame(checkpoint, 0));
    const restored = GameSession.restore(saved.checkpoint, field, catalog);
    assert.deepEqual(restored.checkpoint(), checkpoint);
    const after = restored.state.snapshot();
    restored.advance(100);
    assert.deepEqual(restored.state.snapshot(), after, "restoration must not replay the grant");
    fieldHostChecks.push({ source: instruction.source, propertySource: e.source, opened,
      initialCount, resultCount: readCount(after), checkpointHash: hash(checkpoint),
      limits: expectedLimits, sourceAmount: e.raw.content_num });
  }
}
assert.equal(entities.length, 320);
assert.equal(instructions.length, 25);
assert.equal(instructions.filter((i) => i.request.message).length, 3);
assert.equal(entities.filter((e) => e.raw.content_num === 0).length, 22);
assert.equal(entities.filter((e) => e.raw.entity_id === 0).length, 30);
assert.equal(entities.filter((e) => e.definition.ownedList !== "gil").some((e) => e.raw.content_num > expectedLimits.item), false);
assert.equal([...categories].some((name) => /Inventory|Gil|ItemCount/.test(name)), false);
const report = {
  lane: "source-treasure-inventory-mechanisms", sourceSetHash: corpus.sourceSetHash,
  nativeEvidence: hash(native), catalogHash: catalog.contentHash, limits, entities, instructions, fieldHostChecks,
  genericFieldQuerySurvey: { observedCalcBranchCategories: [...categories].sort(),
    distinctSystemCallForms: syscalls.size, result: "No observed general quantity-query entry; treasure capacity is the implemented source read." },
  summary: { entityDefinitions: entities.length, capacityProbes: entities.length * 2,
    explicitInstructions: instructions.length, messageFalse: 22, messageTrue: 3,
    admittedFieldEntities: entities.filter((e) => e.fieldBlockers.length === 0).length,
    compiledMessageFalse: instructions.filter((i) => i.op.kind === "treasure-box").length,
    controlledFieldSaveChecks: fieldHostChecks.length,
    zeroRewards: 22, anonymousSourceEntities: 30 },
  doesNotEstablish: ["source-map-visuals", "ordinary-interaction", "message-rendering", "story-reachability", "original-game-execution", "full-game-parity"],
};
await writeFile(root + "build/reports/treasure-inventory-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report.summary, reportHash: hash(report) }, null, 2));
