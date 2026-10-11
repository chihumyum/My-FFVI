// Static native provenance and recovered hardcoded initialization bindings.
// The original Windows game has not been executed by this checker.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = process.argv.includes("--dist") ? process.argv[process.argv.indexOf("--dist") + 1] : "dist";
const { initialPossessionAbilityIds } = await import(new URL(`${outDir}/src/compiler/owned-character.js`, "file://" + root));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, digest] of [["build/runtime/game/GameAssembly.dll", nativeSha256], ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(root + path)), digest, path);
const batches = {
  "v16-party-entry": "328110",
  "initial-party": "52de50,537ca0,52b7b0",
  "initial-equipment": "533450,52d220",
  "v18-owned-character-entry-confirmed": "3d4270,52af50,52c020,8045d0,8058f0,805d50,805e80,805f10,84f5b0,863860",
  "v18-owned-character-finalizers": "32b8a0,337c10,338890,52de40,5e9cd0,6d1110,84f8a0,862e40,8631d0",
  "v18-owned-character-command-filter": "329c20,331b90,4ac740,52aa10,5fa8e0,5faa10,74bc10,754770,850b80,851050",
  "parameter-specials": "85ab80,85a230,85a630,84d110",
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
    assert.equal(sha(await readFile(root + `build/native/${batch}/${address}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  { rva: "0x389c70", size: 3, hex: "32c0c3", role: "FF6 inherits false transfer-skill and history-magic providers" },
  { rva: "0x3031d0", size: 3, hex: "b001c3", role: "FF6 enables chanting-based ability group filtering" },
  { rva: "0x856910", size: 6, hex: "b864000000c3", role: "FF6 learned threshold 100" },
  { rva: "0x2c8ef0", size: 3, hex: "c20000", role: "inherited job ChangeCommand/ChangeParameter/SetSkillLevel no-op" },
  { rva: "0x4eef50", size: 80, role: "initial ability Content.TypeId=4 filter" },
  { rva: "0x3e6190", size: 48, role: "remove AbilityGroupId=0 from visible command abilities" },
  { rva: "0x8e2b50", size: 49, role: "HasTwoSwordStyle checks actual Ability.TypeId=12" },
  { rva: "0x84d770", size: 48, role: "HasTwohand checks ability identity" },
  { rva: "0x84da50", size: 14, hex: "c7472002000000c74724fb000000", role: "two-hand multiplier=2; prerequisite ability=251" },
  { rva: "0x804700", size: 64, role: "job replacement content type 7 first slot" },
  { rva: "0x804790", size: 64, role: "job replacement content type 7 second slot" },
  { rva: "0x804820", size: 64, role: "job replacement content type 7 third slot" },
  { rva: "0x806870", size: 96, role: "content type_value equals job change_command_2" },
  { rva: "0x8068e0", size: 96, role: "content type_value equals job change_command_3" },
  { rva: "0x806950", size: 96, role: "content type_value equals job change_command_4" },
  { rva: "0x860010", size: 91, role: "equip-any-job requires equipped MedalContentId=317" },
  { rva: "0x8067c0", size: 96, role: "UpdateNameTag selects character_default_name.character_id" },
  { rva: "0x4a5d70", size: 64, role: "CharacterDefaultName.TagName string getter" },
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
const constructor = await readFile(root + "build/native/v18-owned-character-finalizers/84f8a0.c", "utf8");
const bindings = {}, current = [];
for (const match of constructor.matchAll(/pSVar2,\s*(0x[0-9a-f]+|\d+)\s*,\s*_DAT_182017d40|__this_00,\s*(0x[0-9a-f]+|\d+),pSVar2/g)) {
  if (match[1]) current.push(Number(match[1]));
  else bindings[Number(match[2])] = current.splice(0);
}
assert.equal(current.length, 0);
assert.deepEqual(bindings, initialPossessionAbilityIds);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
for (const [address, suffix] of [[0x1fc20e8, "GetList<AbilityGroup>()"], [0x1feb720, "GetData<Chanting>()"], [0x1fc1e50, "GetList<CharacterDefaultName>()"]])
  assert.ok(symbols.ScriptMetadataMethod.find((m) => m.Address === address)?.Name.endsWith(suffix));
const report = {
  lane: "static-native-owned-character-initialization",
  nativeSha256, symbolsSha256, headerSha256, semanticsVerified: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  initialPossessionAbilityIds: bindings,
  establishes: ["owned-order-and-unique-global-history", "ff6-initial-skill-values", "command-and-chanting-projection", "constructor-zero-inputs-and-null-slots", "ordinary-initial-equipment-and-before-equipment-current-resources"],
  doesNotEstablish: ["original-game-execution", "source-first-join-growth", "conditioned-or-passive-initialization", "ability-action-execution", "rendered-new-character", "full-game-parity"],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/owned-character-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, initialPossessionBindings: Object.keys(bindings).length, reportSha256: sha(output), semanticsVerified: false }, null, 2));
