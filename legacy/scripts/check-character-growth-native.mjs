// Static native evidence, never an original-game execution oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv.includes("--dist") ? process.argv[process.argv.indexOf("--dist") + 1] : "dist";
const { firstJoinLevelAdjustments } = await import(new URL(`${outDir}/src/core/character-growth.js`, "file://" + root));
const digest = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const metadataSha256 = "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45";
const symbolsFile = "build/native/il2cpp/script.json";
const metadataFile = "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat";
for (const [file, expected] of [["build/runtime/game/GameAssembly.dll", nativeSha256], [symbolsFile, symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256], [metadataFile, metadataSha256]])
  assert.equal(digest(await readFile(root + file)), expected, file);
const batches = {
  "v17-roster-lifecycle": "270520",
  "v17-roster-initialization-small": "4d8480,52fbe0,2788c0",
  "v18-owned-character-entry-confirmed": "3d4270",
  "v19-character-growth-entry-confirmed": "4ea5d0,4ecf00,4efdc0,4efe30,4efd10,4e0930,4e0990,4e0aa0,4e09f0,4e5d10,530180,52b4b0",
  "v19-character-growth-learning": "4e9e30,4ec8f0,8569b0,856a30,3d51a0,539d60,539df0,539e10,4efed0,334390",
  "v19-character-recovery": "b45e60,b46020,b46410,b55180",
  "v19-character-recovery-storage": "329a00,32aec0,330ef0,b45400",
  "v19-character-growth-review": "b45540,769570",
};
const methods = [];
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const address of addresses.split(",")) {
    const method = receipt.methods.find((m) => m.rva === "0x" + address);
    assert.ok(method, `${batch}:${address}`);
    assert.equal(digest(await readFile(root + `build/native/${batch}/${address}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  { rva: "0x2a228a", size: 0x46, role: "Current.cctor binds int[32] correction field to static offset 0x98",
    hex: "488b0d27fbd201ba20000000e845b0efff488b1516a8d2014533c0488bc8488bd8e820cfbb00488b0d991bd601488bd3488b89b80000004881c198000000488919e890afefff" },
  { rva: "0x857066", size: 0x857312 - 0x857066, role: "MagicStoneData parameter type dictionary contains keys 62 through 88, excludes zero" },
  { rva: "0x856910", size: 6, hex: "b864000000c3", role: "Learned skill threshold 100" },
  { rva: "0x4a4f20", size: 64, role: "Shared GrowthCurve.HpValue1 / Learning.JobId / ExpTable.TotalExp getter" },
  { rva: "0x4a5930", size: 64, role: "Shared GrowthCurve.MpValue1 getter" },
  { rva: "0x4efcc0", size: 80, role: "Natural learning current-job predicate" },
  { rva: "0x4efa20", size: 64, role: "Natural learning reached-level predicate" },
  { rva: "0x4ef030", size: 64, role: "Learning.TypeId=1 predicate" },
  { rva: "0x4ef000", size: 48, role: "Learning.TypeId=2 predicate" },
  { rva: "0x4de940", size: 48, role: "Learning.TypeId=3 predicate" },
  { rva: "0x479020", size: 48, role: "Learning.TypeId=4 predicate" },
  { rva: "0x4ece70", size: 80, role: "Observed-ability learning requires owned ability identity 74" },
  { rva: "0x4ecea0", size: 96, role: "Observed learning candidate filters source Ability.TypeId=504" },
  { rva: "0x4ef270", size: 48, role: "Observed learning filters BattleActData.IsLearningAbility before reading abilityList" },
  { rva: "0x4f00d0", size: 112, role: "Observed learning matches actual action ability-list identities" },
  { rva: "0x4efe90", size: 64, role: "Addition order compares owned ability CONTENT identity" },
  { rva: "0x350e90", size: 80, role: "Natural learning finds existing OwnedAbility by Ability.Id" },
  { rva: "0x4dee80", size: 80, role: "RemoveCondition duplication predicates compare Condition.Id" },
  { rva: "0x4acb30", size: 176, role: "CurrentHP clamp and IfNeededDying, no death rejection" },
  { rva: "0x4acbe0", size: 112, role: "CurrentMP clamp" },
  { rva: "0x771fa0", size: 0x52, role: "IsGetExp excludes condition types 5, 3 and 608" },
];
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
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
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(checked[i].sha256, m.nativeRangeSha256));
const symbols = JSON.parse(await readFile(root + symbolsFile, "utf8"));
const arrayField = symbols.ScriptMetadata.find((m) => m.Address === 0x1fccab8);
assert.equal(arrayField.Name, "Field$<PrivateImplementationDetails>.90BC6D961BFECAC39764DA41C52820F320E2398B");
assert.equal(symbols.ScriptMetadata.find((m) => m.Address === 0x1fd1db8).Name, "int[]_TypeInfo");
assert.equal(symbols.ScriptMetadata.find((m) => m.Address === 0x2003e50).Name, "Last.Interpreter.Instructions.SystemCall.Current_TypeInfo");
assert.ok(symbols.ScriptMetadataMethod.find((m) => m.Address === 0x1feb5d8).Name.endsWith("GetData<ExpTable>()"));
assert.ok(symbols.ScriptMetadataMethod.find((m) => m.Address === 0x1fcc910).Name.endsWith("Dictionary<int, ParameterType>.Add()"));
for (const [address, name] of [[0x4a4f20, "Last.Data.Master.GrowthCurve$$get_HpValue1"],
  [0x4a5930, "Last.Data.Master.GrowthCurve$$get_MpValue1"], [0x4a4f20, "Last.Data.Master.Learning$$get_JobId"]])
  assert.ok(symbols.ScriptMethod.some((m) => m.Address === address && m.Name === name));
const metadata = await readFile(root + metadataFile);
const correctionBytes = metadata.subarray(0x4df1f6, 0x4df1f6 + 128);
assert.equal(digest(correctionBytes, "sha1"), arrayField.Name.split(".").at(-1).toLowerCase());
const correction = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [String(i + 1), correctionBytes.readInt32LE(i * 4)]));
assert.deepEqual(correction, firstJoinLevelAdjustments);
const stoneAssembly = execFileSync("objdump", ["-d", "--start-address=0x180857066", "--stop-address=0x180857312", root + "build/runtime/game/GameAssembly.dll"], { encoding: "utf8" });
const stoneKeys = [...stoneAssembly.matchAll(/(?:movl\s+\$(0x[0-9a-f]+), %edx|leal\s+(0x[0-9a-f]+)\(%r8\), %edx)/g)]
  .map((m) => Number(m[1] ?? m[2]));
assert.deepEqual(stoneKeys, Array.from({ length: 27 }, (_, i) => i + 62));
const report = {
  lane: "static-native-character-growth-and-join-recovery", nativeSha256, symbolsSha256, headerSha256, metadataSha256,
  semanticsVerified: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  correction: { field: arrayField.Name, metadataOffset: "0x4df1f6", count: 32, values: correction },
  noMagicStone: { contentId: 0, parameterType: 0, dictionaryKeys: stoneKeys },
  establishes: ["first-join-correction-array", "base-plus-additional-exp", "ordinary-fixed-hp-mp-growth", "natural-skill-and-content-order", "natural-growth-no-global-history-append", "join-recovery-null-interpreter-condition-removal"],
  doesNotEstablish: ["original-game-execution", "unity-global-random-state", "esper-bonuses", "equipment-or-battle-special-learning", "full-field-appearance", "full-game-parity"],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/character-growth-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, correctionEntries: 32, reportSha256: digest(output), semanticsVerified: false }, null, 2));
