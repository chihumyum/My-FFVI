// Raw-table and PE-bound timing probes. This is static source recovery and
// deterministic mechanism regression, not original-game dynamic parity.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { hash } from "../dist/src/compiler/content.js";
import {
  advanceChanting,
  addAtbGauge,
  atbGaugeCanAdvance,
  battleClockGate,
  battleTimeScale,
  chantingSeconds,
  chantingTimeComplete,
  keyInputMenuWaiting,
} from "../dist/src/core/battle-timing.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--native"),
  "Usage: node scripts/check-battle-timing.mjs --native /path/to/GameAssembly.dll",
);
const nativePath = args[1] ?? process.env.FFVI_GAME_ASSEMBLY;
assert.ok(nativePath, "Provide the original DLL for byte verification");
const reportDir = resolve(root, "build/reports");
await mkdir(reportDir, { recursive: true });
for (const name of [
  "battle-timing-check.json",
  "battle-timing-native-check.json",
])
  await rm(resolve(reportDir, name), { force: true });
const files = await readSnapshot(resolve(root, "build/import"));
const rawTables = snapshotFile(files, "tables.json");
const tables = JSON.parse(rawTables);
const manifest = JSON.parse(snapshotFile(files, "project.json"));
const catalog = await verifyContent(
  JSON.parse(
    await readFile(resolve(root, "build/game/opening-playable.json"), "utf8"),
  ),
);
const nativeSource = manifest.sources.find(
  (s) => s.file === "GameAssembly.dll",
);
assert.ok(nativeSource);
const rows = (name) => new Map(tables[name].map((r) => [Number(r.id), r]));
const abilities = rows("ability.csv"),
  commands = rows("command.csv");
const ability = (row) => ({
  id: Number(row.id),
  typeId: Number(row.type_id),
  wait: Number(row.ability_wait),
});

// Expected floats are calculated in Python from independently loaded raw rows,
// with explicit IEEE float32 stores matching the native SSE stages. No compiler
// output or core function participates in the expectation calculation.
const evidence = JSON.parse(
  (
    await promisify(execFile)(
      process.env.PYTHON ?? "python3",
      [
        "-c",
        String.raw`
import bisect, hashlib, json, re, struct, sys
from pathlib import Path
root, dll, expected, tables_hash = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4]
sys.path.insert(0, str(root / "tools/native"))
from inspect_pe import PEImage
sha = lambda data: hashlib.sha256(data).hexdigest()
data = dll.read_bytes()
assert sha(data) == expected, "DLL differs from source manifest"
pe = PEImage(data)
symbols = (root / "build/native/il2cpp/script.json").read_bytes()
header = (root / "build/native/il2cpp/il2cpp_ghidra.h").read_bytes()
by_rva = {}
for method in json.loads(symbols)["ScriptMethod"]:
    by_rva.setdefault(method["Address"], []).append(method)
addresses = sorted(by_rva)
selected = {
 "v17-battle-timing": [0x455780,0x45a4d0,0x465560,0x676ee0,0x67b590,0x67b920,0x67bf00,0x72e030,0x856010,0x1588930,0x1588f40],
 "v17-battle-clock-selectors": [0x465f10,0x46d0e0,0x46d1d0,0x4dec10,0x678330,0x67a8e0,0x8e40d0,0x8e40f0],
 "v17-poison-cycle": [0x4d3490,0x4d3520],
 "ai-queue": [0x6765d0],
 "ai-loop-scheduling": [0x67ac60],
 "ai-dispatch": [0x679920],
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
    if folder in ["v17-battle-timing", "v17-battle-clock-selectors"]:
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
# Shared IL2CPP getter names are not authoritative. Bind the command receiver
# to int-array index 8, and the provider to serialData virtual slot 7.
shared = []
for address, size, digest in [
 (0x4a5fb0,64,"44e7f5b36c8548a57970d11c02e3dca094cb7f553f12b58f17abb5bb82a83d25"),
 (0x5c9960,64,"cccb7b5fb9dca4563e9210d9de1affd412323b6538e8e50d4104111297e1c9b4"),
 (0x687260,32,"2fd497e7c635df214d22f6d811d602fe3991c5efb8b783f2464c7106070eea40"),
 (0x7086c0,16,"172745c21594fd519717f9df3de34af58abc8cf3582f0f3d201e49d04e4fa554"),
]:
    section, offset, raw = pe.read(address, size)
    assert sha(raw) == digest
    shared.append({"rva": hex(address), "bytes": size, "sha256": digest})
raw_tables = (root / "build/import/tables.json").read_bytes()
assert sha(raw_tables) == tables_hash, "Tables changed during check"
tables = json.loads(raw_tables)
f = lambda x: struct.unpack("<f", struct.pack("<f", x))[0]
probes = []
for row in tables["ability.csv"]:
    ability_id, type_id, wait = int(row["id"]), int(row["type_id"]), int(row["ability_wait"])
    for variant in ["ordinary", "haste", "slow", "killing-sword", "enemy", "noninteger-speed"]:
        if variant == "enemy" and type_id not in [15,16]: value = 0
        else:
            agility = 0 if variant == "killing-sword" else (31 if variant == "noninteger-speed" else 40)
            modifier = {"haste": 2, "slow": 0.5}.get(variant, 1)
            speed = f(1.3 if variant == "noninteger-speed" else 1)
            numerator = f(f(wait) * 20)
            denominator = f(f(f(f(f(agility) * 0.5) + 20) * modifier) * speed)
            value = f(numerator / denominator)
        probes.append({"abilityId": ability_id, "variant": variant, "expected": value})
print(json.dumps({"native": {"lane": "native-export-integrity", "nativeSha256": expected,
 "symbolsSha256": sha(symbols), "headerSha256": sha(header), "methodCount": sum(len(b["methods"]) for b in batches),
 "batches": batches, "sharedCallRanges": shared, "semanticsVerified": False,
 "limitations": ["static ranges may include alignment bytes", "decompilation is not native dynamic parity"]},
 "probes": probes}))
`,
        root,
        resolve(nativePath),
        nativeSource.sha256,
        createHash("sha256").update(rawTables).digest("hex"),
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    )
  ).stdout,
);

for (const probe of evidence.probes) {
  const v = probe.variant;
  const actual = chantingSeconds({
    actor: v === "enemy" ? "enemy" : "player",
    firstAbility: ability(abilities.get(probe.abilityId)),
    command: { id: v === "killing-sword" ? 12 : 1, referencedAbility: null },
    agility: v === "noninteger-speed" ? 31 : 40,
    conditionTypes:
      v === "haste"
        ? [15]
        : v === "slow"
          ? [16]
          : v === "killing-sword"
            ? [15, 16]
            : [],
    atbSpeed: v === "noninteger-speed" ? 1.3 : 1,
  });
  assert.equal(actual, probe.expected, `${probe.abilityId}/${v}`);
}

const commandChecks = [];
for (const command of Object.values(catalog.common.commands)) {
  const row = commands.get(command.id);
  assert.ok(row);
  const id = Number(row.ability_id);
  const expected = id === 0 ? null : ability(abilities.get(id));
  assert.deepEqual(
    command.referencedAbility,
    expected,
    `command ${command.id} ability_id projection`,
  );
  commandChecks.push({
    id: command.id,
    sourceRowHash: hash(row),
    referencedAbility: expected,
  });
}
const mimic = commands.get(14),
  item = commands.get(3);
assert.equal(Number(mimic.ability_id), 24);
assert.equal(Number(item.ability_id), 0);
const first = ability(abilities.get(21));
const specialCommand = {
  id: 14,
  referencedAbility: ability(abilities.get(Number(mimic.ability_id))),
};
assert.equal(
  chantingSeconds({
    actor: "player",
    firstAbility: first,
    command: specialCommand,
    agility: 40,
    conditionTypes: [],
    atbSpeed: 1,
  }),
  1.5,
);
assert.equal(
  chantingSeconds({
    actor: "player",
    firstAbility: null,
    command: { id: 3, referencedAbility: null },
    agility: 40,
    conditionTypes: [],
    atbSpeed: 1,
  }),
  0,
);
let remaining = 1.5;
for (let n = 0; n < 150; n++) remaining = advanceChanting(remaining, 0.01, 1);
assert.equal(remaining, 1.1473894119262695e-6);
assert.equal(chantingTimeComplete(remaining), false);
assert.equal(advanceChanting(remaining, 0.01, 1), -0.009998852387070656);
assert.equal(chantingTimeComplete(advanceChanting(remaining, 0.01, 1)), true);
assert.equal(chantingTimeComplete(0), true);
assert.equal(addAtbGauge(99.5, 0.75), 100.25);
assert.equal(
  atbGaugeCanAdvance({
    gauge: 100.25,
    actNotPossibleCounter: 0,
    notUpdateGauge: false,
  }),
  false,
);
assert.equal(
  atbGaugeCanAdvance({
    gauge: 99.5,
    actNotPossibleCounter: 1,
    notUpdateGauge: false,
  }),
  false,
);
const menuStates = [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((state) => {
  const expected = {
    uiWaiting: [2, 3, 4, 5, 6, 7, 8].includes(state),
    forceWaiting: [9, 10].includes(state),
  };
  assert.deepEqual(keyInputMenuWaiting(state), expected);
  return { state, ...expected };
});
const base = {
  paused: false,
  helpPaused: false,
  progressEnabled: true,
  mode: "wait",
  uiWaiting: true,
  forceWaiting: false,
  battleResult: 0,
};
assert.deepEqual(battleClockGate(base), {
  simulation: true,
  progress: false,
  conditions: false,
});
assert.deepEqual(battleClockGate({ ...base, mode: "active" }), {
  simulation: true,
  progress: true,
  conditions: true,
});
assert.deepEqual(
  battleClockGate({ ...base, mode: "active", battleResult: 3 }),
  { simulation: true, progress: true, conditions: false },
);
assert.equal(
  battleTimeScale({
    paused: false,
    helpPaused: false,
    auto: true,
    optionTimeScale: 2,
  }),
  3,
);

const native = {
  ...evidence.native,
  sourceSetHash: manifest.sourceSetHash,
  catalogHash: catalog.contentHash,
};
native.contentHash = hash(native);
await writeFile(
  resolve(reportDir, "battle-timing-native-check.json"),
  JSON.stringify(native, null, 2) + "\n",
);
const report = {
  lane: "source-table-timing-regression",
  sourceSetHash: manifest.sourceSetHash,
  catalogHash: catalog.contentHash,
  nativeReceiptHash: native.contentHash,
  abilityRows: abilities.size,
  chantingProbes: evidence.probes.length,
  commandChecks,
  menuStates,
  firstAbilityTypes: Object.fromEntries(
    [15, 16, 623].map((t) => [
      t,
      [...abilities.values()]
        .filter((a) => Number(a.type_id) === t)
        .map((a) => Number(a.id)),
    ]),
  ),
  floatBoundary: {
    after150: remaining,
    after151: advanceChanting(remaining, 0.01, 1),
  },
  limitations: [
    "Pure calculation of a referenced ability or condition does not admit its effects, active lifecycle or command",
    "Development fixed-step replay, initial RNG, settings defaults and 400/900ms action presentation are not original-game timing parity",
    "Special queue eligibility, field conditions, action-end consumers and full runtime UI state still require their own admission",
  ],
};
report.contentHash = hash(report);
await writeFile(
  resolve(reportDir, "battle-timing-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      abilityRows: report.abilityRows,
      chantingProbes: report.chantingProbes,
      commandChecks: commandChecks.length,
      nativeMethods: native.methodCount,
      catalogHash: catalog.contentHash,
    },
    null,
    2,
  ),
);
