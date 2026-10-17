// Static source binding only. Re-read DLL ranges and local exports on each run;
// an existing build/reports receipt is never accepted as validation input.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputPath = root + "build/reports/poison-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(outputPath, { force: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const identity = {
  nativeSha256:
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256:
    "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256:
    "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
for (const [key, file] of Object.entries({
  nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json",
  headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
}))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const { ScriptMethod } = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
const addresses = [...new Set(ScriptMethod.map((m) => m.Address))].sort(
  (a, b) => a - b,
);
function symbol(rva, name) {
  assert.equal(
    ScriptMethod.filter((m) => m.Address === Number(rva) && m.Name === name)
      .length,
    1,
    name,
  );
}
const exports = [
  [
    "v17-poison-behavior",
    [
      ["0x92d270", "Last.Battle.PoisonConditionFunction$$.ctor"],
      ["0x92cee0", "Last.Battle.PoisonConditionFunction$$StartSub"],
      ["0x92d200", "Last.Battle.PoisonConditionFunction$$UpdateSub"],
      ["0x92c7b0", "Last.Battle.PoisonConditionFunction$$ActEndUpdateSub"],
      [
        "0x92c840",
        "Last.Battle.PoisonConditionFunction$$CalcProgressGenerateValue",
      ],
      ["0x92c8d0", "Last.Battle.PoisonConditionFunction$$GeneratePoisonDamage"],
      ["0x92ccb0", "Last.Battle.PoisonConditionFunction$$IsEnd"],
      ["0x92cd10", "Last.Battle.PoisonConditionFunction$$RemoveSub"],
      ["0x45b140", "Last.Battle.BattleConditionFunction$$GetRateValue"],
      ["0x7620e0", "Last.Battle.BattleUtility$$CalcATBProgressCycleForVital"],
      ["0x45c430", "Last.Battle.BattleConditionFunction$$UpdateCondition"],
    ],
  ],
  [
    "v17-poison-cycle",
    [
      ["0x766a00", "Last.Battle.BattleUtility$$GetProgressCycleCoefficient"],
      ["0x76de60", "Last.Battle.BattleUtility$$.cctor"],
      [
        "0x771b60",
        "Last.Battle.BattleUtility.<>c$$<GetProgressCycleCoefficient>b__65_0",
      ],
      [
        "0x771b90",
        "Last.Battle.BattleUtility.<>c$$<GetProgressCycleCoefficient>b__65_1",
      ],
      ["0xaa4be0", "Last.Battle.ChangeSkinColorConditionFunctionBase$$Update"],
      ["0x4d3520", "Last.Systems.ConditionUtility$$IsOutBattle"],
      ["0x4d3490", "Last.Systems.ConditionUtility$$IsOutBattle"],
    ],
  ],
  [
    "v17-battle-timing",
    [
      ["0x45a4d0", "Last.Battle.BattleConditionController$$Update"],
      ["0x455780", "Last.Battle.BattleConditionController$$ActEndUpdate"],
    ],
  ],
  [
    "v17-battle-clock-selectors",
    [["0x4dec10", "Last.Systems.ConditionUtility.<>c$$<IsOutBattle>b__15_0"]],
  ],
  [
    "condition-silence",
    [
      [
        "0x45c5b0",
        "Last.Battle.BattleConditionFunction$$UpdateCondtitonRecovery",
      ],
      [
        "0x455de0",
        "Last.Battle.BattleConditionController$$BattleEndRecoveryCondition",
      ],
    ],
  ],
];
const methods = [],
  decompiled = new Map();
for (const [batch, specifications] of exports) {
  const receipt = JSON.parse(
    await readFile(root + `build/native/${batch}/complete.json`, "utf8"),
  );
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  for (const [key, value] of Object.entries(identity))
    assert.equal(receipt[key], value, batch);
  for (const [rva, name] of specifications) {
    symbol(rva, name);
    const matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1, `${batch}:${rva}`);
    const method = matches[0];
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((a) => a > Number(rva)),
      rva,
    );
    const bytes = await readFile(
      root + `build/native/${batch}/${rva.slice(2)}.c`,
    );
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.ok(
      bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`),
      rva,
    );
    decompiled.set(rva, bytes.toString());
    methods.push({ batch, ...method });
  }
}
const shared = [
  {
    rva: "0x4a4a40",
    symbol: "Last.Data.Master.Condition$$get_ConditionType",
    bytes:
      "4883ec28488b41184885c0740e83781801760e8b40244883c428c3e8108ccfffcce81a8acfff488bc833d2e8d08bcfffcccccccccccccccccccccccccccccccc",
  },
  {
    rva: "0x4a5ef0",
    symbol: "Last.Data.Master.Condition$$get_RateType1",
    bytes:
      "4883ec28488b41184885c0740e83781809760e8b40444883c428c3e86077cfffcce86a75cfff488bc833d2e82077cfffcccccccccccccccccccccccccccccccc",
  },
  {
    rva: "0x4a58b0",
    symbol: "Last.Data.Master.Condition$$get_RateValue1",
    bytes:
      "4883ec28488b41184885c0740e8378180a760e8b40484883c428c3e8a07dcfffcce8aa7bcfff488bc833d2e8607dcfffcccccccccccccccccccccccccccccccc",
  },
  {
    rva: "0xffb230",
    symbol: "UnityEngine.Mathf$$FloorToInt",
    bytes:
      "4883ec38803ddd17fb00000f297424200f28f075128b0dbd379800e8b0221affc605c117fb0001488b0d6258fd00f6812f01000002740e83b9e0000000007505e8eb1613ff0f57c0f30f5ac6e8070024ff0f28742420f20f2cc04883c438c3cc",
  },
  {
    rva: "0xcc61b0",
    symbol: "System.Math$$Floor",
    bytes: "e9d35057ffcccccccccccccccccccccc",
  },
  { rva: "0x162f614", bytes: "0000003f" },
];
for (const range of shared) if (range.symbol) symbol(range.rva, range.symbol);
const requests = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
    hex: false,
  })),
  ...shared.map((m) => ({ rva: m.rva, size: m.bytes.length / 2, hex: true })),
];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
data=(Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes()
image=PEImage(data)
result=[]
for request in json.load(sys.stdin):
 section,offset,block=image.read(int(request['rva'],0),request['size'])
 result.append(dict(rva=request['rva'],size=request['size'],sha256=hashlib.sha256(block).hexdigest(),**({'bytes':block.hex()} if request['hex'] else {})))
print(json.dumps(dict(nativeSha256=hashlib.sha256(data).hexdigest(),ranges=result)))
`;
const observed = JSON.parse(
  execFileSync("python3", ["-c", python, root], {
    input: JSON.stringify(requests),
    encoding: "utf8",
  }),
);
assert.equal(observed.nativeSha256, identity.nativeSha256);
methods.forEach((m, i) =>
  assert.equal(observed.ranges[i].sha256, m.nativeRangeSha256, m.rva),
);
shared.forEach((m, i) =>
  assert.equal(observed.ranges[methods.length + i].bytes, m.bytes, m.rva),
);

// Pin interpreted branches to the inspected exports, alongside original-byte
// provenance. Generic IL2CPP getter names alone are not source field bindings.
assert.match(
  decompiled.get("0x92cee0"),
  /progressGenerateValue = .*progressGenerateValue \* 0\.5/,
);
assert.match(decompiled.get("0x92d200"), /isTimeStop == false/);
assert.match(decompiled.get("0x92d200"), /progressGenerateValue <= fVar2/);
assert.match(decompiled.get("0x92d200"), /progressCount = 0\.0/);
assert.match(decompiled.get("0x92c840"), /\(battleUnitData,1,/);
assert.match(
  decompiled.get("0x7620e0"),
  /type == 1[\s\S]*return fVar7 \/ fVar1/,
);
assert.match(decompiled.get("0x76de60"), /0x41800000/);
assert.match(decompiled.get("0x76de60"), /0x41000000/);
assert.match(decompiled.get("0x76de60"), /0x42000000/);
assert.match(decompiled.get("0x771b60"), /iVar3 == 0xf/);
assert.match(decompiled.get("0x771b90"), /iVar3 == 0x10/);
assert.match(
  decompiled.get("0x45b140"),
  /iVar4 == 3[\s\S]*fVar7 = \(float\)maxValue \/ fVar7/,
);
assert.match(decompiled.get("0x45b140"), /18023b288/);
assert.match(decompiled.get("0x92c8d0"), /TryGetValue[^\n]*\n\s*\(lVar8,6,/);
assert.match(decompiled.get("0x92c8d0"), /Max\(iVar6 \/ 2,1,/);
assert.match(decompiled.get("0x4dec10"), /iVar3 == 3/);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const poisonFields = dump.slice(
  dump.indexOf("public class PoisonConditionFunction"),
  dump.indexOf("public class PoisonConditionFunction") + 750,
);
assert.match(poisonFields, /private float progressCount; \/\/ 0xEC/);
assert.match(poisonFields, /private float progressGenerateValue; \/\/ 0xF0/);
assert.match(poisonFields, /private bool isTimeStop; \/\/ 0x118/);

const report = {
  kind: "static-poison-provenance",
  ...identity,
  methods,
  sharedRanges: observed.ranges.slice(methods.length),
  binding: {
    conditionType: 10,
    rateType: 3,
    rateIndex: 1,
    poisonElement: 6,
    cycle: {
      normal: 16,
      haste: 8,
      slow: 32,
      firstMultiplier: 0.5,
      readsVitality: false,
    },
    activeCycleProviders: ["neutral"],
    updateTicks: "at-most-one-and-reset-elapsed-to-zero",
    damageRounding: "floor-float32-maxHp-divided-by-float32-rateValue1",
    lifecycle:
      "until-type-3-persists-battle-end; death-conflicts-and-explicit-cure-remove",
    hostUnitGate: "confirmed-condition-type-3-is-out-of-battle; not-hp-zero",
  },
  limitations: [
    "native execution parity unknown",
    "field poison steps unimplemented",
    "haste/slow/stop active providers blocked",
    "generic condition recovery PRNG draws are not reproduced",
    "native visual lifecycle unverified",
  ],
  semanticsVerified: false,
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(outputPath, output);
console.log(
  JSON.stringify({
    methods: methods.length,
    sharedRanges: shared.length,
    sha256: sha(output),
    semanticsVerified: false,
  }),
);
