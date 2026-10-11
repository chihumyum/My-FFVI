// Independent raw-operand expectations and unchanged source-AI host probes.
// This checks a development mechanism; it is not native dynamic parity.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { hash } from "../dist/src/compiler/content.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { battleTableIndex } from "../dist/src/compiler/battle.js";
import {
  compileBattleAI,
  battleAIAbilities,
} from "../dist/src/compiler/battle-ai.js";
import { compileDevelopmentAbility } from "../dist/src/compiler/ability.js";
import {
  startBattleAI,
  planBattleAITurn,
  planBattleAIReaction,
} from "../dist/src/core/battle-ai.js";
import { initialEnemyBehavior } from "../dist/src/core/enemy-behavior.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { encounterContent } from "../dist/src/core/battle-content.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--native"),
  "Usage: node scripts/check-battle-received-ability.mjs --native /path/to/GameAssembly.dll",
);
const nativePath = args[1] ?? process.env.FFVI_GAME_ASSEMBLY;
assert.ok(
  nativePath,
  "Provide --native or FFVI_GAME_ASSEMBLY for source byte verification",
);
const reportDir = resolve(root, "build/reports");
await mkdir(reportDir, { recursive: true });
for (const name of [
  "battle-received-ability-check.json",
  "battle-received-ability-native-check.json",
])
  await rm(resolve(reportDir, name), { force: true });
const [importFiles, battleFiles, source, catalog] = await Promise.all([
  readSnapshot(resolve(root, "build/import")),
  readSnapshot(resolve(root, "build/battle")),
  readCandidate("build/game/opening-battle.json"),
  readCandidate("build/game/opening-playable.json"),
]);
async function readCandidate(path) {
  return verifyContent(JSON.parse(await readFile(resolve(root, path), "utf8")));
}
const tables = JSON.parse(snapshotFile(importFiles, "tables.json"));
const manifest = JSON.parse(snapshotFile(importFiles, "project.json"));
const exported = JSON.parse(snapshotFile(battleFiles, "battle.json"));
assert.equal(source.parentSourceSetHash, manifest.sourceSetHash);
assert.equal(source.sourceSetHash, exported.sourceSetHash);
assert.equal(exported.parentSourceSetHash, manifest.sourceSetHash);
assert.equal(catalog.common.sourceContentHash, source.contentHash);
const reader = battleTableIndex(tables, exported.tableSources);
const instructions = [],
  programBlockers = [],
  programs = new Map();
let sourceProgramCount = 0;
for (const asset of Object.values(exported.assets).filter((a) =>
  a.source.assetPath.includes("/MonsterAI/"),
)) {
  sourceProgramCount++;
  const files = exported.sources.filter(
    (s) =>
      s.file === asset.source.file || s.file.endsWith("/" + asset.source.file),
  );
  assert.equal(files.length, 1);
  const identity = {
    ...asset.source,
    sha256: files[0].sha256,
    sourceSetHash: source.parentSourceSetHash,
    battleSourceSetHash: source.sourceSetHash,
  };
  assert.equal(typeof identity.objectId, "string");
  let program;
  try {
    program = compileBattleAI(asset.data, identity);
  } catch (error) {
    programBlockers.push({ source: identity, reason: error.message });
    assert.ok(
      !asset.data.Mnemonics?.some((m) =>
        ["IsRecevieAbility", "IsRecevieAbilitySystem"].includes(m.mnemonic),
      ),
      "A received-ability source program no longer decodes",
    );
    continue;
  }
  programs.set(asset.source.assetPath.split("/").at(-1), { asset, program });
  for (const [pc, raw] of asset.data.Mnemonics.entries()) {
    if (!["IsRecevieAbility", "IsRecevieAbilitySystem"].includes(raw.mnemonic))
      continue;
    const expected = {
      kind: "received-ability-branch",
      field: raw.mnemonic === "IsRecevieAbility" ? "id" : "systemId",
      value: raw.operands.iValues[0],
      target: raw.operands.iValues[1],
    };
    assert.deepEqual(program.instructions[pc].op, expected);
    instructions.push({
      source: identity,
      programHash: hash(asset.data),
      pc,
      raw: raw.operands,
      expected,
    });
  }
}
assert.equal(instructions.filter((i) => i.expected.field === "id").length, 25);
assert.equal(
  instructions.filter((i) => i.expected.field === "systemId").length,
  1,
);

const { asset, program } = programs.get("sc_ai_002_Templar.json");
assert.equal(program.source.objectId, "7235875817597455095");
assert.equal(program.instructions.length, 21);
assert.deepEqual(program.blockers, []);
assert.ok(program.instructions.every((i) => i.op.kind !== "blocked"));
const context = () => ({
  self: {
    hp: 10000,
    mp: 10000,
    monsterId: 3,
    behavior: initialEnemyBehavior(),
  },
  conditionIds: [],
  players: [{ level: 1 }],
  enemies: [{ level: 11 }],
});
const routeChecks = [];
for (const [id, system, counterReady, hp, expectedCounterPc] of [
  [1, 3, true, 10000, 5],
  [1, 3, false, 10000, null],
  [1, 3, true, 0, null],
  [3, 2, true, 10000, null],
  [3, 2, false, 10000, null],
]) {
  const ctx = context();
  ctx.self.hp = hp;
  const initial = startBattleAI(program, ctx);
  const reaction = planBattleAIReaction(program, initial.state, ctx, {
    counterReady,
    receivedAbilityId: id,
    receivedSystemId: system,
  });
  assert.deepEqual(
    reaction.acts.map((a) => a.pc),
    expectedCounterPc === null ? [] : [expectedCounterPc],
  );
  assert.equal(reaction.state.receivedAbility, null);
  if (id === 3) {
    assert.ok(reaction.visited.includes(11));
    assert.ok(!reaction.visited.includes(5));
  }
  const normal = planBattleAITurn(program, reaction.state, ctx);
  assert.deepEqual(
    normal.acts.map((a) => ({ pc: a.pc, abilities: a.abilities })),
    [{ pc: 6, abilities: [1] }],
  );
  routeChecks.push({
    id,
    system,
    counterReady,
    hp,
    visited: reaction.visited,
    selectedPcs: reaction.acts.map((a) => a.pc),
    nextNormalPc: 6,
  });
}

function sourceHost(missed, parts) {
  const content = structuredClone(encounterContent(catalog, 3));
  const donorSourceId = content.enemies[0].sourceId;
  content.enemies = [content.enemies[0]];
  const enemy = content.enemies[0];
  // Preserve every source instruction and its identity. Stats and formation are
  // an explicitly controlled host, not a claim that source monster 3 is ready.
  enemy.ai = structuredClone(program);
  enemy.abilities = battleAIAbilities(program);
  enemy.hp = enemy.mp = 10000;
  enemy.name = "收到能力机制检查";
  for (const p of content.players) p.hp = 10000;
  content.initialAtb = { player: [100, 100], enemy: [100, 100] };
  for (const id of enemy.abilities)
    content.abilities[id] = compileDevelopmentAbility(
      reader,
      id,
      `机制能力 #${id}`,
    );
  assert.ok(content.abilities[1].plan);
  assert.ok(content.abilities[379].plan);
  assert.equal(content.abilities[40].plan, null);
  content.abilities[1].wait = 0;
  content.commands[900001] = {
    id: 900001,
    name: "机制普通攻击",
    kind: "ability",
    abilityIds: [1],
    forbiddenConditionIds: [],
  };
  const player = content.players[0];
  player.abilities.push(1);
  player.commands.push(900001);
  player.physical.accuracy = missed ? 0 : 255;
  const battle = new BattleGame(content, 509);
  assert.ok(battle.command(player.id, 1, enemy.id, 900001));
  for (const dt of parts) battle.advance(dt);
  assert.equal(battle.action.source.id, 1);
  assert.equal(battle.action.results[0].effects[0].missed, missed);
  const counters = battle.pendingActions.filter((a) => a.kind === "counter");
  assert.deepEqual(
    counters.map((a) => a.source.id),
    missed ? [] : [379],
  );
  if (!missed) assert.deepEqual(counters[0].targetIds, [player.id]);
  assert.ok(
    battle.pendingActions.some(
      (a) => a.kind === "normal" && a.actor === enemy.id,
    ),
  );
  assert.equal(battle.enemyAIState(enemy.id).receivedAbility, null);
  assert.deepEqual(battle.enemies[0].ai, program);
  return {
    donorSourceId,
    combatants: battle.combatants,
    events: battle.events,
    action: battle.action,
    pending: battle.pendingActions,
    state: battle.enemyAIState(enemy.id),
  };
}
const hostChecks = [];
for (const missed of [false, true]) {
  const result = sourceHost(missed, [410]);
  assert.deepEqual(sourceHost(missed, Array(41).fill(10)), result);
  hostChecks.push({
    missed,
    donorSourceId: result.donorSourceId,
    primary: result.action.results[0].effects[0],
    actions: result.pending.map((a) => ({
      kind: a.kind,
      actor: a.actor,
      source: a.source,
      targetIds: a.targetIds,
    })),
    state: result.state,
    replay: true,
  });
}
const monster = tables["monster.csv"].find((r) => r.id === "3");
assert.equal(monster.script_id, "2");
const unsupported = [3, 40].map((id) => {
  const ability = compileDevelopmentAbility(reader, id);
  assert.equal(ability.plan, null);
  return {
    id,
    blockers: ability.blockers,
    rowHash: hash(tables["ability.csv"].find((r) => r.id === String(id))),
  };
});

const nativeSource = manifest.sources.find(
  (s) => s.file === "GameAssembly.dll",
);
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
assert sha(data) == expected, "DLL changed from imported source manifest"
pe = PEImage(data)
symbols = (root / "build/native/il2cpp/script.json").read_bytes()
header = (root / "build/native/il2cpp/il2cpp_ghidra.h").read_bytes()
by_rva = {}
for method in json.loads(symbols)["ScriptMethod"]:
    by_rva.setdefault(method["Address"], []).append(method)
addresses = sorted(by_rva)
selected = {
 "ai-received-context": [0x826390,0x826490,0x15b7460,0x15b7520,0x15b7e80,0x15b7ea0,0x15b83d0,0x15b8460,0x15b9d50],
 "ai-control": [0x828fe0],
 "ai-queue": [0x1591170,0x15b7730],
 "ai-counter-trigger": [0x1591ba0,0x1591ee0],
 "item-counter": [0x1590190],
}
batches = []
for folder, wanted in selected.items():
    base = root / "build/native" / folder
    receipt = (base / "complete.json").read_bytes()
    value = json.loads(receipt)
    assert value["status"] == "complete" and value["semanticsVerified"] is False
    assert value["nativeSha256"] == expected
    assert value["symbolsSha256"] == sha(symbols)
    assert value["headerSha256"] == sha(header)
    methods = [m for m in value["methods"] if int(m["rva"], 16) in wanted]
    assert [int(m["rva"], 16) for m in methods] == wanted
    if folder == "ai-received-context":
        assert len(value["methods"]) == len(wanted)
    for method in methods:
        address, next_address = int(method["rva"], 16), int(method["nextSymbolRva"], 16)
        assert len(by_rva[address]) == 1, "Ambiguous target method"
        assert next_address == addresses[bisect.bisect_right(addresses, address)]
        name = re.sub(r"[^a-zA-Z0-9_]", "_", by_rva[address][0]["Name"])[:180] + "_" + format(address, "x")
        assert method["name"] == name
        section, offset, raw = pe.read(address, next_address - address)
        assert sha(raw) == method["nativeRangeSha256"]
        assert sha((base / (format(address, "x") + ".c")).read_bytes()) == method["decompiledSha256"]
    batches.append({"folder": folder, "receiptSha256": sha(receipt), "methods": methods})
print(json.dumps({"lane": "native-export-integrity", "nativeSha256": expected,
 "symbolsSha256": sha(symbols), "headerSha256": sha(header), "methodCount": sum(len(b["methods"]) for b in batches),
 "batches": batches, "semanticsVerified": False,
 "limitations": ["static ranges may include alignment bytes", "decompilation is not native dynamic parity"]}))
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
await writeFile(
  resolve(reportDir, "battle-received-ability-native-check.json"),
  JSON.stringify(nativeReport, null, 2) + "\n",
);
const report = {
  lane: "raw-source-received-ability-development",
  sourceSetHash: manifest.sourceSetHash,
  battleSourceSetHash: source.sourceSetHash,
  sourceContentHash: source.contentHash,
  catalogHash: catalog.contentHash,
  nativeReceiptHash: nativeReport.contentHash,
  sourceProgramCount,
  instructions,
  programBlockers,
  unchangedSourceProgram: {
    source: program.source,
    rawHash: hash(asset.data),
    compiledHash: hash(program),
    routeChecks,
    hostChecks,
  },
  remainingDependencies: {
    abilities: unsupported,
    originalMonster: {
      id: 3,
      source: exported.tableSources["monster.csv"],
      rowHash: hash(monster),
      initialCondition: Number(monster.initial_condition),
    },
  },
  limitations: [
    "26 decoded source branches are instruction coverage, not enemy or region playability",
    "Host uses unchanged Templar AI with explicit donor stats, HP, accuracy and zero wait",
    "Ability 3 branch is a controlled AI input; source ability 3 and 40 are not executable",
    "Source monster 3 initial condition 903 is not active-condition support",
    "Final attacks, separate recovery readiness, additional receiver predicates and native dynamic parity remain open",
  ],
};
report.contentHash = hash(report);
await writeFile(
  resolve(reportDir, "battle-received-ability-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      report: "build/reports/battle-received-ability-check.json",
      instructions: instructions.length,
      unchangedSourceHostChecks: hostChecks.length,
      routeChecks: routeChecks.length,
      nativeMethods: nativeReport.methodCount,
      catalogHash: catalog.contentHash,
      contentHash: report.contentHash,
    },
    null,
    2,
  ),
);
