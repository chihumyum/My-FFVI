// Static native binding. This checker never runs the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const outputPath = root + "build/reports/protection-native-check.json";
await rm(outputPath, { force: true });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
const symbolsText = await readFile(root + "build/native/il2cpp/script.json", "utf8");
const headerText = await readFile(root + "build/native/il2cpp/il2cpp_ghidra.h", "utf8");
assert.equal(digest(await readFile(root + "build/runtime/game/GameAssembly.dll")), identity.nativeSha256);
assert.equal(digest(symbolsText), identity.symbolsSha256);
assert.equal(digest(headerText), identity.headerSha256);
const symbols = JSON.parse(symbolsText);
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const batches = {
  "v24-system-providers": ["92d930", "92d950", "928510"],
  "condition-lifecycle": ["33d8a0"],
  "physical-research": ["a97b20"],
  "magic-core": ["a94480"],
  "condition-silence": ["45b450", "45c5b0", "455de0"],
  "condition-cleanup": ["45ad60"],
  "v22-battle-appearance": ["45b3d0", "45bc70"],
  "condition-actions": ["4f1d70", "4f2630", "66eac0", "66f4d0"],
  "condition-eligibility": ["4ac5f0"],
  "condition-hit": ["a91a90"],
  "condition-utility": ["4d1000", "4d3d50", "4d17c0"],
};
const methods = [], contents = {};
for (const [batch, rvas] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const address of rvas) {
    const rva = "0x" + address;
    const matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1, `${batch}:${rva}`);
    const method = matches[0];
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)), rva);
    const text = await readFile(root + `build/native/${batch}/${address}.c`, "utf8");
    assert.equal(digest(text), method.decompiledSha256, rva);
    assert.ok(text.startsWith(`/* RVA ${rva}; ${method.name};`), rva);
    contents[address] = text; methods.push({ batch, ...method });
  }
}
const raw = [
  { rva: "0x5176b0", size: 20, hex: "488b018b51644c8b807801000048ffa070010000", role: "Non.Start reads this+0x64 condition type and calls InitConditionEffect" },
  { rva: "0x4b71a0", size: 7, hex: "33d2e9b93bfaff", role: "Proteus/Non.Remove delegates DestroyEffect" },
  { rva: "0x2c8ef0", size: 3, hex: "c20000", role: "Proteus/Non.Update no-op" },
  { rva: "0x4a4a40", size: 0x40, role: "Condition.ConditionType shared getter; row index1" },
  { rva: "0x4a5f30", size: 0x40, role: "Condition.UntilType shared getter; row index7" },
];
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 if 'hex' in r: assert data.hex()==r['hex'],r
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
assert bytes.fromhex('83781801760e8b4024') in p.read(0x4a4a40,0x40)[2]
assert bytes.fromhex('83781807760e8b403c') in p.read(0x4a5f30,0x40)[2]
print(json.dumps(out))`;
const verified = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(verified[i].sha256, m.nativeRangeSha256, m.rva));
const named = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) => m.Address === rva && m.Name === name).length, 1, name);
for (const [rva, name] of [[0x92d930, "Last.Battle.ProteusConditionFunction$$Start"],
  [0x5176b0, "Last.Battle.NonConditionFunction$$Start"], [0x4b71a0, "Last.Battle.ProteusConditionFunction$$Remove"],
  [0x4b71a0, "Last.Battle.NonConditionFunction$$Remove"], [0x2c8ef0, "Last.Battle.ProteusConditionFunction$$Update"],
  [0x2c8ef0, "Last.Battle.NonConditionFunction$$Update"], [0x4a4a40, "Last.Data.Master.Condition$$get_ConditionType"],
  [0x4a5f30, "Last.Data.Master.Condition$$get_UntilType"]]) named(rva, name);
assert.match(headerText, /VirtualInvokeData _4_InitConditionEffect/);
assert.match(contents["92d930"], /_ConditionType_k__BackingField = 0x13/);
assert.match(contents["45b450"], /_ConditionType_k__BackingField = iVar6/);
assert.match(contents["33d8a0"], /case 0x13:[\s\S]*?ProteusConditionFunction/);
assert.match(contents["33d8a0"], /case 0x19c:[\s\S]*?break;/);
assert.match(contents["33d8a0"], /NonConditionFunction___ctor/);
assert.match(contents["45b3d0"], /_BattlePlayerData_TypeInfo/);
assert.match(contents["45bc70"], /ConditionEffectAssetLoader__Load/);
assert.match(contents["455de0"], /iVar6 != 3[\s\S]*?iVar6 != 0x13[\s\S]*?Controller__Remove/);
assert.doesNotMatch(contents["45c5b0"], /case 2:/);
const physical = contents["a97b20"], magic = contents["a94480"];
assert.match(physical, /CheckHaveCondition\(pSVar28,0x13/);
assert.match(physical, /m_stringLength = \(\(int\)\(iVar14 \+ \(iVar14 >> 0x1f & 0xffU\)\) >> 8\) \+ iVar19/);
assert.ok(physical.indexOf("CheckHaveCondition(pSVar28,0x13") < physical.indexOf("IsNomarlAttackHealWeapon", physical.indexOf("CheckHaveCondition(pSVar28,0x13")));
assert.match(magic, /iStack_128 = iVar9 \+ 1;[\s\S]*?CheckHaveCondition\(pSStack_100,0x19c/);
assert.match(magic, /iStack_128 = \(int\)\(iStack_128 \* 0xaa[\s\S]*?iStack_128 = iStack_128 \+ 1/);
assert.match(contents["4f1d70"], /IsAddable/);
assert.match(contents["a91a90"], /Contains\(__this_00,1,[\s\S]*?hitRate = 0xff/);
const report = {
  lane: "source-protection-identity-lifecycle-and-numerical-order", ...identity, semanticsVerified: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: verified[i] })),
  rawRanges: raw.map((r, i) => ({ ...r, sourceRange: verified[methods.length + i] })),
  establishes: ["ordinary Proteus19 and Shell412 provider identities", "Start/Remove visual-only behavior with no custom Update",
    "until2 has no timer/turn expiry and is removed at battle end", "generic identity/hit/resistance/conflict/recovery paths",
    "Proteus precedes defense without +1; Shell follows magic defense with its own +1", "flag5 and ordinary healing bypass rules"],
  doesNotEstablish: ["original-game execution or Unity RNG parity", "particle effects327/328 rendering", "equipment/permanent/group-provider protection", "full-game parity"],
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawRanges: raw.length, reportSha256: digest(JSON.stringify(report)), semanticsVerified: false }, null, 2));
