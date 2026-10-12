// Static bindings to this supplied build. No process execution or parity claim.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const compiledIndex = process.argv.indexOf("--compiled-dir");
if (compiledIndex !== -1 && !process.argv[compiledIndex + 1]) throw new Error("Missing --compiled-dir value");
const compiledDir = compiledIndex === -1 ? "dist" : process.argv[compiledIndex + 1];
const { MAX_MAGIC_LEARNING_VALUE } = await import(pathToFileURL(resolve(root, compiledDir, "src/core/battle-result.js")));
const sha = value => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
const reportPath = root + "build/reports/battle-result-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
for (const [file, key] of [
  ["build/runtime/game/GameAssembly.dll", "nativeSha256"],
  ["build/native/il2cpp/script.json", "symbolsSha256"],
  ["build/native/il2cpp/il2cpp_ghidra.h", "headerSha256"],
]) assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map(row => row.Address))].sort((a, b) => a - b);
function symbol(rva, name) {
  assert.equal(symbols.ScriptMethod.filter(row => row.Address === Number(rva) && row.Name === name).length, 1, name);
}

const methods = [], code = new Map();
for (const [batch, rva, name] of [
  ["v24-system-providers", "0x463f00", "Last.Battle.BattleController$$StartWinResult"],
  ["v19-character-growth-learning", "0x3d51a0", "Last.Systems.BattleResultProvider$$Genelate"],
  ["v19-character-growth-entry-confirmed", "0x4ea5d0", "Last.Systems.StatusUpProvider$$Execution"],
  ["v19-character-growth-review", "0x769570", "Last.Battle.BattleUtility$$IsGetExp"],
]) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch + ":" + key);
  const found = receipt.methods.filter(method => method.rva === rva);
  assert.equal(found.length, 1, batch + ":" + rva);
  const method = found[0];
  symbol(rva, name);
  assert.equal(Number(method.nextSymbolRva), addresses.find(next => next > Number(rva)));
  const bytes = await readFile(root + `build/native/${batch}/${rva.slice(2)}.c`);
  assert.equal(sha(bytes), method.decompiledSha256);
  assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
  methods.push({ batch, ...method });
  code.set(rva, bytes.toString());
}

const rawRanges = [
  { rva: "0x4a58f0", size: 64, name: "Last.Data.Master.MonsterParty$$get_GetValue",
    hex: "4883ec28488b41184885c0740e8378180d760e8b40544883c428c3e8607dcfffcce86a7bcfff488bc833d2e8207dcfffcccccccccccccccccccccccccccccccc",
    role: "Shared getter reads int array index 13 (+0x54); bind MonsterParty identity, not the Ghidra Ability alias" },
  { rva: "0x4a5870", size: 64, name: "Last.Data.Master.MonsterParty$$get_GetAp",
    hex: "4883ec28488b41184885c0740e8378180e760e8b40584883c428c3e8e07dcfffcce8ea7bcfff488bc833d2e8a07dcfffcccccccccccccccccccccccccccccccc",
    role: "Shared getter reads int array index 14 (+0x58), a distinct AP field" },
  { rva: "0x453d80", size: 128, name: "Last.Battle.BattleAddExpPlug$$GetAp",
    expectedSha256: "af7c86645396b8bda9a99b0e9afef9eeb50f48cb1ab7e8fb5f34be5db50e1faa",
    role: "Current MonsterParty wrapper tail calls GetAp; null party returns zero" },
  { rva: "0x454070", size: 128, name: "Last.Battle.BattleAddExpPlug$$GetMagicValue",
    expectedSha256: "4d00cc3ea4d3b12a4e31cc4c4e47cc46a4af66688cda5c82b9d4472a98be5a36",
    role: "Current MonsterParty wrapper tail calls GetValue; null party returns zero" },
  { rva: "0x681b70", size: 96, name: "Last.Battle.BattleSkillUpInformation$$.ctor",
    role: "Separate constructor writes AP at +0x1c and MagicPoint at +0x20" },
  { rva: "0x3d58b0", size: 14, name: "Last.Systems.BattleResultProvider$$.ctor",
    hex: "33d2c7411080000000e93236efff",
    role: "Constructor initializes MaxMagicLearningValue at +0x10 to integer 0x80 (128)" },
  { rva: "0x530020", size: 48, name: "Last.Data.User.OwnedCharacterData$$get_MagicLearningValue",
    role: "Reads OwnedCharacterSaveData at +0x88, then serialized magicLearningValue at +0x9c" },
  { rva: "0x530270", size: 48, name: "Last.Data.User.OwnedCharacterData$$set_MagicLearningValue",
    role: "Writes the same saveData +0x9c field; not a second result-owned counter" },
  { rva: "0x4ea720", size: 15, hex: "488b8df80000004885c974038b4920",
    role: "StatusUp loads the passed BattleSkillUpInformation +0x20 (MagicPoint), not +0x1c (AP)" },
  { rva: "0x771fa0", size: 82,
    role: "IsGetExp predicate excludes source condition types 5, 3 and 608" },
];
for (const range of rawRanges) if (range.name) symbol(range.rva, range.name);
assert.ok(symbols.ScriptMetadataMethod.some(row => row.Address === 0x200a0c8 && row.MethodAddress === 0x771fa0));
const ranges = [...methods.map(method => ({ rva: method.rva,
  size: Number(method.nextSymbolRva) - Number(method.rva) })), ...rawRanges];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 if 'hex' in r: assert data.hex()==r['hex'],(r['rva'],data.hex())
 digest=hashlib.sha256(data).hexdigest()
 if 'expectedSha256' in r: assert digest==r['expectedSha256'],r['rva']
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=digest,hex=data.hex()))
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], {
  input: JSON.stringify(ranges), encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
}));
methods.forEach((method, i) => assert.equal(method.nativeRangeSha256, checked[i].sha256));
const bytes = rva => Buffer.from(checked.find(range => range.rva === rva).hex, "hex");
const cap = bytes("0x3d58b0").readInt32LE(5);
assert.equal(cap, 128);
assert.equal(MAX_MAGIC_LEARNING_VALUE, cap);
assert.ok(bytes("0x681b70").includes(Buffer.from("896e1c", "hex")), "AP store +0x1c");
assert.ok(bytes("0x681b70").includes(Buffer.from("894620", "hex")), "MagicPoint store +0x20");
assert.ok(bytes("0x530020").includes(Buffer.from("8b809c000000", "hex")), "owned getter +0x9c");
assert.ok(bytes("0x530270").includes(Buffer.from("89909c000000", "hex")), "owned setter +0x9c");
// Each wrapper uses a direct tail branch after loading its current party.
for (const [rva, target] of [["0x453d80", 0x4a5870], ["0x454070", 0x4a58f0]]) {
  const data = bytes(rva), jump = data.indexOf(Buffer.from("4883c428e9", "hex")) + 4;
  assert.ok(jump >= 4);
  assert.equal(Number(rva) + jump + 5 + data.readInt32LE(jump + 1), target);
}

const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
for (const text of [
  'private const string _get_value = "get_value";', 'private const string _get_ap = "get_ap";',
  "public const MonsterParty.Param GetValue = 13;", "public const MonsterParty.Param GetAp = 14;",
  "private int <AP>k__BackingField; // 0x1C", "private int <MagicPoint>k__BackingField; // 0x20",
  "private readonly int MaxMagicLearningValue; // 0x10",
  "private OwnedCharacterSaveData saveData; // 0x88", "private int magicLearningValue; // 0x9C",
]) assert.ok(dump.includes(text), text);
const checks = [];
function requireText(rva, label, ...parts) {
  for (const part of parts) assert.ok(code.get(rva).includes(part), `${rva}: ${label}: ${part}`);
  checks.push(label);
}
requireText("0x463f00", "party AP and MagicPoint are distinct victory inputs",
  "Last_Battle_InstantiateManager__GetMonsterParty", "ap = Last_Data_Master_Ability__get_AccuracyRate",
  "magicPoint =", "Last_Data_Master_Ability__get_AttackCount", "ap,magicPoint,(MethodInfo *)0x0");
requireText("0x3d51a0", "result.GetMp carries MagicPoint, not current MP",
  "(battleSkillUpInformation->fields)._MagicPoint_k__BackingField", "_GetMp_k__BackingField = iVar14");
requireText("0x3d51a0", "each qualified member receives the full MagicPoint amount before StatusUp",
  "Last_Battle_BattleUtility__IsGetExp", "Last_Data_User_OwnedCharacterData__set_AdditionalExp",
  "(unaff_RBX,(pLVar15->fields)._GetMp_k__BackingField + iVar14", "MaxMagicLearningValue",
  "if (iVar14 <= iVar11)", "FUN_18004fb40(1,_Last_Systems_IStatusUpProvider_TypeInfo");
const reward = code.get("0x3d51a0");
assert.ok(reward.indexOf("Last_Data_User_OwnedCharacterData__set_AdditionalExp") < reward.indexOf("Last_Data_User_OwnedCharacterData__set_MagicLearningValue"));
assert.ok(reward.indexOf("Last_Data_User_OwnedCharacterData__set_MagicLearningValue") < reward.indexOf("FUN_18004fb40(1,_Last_Systems_IStatusUpProvider_TypeInfo"));
requireText("0x3d51a0", "ineligible members take the separate learning-only interface path",
  "System_Collections_Generic_List_BattlePlayerData___Contains", "if (cVar9 == '\\0')",
  "FUN_180050a10(2,_Last_Systems_IStatusUpProvider_TypeInfo");
requireText("0x3d51a0", "Colosseum remains a separate unimplemented reward lifecycle", "IsColosseumBattle", "if (bVar10) {\n          return pLVar15;");
requireText("0x4ea5d0", "full StatusUp retains learning effects outside this counter projector",
  "Last_Systems_StatusUpProvider__ExecutionLearning", "Last_Data_User_OwnedCharacterData__get_MagicStoneId");
requireText("0x769570", "EXP reward eligibility is based on current conditions", "_CurrentConditionList_k__BackingField", "System_Linq_Enumerable__Any", "return !bVar1;");
for (const [flag, name] of [[3, "NoResultNoSave"], [9, "NoSaveItem"], [10, "NoFanfareNoResult"],
  [11, "NoExp"], [12, "NoGil"], [13, "OnlyExpGilbart"]])
  assert.ok(dump.includes(`public const BattleFlagType ${name} = ${flag};`));
checks.push("unimplemented reward flags retain their source enum identities");
const compactRange = ({ hex: _hex, ...range }) => range;
const report = {
  kind: "battle-result-native-check-v1", ...identity, maxMagicLearningValue: cap,
  methods: methods.map((method, i) => ({ ...method, sourceRange: compactRange(checked[i]) })),
  rawRanges: rawRanges.map((range, i) => ({ ...range, sourceRange: compactRange(checked[methods.length + i]) })),
  checks, semanticsVerified: false, originalGameExecuted: false,
  establishes: ["MonsterParty.GetValue supplies MagicPoint; GetAp is distinct",
    "ordinary qualified-member counter increment and cap 128", "persistent OwnedCharacterSaveData field identity",
    "StatusUp consumes MagicPoint in addition to the accumulated counter"],
  limitations: ["Static decompiler and original DLL byte bindings, not original-game execution",
    "No nonzero AP provider or special reward/battle flag execution",
    "Magic-stone, equipment and background learning still require their existing providers/gates",
    "Counter projection alone does not establish actor eligibility or whole-result transaction correctness",
    "Pathological signed integer overflow outside the actual source reward range is not an execution oracle"],
};
const json = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, json);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, checks: checks.length,
  maxMagicLearningValue: cap, semanticsVerified: false, reportSha256: sha(json) }, null, 2));
