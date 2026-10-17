// Static source binding, not original-game execution or decompiler certification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/ordinary-weapon-native-check.json";
await rm(output, { force: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, expected] of [["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(root + path)), expected);
const scripts = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const methods = [];
const batches = {
  "v26-weapon-speed-entry": ["685510", "4ff360", "4ff070"],
  "v26-weapon-additional": ["500200"],
  "physical-inputs": ["3d6990", "534d90", "534f30"],
  "equipment-arm": ["15a6b50"],
  "v25-row-providers": ["4de0a0", "4de0e0", "4de110"],
  "equipment-transaction": ["333110"],
  "initial-equipment": ["52d220"],
  "physical-research": ["a97b20"],
};
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256); assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  for (const address of addresses) {
    const matched = receipt.methods.filter((m) => m.rva === "0x" + address);
    assert.equal(matched.length, 1);
    const method = matched[0], bytes = await readFile(root + `build/native/${batch}/${address}.c`);
    assert.equal(sha(bytes), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  { rva: "0x350ba0", size: 19, expectedHex: "4885d2740b817a64680200000f94c0c332c0c3",
    role: "shared predicate: BattleConditionFunction.ConditionType +0x64 equals Rampage 616, not weapon kind" },
  { rva: "0x350f70", size: 23, expectedHex: "4883ec284885d2740e8b41103942100f94c04883c428c3",
    role: "shared predicate: capture monsterId +0x10 equals LikeMonsterFightAttackParam.monster_id +0x10" },
  { rva: "0x4def50", size: 128,
    expectedFragment: "488b43084885c07415488b40504885c00f95c0",
    role: "GetFightStatus hand-slot membership and OwnedItemData.Weapon +0x50" },
  { rva: "0x4a4810", size: 48, role: "shared master getter: Weapon.Id at reviewed OwnedItemData.Weapon callsites" },
  { rva: "0x4a4a80", size: 48, expectedFragment: "83781802760e8b4028", role: "shared master array getter index2: Weapon.TypeId" },
  { rva: "0x4a5f70", size: 48, expectedFragment: "83781810760e8b4060", role: "shared master array getter index16: Weapon.BackFlag" },
];
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva), hex: false })),
  ...rawRanges.map((r) => ({ rva: r.rva, size: r.size, hex: true }))];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'tools/native'))
from inspect_pe import PEImage
image=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
result=[]
for request in json.load(sys.stdin):
 section,offset,data=image.read(int(request['rva'],0),request['size'])
 result.append(dict(rva=request['rva'],size=request['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),**({'hex':data.hex()} if request['hex'] else {})))
print(json.dumps(result))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((method, i) => assert.equal(method.nativeRangeSha256, checked[i].sha256, method.rva));
rawRanges.forEach((range, i) => {
  const result = checked[methods.length + i];
  if (range.expectedHex) assert.equal(result.hex, range.expectedHex);
  if (range.expectedFragment) assert.ok(result.hex.includes(range.expectedFragment));
});
const report = {
  lane: "ordinary-weapon-source-closure", nativeSha256, symbolsSha256, headerSha256,
  methods: methods.map((method, i) => ({ ...method, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((range, i) => ({ ...range, ...checked[methods.length + i],
    aliases: scripts.ScriptMethod.filter((method) => method.Address === Number(range.rva)).map((method) => method.Name) })),
  bindings: [
    "GetUniqueFightAttackWeaponId: Rampage override, SketchFightWeaponId, ThrowWeaponId; ordinary path returns 0.",
    "InitPrepareState calls AddtionAbilty for ordinary actions; its selected-arm Weapon.Id is matched against BattleExtraDesc.add_ability_weapon, including RNG at chance=0.",
    "GetFightStatus: selected Weapon.Id 30/11 have Ultima/Valiant numerical branches despite ProcessProg=None. They remain blocked.",
    "GetFightStatus: hand Weapon records, nonempty type, Count>0 && All(BackFlag==1) ignores actor and target rows in PhysicalExecution.",
  ],
  originalGameExecuted: false, semanticsVerified: false,
  doesNotEstablish: ["native-dynamic-parity", "weapon-procs", "Rampage-Sketch-Throw", "dual-wield", "two-hand", "full-weapon-animation"],
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, reportSha256: sha(JSON.stringify(report)),
  originalGameExecuted: false, semanticsVerified: false }));
