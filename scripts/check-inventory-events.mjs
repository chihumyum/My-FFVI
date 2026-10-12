// Source instructions in controlled inventory states. This is not story reachability
// or an original-game behavior comparison.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../dist/src/compiler/corpus.js";
import { compileOpeningBattle } from "../dist/src/compiler/battle.js";
import { compileOpeningPlayable } from "../dist/src/compiler/opening-playable.js";
import { decodeFieldOp } from "../dist/src/compiler/field.js";
import { hash } from "../dist/src/compiler/content.js";
import { EventState } from "../dist/src/core/event-state.js";
import { FieldGame } from "../dist/src/core/field.js";
import { GameState } from "../dist/src/core/game-state.js";
import { equipmentSlotAllowed } from "../dist/src/core/equipment.js";
import { GameSession } from "../dist/src/core/game-session.js";
import {
  decodeSavedGame,
  encodeSavedGame,
} from "../dist/src/core/saved-game.js";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const corpus = await loadCorpus(root),
  sourceBattle = await compileOpeningBattle(root);
const catalog = await compileOpeningPlayable(root, sourceBattle);
const native = JSON.parse(
  await readFile(
    root + "/build/reports/inventory-events-native-check.json",
    "utf8",
  ),
);
assert.equal(
  native.sourceSha256,
  "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
);
assert.ok(
  corpus.manifest.sources.some(
    (s) => s.file === "GameAssembly.dll" && s.sha256 === native.sourceSha256,
  ),
);
const ownershipNative = JSON.parse(
  await readFile(
    root + "/build/reports/inventory-ownership-native-check.json",
    "utf8",
  ),
);
assert.equal(ownershipNative.nativeSha256, native.sourceSha256);
assert.equal(ownershipNative.semanticsVerified, false);
const sourceLimit = (name) => {
  const rows = corpus.tables["game_constant_int.csv"].filter(
    (r) => r.key_name === name,
  );
  assert.equal(rows.length, 1);
  return Number(rows[0].value1);
};
const equipmentSystem = catalog.gameState.equipmentSystem;
assert.ok(equipmentSystem);
assert.equal(equipmentSystem.catalog.limit, sourceLimit("MAX_ITEM"));
function controlledField(site, op) {
  return {
    formatVersion: 1,
    kind: "field-development",
    // Use the catalog's field host identity; the extracted instruction retains
    // the full corpus parent identity and its exact source pointer separately.
    sourceSetHash: catalog.common.fieldSourceSetHash,
    parentSourceSetHash: corpus.sourceSetHash,
    contentHash: hash({ site, op, kind: "isolated-inventory-instruction" }),
    map: {
      id: "inventory-probe",
      width: 1,
      height: 1,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: [0] },
      entities: [],
      source: site.source,
    },
    characters: {},
    scripts: {
      [site.script]: [
        { ...op, index: 0 },
        { ...site, index: 1, kind: "exit" },
      ],
    },
    entry: {
      player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
      description: "Isolated source inventory instruction; controlled state",
      evidence: [site.source],
    },
    limitations: [
      "controlled-state",
      "isolated-instruction",
      "no-original-oracle",
    ],
  };
}
const make = () =>
  new GameState(
    catalog.gameState,
    catalog.common.players,
    catalog.contentHash,
    catalog.common.conditions,
  );
const entries = [],
  checks = [],
  equipmentChains = [],
  equipmentSites = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    if (!["GetItem", "RemoveItem", "RemoveGil"].includes(raw.mnemonic))
      continue;
    const site = {
      script: asset.id,
      index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` },
    };
    const op = decodeFieldOp(raw, site, corpus.messages, corpus.tables);
    entries.push({ site, mnemonic: raw.mnemonic, op });
    if (op.kind === "blocked") continue;
    assert.equal(op.kind, "inventory");
    // Expectations use raw source identity/coefficient, not the compiled command.
    const sourceId = raw.operands.iValues[0],
      amount = raw.operands.iValues[1];
    const content = corpus.tables["content.csv"].find(
      (r) => +r.id === sourceId,
    );
    const product = corpus.tables["product.csv"].filter(
      (r) => +r.group_id === sourceId,
    );
    const item = raw.mnemonic !== "RemoveGil" && content.type_id === "1";
    const equipment =
      raw.mnemonic !== "RemoveGil" && ["2", "3"].includes(content.type_id);
    const payment = raw.mnemonic === "RemoveGil";
    const fee = payment ? Number(product[0].coefficient) : null;
    const initials = item
      ? [0, 1, catalog.gameState.limits.item]
      : equipment
        ? [0, sourceLimit("MAX_ITEM") - 1, sourceLimit("MAX_ITEM")]
        : payment
          ? [...new Set([0, Math.max(0, fee - 1), fee, fee + 1])]
          : [0, catalog.gameState.limits.gil - 1, catalog.gameState.limits.gil];
    for (const initial of initials) {
      const owned = make(),
        before = owned.snapshot();
      if (item) {
        before.items = before.items.filter((x) => x.id !== sourceId);
        if (initial) before.items.push({ id: sourceId, count: initial });
        before.items.sort((a, b) => a.id - b.id);
      } else if (equipment) {
        // Current real grant sites refer to equipment absent from the opening
        // loadouts. Fail instead of accidentally deleting a worn source copy.
        assert.ok(before.roster.every((p) => !p.equipment.includes(sourceId)));
        before.equipmentStock = before.equipmentStock.filter(
          (x) => x.id !== sourceId,
        );
        if (initial)
          before.equipmentStock.push({ id: sourceId, count: initial });
        before.equipmentStock.sort((a, b) => a.id - b.id);
      } else before.gil = before.totalGil = initial;
      owned.restore(before);
      const field = controlledField(site, op);
      const game = new FieldGame(
        field,
        EventState.initialized(),
        undefined,
        undefined,
        { inventory: owned.fieldInventory },
      );
      game.startEvent(asset.id);
      game.advance(1000);
      assert.equal(game.stop, null);
      assert.equal(game.busy, false);
      const after = owned.snapshot();
      if (item) {
        const expected =
          raw.mnemonic === "GetItem"
            ? Math.min(catalog.gameState.limits.item, initial + amount)
            : Math.max(0, initial - amount);
        assert.equal(
          after.items.find((x) => x.id === sourceId)?.count ?? 0,
          expected,
        );
        assert.equal(after.gil, before.gil);
        assert.equal(after.totalGil, before.totalGil);
      } else if (equipment) {
        const expected =
          raw.mnemonic === "GetItem"
            ? Math.min(sourceLimit("MAX_ITEM"), initial + amount)
            : Math.max(0, initial - amount);
        assert.deepEqual(
          owned.equipmentInventory.find((x) => x.id === sourceId),
          { id: sourceId, count: expected, equipped: 0, available: expected },
        );
        assert.equal(after.gil, before.gil);
        assert.equal(after.totalGil, before.totalGil);
        assert.deepEqual(after.items, before.items);
      } else if (payment) {
        const paid = initial >= fee;
        assert.equal(after.gil, paid ? initial - fee : initial);
        assert.equal(after.totalGil, before.totalGil);
        assert.equal(
          game.eventState.read({ category: "MapLocalVariable", index: 0 }),
          Number(paid),
        );
      } else {
        assert.equal(
          after.gil,
          Math.min(catalog.gameState.limits.gil, initial + amount),
        );
        assert.equal(after.totalGil, initial + amount);
      }
      if (!equipment)
        assert.deepEqual(after.equipmentStock, before.equipmentStock);
      assert.deepEqual(after.roster, before.roster);
      assert.deepEqual(after.completedBattles, before.completedBattles);
      const stable = JSON.stringify(after);
      const restored = FieldGame.restore(
        field,
        JSON.parse(JSON.stringify(game.checkpoint())),
        { inventory: owned.fieldInventory },
      );
      restored.advance(1000);
      assert.equal(
        JSON.stringify(owned.snapshot()),
        stable,
        "restoring idle field must not repeat inventory command",
      );
      checks.push({
        site,
        initial,
        ownedBefore: hash(before),
        ownedAfter: hash(after),
        fieldAfter: hash(game.checkpoint()),
      });
    }
    if (equipment) equipmentSites.push({ site, raw, op, content });
  }
}
// Source acquisition through the shared session, then a supported swap or an
// atomic wear refusal, portable save/restore and battle projection. No invented
// acquisition sites are added to force a physical-weapon example.
for (const { site, raw, op, content } of equipmentSites) {
  const id = raw.operands.iValues[0];
  const definition = equipmentSystem.catalog.definitions[id];
  assert.equal(definition.id, id);
  assert.equal(definition.equipmentId, Number(content.type_value));
  assert.equal(definition.kind, content.type_id === "2" ? "weapon" : "armor");
  const field = controlledField(site, op),
    game = new GameSession(field, catalog, 20261011);
  const before = game.state.snapshot();
  game.field.startEvent(site.script);
  game.advance(1000);
  assert.equal(game.field.stop, null);
  assert.equal(game.checkpointReady, true);
  assert.equal(
    game.state.equipmentInventory.find((x) => x.id === id).count,
    (before.equipmentStock.find((x) => x.id === id)?.count ?? 0) +
      raw.operands.iValues[1],
  );
  const choices = game.state.snapshot().roster.flatMap((player) =>
    [1, 2, 3, 4, 5, 6].flatMap((slot) =>
      game.state
        .equipmentChoices(player.id, slot)
        .filter((choice) => choice.id === id)
        .map((choice) => ({ player, slot, choice })),
    ),
  );
  const selected = choices[0];
  let wearRejection = null;
  if (definition.blockers.length) {
    assert.equal(choices.length, 0);
    const candidate = game.state.snapshot().roster.flatMap((player) => {
      const owner = equipmentSystem.catalog.characters[player.sourceId];
      return [1, 2, 3, 4, 5, 6].filter((slot) => definition.jobIds.includes(owner.jobId) &&
        equipmentSlotAllowed(definition, slot, owner) && (!owner.accessoriesOnly || slot >= 5))
        .map((slot) => ({ playerId: player.id, slot }));
    })[0];
    assert.ok(candidate, "source grant needs a slot/job-qualified wear refusal probe");
    const unchanged = game.state.snapshot();
    assert.throws(() => game.changeEquipment(candidate.playerId, candidate.slot, id), (error) => {
      assert.match(error.message, /Unimplemented equipment effects/);
      wearRejection = { ...candidate, reason: error.message, blockers: [...definition.blockers] };
      return true;
    });
    assert.deepEqual(game.state.snapshot(), unchanged);
  }
  let expected = null;
  if (selected) {
    const stock = game.state.snapshot().equipmentStock;
    assert.equal(
      game.changeEquipment(selected.player.id, selected.slot, id),
      true,
    );
    assert.deepEqual(game.state.snapshot().equipmentStock, stock);
    const owner = game.state
      .snapshot()
      .roster.find((p) => p.id === selected.player.id);
    const context = equipmentSystem.contexts[owner.id];
    const rawEquipment = owner.equipment.map((contentId) => {
      const c = corpus.tables["content.csv"].find((r) => +r.id === contentId);
      return corpus.tables[c.type_id === "2" ? "weapon.csv" : "armor.csv"].find(
        (r) => +r.id === +c.type_value,
      );
    });
    // These are source zero-provider opening characters. Read the raw vitality
    // cells independently rather than asking the projection helper for an oracle.
    const vitalityLimit = equipmentSystem.limits.parameters.vitality;
    const naturalVitality = Math.max(
      0,
      Math.min(
        vitalityLimit,
        context.parameters.base.vitality +
          context.parameters.additional.vitality +
          context.parameters.correction.vitality,
      ),
    );
    const vitality = Math.max(
      0,
      Math.min(
        vitalityLimit,
        naturalVitality +
          context.parameters.temporary.vitality +
          rawEquipment.reduce((n, r) => n + +r.vitality, 0),
      ),
    );
    expected = { vitality };
    const projected = game.players.find((p) => p.id === owner.id);
    assert.equal(projected.vitality, vitality);
    if (definition.kind === "weapon") {
      const weapon = corpus.tables["weapon.csv"].find(
        (r) => +r.id === +content.type_value,
      );
      assert.equal(context.parameters.condition601, false);
      assert.equal(context.physical.temporary.attack, 0);
      expected.attack = Math.max(
        0,
        Math.min(
          equipmentSystem.limits.physical.attack,
          Math.max(
            0,
            Math.min(
              equipmentSystem.limits.physical.attack,
              context.physical.baseAttack,
            ),
          ) + +weapon.attack,
        ),
      );
      assert.equal(projected.physical.attack, expected.attack);
    }
  }
  const saved = await encodeSavedGame(game.checkpoint(), 0);
  const restored = GameSession.restore(
    (await decodeSavedGame(saved)).checkpoint,
    field,
    catalog,
  );
  assert.deepEqual(restored.checkpoint(), game.checkpoint());
  restored.advance(1000);
  assert.deepEqual(
    restored.state.snapshot(),
    game.state.snapshot(),
    "restoring must not repeat a grant",
  );
  assert.deepEqual(restored.players, game.players);
  const encounterId = Number(
    Object.keys(catalog.encounters).sort((a, b) => +a - +b)[0],
  );
  assert.ok(Number.isInteger(encounterId));
  const lease = restored.state.openBattle(encounterId, catalog.encounters[encounterId].rewardPolicy);
  const borrowed = restored.state.battlePlayers(lease);
  assert.deepEqual(borrowed, game.players);
  assert.throws(
    () => restored.state.fieldInventory.prepare(op.command),
    /reserved/,
  );
  restored.state.cancelBattle(lease);
  assert.deepEqual(restored.state.snapshot(), game.state.snapshot());
  equipmentChains.push({
    site,
    id,
    equipmentId: definition.equipmentId,
    equipmentKind: definition.kind,
    obtained: raw.operands.iValues[1],
    selected: selected
      ? { playerId: selected.player.id, slot: selected.slot }
      : null,
    wearBlockers: definition.blockers,
    wearRejection,
    expected,
    after: hash(restored.state.snapshot()),
    portableSave: hash(saved),
    battlePlayers: hash(borrowed),
  });
}
assert.equal(equipmentSites.length, 17);
assert.equal(
  equipmentSites.filter((x) => x.raw.mnemonic === "RemoveItem").length,
  0,
);
assert.equal(
  new Set(equipmentSites.map((x) => x.raw.operands.iValues[0])).size,
  14,
);
const weaponChains = equipmentChains.filter((chain) => chain.equipmentKind === "weapon");
assert.deepEqual(weaponChains.map((chain) => chain.id).sort((a, b) => a - b), [103, 121, 127]);
assert.ok(weaponChains.every((chain) => chain.selected === null && chain.wearRejection !== null));
// The only formerly ordinary weapon in these actual grant sites is Weapon.Id
// 11. Native GetFightStatus has a special formula despite process=None; the new
// ordinary ranged source IDs do not occur in this instruction survey.
assert.equal(corpus.tables["weapon.csv"].find((row) => row.id === "11").process_prog, "None");
assert.ok(weaponChains.find((chain) => chain.id === 103).wearBlockers.includes("weapon:11 special physical weapon provider=11"));
for (const id of [121, 127]) assert.ok(weaponChains.find((chain) => chain.id === id)
  .wearBlockers.some((reason) => reason.includes("additional ability provider=")));
assert.equal(equipmentChains.filter((chain) => chain.selected).length, 6);
assert.ok(equipmentChains.filter((chain) => chain.selected).every((chain) => chain.equipmentKind === "armor"));
const scripts = corpus.assets.filter((a) => a.kind === "script");
const selectors = [
  ...new Set(
    scripts.flatMap((a) =>
      a.data.Mnemonics.filter((raw) => raw.mnemonic === "SysCall").map((raw) =>
        JSON.stringify(raw.operands.sValues),
      ),
    ),
  ),
];
const querySurvey = {
  examinedScripts: scripts.length,
  distinctSysCallSelectors: selectors.length,
  terms: [
    "ItemCount",
    "OwnedItem",
    "所持",
    "個数",
    "アイテム数",
    "所持金",
    "所持数",
  ],
  candidateSelectors: selectors.filter((s) =>
    /ItemCount|OwnedItem|所持|個数|アイテム数|所持金|所持数/i.test(s),
  ),
  recoveredInventoryCountSelectors: [],
  limitation:
    "Bounded source operand and native symbol survey; no generic inventory-count SysCall mapping established. The existence of ItemFilters.GetItemCount is not a script-call contract.",
};
const report = {
  kind: "field-inventory-source-check",
  formatVersion: 1,
  sourceSetHash: corpus.sourceSetHash,
  catalogHash: catalog.contentHash,
  nativeReportHash: hash(native),
  ownershipNativeReportHash: hash(ownershipNative),
  counts: {
    sourceSites: entries.length,
    admittedSites: entries.filter((e) => e.op.kind === "inventory").length,
    blockedSites: entries.filter((e) => e.op.kind === "blocked").length,
    probes: checks.length,
    equipmentGrantSites: equipmentSites.length,
    equipmentGrantIdentities: new Set(
      equipmentSites.map((x) => x.raw.operands.iValues[0]),
    ).size,
    equipmentChains: equipmentChains.length,
    equipmentSwaps: equipmentChains.filter((x) => x.selected).length,
    equipmentWearRejections: equipmentChains.filter((x) => x.wearRejection).length,
    weaponGrantSites: weaponChains.length,
  },
  entries,
  checks,
  equipmentChains,
  querySurvey,
  limitations: [
    "No new maps or story unlocks",
    "Isolated instructions with controlled stock and Gil",
    "Magic and esper ownership stays blocked; held equipment with unsupported wear effects cannot be equipped",
    "Equipment removals below full-roster occupancy are explicitly unsupported, not silently clamped or unequipped",
    "Acquisition/save/battle chains use isolated source instructions and the existing controlled opening party, not source story reachability",
    "No general item-count query or arbitrary SysCall support",
    "No original dynamic parity",
    "Source remove-zero record deletion is projected as canonical zero count",
  ],
};
const result = { ...report, contentHash: hash(report) };
await writeFile(
  root + "/build/reports/inventory-events-check.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    ...report.counts,
    contentHash: result.contentHash,
    catalogHash: result.catalogHash,
  }),
);
