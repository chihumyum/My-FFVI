// Independent raw-table expectations for bounded item status use. This lane
// neither recompiles the candidate nor establishes original-game parity.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { hash } from "../dist/src/compiler/content.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { GameState } from "../dist/src/core/game-state.js";
import { GameSession } from "../dist/src/core/game-session.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { encounterContent } from "../dist/src/core/battle-content.js";
import {
  encodeSavedGame,
  decodeSavedGame,
} from "../dist/src/core/saved-game.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--native"),
  "Usage: node scripts/check-item-status.mjs --native /path/to/GameAssembly.dll",
);
const nativePath = args[1] ?? process.env.FFVI_GAME_ASSEMBLY;
assert.ok(
  nativePath,
  "Provide --native or FFVI_GAME_ASSEMBLY for source byte verification",
);
const reportDir = resolve(root, "build/reports");
await mkdir(reportDir, { recursive: true });
// A failed rerun must not leave an earlier passing receipt at these paths.
for (const name of ["item-status-check.json", "item-status-native-check.json"])
  await rm(resolve(reportDir, name), { force: true });
const [importFiles, battleFiles, source, catalog, field] = await Promise.all([
  readSnapshot(resolve(root, "build/import")),
  readSnapshot(resolve(root, "build/battle")),
  readCandidate("build/game/opening-battle.json"),
  readCandidate("build/game/opening-playable.json"),
  readCandidate("build/game/narshe.json"),
]);
async function readCandidate(path) {
  return verifyContent(JSON.parse(await readFile(resolve(root, path), "utf8")));
}
const tables = JSON.parse(snapshotFile(importFiles, "tables.json"));
const manifest = JSON.parse(snapshotFile(importFiles, "project.json"));
const battleExport = JSON.parse(snapshotFile(battleFiles, "battle.json"));
assert.equal(catalog.common.profile, "narshe-playability-v16");
assert.equal(source.parentSourceSetHash, manifest.sourceSetHash);
assert.equal(source.sourceSetHash, battleExport.sourceSetHash);
assert.equal(battleExport.parentSourceSetHash, manifest.sourceSetHash);
assert.equal(catalog.common.sourceContentHash, source.contentHash);
assert.equal(catalog.common.fieldSourceSetHash, field.sourceSetHash);
assert.equal(field.parentSourceSetHash, manifest.sourceSetHash);
const provenance = new Map();
function row(table, id) {
  const found = tables[table].filter((r) => r.id === String(id));
  assert.equal(found.length, 1, `Unique raw source row ${table}:${id}`);
  const selected = source.tables[table]?.[id];
  assert.ok(selected, `Candidate source closure contains ${table}:${id}`);
  assert.deepEqual(
    selected.values,
    found[0],
    `Raw/candidate source row ${table}:${id}`,
  );
  const files = battleExport.sources.filter(
    (s) =>
      s.file === selected.source.file ||
      s.file.endsWith("/" + selected.source.file),
  );
  assert.equal(
    files.length,
    1,
    `Unique source file fingerprint for ${table}:${id}`,
  );
  const file = files[0];
  assert.deepEqual(
    { ...battleExport.tableSources[table], rowId: String(id) },
    selected.source,
    `Raw table object identity for ${table}:${id}`,
  );
  provenance.set(`${table}:${id}`, {
    table,
    id: String(id),
    source: selected.source,
    fileSha256: file.sha256,
    rowHash: hash(found[0]),
  });
  return found[0];
}
function conditionGroup(id) {
  const members = tables["condition_group.csv"].filter(
    (r) => r.group_id === String(id),
  );
  assert.ok(members.length, `Nonempty raw condition group ${id}`);
  return members.map((r) => {
    row("condition_group.csv", r.id);
    row("condition.csv", r.condition_id);
    return Number(r.condition_id);
  });
}
function program(contentId, context) {
  const content = row("content.csv", contentId);
  assert.equal(content.type_id, "1");
  const item = row("item.csv", content.type_value);
  const groupId = Number(item[`${context}_function_group_id`]);
  const functions = [];
  if (groupId) {
    const group = row("function_group.csv", groupId);
    for (let slot = 1; slot <= 3; slot++) {
      const id = Number(group[`function${slot}_id`]);
      if (!id) continue;
      const fn = row("function.csv", id);
      const values = [1, 2, 3].map((n) =>
        Number(group[`function${slot}_value${n}`]),
      );
      const recoveryIds =
        fn.type_id === "12"
          ? conditionGroup(values[0])
          : fn.type_id === "11"
            ? [Number(row("condition.csv", values[0]).id)]
            : [];
      functions.push({
        slot,
        id,
        type: Number(fn.type_id),
        values,
        recoveryIds,
      });
    }
  }
  return {
    contentId,
    itemId: Number(item.id),
    context,
    groupId,
    range: Number(item[`${context}_renge_id`]),
    functions,
  };
}
const programs = [10, 11, 15, 21].flatMap((id) =>
  ["menu", "battle"].map((c) => program(id, c)),
);
const phoenix = programs.find(
  (p) => p.contentId === 10 && p.context === "battle",
);
assert.deepEqual(
  phoenix.functions.map((f) => [f.type, f.values]),
  [
    [12, [428, 0, 0]],
    [34, [2, 5, 8]],
  ],
);
assert.equal(phoenix.itemId, 9);
assert.deepEqual(phoenix.functions[0].recoveryIds, [5, 100]);
assert.deepEqual(
  programs.find((p) => p.contentId === 10 && p.context === "menu").functions,
  phoenix.functions,
);
for (const context of ["menu", "battle"]) {
  const p = programs.find((p) => p.contentId === 15 && p.context === context);
  assert.deepEqual(
    p.functions.map((f) => [f.type, f.values]),
    [[12, [1, 0, 0]]],
  );
  assert.ok(p.functions[0].recoveryIds.includes(6));
  assert.ok(catalog.gameState.items[10].uses[context].plan);
  assert.ok(catalog.gameState.items[15].uses[context].plan);
  assert.equal(
    catalog.gameState.items[11].uses[context].plan,
    null,
    "Zombie recovery composition stays blocked",
  );
}
const echoMenu = programs.find(
  (p) => p.contentId === 21 && p.context === "menu",
);
const echoBattle = programs.find(
  (p) => p.contentId === 21 && p.context === "battle",
);
assert.equal(echoMenu.groupId, 0);
assert.deepEqual(
  echoBattle.functions.map((f) => [f.type, f.values]),
  [[11, [6, 0, 0]]],
);
assert.equal(catalog.gameState.items[21].uses.menu.plan, null);
assert.ok(catalog.gameState.items[21].uses.battle.plan);
const dying = tables["condition.csv"].filter((r) => r.condition_type === "4");
assert.equal(dying.length, 1);
const dyingId = Number(row("condition.csv", dying[0].id).id);
const constants = tables["game_constant_int.csv"].filter(
  (r) => r.key_name === "RATE_HAVE_NEAR_DEATH",
);
assert.equal(constants.length, 1);
const dyingDivisor = Number(
  row("game_constant_int.csv", constants[0].id).value1,
);
const recoveryDivisor = phoenix.functions[1].values[2];
function expectedRevival(maxHp) {
  // Independent interpretation of raw Function 34 Value2=5 and source life
  // removal: HP-zero removal clamps to one after the recovery update.
  const amount = Math.min(9999, Math.trunc(maxHp / recoveryDivisor));
  return {
    hp: Math.max(1, amount),
    conditionIds:
      amount > 0 &&
      Math.fround(Math.fround(amount) / Math.fround(maxHp)) <=
        Math.fround(1 / Math.fround(dyingDivisor))
        ? [dyingId]
        : [],
  };
}
const makeState = (candidate = catalog) =>
  new GameState(
    candidate.gameState,
    candidate.common.players,
    candidate.contentHash,
    candidate.common.conditions,
  );
function boundaryCatalog(maxHp) {
  const candidate = structuredClone(catalog),
    player = candidate.common.players[1];
  player.hp = maxHp;
  // Keep the whole equipment system in a controlled clone. Once equipment is
  // integrated, max HP must come from the same base/growth/equipment providers
  // as normal play; editing a persisted derived maxHp would evade that invariant.
  if (candidate.gameState.equipmentSystem) {
    const context = candidate.gameState.equipmentSystem.contexts[player.id];
    assert.ok(
      context,
      "Controlled boundary has the character's parameter context",
    );
    for (const provider of ["additional", "temporary", "passive"])
      assert.equal(
        context.parameters[provider].hp,
        0,
        "Boundary requires no extra HP provider",
      );
    context.parameters.base.hp = maxHp;
  }
  const { contentHash: _, ...payload } = candidate;
  candidate.contentHash = hash(payload);
  return candidate;
}
const count = (snapshot, id) =>
  snapshot.items.find((i) => i.id === id)?.count ?? 0;
const checks = [];
for (const deathId of phoenix.functions[0].recoveryIds) {
  assert.equal(row("condition.csv", deathId).condition_type, "5");
  for (const maxHp of [1, 7, 8, 63, 9999]) {
    const candidate = boundaryCatalog(maxHp);
    const state = makeState(candidate),
      initial = state.snapshot(),
      target = initial.roster[1];
    assert.equal(
      target.maxHp,
      maxHp,
      "Boundary is produced by complete character initialization",
    );
    target.hp = 0;
    target.conditionIds = [deathId];
    state.restore(initial);
    state.changeItems([{ id: 10, count: 1 }], "grant");
    const before = state.snapshot();
    assert.equal(state.useMenuItem(10, target.id), true);
    const after = state.snapshot().roster[1];
    assert.deepEqual(
      { hp: after.hp, conditionIds: after.conditionIds },
      expectedRevival(maxHp),
    );
    assert.equal(after.mp, target.mp);
    assert.equal(count(state.snapshot(), 10), 0);
    checks.push({
      kind: "menu-revival",
      deathId,
      maxHp,
      expected: expectedRevival(maxHp),
      actual: { hp: after.hp, conditionIds: after.conditionIds },
      consumed: 1,
      controlledCatalogHash: candidate.contentHash,
    });
    const runBattle = (parts) => {
      const owned = makeState(candidate);
      owned.restore(before);
      const lease = owned.openBattle(3);
      const battle = new BattleGame(
        encounterContent(candidate, 3),
        71,
        owned.battlePlayers(lease),
        owned.battleInventory(lease),
      );
      ready(battle);
      assert.equal(
        battle.commandItem(
          battle.players[0].id,
          10,
          { kind: "single", id: target.id },
          3,
        ),
        true,
      );
      for (const part of parts) battle.advance(part);
      const result = battle.players[1];
      assert.deepEqual(
        { hp: result.hp, conditionIds: result.conditionIds },
        expectedRevival(maxHp),
      );
      assert.equal(result.mp, target.mp);
      assert.equal(battle.inventory.find((i) => i.id === 10).count, 0);
      assert.deepEqual(
        owned.snapshot(),
        before,
        "Battle mutation stays in its borrowed copy",
      );
      return {
        hp: result.hp,
        conditionIds: result.conditionIds,
        events: battle.events,
        inventory: battle.inventory,
        action: battle.action,
      };
    };
    const battleResult = runBattle([410]);
    assert.deepEqual(runBattle(Array(41).fill(10)), battleResult);
    checks.push({
      kind: "battle-revival",
      deathId,
      maxHp,
      expected: expectedRevival(maxHp),
      actual: { hp: battleResult.hp, conditionIds: battleResult.conditionIds },
      consumed: 1,
      replay: true,
    });
  }
}
function ready(battle) {
  battle.players.forEach((p) => {
    p.atb = p.hp > 0 ? 100 : 0;
  });
  battle.enemies.forEach((p) => {
    p.atb = 0;
  });
}
for (const hp of [1, 20, catalog.common.players[0].hp]) {
  const state = makeState(),
    s = state.snapshot();
  s.roster[0].hp = hp;
  state.restore(s);
  state.changeItems([{ id: 10, count: 1 }], "grant");
  const before = state.snapshot();
  assert.equal(state.useMenuItem(10, s.roster[0].id), false);
  assert.deepEqual(state.snapshot(), before);
  checks.push({ kind: "menu-living-phoenix-rejected", hp, consumed: 0 });
}
for (const id of [15, 21]) {
  const state = makeState(),
    s = state.snapshot();
  s.roster[2].conditionIds = [6];
  state.restore(s);
  state.changeItems([{ id, count: 2 }], "grant");
  const before = state.snapshot();
  assert.equal(state.useMenuItem(id, s.roster[2].id), id === 15);
  if (id === 15) {
    assert.deepEqual(state.snapshot().roster[2].conditionIds, []);
    assert.equal(state.snapshot().roster[2].hp, s.roster[2].hp);
    assert.equal(state.snapshot().roster[2].mp, s.roster[2].mp);
    const once = state.snapshot();
    assert.equal(state.useMenuItem(id, s.roster[2].id), false);
    assert.deepEqual(state.snapshot(), once);
  } else assert.deepEqual(state.snapshot(), before);
  checks.push({
    kind: "menu-silence-cure",
    id,
    allowed: id === 15,
    consumed: id === 15 ? 1 : 0,
  });
  state.restore(before);
  const lease = state.openBattle(3);
  const battle = new BattleGame(
    encounterContent(catalog, 3),
    79,
    state.battlePlayers(lease),
    state.battleInventory(lease),
  );
  ready(battle);
  assert.ok(
    battle.commandItem(
      battle.players[0].id,
      id,
      { kind: "single", id: battle.players[2].id },
      3,
    ),
  );
  battle.advance(410);
  assert.deepEqual(battle.players[2].conditionIds, []);
  assert.equal(battle.players[2].hp, before.roster[2].hp);
  assert.equal(battle.players[2].mp, before.roster[2].mp);
  assert.equal(battle.inventory.find((i) => i.id === id).count, 1);
  assert.deepEqual(state.snapshot(), before);
  checks.push({ kind: "battle-silence-cure", id, consumed: 1 });
}
function doubleRevival(parts) {
  const state = makeState(),
    s = state.snapshot(),
    target = s.roster[2];
  target.hp = 0;
  target.conditionIds = [5];
  state.restore(s);
  state.changeItems([{ id: 10, count: 2 }], "grant");
  const lease = state.openBattle(3),
    battle = new BattleGame(
      encounterContent(catalog, 3),
      83,
      state.battlePlayers(lease),
      state.battleInventory(lease),
    );
  ready(battle);
  for (const actor of battle.players.slice(0, 2))
    assert.ok(
      battle.commandItem(actor.id, 10, { kind: "single", id: target.id }, 3),
    );
  assert.equal(battle.inventory.find((i) => i.id === 10).available, 0);
  for (const part of parts) battle.advance(part);
  assert.equal(battle.players[2].hp, expectedRevival(target.maxHp).hp);
  assert.deepEqual(battle.action.targetIds, [target.id]);
  assert.ok(battle.action.results[0].effects.every((e) => e.missed));
  assert.equal(battle.inventory.find((i) => i.id === 10).count, 0);
  return {
    units: battle.combatants,
    action: battle.action,
    events: battle.events,
    inventory: battle.inventory,
  };
}
const pair = doubleRevival([1320]);
assert.deepEqual(doubleRevival(Array(132).fill(10)), pair);
checks.push({
  kind: "queued-revival-same-target",
  target: pair.action.targetIds[0],
  secondMiss: true,
  totalConsumed: 2,
  replay: true,
});

// The event and combat completion below are controlled host inputs. They are
// deliberately separate from source story progression and enemy-victory proof.
const probeField = structuredClone(field);
const site = {
  script: "__item_status_probe",
  index: 0,
  source: {
    file: "controlled-source-probe",
    assetPath: "item-status-transaction",
  },
};
probeField.scripts.__item_status_probe = [
  {
    ...site,
    kind: "encounter",
    party: 3,
    continuation: "__item_status_return",
  },
];
probeField.scripts.__item_status_return = [
  { ...site, script: "__item_status_return", kind: "exit" },
];
const { contentHash: originalFieldHash, ...probePayload } = probeField;
probeField.contentHash = hash(probePayload);
let game = new GameSession(probeField, catalog, 89);
const initial = game.state.snapshot();
initial.roster[0].conditionIds = [6];
initial.roster[1].hp = 0;
initial.roster[1].conditionIds = [5];
initial.roster[2].conditionIds = [6];
game.state.restore(initial);
game.state.changeItems(
  [
    { id: 10, count: 2 },
    { id: 15, count: 1 },
    { id: 21, count: 1 },
  ],
  "grant",
);
assert.ok(game.useMenuItem(15, initial.roster[0].id));
async function roundTrip(session) {
  const checkpoint = session.checkpoint();
  const saved = await decodeSavedGame(await encodeSavedGame(checkpoint, 0));
  const restored = GameSession.restore(saved.checkpoint, probeField, catalog);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(restored.continueVictory(), false);
  return restored;
}
game = await roundTrip(game);
const entry = game.state.snapshot();
game.field.startEvent("__item_status_probe");
game.advance(10);
ready(game.battle);
assert.equal(game.useMenuItem(10, initial.roster[1].id), false);
assert.throws(() => game.checkpoint(), /Cannot save/);
function useAndFinish(id, actor, target) {
  assert.ok(
    game.battle.commandItem(actor, id, { kind: "single", id: target }, 3),
  );
  game.advance(910);
}
useAndFinish(10, initial.roster[0].id, initial.roster[1].id);
assert.deepEqual(game.state.snapshot(), entry);
for (const p of game.battle.players) {
  p.hp = 0;
  p.conditionIds = [5];
}
game.advance(10);
assert.equal(game.battle.phase, "defeat");
assert.ok(game.retryBattle());
assert.deepEqual(game.state.snapshot(), entry);
assert.equal(game.battle.players[1].hp, 0);
assert.deepEqual(game.battle.players[2].conditionIds, [6]);
assert.equal(game.battle.inventory.find((i) => i.id === 10).count, 2);
ready(game.battle);
useAndFinish(10, initial.roster[0].id, initial.roster[1].id);
useAndFinish(21, initial.roster[2].id, initial.roster[2].id);
for (const enemy of game.battle.enemies) enemy.hp = 0;
game.advance(10);
assert.equal(game.battle.phase, "victory");
const result = game.battle.previewVictory();
assert.deepEqual(result.consumedItems, [
  { id: 10, count: 1 },
  { id: 21, count: 1 },
]);
assert.deepEqual(game.state.snapshot(), entry);
const rewardGil = game.battle.enemies.reduce(
  (sum, enemy) => sum + Number(row("monster.csv", enemy.sourceId).gill),
  0,
);
assert.equal(result.gil, rewardGil);
assert.ok(game.continueVictory());
assert.equal(game.continueVictory(), false);
game.advance(10);
assert.ok(game.checkpointReady);
const settled = game.state.snapshot();
assert.equal(settled.gil, entry.gil + rewardGil);
assert.equal(settled.completedBattles.length, 1);
assert.equal(count(settled, 10), 1);
assert.equal(count(settled, 15), 0);
assert.equal(count(settled, 21), 0);
assert.ok(settled.roster.every((p) => p.hp > 0 && !p.conditionIds.includes(6)));
game = await roundTrip(game);
assert.deepEqual(game.state.snapshot(), settled);
checks.push({
  kind: "menu-battle-retry-victory-checkpoint",
  controlledEnding: true,
  checkpoints: 2,
  retryRestoresEntry: true,
  singleReward: true,
  gil: rewardGil,
  consumedOnSuccessfulBattle: result.consumedItems,
  finalStock: settled.items,
  finalParty: settled.roster.map(({ id, hp, mp, conditionIds }) => ({
    id,
    hp,
    mp,
    conditionIds,
  })),
});
const activeIds = catalog.common.conditions.behaviors.map((b) => b.id);
const otherRecoveryIds = [
  ...new Set(
    programs.flatMap((p) => p.functions.flatMap((f) => f.recoveryIds)),
  ),
].filter((id) => !activeIds.includes(id));
for (const id of otherRecoveryIds) {
  const state = makeState(),
    invalid = state.snapshot();
  invalid.roster[0].conditionIds = [id];
  assert.throws(
    () => state.restore(invalid),
    /Unimplemented active battle condition/,
  );
}
assert.ok(otherRecoveryIds.length > 0);

const nativeSource = manifest.sources.find(
  (s) => s.file === "GameAssembly.dll",
);
assert.ok(nativeSource);
const nativeReport = JSON.parse(
  (
    await promisify(execFile)(
      process.env.PYTHON ?? "python3",
      [
        "-c",
        String.raw`
import bisect, hashlib, json, re, sys
from pathlib import Path
root, dll, expected = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
sys.path.insert(0, str(root / "tools/native"))
from inspect_pe import PEImage
sha = lambda data: hashlib.sha256(data).hexdigest()
data = dll.read_bytes()
assert sha(data) == expected, "Original DLL changed from imported source manifest"
pe = PEImage(data)
symbols = (root / "build/native/il2cpp/script.json").read_bytes()
header = (root / "build/native/il2cpp/il2cpp_ghidra.h").read_bytes()
by_rva = {}
for method in json.loads(symbols)["ScriptMethod"]:
    by_rva.setdefault(method["Address"], []).append(method)
addresses = sorted(by_rva)
expected_batches = {
 "item-use": [0x3d8400,0x3d8660,0x5029b0,0x76afb0,0x7fd6d0,0x7fdaf0,0x7fe5e0,0xa6e6e0,0xa6f520],
 "item-eligibility": [0x7f9d80,0x7fae40,0x7fb670,0x15a9340],
 "condition-actions": [0x3d2850,0x3e6460,0x4582c0,0x458520,0x4f1d70,0x4f2630,0x66e250,0x66e910,0x66eac0,0x66f4d0],
 "revival-chain": [0x3d8a00,0x4f4760,0x668cb0,0x769980,0x769cd0,0x769d70,0x772030,0x772060,0x8f3080,0x8f3820],
 "revival-recovery": [0x343380,0x343a50,0x4671b0,0x6702d0,0x6704b0,0x678ef0],
 "revival-target-recovery": [0x4f7d60,0x9008e0,0x900d40],
}
batches = []
for folder, wanted in expected_batches.items():
    base = root / "build/native" / folder
    receipt = (base / "complete.json").read_bytes()
    value = json.loads(receipt)
    assert value["status"] == "complete" and value["semanticsVerified"] is False
    assert value["nativeSha256"] == expected
    assert value["symbolsSha256"] == sha(symbols)
    assert value["headerSha256"] == sha(header)
    assert [int(m["rva"], 16) for m in value["methods"]] == wanted
    for method in value["methods"]:
        address = int(method["rva"], 16)
        next_address = int(method["nextSymbolRva"], 16)
        assert len(by_rva[address]) == 1, "Ambiguous target method"
        assert next_address == addresses[bisect.bisect_right(addresses, address)]
        name = re.sub(r"[^a-zA-Z0-9_]", "_", by_rva[address][0]["Name"])[:180] + "_" + format(address, "x")
        assert method["name"] == name
        section, offset, raw = pe.read(address, next_address - address)
        assert sha(raw) == method["nativeRangeSha256"]
        c = (base / (format(address, "x") + ".c")).read_bytes()
        assert sha(c) == method["decompiledSha256"]
    batches.append({"folder": folder, "receiptSha256": sha(receipt), "methods": value["methods"]})
print(json.dumps({"lane": "existing-native-export-integrity", "nativeSha256": expected,
 "symbolsSha256": sha(symbols), "headerSha256": sha(header), "methodCount": sum(len(b["methods"]) for b in batches),
 "batches": batches, "semanticsVerified": False,
 "limitations": ["static ranges include possible alignment bytes", "decompilation is not native dynamic evidence"]}))
`,
        root,
        resolve(nativePath),
        nativeSource.sha256,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    )
  ).stdout,
);
nativeReport.sourceSetHash = manifest.sourceSetHash;
nativeReport.catalogHash = catalog.contentHash;
nativeReport.contentHash = hash(nativeReport);
const nativeBytes = JSON.stringify(nativeReport, null, 2) + "\n";
await writeFile(
  resolve(reportDir, "item-status-native-check.json"),
  nativeBytes,
);
const report = {
  lane: "raw-source-controlled-item-status",
  sourceSetHash: manifest.sourceSetHash,
  battleSourceSetHash: source.sourceSetHash,
  sourceContentHash: source.contentHash,
  catalogHash: catalog.contentHash,
  originalFieldHash,
  controlledFieldHash: probeField.contentHash,
  programs,
  sourceRows: [...provenance.values()].sort((a, b) =>
    `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`),
  ),
  checks,
  decodedButInactiveRecoveryIds: otherRecoveryIds,
  inactiveStatusesStillRejected: true,
  nativeReport: {
    path: "build/reports/item-status-native-check.json",
    contentHash: nativeReport.contentHash,
    sha256: createHash("sha256").update(nativeBytes).digest("hex"),
    methods: nativeReport.methodCount,
  },
  limitations: [
    "no-original-game-parity",
    "controlled-hp-stock-atb-and-combat-ending",
    "only-silence-death-dying-active-behaviors",
    "no-enemy-item-targets-or-undead",
    "no-equipment-permanent-condition-restoration",
    "development-scheduling-and-random-stream",
    "stable-checkpoints-only",
    "no-new-story-item-grants-or-region-coverage",
  ],
};
report.contentHash = hash(report);
await writeFile(
  resolve(reportDir, "item-status-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    checks: checks.length,
    nativeMethods: nativeReport.methodCount,
    catalogHash: catalog.contentHash,
    contentHash: report.contentHash,
    decodedButInactiveRecoveryIds: otherRecoveryIds,
  }),
);
