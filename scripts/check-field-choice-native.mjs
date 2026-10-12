// Static source binding only. This script never executes the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-choice-native-check.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = {
  nativeSha256:
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256:
    "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256:
    "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  metadataSha256:
    "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
};
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
const metadataPath =
  "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat";
for (const [key, file] of Object.entries({
  nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json",
  headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
  metadataSha256: metadataPath,
}))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort(
  (a, b) => a - b,
);
const batches = {
  "event-interaction-v39": ["b4d7c0", "b4e0b0", "31ec80", "31ed10", "31eb90"],
  "event-choice-ui-v39": [
    "987de0",
    "987fb0",
    "7ee5e0",
    "7ef200",
    "7eed10",
    "31be10",
    "31c000",
  ],
  "event-choice-contract-v39": [
    "7ef570",
    "7ecfc0",
    "7eceb0",
    "7ed710",
    "7edd30",
  ],
};
const methods = [],
  code = new Map();
for (const [batch, rvas] of Object.entries(batches)) {
  const receipt = JSON.parse(
    await readFile(root + `build/native/${batch}/complete.json`, "utf8"),
  );
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.semanticsVerified, false);
  for (const key of ["nativeSha256", "symbolsSha256", "headerSha256"])
    assert.equal(receipt[key], identity[key], batch);
  for (const hex of rvas) {
    const rva = "0x" + hex,
      matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1, rva);
    const method = matches[0],
      bytes = await readFile(root + `build/native/${batch}/${hex}.c`),
      sourceNames = symbols.ScriptMethod.filter(
        (m) => m.Address === Number(rva),
      );
    assert.equal(
      sourceNames.length,
      1,
      rva + " must have a unique source method",
    );
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((a) => a > Number(rva)),
    );
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, sourceName: sourceNames[0].Name, ...method });
    code.set(hex, bytes.toString());
  }
}
const ranges = JSON.parse(
  execFileSync(
    root + ".venv/bin/python",
    [
      "-c",
      String.raw`import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1]); from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
print(json.dumps([dict(**r,sha256=hashlib.sha256(p.read(int(r['rva'],0),r['size'])[2]).hexdigest()) for r in json.load(sys.stdin)]))`,
      root,
    ],
    {
      encoding: "utf8",
      input: JSON.stringify(
        methods.map((m) => ({
          rva: m.rva,
          size: Number(m.nextSymbolRva) - Number(m.rva),
        })),
      ),
    },
  ),
);
methods.forEach((method, index) =>
  assert.equal(ranges[index].sha256, method.nativeRangeSha256, method.rva),
);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8"),
  metadata = await readFile(root + metadataPath);
assert.match(
  dump,
  /CDA46F1C24B92FA8375164475268E0375C6A403D \/\*Metadata offset 0x4DF600\*\//,
);
const anchorBytes = metadata.subarray(0x4df600, 0x4df600 + 20);
assert.equal(
  createHash("sha1").update(anchorBytes).digest("hex"),
  "cda46f1c24b92fa8375164475268e0375c6a403d",
);
const anchors = Array.from({ length: 5 }, (_, i) =>
  anchorBytes.readInt32LE(i * 4),
);
assert.deepEqual(anchors, [0, 1, 2, 3, 4]);
assert.equal(
  symbols.ScriptString.find((s) => s.Address === 0x1fda990)?.Value,
  "Msg",
);
assert.match(dump, /SPEECH_IN_OPTION_YES; \/\/ 0xC30/);
assert.match(dump, /SPEECH_IN_OPTION_NO; \/\/ 0xC38/);
assert.match(code.get("b4e0b0"), /TypeInfo \+ 0xb8\) = 4/);
assert.match(code.get("b4d7c0"), /Core__IsFirstClock/);
assert.match(code.get("b4d7c0"), /0 < \(int\)uVar12/);
assert.match(code.get("b4d7c0"), /Play\(pLVar7,iVar5,pSVar1->m_Items\[2\]/);
assert.match(
  code.get("b4d7c0"),
  /GetMessage[\s\S]*m_Items\[uVar13\],true[\s\S]*uVar12 < 6/,
);
assert.match(code.get("b4d7c0"), /Play\(pLVar7,5,values/);
assert.match(
  code.get("b4d7c0"),
  /IsSelecting[\s\S]*GetNextMnemonic[\s\S]*_DAT_181fda990[\s\S]*MessageWindowClient__Stop[\s\S]*SwitchCurrentUpdateTargetEntities/,
);
assert.doesNotMatch(code.get("b4d7c0"), /m_Items\[1\]/);
assert.match(
  code.get("7ef570"),
  /UiMessageConstants_TypeInfo \+ 0xb8\) \+ 0xc30/,
);
assert.match(
  code.get("7ef570"),
  /UiMessageConstants_TypeInfo \+ 0xb8\) \+ 0xc38/,
);
assert.match(code.get("7ee5e0"), /GetMessageByMessageConclusion/);
assert.match(code.get("7ecfc0"), /SetContentData[\s\S]*__this_01,index,pSVar9/);
assert.match(code.get("7ed710"), /SetForcusIndex\(__this,0,/);
for (const rva of ["987fb0", "31c000"]) {
  assert.match(code.get(rva), /selected = index/);
  assert.match(code.get(rva), /nextState = 2/);
}
const controllerKeyOffsets = {};
for (const rva of ["7ef200", "7edd30"]) {
  const offsets = [
    ...code
      .get(rva)
      .matchAll(/_System_Input_Key_TypeInfo \+ 0xb8\) \+ (0x[0-9a-f]+|\d+)/g),
  ].map((m) => Number(m[1]));
  const unique = [...new Set(offsets)].sort((a, b) => a - b);
  assert.deepEqual(
    unique,
    [8, 40, 48, 56, 64],
    "Action and four directions, without Cancel",
  );
  controllerKeyOffsets[rva] = unique;
}
const report = {
  kind: "field-choice-static-native",
  ...identity,
  dumpSha256: sha(dump),
  methods,
  ranges,
  anchors: {
    metadataOffset: "0x4df600",
    values: anchors,
    default: 4,
    explicitLabels: 5,
  },
  controllerKeyOffsets,
  interpretation: {
    defaults:
      "SPEECH_IN_OPTION_YES / SPEECH_IN_OPTION_NO through message_conclusion and localized system messages",
    explicit:
      "Up to six original source slots; this ordinary capability accepts contiguous nonempty 2..6 labels",
    selected:
      "Fixed callback writes zero-based index to shared DataStorage.selected; no ordinary Cancel callback",
    completion:
      "Next raw Msg retains current window; otherwise Stop and group12 with invokeCallback=false",
  },
  semanticsVerified: false,
  originalGameExecuted: false,
  doesNotEstablish: [
    "native dynamic parity",
    "native UI pixels or input repeat timing",
    "script reachability",
    "whole-game playability",
  ],
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(output, bytes);
console.log(
  JSON.stringify({
    result: "pass",
    methods: methods.length,
    reportSha256: sha(bytes),
    semanticsVerified: false,
  }),
);
