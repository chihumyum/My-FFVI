// Static provenance and field binding, not an original-game execution oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const expected = {
  nativeSha256:
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256:
    "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256:
    "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
const receipt = JSON.parse(
  await readFile(
    root + "build/native/v16-vitality-inputs/complete.json",
    "utf8",
  ),
);
assert.equal(receipt.status, "complete");
assert.equal(receipt.semanticsVerified, false);
for (const [key, file] of Object.entries({
  nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json",
  headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
})) {
  assert.equal(receipt[key], expected[key]);
  assert.equal(sha(await readFile(root + file)), expected[key]);
}
assert.deepEqual(receipt.methods.map((m) => m.rva).sort(), [
  "0x4afa30",
  "0x5343c0",
  "0x536870",
]);
for (const method of receipt.methods) {
  assert.equal(
    sha(
      await readFile(
        root + "build/native/v16-vitality-inputs/" + method.rva.slice(2) + ".c",
      ),
    ),
    method.decompiledSha256,
  );
}
const symbols = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
assert.deepEqual(
  symbols.ScriptString.filter((s) => s.Value === "MAX_VITALITY"),
  [{ Address: 0x1fe7530, Value: "MAX_VITALITY" }],
);
for (const name of ["CharacterStatus", "Monster"]) {
  const rows = symbols.ScriptMethod.filter(
    (m) => m.Name === "Last.Data.Master." + name + "$$get_Vitality",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Address, 0x4a5cf0);
}
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /ParameterBase\.Type Equipment = 4;/);
assert.match(dump, /ParameterBase\.Type Correction = 5;/);
assert.match(dump, /private int <Vitality>k__BackingField; \/\/ 0x2C/);
const requests = receipt.methods.map((m) => ({
  rva: m.rva,
  size: Number(m.nextSymbolRva) - Number(m.rva),
}));
// Getter uses shared master-row storage; the symbol aliases above bind the source field.
requests.push({ rva: "0x4a5cf0", size: 64 });
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
image=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
result=[]
for item in json.load(sys.stdin):
 section,offset,data=image.read(int(item['rva'],0),item['size'])
 result.append(dict(**item,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),hex=data.hex()))
print(json.dumps(result))
`;
const ranges = JSON.parse(
  execFileSync("python3", ["-c", python, root], {
    input: JSON.stringify(requests),
    encoding: "utf8",
  }),
);
receipt.methods.forEach((method, i) =>
  assert.equal(ranges[i].sha256, method.nativeRangeSha256),
);
const report = {
  kind: "static-vitality-provenance",
  ...expected,
  methods: receipt.methods,
  ranges,
  binding: {
    constant: "MAX_VITALITY",
    dictionary: { equipment: 4, correction: 5 },
    parameterBaseVitalityOffset: 44,
    masterGetter: "0x4a5cf0",
  },
  interpretation:
    "Player natural clamps base + additional + correction, then confirmed clamps natural + temporary + equipment. Enemy clamps base + temporary. ParameterBase field and shared master getter are bound by source types, not decompiler generic aliases.",
  semanticsVerified: false,
  nativeParity: "unknown",
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/vitality-native-check.json", output);
console.log(
  JSON.stringify({
    methods: receipt.methods.length,
    sha256: sha(output),
    semanticsVerified: false,
  }),
);
