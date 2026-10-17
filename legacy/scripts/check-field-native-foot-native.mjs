// Static evidence only. Checks reviewed source bodies and raw ranges, not DLL execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [file, digest] of [["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(resolve(root, file))), digest, file);
const symbols = JSON.parse(await readFile(resolve(root, "build/native/il2cpp/script.json")));
const methods = [], code = new Map();
const groups = {
  "v32-native-foot": [0x309a20, 0x301c20, 0x2fc8a0],
  "v23-field-entry-attributes": [0x301680, 0x365870],
  "v29-field-providers": [0x2df5f0],
};
for (const [batch, addresses] of Object.entries(groups)) {
  const receipt = JSON.parse(await readFile(resolve(root, "build/native", batch, "complete.json")));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256); assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  for (const address of addresses) {
    const method = receipt.methods.find((entry) => Number(entry.rva) === address); assert.ok(method);
    const matched = symbols.ScriptMethod.filter((entry) => entry.Address === address); assert.equal(matched.length, 1);
    const bytes = await readFile(resolve(root, "build/native", batch, address.toString(16) + ".c"));
    assert.equal(sha(bytes), method.decompiledSha256); code.set(address, bytes.toString());
    methods.push({ batch, symbol: matched[0].Name, ...method });
  }
}
const rawRanges = [
  { rva: "0x3826e0", size: 0x60, symbol: "AssetMapPackageData$$get_Attribute",
    role: "Package field +0x28 uses IsNullOrEmpty and returns String.Empty for null/missing/empty." },
  { rva: "0x312700", size: 0x1b0, symbol: "Last.Map.MapAssetLoader.<AttributeAssetLoad>d__30$$MoveNext",
    role: "An empty Attribute reference skips attribute loading entirely." },
  { rva: "0x9d3ff0", size: 0x60, symbol: "Last.Map.AttributeEncount$$GetCellAttribute",
    role: "The non-null grid branch reads CellDatas by truncated y*MapWidth+x; this branch remains unimplemented." },
];
for (const range of rawRanges)
  assert.ok(symbols.ScriptMethod.some((entry) => entry.Address === Number(range.rva) && entry.Name === range.symbol));
const requests = [...methods.map((method) => ({ rva: method.rva, size: Number(method.nextSymbolRva) - Number(method.rva) })), ...rawRanges];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for item in json.load(sys.stdin):
 section,offset,data=p.read(int(item['rva'],0),item['size'])
 out.append(dict(rva=item['rva'],size=item['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),hex=data.hex()))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(requests), encoding: "utf8" }));
methods.forEach((method, index) => assert.equal(ranges[index].sha256, method.nativeRangeSha256));
const raw = new Map(ranges.map((range) => [range.rva, Buffer.from(range.hex, "hex")]));
const call = (rva, at, target) => {
  const bytes = raw.get(rva), offset = at - Number(rva);
  assert.equal(bytes[offset], 0xe8);
  assert.equal(at + 5 + bytes.readInt32LE(offset + 1), target);
};
call("0x3826e0", 0x38270a, 0x1095410);
assert.ok(symbols.ScriptMethod.some((method) => method.Address === 0x1095410 && method.Name === "System.String$$IsNullOrEmpty"));
assert.ok(raw.get("0x3826e0").toString("hex").includes("488b4b2833d2"));
call("0x312700", 0x312757, 0x3826e0); call("0x312700", 0x312761, 0x1095410);
assert.equal(raw.get("0x312700").subarray(0x68, 0x6a).toString("hex"), "0f85");
assert.equal(0x31276e + raw.get("0x312700").readInt32LE(0x6a), 0x31285e);
// The constructor C export has a PIC warning. Its full raw tail only creates
// footInfoList at +0x18; preserve the explicit EncountData +0x38 null write.
assert.equal(raw.get("0x301c20").subarray(0x35, 0x42).toString("hex"), "488d4f3833d248c70100000000");
assert.ok(raw.get("0x301c20").toString("hex").includes("488d4f18488bd3488919"));
const bindings = [
  [0x309a20, /_Last_Map_MapModel_TypeInfo[\s\S]*_Last_Map_MapAttribute_TypeInfo[\s\S]*pLVar8->fields\)\.attribute/,
    "New MapModel owns a newly allocated MapAttribute; it does not inherit the old map's attribute object."],
  [0x301c20, /_EncountData_k__BackingField[\s\S]*= \(Last_Map_AttributeEncount_o \*\)0x0/,
    "The new attribute object explicitly clears EncountData."],
  [0x365870, /_AttributeInfo_k__BackingField[\s\S]*has_value[\s\S]*if \(\(char\)uStack_a0 == '\\0'\)[\s\S]*return;/,
    "Absent AttributeInfo posts completion without constructing an AttributeEncount."],
  [0x301680, /_EncountData_k__BackingField[\s\S]*Last_Map_AttributeEncount__GetCellAttribute[\s\S]*return 0;/,
    "Raw attribute query returns zero on null EncountData, independent of the default encounter table."],
  [0x2df5f0, /CorrectionMapAreaRangePos[\s\S]*WorldPositionToCellPosition[\s\S]*MapAttribute__GetCellAttribute[\s\S]*IsSemiTransparentBody/,
    "Native actor transparency queries raw map attributes after coordinate conversion."],
];
for (const [rva, pattern, meaning] of bindings) assert.match(code.get(rva), pattern, meaning);
assert.doesNotMatch(code.get(0x301680), /defaultEncountData|defaultFootInfo/);
const dump = await readFile(resolve(root, "build/native/il2cpp/dump.cs"), "utf8");
assert.match(dump, /public string attribute; \/\/ 0x28/);
assert.match(dump, /private AttributeEncount <EncountData>k__BackingField; \/\/ 0x38/);
const report = { formatVersion: 1, lane: "static-native-raw-field-foot", nativeSha256, symbolsSha256, headerSha256,
  metadataSha256: sha(dump), semanticsVerified: false, originalGameExecuted: false,
  methods: methods.map((method, index) => ({ ...method, sourceRange: ranges[index] })),
  rawRanges: rawRanges.map((range, index) => ({ ...range, sourceRange: ranges[methods.length + index] })),
  establishes: bindings.map(([, , meaning]) => meaning),
  doesNotEstablish: ["attribute-grid-parsing", "arbitrary-map-water-state", "original-game-execution", "shader-parity", "full-game-parity"],
  checkerSha256: sha(await readFile(fileURLToPath(import.meta.url))) };
await mkdir(resolve(root, "build/reports"), { recursive: true });
const output = resolve(root, "build/reports/field-native-foot-native-check.json");
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, bindings: bindings.length,
  semanticsVerified: false, reportSha256: sha(await readFile(output)) }));
