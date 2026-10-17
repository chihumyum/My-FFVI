// Re-read source DLL bytes, metadata and complete export bodies on every run.
// Static evidence does not establish original-runtime or audible equivalence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nativeSha256 =
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256 =
    "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256 =
    "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const reportPath = root + "build/reports/audio-readiness-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
for (const [file, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
])
  assert.equal(sha(await readFile(root + file)), expected, file);
const symbols = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
const addresses = [...new Set(symbols.ScriptMethod.map((r) => r.Address))].sort(
  (a, b) => a - b,
);
const batches = {
  "v28-opening-primitives": [
    ["819670", "Last.Interpreter.Instructions.Audio$$ReadyBGM"],
    ["81a850", "Last.Interpreter.Instructions.Audio$$SyncBGM"],
  ],
  "v28-audio-readiness": [
    ["8194b0", "Last.Interpreter.Instructions.Audio$$PollingCommon"],
    ["838610", "Last.Interpreter.Instructions.Audio.<>c$$<ReadyBGM>b__16_0"],
    ["8386f0", "Last.Interpreter.Instructions.Audio.<>c$$<SyncBGM>b__28_0"],
    ["492780", "Last.Management.AudioManager$$AssetIsReady"],
    ["493210", "Last.Management.AudioManager$$IsPlaying"],
    ["493130", "Last.Management.AudioManager$$IsPlaying"],
  ],
  "audio-bgm": [["81acb0", "Last.Interpreter.Instructions.Audio$$.cctor"]],
  "audio-bgm-reuse": [["495500", "Last.Management.AudioManager$$Stop"]],
  "audio-bgm-play": [
    ["491970", "Last.Management.Audio.AssetMasterInfo$$<.ctor>b__8_1"],
    ["493d30", "Last.Management.AudioManager$$Play"],
  ],
};
const methods = [],
  code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(
    await readFile(root + `build/native/${batch}/complete.json`, "utf8"),
  );
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const [address, name] of entries) {
    const rva = "0x" + address,
      number = Number(rva),
      aliases = symbols.ScriptMethod.filter((r) => r.Address === number);
    assert.equal(aliases.length, 1, "Unique exported signature: " + name);
    assert.equal(aliases[0].Name, name);
    const matches = receipt.methods.filter((r) => r.rva === rva);
    assert.equal(matches.length, 1, batch + ":" + rva);
    const method = matches[0],
      bytes = await readFile(root + `build/native/${batch}/${address}.c`);
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((n) => n > number),
    );
    assert.equal(sha(bytes), method.decompiledSha256);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method });
    code.set(address, bytes.toString());
  }
}
const rawMethods = [
  [
    "838910",
    "Last.Interpreter.Instructions.Audio.<>c__DisplayClass16_0$$<ReadyBGM>b__1",
  ],
  ["47bba0", "Last.Interpreter.Instructions.Audio.<>c$$<SyncBGM>b__28_1"],
  ["493040", "Last.Management.AudioManager$$<IsPlaying>b__36_0"],
  ["4a1830", "Last.Management.Audio.PlayInstance$$IsFinished"],
  ["4915e0", "Last.Management.Audio.AssetInstance$$get_isReady"],
  ["490a80", "Last.Management.Audio.AssetInstance$$Get"],
  ["4914b0", "Last.Management.Audio.AssetInstance$$.ctor"],
].map(([address, name]) => {
  const number = Number("0x" + address),
    aliases = symbols.ScriptMethod.filter((m) => m.Address === number);
  assert.equal(aliases.filter((m) => m.Name === name).length, 1);
  return {
    rva: "0x" + address,
    size: addresses.find((n) => n > number) - number,
    name,
    aliasCount: aliases.length,
  };
});
const ranges = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
  })),
  ...rawMethods,
];
const python = `import json,sys,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],16),r['size'])
 out.append(dict(r,sha256=hashlib.sha256(data).hexdigest(),hex=data.hex()))
print(json.dumps(out))`;
const raw = JSON.parse(
  execFileSync("python3", ["-c", python, root], {
    input: JSON.stringify(ranges),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }),
);
for (let i = 0; i < methods.length; i++)
  assert.equal(raw[i].sha256, methods[i].nativeRangeSha256, methods[i].rva);
const binary = (address) =>
  Buffer.from(raw.find((r) => r.rva === "0x" + address).hex, "hex");
function branches(address, opcode) {
  const data = binary(address),
    start = Number("0x" + address),
    targets = [];
  for (let i = 0; i < data.length - 4; i++)
    if (data[i] === opcode)
      targets.push(start + i + 5 + data.readInt32LE(i + 1));
  return targets;
}
function ripLoads(address) {
  const data = binary(address),
    start = Number("0x" + address),
    targets = [];
  for (let i = 0; i < data.length - 6; i++)
    if (
      [0x48, 0x4c].includes(data[i]) &&
      data[i + 1] === 0x8b &&
      (data[i + 2] & 0xc7) === 5
    )
      targets.push(start + i + 7 + data.readInt32LE(i + 3));
  return targets;
}
const metadata = [
  [
    0x2003a10,
    "Method$Last.Interpreter.Instructions.Audio.<>c.<ReadyBGM>b__16_0()",
    0x838610,
    "819670",
  ],
  [
    0x20158e0,
    "Method$Last.Interpreter.Instructions.Audio.<>c__DisplayClass16_0.<ReadyBGM>b__1()",
    0x838910,
    "819670",
  ],
  [
    0x2003998,
    "Method$Last.Interpreter.Instructions.Audio.<>c.<SyncBGM>b__28_0()",
    0x8386f0,
    "81a850",
  ],
  [
    0x20159d8,
    "Method$Last.Interpreter.Instructions.Audio.<>c.<SyncBGM>b__28_1()",
    0x47bba0,
    "81a850",
  ],
  [
    0x2000868,
    "Method$Last.Management.AudioManager.<IsPlaying>b__36_0()",
    0x493040,
    "493130",
  ],
];
const checks = [];
function check(name, body) {
  body();
  checks.push({ name, pass: true });
}
check(
  "wrapper delegates and shared aliases bind exact metadata identities",
  () => {
    for (const [address, name, target, caller] of metadata) {
      const rows = symbols.ScriptMetadataMethod.filter(
        (m) => m.Address === address,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].Name, name);
      assert.equal(rows[0].MethodAddress, target);
      assert.ok(ripLoads(caller).includes(address));
    }
    for (const rva of ["819670", "81a850"])
      assert.ok(branches(rva, 0xe8).includes(0x8194b0));
  },
);
check(
  "PollingCommon reads current immediate operand and returns Next0 or Repeat1 in the same call",
  () => {
    const c = code.get("8194b0");
    assert.match(
      c,
      /currentInstruction[\s\S]*operands[\s\S]*iValues[\s\S]*m_Items\[index\]/,
    );
    assert.match(c, /return \(uint\)\(cVar5 == '\\0'\)/);
    assert.ok(
      binary("8194b0").includes(
        Buffer.from("84c07507b801000000eb0233c0", "hex"),
      ),
    );
  },
);
check(
  "Ready getter reads iValues0 while Sync getter returns its argument unchanged",
  () => {
    const body = binary("838910");
    for (const hex of [
      "488b4110",
      "488b4048",
      "488b4020",
      "488b4010",
      "8b4020",
    ])
      assert.ok(body.includes(Buffer.from(hex, "hex")));
    assert.equal(binary("47bba0").subarray(0, 3).toString("hex"), "8bc2c3");
  },
);
check(
  "Ready queries BGM asset type2 without issuing an audio load or play",
  () => {
    assert.ok(branches("838610", 0xe9).includes(0x492780));
    assert.ok(binary("838610").includes(Buffer.from("418d5102", "hex")));
    assert.match(code.get("492780"), /AssetInstance__Get\(type,masterId/);
    assert.match(code.get("492780"), /offset \+ 10/);
    assert.equal(
      binary("4915e0").subarray(0, 8).toString("hex"),
      "837940020f94c0c3",
    );
    assert.doesNotMatch(code.get("492780"), /RequestLoad|__Play\(/);
  },
);
check(
  "asset lookup constructs an unready identity or reactivates an already cached asset",
  () => {
    assert.ok(binary("4914b0").includes(Buffer.from("33f6", "hex")));
    assert.ok(binary("4914b0").includes(Buffer.from("897740", "hex")));
    assert.ok(binary("490a80").includes(Buffer.from("895f40", "hex")));
    assert.ok(binary("490a80").includes(Buffer.from("c7474002000000", "hex")));
    for (const address of ["490a80", "4914b0"])
      for (const load of [0x494080, 0x494160, 0x494260, 0x4913a0])
        assert.equal(branches(address, 0xe8).includes(load), false);
    assert.match(code.get("491970"), /resident = false/);
  },
);
check(
  "Play owns the loading request and the later PlayOnLoad operation",
  () => {
    const c = code.get("493d30");
    assert.match(c, /RequestLoadAsset/);
    assert.match(c, /PlayOnLoad/);
    assert.ok(c.indexOf("RequestLoadAsset") < c.indexOf("PlayOnLoad"));
  },
);
check("two script channels map to source BGM channels0 and1", () => {
  const c = code.get("81acb0");
  assert.match(c, /BgmChannel___TypeInfo,2/);
  assert.match(c, /\+ 0x24\) = 1/);
  assert.ok(binary("81acb0").includes(Buffer.from("ba02000000", "hex")));
});
check("Sync re-reads the chosen BGM slot and negates IsPlaying", () => {
  assert.ok(branches("8386f0", 0xe8).includes(0x493210));
  assert.match(code.get("8386f0"), /handle \* 4/);
  assert.match(code.get("8386f0"), /return !bVar3/);
  assert.ok(binary("493210").includes(Buffer.from("488b5140", "hex")));
  assert.ok(branches("493210", 0xe9).includes(0x493130));
});
check(
  "static channel query excludes detached tails and returns false for an empty slot",
  () => {
    const c = code.get("493130");
    assert.match(c, /controller->fields\).channels/);
    assert.match(c, /m_Items\[channel\] ==[\s\S]*uVar4 = false/);
    assert.doesNotMatch(c, /controller->fields\).super.instances/);
  },
);
check(
  "IsPlaying means nonnull and not Finished; loading and paused are not completion",
  () => {
    assert.ok(binary("493040").includes(Buffer.from("b902000000", "hex")));
    assert.ok(binary("493040").includes(Buffer.from("84c00f94c0", "hex")));
    assert.equal(
      binary("4a1830").subarray(0, 8).toString("hex"),
      "837928040f94c0c3",
    );
  },
);
check(
  "Stop transfers the current voice into the tail collection and clears its channel immediately",
  () => {
    assert.ok(branches("495500", 0xe9).includes(0x4a29b0));
    const c = code.get("495500");
    assert.match(c, /super.instances/);
    assert.match(
      c,
      /m_Items\[channel\] = \(Last_Management_Audio_PlayInstance_o \*\)0x0/,
    );
  },
);
const report = {
  formatVersion: 1,
  kind: "source-audio-readiness-native-check",
  nativeSha256,
  symbolsSha256,
  headerSha256,
  semanticsVerified: false,
  methods,
  rawRanges: raw.map(({ hex, ...r }) => r),
  metadata: metadata.map(([address, name, target, caller]) => ({
    address,
    name,
    target,
    caller,
  })),
  checks,
  limitations: [
    "Static DLL/metadata checks only; no original-runtime timing or audible comparison.",
    "The Web owner uses validated sample geometry and a logical clock; browser decode readiness is a separate host observation.",
  ],
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, bytes);
console.log(
  JSON.stringify(
    {
      exportedMethods: methods.length,
      rawRanges: raw.length,
      checks: checks.length,
      reportSha256: sha(bytes),
      reportPath,
    },
    null,
    2,
  ),
);
