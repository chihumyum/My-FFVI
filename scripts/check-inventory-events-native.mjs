// Rebuild the inventory-event receipt from local source bytes and native exports.
// No prior report is read, and static provenance is not dynamic game verification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const nativeSha256 =
  "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 =
  "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 =
  "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [file, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
])
  assert.equal(sha(await readFile(root + file)), expected, file);

const { ScriptMethod } = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
const symbolAddresses = [...new Set(ScriptMethod.map((m) => m.Address))].sort(
  (a, b) => a - b,
);
function requireSymbol(rva, name) {
  const found = ScriptMethod.filter(
    (m) => m.Address === Number(rva) && m.Name === name,
  );
  assert.equal(found.length, 1, `${rva}: ${name}`);
}

async function checkedExport(batch, specifications) {
  const receipt = JSON.parse(
    await readFile(root + `build/native/${batch}/complete.json`, "utf8"),
  );
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.nativeSha256, nativeSha256, batch);
  assert.equal(receipt.symbolsSha256, symbolsSha256, batch);
  assert.equal(receipt.headerSha256, headerSha256, batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  const methods = [];
  for (const [rva, name] of specifications) {
    requireSymbol(rva, name);
    const found = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(found.length, 1, `${batch}: ${rva}`);
    const method = found[0];
    assert.equal(
      Number(method.nextSymbolRva),
      symbolAddresses.find((address) => address > Number(rva)),
      `${rva}: next symbol`,
    );
    const decompiled = await readFile(
      root + `build/native/${batch}/${rva.slice(2)}.c`,
    );
    assert.equal(sha(decompiled), method.decompiledSha256, `${rva}: export`);
    assert.ok(
      decompiled
        .toString("utf8")
        .startsWith(`/* RVA ${rva}; ${method.name};`),
      `${rva}: export identity`,
    );
    methods.push(method);
  }
  return { ...receipt, methods };
}

const receipt = await checkedExport("inventory-events", [
  ["0xb4c820", "Last.Interpreter.Instructions.External.Item$$GetItem"],
  ["0xb4cba0", "Last.Interpreter.Instructions.External.Item$$RemoveItem"],
  ["0xb51940", "Last.Interpreter.Instructions.External.Misc$$RemoveGil"],
  [
    "0xb567d0",
    "Last.Interpreter.Instructions.External.Misc.<>c__DisplayClass61_0$$<RemoveGil>b__0",
  ],
]);
const owned = await checkedExport("owned-state", [
  ["0x7f7740", "Last.Management.OwnedItemClient$$AddGil"],
  ["0x7f7900", "Last.Management.OwnedItemClient$$AddOwnedItem"],
  ["0x7f79a0", "Last.Management.OwnedItemClient$$AddOwnedItem"],
  ["0x7fd590", "Last.Management.OwnedItemClient$$RemoveGil"],
  ["0x7fd6d0", "Last.Management.OwnedItemClient$$RemoveOwnedItem"],
  ["0x7fdaf0", "Last.Management.OwnedItemClient$$RemoveOwnedItem"],
]);

// These getters share many IL2CPP addresses. Bind the Product aliases explicitly
// and check the actual array-index/return instructions, not a decompiler's alias.
requireSymbol("0x4a4a80", "Last.Data.Master.Product$$get_GroupId");
requireSymbol("0x4a4f60", "Last.Data.Master.Product$$get_Coefficient");
const shared = [
  {
    rva: "0x4a4a80",
    size: 64,
    expectedHex:
      "4883ec28488b41184885c0740e83781802760e8b40284883c428c3e8d08bcfffcce8da89cfff488bc833d2e8908bcfffcccccccccccccccccccccccccccccccc",
  },
  {
    rva: "0x4a4f60",
    size: 64,
    expectedHex:
      "4883ec28488b41184885c0740e83781803760e8b402c4883c428c3e8f086cfffcce8fa84cfff488bc833d2e8b086cfffcccccccccccccccccccccccccccccccc",
  },
  { rva: "0x409ff0", size: 8, expectedHex: "33c0c3cccccccccc" },
];
const methods = [...receipt.methods, ...owned.methods];
const requests = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
    hex: false,
  })),
  ...shared.map(({ rva, size }) => ({ rva, size, hex: true })),
];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
native=(Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes()
image=PEImage(native)
ranges=[]
for request in json.load(sys.stdin):
 section,offset,data=image.read(int(request['rva'],0),request['size'])
 ranges.append(dict(rva=request['rva'],size=request['size'],sha256=hashlib.sha256(data).hexdigest(),**({'bytes':data.hex()} if request['hex'] else {})))
print(json.dumps(dict(sourceSha256=hashlib.sha256(native).hexdigest(),ranges=ranges)))
`;
const checked = JSON.parse(
  execFileSync("python3", ["-c", python, root], {
    input: JSON.stringify(requests),
    encoding: "utf8",
  }),
);
assert.equal(checked.sourceSha256, nativeSha256);
assert.equal(checked.ranges.length, requests.length);
methods.forEach((method, index) =>
  assert.equal(
    checked.ranges[index].sha256,
    method.nativeRangeSha256,
    `${method.rva}: native range`,
  ),
);
const sharedRanges = shared.map((range, index) => {
  const observed = checked.ranges[methods.length + index];
  assert.equal(observed.bytes, range.expectedHex, `${range.rva}: shared range`);
  return {
    rva: range.rva,
    size: range.size,
    bytes: observed.bytes,
    sha256: observed.sha256,
  };
});

// Preserve the existing consumer's receipt shape, including owned dependencies.
// All input is from build/native or the original DLL; build/reports is output only.
const report = {
  sourceSha256: nativeSha256,
  receipt,
  sharedRanges,
  semanticsVerified: false,
  ownedStateDependencies: {
    nativeSha256,
    methods: owned.methods,
    semanticsVerified: false,
  },
};
const output = JSON.stringify(report, null, 2) + "\n";
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/inventory-events-native-check.json", output);
console.log(
  JSON.stringify({
    methods: receipt.methods.length,
    ownedStateDependencies: owned.methods.length,
    sharedRanges: sharedRanges.length,
    sha256: sha(output),
    semanticsVerified: false,
  }),
);
