// Static binding only. No original-game process or differential replay is run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const symbolsText = await readFile(root + "build/native/il2cpp/script.json", "utf8");
const headerText = await readFile(root + "build/native/il2cpp/il2cpp_ghidra.h", "utf8");
assert.equal(digest(await readFile(root + "build/runtime/game/GameAssembly.dll")), nativeSha256);
assert.equal(digest(symbolsText), symbolsSha256);
assert.equal(digest(headerText), headerSha256);
const batches = {
  "v23-defend-lifecycle": ["15956c0", "979aa0", "979d50", "985810", "455560", "1587aa0", "683d60", "45c040"],
  "v23-defend-presentation": ["761790", "15a2ea0", "15a2b30", "156cf10", "1575b50", "156df50", "3d8c60"],
  "v23-defend-ready": ["15740f0", "1574b40", "67ecf0"],
  "ability-providers": ["342080"], "ability-functions": ["66c760"],
  "condition-lifecycle": ["33d8a0", "458be0"], "condition-silence": ["45c5b0"],
  "ai-dispatch": ["679920"], "physical-research": ["a97b20"], "magic-core": ["a94480"],
};
const methods = [], contents = {};
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const address of addresses) {
    const method = receipt.methods.find((m) => m.rva === "0x" + address);
    assert.ok(method, `${batch}:${address}`);
    const text = await readFile(root + `build/native/${batch}/${address}.c`, "utf8");
    assert.equal(digest(text), method.decompiledSha256);
    contents[address] = text;
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  { rva: "0x920110", size: 0x30, role: "Defend Remove invokes SetIdleAnimState(0)" },
  { rva: "0x920140", size: 0x30, role: "Defend Start invokes SetIdleAnimState(1)" },
  { rva: "0x2c8ef0", size: 3, hex: "c20000", role: "Defend Update inherited no-op" },
  { rva: "0x389c70", size: 3, hex: "32c0c3", role: "inherited IsReadyAnimAbility false" },
  { rva: "0x4f6bd0", size: 0x20, role: "FixedTarget delegates CommonExtractTarget" },
  { rva: "0x687440", size: 0x50, role: "SetActData ability type 8/40/41 predicate" },
  { rva: "0x687490", size: 0x30, role: "SetActData current ability id83 predicate" },
  { rva: "0x6874c0", size: 0x60, role: "SetActData chained first ability id83 predicate" },
  { rva: "0x687520", size: 0x30, role: "SetActData current ability id17 predicate" },
  { rva: "0x7615f0", size: 0x150, role: "SetAttackAnimByType reads first ability type" },
  { rva: "0x15a2b60", size: 0x330, role: "ability type5 maps to attack state Normal0" },
  { rva: "0xaa3a99", size: 0x17, role: "TranceConditions stores621/684, not Defend1" },
];
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const python = `import sys,json,hashlib,struct
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 if 'hex' in r: assert data.hex()==r['hex'],r
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
read=lambda r,n:p.read(r,n)[2]
assert read(0x920140,0x30).find(bytes.fromhex('ba01000000'))>=0
assert read(0x920110,0x30).find(bytes.fromhex('33d2'))>=0
selector=read(0x15a2e5c+5-1,1)[0]
assert selector==2
target=struct.unpack('<I',read(0x15a2e48+selector*4,4))[0]
assert target==0x15a2d4f
assert read(target+10,7)==bytes.fromhex('c7432400000000')
trance=read(0xaa3a99,0x17)
assert bytes.fromhex('6d020000') in trance and bytes.fromhex('ac020000') in trance
print(json.dumps(dict(ranges=out,readyBranch=dict(abilityType=5,selector=selector,targetRva=hex(target),attackState=0))))`;
const verified = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((method, index) => assert.equal(verified.ranges[index].sha256, method.nativeRangeSha256));
const symbols = JSON.parse(symbolsText);
const named = (rva, name) => assert.ok(symbols.ScriptMethod.some((m) => m.Address === rva && m.Name === name), name);
named(0x920140, "Last.Battle.DefendConditionFunction$$Start");
named(0x920110, "Last.Battle.DefendConditionFunction$$Remove");
named(0x2c8ef0, "Last.Battle.DefendConditionFunction$$Update");
named(0x389c70, "Last.Battle.SerialBattleUtilityBase$$IsReadyAnimAbility");
assert.equal(symbols.ScriptMethod.some((m) => m.Name.endsWith("$$IsReadyAnimAbility") && m.Address !== 0x389c70), false);
named(0x4a4a40, "Last.Data.Master.Condition$$get_ConditionType");
named(0x7615f0, "Last.Battle.BattleUnitData$$SetAttackAnimByType");
named(0x15a2b60, "Last.Battle.AnimStateController$$SetAttackAnimByType");
for (const [address, value] of [[0x1ff0120, "ready"], [0x1feff78, "skillReady"], [0x1feff00, "defend"]])
  assert.ok(symbols.ScriptString.some((s) => s.Address === address && s.Value === value));
for (const [address, suffix] of [[0x200afe8, "<SetActData>b__35_0()"], [0x200afe0, "<SetActData>b__35_1()"],
  [0x200afb0, "<SetActData>b__35_2()"], [0x200af80, "<SetActData>b__35_3()"], [0x200af40, "<SetActData>b__35_4()"]])
  assert.ok(symbols.ScriptMetadataMethod.some((m) => m.Address === address && m.Name.endsWith(suffix)), suffix);
assert.match(contents["979d50"], /CurrentConditionList/);
assert.match(contents["985810"], /== 1/);
assert.match(contents["679920"], /BattleConditionController__Recovery[\s\S]*?,1,/);
assert.match(contents["a97b20"], /CheckHaveCondition\(pSStack_4d8,1,/);
assert.match(contents["15740f0"], /_DAT_181ff0120/);
assert.match(contents["15740f0"], /spriteAnimMagicArmor/);
assert.match(headerText, /VirtualInvokeData _7_SetIdleAnimState/);
const report = {
  lane: "source-defend-action-lifecycle-physical-and-ready-pose", nativeSha256, symbolsSha256, headerSha256,
  semanticsVerified: false,
  methods: methods.map((m, index) => ({ ...m, sourceRange: verified.ranges[index] })),
  rawRanges: rawRanges.map((r, index) => ({ ...r, sourceRange: verified.ranges[methods.length + index] })),
  readyBranch: verified.readyBranch,
  establishes: ["Function15 direct condition-type1 append", "fixed status result without hit/resistance RNG",
    "ATB admission removes until1; direct counters bypass that owner", "special chain/selection branches require explicit guards",
    "physical defense branch halves before critical and elements; flag5 bypasses it",
    "Defend Start Ready/Remove Idle; abilitytype5 selects source ready for body and Magitek"],
  doesNotEstablish: ["original-game execution", "full native chained-action semantics", "full shield staging/animation scheduler", "full-game parity"],
};
await mkdir(root + "build/reports", { recursive: true });
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/defend-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, reportSha256: digest(output), semanticsVerified: false }, null, 2));
