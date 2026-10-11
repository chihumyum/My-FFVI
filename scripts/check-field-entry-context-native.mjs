// Static provenance from this build's DLL bytes and local exports. No native
// runtime is executed, and no prior report is used as verification input.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const reportPath = root + "build/reports/field-entry-context-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const { ScriptMethod, ScriptMetadata } = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(ScriptMethod.map((method) => method.Address))].sort((a, b) => a - b);
const batches = {
  "v23-field-entry-context": [0x575e50, 0x575d60, 0x7d7470, 0x7d9ad0, 0x7aabf0, 0x7ab9f0, 0x7abb40, 0x7a7300, 0x7a77d0, 0x7a71e0],
  "v23-field-entry-attributes": [0x2e35c0, 0x2d9950, 0x3016c0, 0x301680, 0x365870, 0x7abec0, 0xaf09f0, 0xaf0a00],
  "v23-field-entry-initialization": [0x310bd0, 0x51d90, 0x7abd10, 0x2f0180],
  "map-script-entry": [0x58a910],
  "v19-transport-lifecycle": [0x2e3d30],
  "v19-transport-entry": [0x2fb440],
  "v18-field-foot-monitor": [0x7da350],
  "v21-battle-entry-owned": [0x409a70],
};
const methods = [], code = new Map();
for (const [batch, rvas] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const rva of rvas) {
    const symbols = ScriptMethod.filter((method) => method.Address === rva);
    assert.equal(symbols.length, 1, `Unique method ${rva.toString(16)}`);
    const found = receipt.methods.filter((method) => Number(method.rva) === rva);
    assert.equal(found.length, 1);
    const method = found[0], bytes = await readFile(root + `build/native/${batch}/${rva.toString(16)}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((address) => address > rva));
    assert.equal(sha(bytes), method.decompiledSha256);
    assert.ok(bytes.toString().startsWith(`/* RVA ${method.rva}; ${method.name};`));
    methods.push({ batch, symbol: symbols[0].Name, ...method });
    code.set(rva, bytes.toString());
  }
}
// EncounterLot's C export contains a PIC warning and truncates this constructor
// tail. Bind the actual instructions instead of treating the C return as final.
const rawRanges = [
  { rva: "0x7abfaa", size: 0xbc, role: "EncounterLot constructor lazily creates and stores BeastFieldEncount at +0x58" },
  { rva: "0x312700", size: 0x1b0, symbol: "Last.Map.MapAssetLoader.<AttributeAssetLoad>d__30$$MoveNext",
    role: "Empty Attribute reference skips attribute asset loading" },
  { rva: "0x3826e0", size: 0x60, symbol: "AssetMapPackageData$$get_Attribute", role: "Attribute getter reads package attribute member" },
  { rva: "0x7a9aa0", size: addresses.find((address) => address > 0x7a9aa0) - 0x7a9aa0,
    symbol: "Last.Map.EncountTable$$Create", role: "Missing monster set returns null; existing master creates the default table" },
  { rva: "0x2c8ef0", size: 3, symbol: "Serial.Template.Map.FootAttribute$$SetupEncountData",
    hex: "c20000", role: "FF6 inherits the empty virtual SetupEncountData provider" },
];
for (const range of rawRanges.filter((range) => range.symbol))
  assert.ok(ScriptMethod.some((method) => method.Address === Number(range.rva) && method.Name === range.symbol));
assert.equal(ScriptMethod.some((method) => method.Name === "Serial.FF6.Map.FootAttribute$$SetupEncountData"), false);
assert.ok(ScriptMetadata.some((entry) => entry.Address === 0x1ffaf98 && entry.Name === "Last.Map.Encount.BeastFieldEncount_TypeInfo"));
const requests = [...methods.map((method) => ({ rva: method.rva, size: Number(method.nextSymbolRva) - Number(method.rva) })), ...rawRanges];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
image=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for request in json.load(sys.stdin):
 section,offset,data=image.read(int(request['rva'],0),request['size'])
 if 'hex' in request: assert data.hex()==request['hex'],request
 out.append(dict(rva=request['rva'],size=request['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),hex=data.hex()))
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(requests), encoding: "utf8" }));
methods.forEach((method, index) => assert.equal(checked[index].sha256, method.nativeRangeSha256));
const raw = new Map(checked.slice(methods.length).map((range) => [range.rva, range.hex]));
assert.ok(raw.get("0x7abfaa").includes("488d4f58488b10488911"), "source stores singleton to EncounterLot +0x58");
assert.ok(raw.get("0x3826e0").includes("488b4328"), "source Attribute field at +0x28");
const attributeBytes = Buffer.from(raw.get("0x312700"), "hex");
for (const [at, target] of [[0x312757, 0x3826e0], [0x312761, 0x1095410]]) {
  const offset = at - 0x312700;
  assert.equal(attributeBytes[offset], 0xe8);
  assert.equal(at + 5 + attributeBytes.readInt32LE(offset + 1), target);
}
assert.equal(attributeBytes.subarray(0x68, 0x6a).toString("hex"), "0f85");
assert.equal(0x31276e + attributeBytes.readInt32LE(0x6a), 0x31285e, "empty Attribute skips the loading branch");
const bindingChecks = [
  [0x575e50, /footEventEntityList[\s\S]*\+ 0x18\) == 9/, "save point is a foot-event list membership, not free-save map flag"],
  [0x7d7470, /AddFootEventEntity/, "foot event updates list on accepted overlap"],
  [0x7d7470, /RemoveFootEventEntity/, "foot event removes departed membership"],
  [0xaf09f0, /_TriggerPower_k__BackingField == false[\s\S]*_TriggerOverlap_k__BackingField = true/, "save point entry callback is gated"],
  [0xaf0a00, /_TriggerPower_k__BackingField = true[\s\S]*_TriggerOverlap_k__BackingField = false/, "save point exit resets trigger state"],
  [0x7aabf0, /useStayPosition[\s\S]*GetEntityPosition[\s\S]*destPos/, "field attribute check uses source stay or destination position"],
  [0x7aabf0, /currentFootAttributeType = 0/, "absent foot info maps to ordinary foot type"],
  [0x7aabf0, /currentTransportation = pLVar11/, "controller receives actual transport identity"],
  [0x7ab9f0, /currentFootAttributeType = -1/, "map setup cache sentinel is not current-map zero"],
  [0x3016c0, /defaultEncountData[\s\S]*_EncountData_k__BackingField[\s\S]*defaultFootInfo/, "default table takes priority over attribute grid"],
  [0x310bd0, /_MonsterSetId_k__BackingField[\s\S]*EncountTable__Create[\s\S]*GetSubtractSteps[\s\S]*\+ 0x30\) = 0/, "default foot tuple is zero type plus subtract steps"],
  [0x365870, /_AttributeInfo_k__BackingField[\s\S]*if \(\(char\)uStack_a0 == '\\0'\)/, "no AttributeInfo skips encounter grid construction"],
  [0x2d9950, /StandingInExclusionArea[\s\S]*return \(Last_Map_EncountInfo_o \*\)0x0/, "excluded cells return absent info and therefore the same ordinary type"],
  [0x2fb440, /_MonsterSetId_k__BackingField =/, "LoadData binds current map master monster set"],
  [0x2e3d30, /RemoveFootEventEntityAll/, "MapSetup clears prior foot-event membership"],
  [0x58a910, /_ScriptFinished_k__BackingField == false[\s\S]*SetupEncountData/, "LastSettings waits for source initializer completion before cache synchronization"],
  [0x2f0180, /_5_SetupEncountData[\s\S]*CheckBeastFieldAttribute[\s\S]*player,true/, "post-initialization refresh uses player standing position"],
  [0x7da350, /CheckBeastFieldAttribute/, "movement checks current destination foot context"],
  [0x409a70, /0x1f[\s\S]*0x20[\s\S]*id == 1/, "Beast qualification uses foot 31 or 32 and transport ID1"],
];
for (const [rva, regex, name] of bindingChecks) assert.match(code.get(rva), regex, name);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const beast = dump.slice(dump.indexOf("public class BeastFieldEncount //"), dump.indexOf("public class BeastFieldEncount //") + 6000);
assert.match(beast, /currentFootAttributeType; \/\/ 0x38/);
assert.match(beast, /currentTransportation; \/\/ 0x40/);
const report = { kind: "static-field-entry-context-provenance", ...identity, semanticsVerified: false,
  methods: methods.map((method, index) => ({ ...method, sourceRange: { ...checked[index], hex: undefined } })),
  rawRanges: rawRanges.map((range, index) => ({ ...range, sourceRange: { ...checked[methods.length + index], hex: undefined } })),
  sourceChecks: bindingChecks.map(([rva, , claim]) => ({ rva: "0x" + rva.toString(16), claim })),
  limitations: ["Static source restoration only; no original runtime trace or native parity oracle.",
    "Actual save-point trigger overlap/list membership and attribute-grid selection remain unhosted.",
    "This provider does not implement random encounter scheduling or BeastField progression.",
    "Constructor PIC truncation is resolved only for the explicitly bound raw tail; C completion does not establish semantics."] };
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, bytes);
console.log(JSON.stringify({ report: reportPath, methods: methods.length, rawRanges: rawRanges.length,
  sourceChecks: bindingChecks.length, reportSha256: sha(bytes), semanticsVerified: false }));
