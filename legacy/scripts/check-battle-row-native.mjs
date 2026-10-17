// Exact local static bindings; this does not execute the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/battle-row-native-check.json";
await rm(output, { force: true });
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
  "v25-row-providers": ["3d6830", "3db000", "4de0a0", "4de0e0", "4de110"],
  "physical-inputs": ["3d6990"], "physical-research": ["a97b20"],
  "magic-core": ["a91600"], "owned-state": ["7f8050"],
};
const methods = [], texts = {};
for (const [batch, rvas] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const address of rvas) {
    const rva = "0x" + address, matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1, rva);
    const method = matches[0];
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)), rva);
    const text = await readFile(root + `build/native/${batch}/${address}.c`, "utf8");
    assert.equal(digest(text), method.decompiledSha256, rva);
    assert.ok(text.startsWith(`/* RVA ${rva}; ${method.name};`));
    texts[address] = text; methods.push({ batch, ...method });
  }
}
const raw = [
  { rva: "0x4def50", size: 128, role: "hand-slot membership AND non-null OwnedItemData.Weapon at +0x50" },
  { rva: "0x4de070", size: 48, role: "jump predicate reads ConditionType and compares420" },
  { rva: "0x4a4a80", size: 64, role: "Weapon.TypeId shared getter reads integer row index2" },
  { rva: "0x4a5f70", size: 64, role: "Weapon.BackFlag shared getter reads integer row index16" },
  { rva: "0x350db0", size: 64, role: "GetCorpsId player match uses parameter instance equality" },
  { rva: "0x34c9f0", size: 6, hex: "b801000000c3", role: "FF6 enemy CorpsId provider returns Front1" },
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
assert bytes.fromhex('488b43084885c07415488b40504885c00f95c0') in p.read(0x4def50,128)[2]
assert bytes.fromhex('3da40100000f94c0') in p.read(0x4de070,48)[2]
assert bytes.fromhex('83781802760e8b4028') in p.read(0x4a4a80,64)[2]
assert bytes.fromhex('83781810760e8b4060') in p.read(0x4a5f70,64)[2]
assert bytes.fromhex('488b4810498b50104885c9') in p.read(0x350db0,64)[2]
print(json.dumps(out))`;
const verified = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(verified[i].sha256, m.nativeRangeSha256, m.rva));
const named = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) => m.Address === rva && m.Name === name).length, 1, name);
for (const [rva, name] of [
  [0x4def50, "Last.Systems.CalcControllerProvider.<>c__DisplayClass27_0$$<GetFightStatus>b__2"],
  [0x4de070, "Last.Systems.CalcControllerProvider.<>c$$<GetFightStatus>b__27_1"],
  [0x4a4a80, "Last.Data.Master.Weapon$$get_TypeId"],
  [0x4a5f70, "Last.Data.Master.Weapon$$get_BackFlag"],
  [0x350db0, "Last.Systems.CalcControllerProvider.<>c__DisplayClass24_0$$<GetCorpsId>b__0"],
  [0x34c9f0, "Serial.FF6.Management.SerialBattleUtility$$GetCorpsIdEnemy"],
]) named(rva, name);
assert.match(texts["3db000"], /GetCorpsId\(__this,attackParameter/);
assert.match(texts["3db000"], /GetCorpsId\(__this,targetParameter/);
assert.match(texts["3d6830"], /_PlayerCharacterParameter_TypeInfo/);
assert.match(texts["3d6830"], /GetPlayerUnits[\s\S]*?return 1;/);
assert.match(texts["3d6830"], /return \*\(int32_t \*\)\(pcVar3 \+ 0x10\)/);
assert.match(texts["4de0a0"], /_Weapon_k__BackingField/);
assert.match(texts["4de0e0"], /4a4a80\(w,0\);[\s\S]*?return iVar3 != 2/);
assert.match(texts["4de110"], /4a5f70\(w,0\);[\s\S]*?return iVar3 == 1/);
assert.match(texts["3d6990"], /Count_BattlePlayerData__[\s\S]*?0 < iVar21[\s\S]*?Enumerable__All/);
assert.match(texts["3d6990"], /get_IsMachine[\s\S]*?isIgnoreCorps = 1/);
assert.match(texts["3d6990"], /iVar19 == 0x25a[\s\S]*?isIgnoreCorps = true/);
assert.match(texts["7f8050"], /iVar3 == 2[\s\S]*?Last_Data_Master_Weapon_o/);
assert.match(texts["7f8050"], /iVar3 != 3[\s\S]*?Last_Data_Master_Armor_o/);
const physical = texts["a97b20"];
const actorAt = physical.indexOf("if (((!isIgnoreCorps) && (!isJumpAbility)) && (userCorpsId == 2))");
const actorHalfAt = physical.indexOf("m_stringLength = (int32_t)((double)SStack_518.fields.m_stringLength * 0.5)", actorAt);
const multiplyAt = physical.indexOf("(double)(iVar19 * SStack_518.fields.m_stringLength) * 0.01", actorAt);
const targetAt = physical.indexOf("if ((!isIgnoreCorps) && (targetCorpsId == 2))");
const targetHalfAt = physical.indexOf("m_stringLength = (int32_t)((double)SStack_518.fields.m_stringLength * 0.5)", targetAt);
const defendAt = physical.indexOf("CheckHaveCondition(pSStack_4d8,1", targetAt);
assert.ok(actorAt > 0 && actorHalfAt > actorAt && multiplyAt > actorHalfAt);
assert.ok(targetAt > multiplyAt && targetHalfAt > targetAt && defendAt > targetHalfAt);
assert.match(physical.slice(actorAt, actorHalfAt), /abilityTypeId != 0x261/);
assert.match(physical.slice(0, targetAt), /iVar19 = \(0xff - iVar19\) \* iVar16;[\s\S]*?m_stringLength = \(\(int\)\(iVar19 \+ \(iVar19 >> 0x1f & 0xffU\)\) >> 8\) \+ 1/);
assert.match(texts["a91600"], /43CF64762C827FC2F2D5B1C7D4894A97AC4DCA2A[\s\S]*?\+ 0x38/);
const metadata = await readFile(root + "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat");
const initializer = metadata.subarray(0x4dec52, 0x4dec52 + 12);
assert.equal(initializer.toString("hex"), "7c0000007f00000082000000");
assert.equal(createHash("sha1").update(initializer).digest("hex"), "43cf64762c827fc2f2d5b1c7d4894a97ac4dca2a");
const exceptions = [0, 4, 8].map((offset) => initializer.readInt32LE(offset));
assert.deepEqual(exceptions, [124, 127, 130]);
const report = {
  lane: "source-front-back-physical-row-providers", ...identity,
  metadataSha256: digest(metadata), semanticsVerified: false, originalGameExecuted: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: verified[i] })),
  rawRanges: raw.map((r, i) => ({ ...r, sourceRange: verified[methods.length + i] })),
  exceptionInitializer: { fileOffset: 0x4dec52, size: 12, sha1: "43cf64762c827fc2f2d5b1c7d4894a97ac4dca2a", values: exceptions },
  establishes: ["player row reads the current battle party cell; enemy/non-player is Front1",
    "two hand slots -> non-null Weapon -> TypeId !=2 -> nonempty All BackFlag==1",
    "actor rear correction before multiply and variance; target rear after defense plus-one",
    "jump420/type609/124,127,130 are actor-only exceptions; ability602 and equipment ignore both",
    "flag5 defense bypass skips target row but not actor row"],
  doesNotEstablish: ["original-game execution", "admission of ranged weapons or dual wield", "machine physical item providers",
    "Jump or special ability action execution", "change-row command", "back/pincer/side formations"],
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawRanges: raw.length, exceptions, reportSha256: digest(JSON.stringify(report)), originalGameExecuted: false }, null, 2));
