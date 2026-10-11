// Re-read exact local DLL ranges and complete native exports. These are static
// source checks; no report from an earlier run supplies validation results.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nativeSha256 =
  "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 =
  "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 =
  "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const reportPath = root + "build/reports/source-presentation-native-check.json";
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
  "v19-transport-prelude": [
    [
      "295520",
      "Last.Interpreter.Instructions.SystemCall.Current$$SetAdvertisementFlag",
    ],
  ],
  "v27-advertisement": [
    [
      "2920c0",
      "Last.Interpreter.Instructions.SystemCall.Current$$ReturnToTitleByAdvertisement",
    ],
    ["ae8f30", "Last.FF6.Demo.Advertisement$$Update"],
    ["ae8be0", "Last.FF6.Demo.Advertisement$$<Update>b__48_0"],
    ["ae8c60", "Last.FF6.Demo.Advertisement$$<Update>b__48_1"],
    ["ae75c0", "Last.FF6.Demo.AdvertisementOpeningFader$$Setup"],
    ["ae76d0", "Last.FF6.Demo.AdvertisementOpeningFader$$Update"],
    ["ae7600", "Last.FF6.Demo.AdvertisementOpeningFader$$<Update>b__6_0"],
    ["afb260", "Last.FF6.Demo.AdvertisementOpeningFader.<Fade>d__7$$MoveNext"],
    ["ae74e0", "Last.FF6.Demo.AdvertisementOpeningFader$$Destroy"],
  ],
  "v27-title-entry": [
    ["ae7c50", "Last.FF6.Demo.Advertisement$$Start"],
    ["8b4e30", "Last.UI.KeyInput.TitleWindowController$$PlayOpening"],
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
      number = Number(rva);
    const aliases = symbols.ScriptMethod.filter((r) => r.Address === number);
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
  ["409ff0", "Last.Interpreter.Core$$get_Next"],
  ["3750c0", "Last.Interpreter.Core$$get_End"],
].map(([address, name]) => {
  const number = Number("0x" + address);
  assert.equal(
    symbols.ScriptMethod.filter((m) => m.Address === number && m.Name === name)
      .length,
    1,
  );
  return {
    rva: "0x" + address,
    size: addresses.find((n) => n > number) - number,
    name,
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
    0x1fd7540,
    "Method$System.SingletonMonoBehaviour<SystemIndicator>.get_Instance()",
  ],
  [
    0x1fc0ce8,
    "Method$UnityEngine.GameObject.GetComponentInChildren<AdvertisementOpeningFader>()",
  ],
  [
    0x1fc4258,
    "Method$UnityEngine.GameObject.GetComponent<AdvertisementOpeningFader>()",
  ],
  [
    0x1fd3cd8,
    "Method$Last.FF6.Demo.AdvertisementOpeningFader.<Update>b__6_0()",
  ],
  [0x1fd3d30, "Method$Last.FF6.Demo.Advertisement.<Update>b__48_1()"],
];
for (const [address, name] of metadata)
  assert.equal(
    symbols.ScriptMetadataMethod.filter(
      (m) => m.Address === address && m.Name === name,
    ).length,
    1,
  );
assert.equal(
  symbols.ScriptString.filter(
    (m) =>
      m.Address === 0x1fdbfb0 &&
      m.Value === "root/AspectFilterCanvas/SystemIndicator",
  ).length,
  1,
);
const checks = [];
function check(name, body) {
  body();
  checks.push({ name, pass: true });
}
check(
  "probe resolves exact SystemIndicator child and fader generic identity",
  () => {
    const refs = ripLoads("295520");
    for (const address of [0x1fd7540, 0x1fdbfb0, 0x1fc0ce8])
      assert.ok(refs.includes(address));
    assert.ok(branches("295520", 0xe8).includes(0x959030));
  },
);
check(
  "probe writes map-local 7 only for a present component and returns Next without waiting",
  () => {
    const c = code.get("295520");
    assert.match(c, /if \(bVar2\)[\s\S]*DataStorage__Set\(__this_01,10,7,1,/);
    assert.equal((c.match(/DataStorage__Set\(/g) ?? []).length, 1);
    assert.ok(branches("295520", 0xe9).includes(0x409ff0));
    assert.equal(binary("409ff0").subarray(0, 3).toString("hex"), "33c0c3");
  },
);
check(
  "title return orders nullable-color fade, GotoTitle and Stop, then ends the interpreter",
  () => {
    const c = code.get("2920c0"),
      names = [
        "FadeManager__FadeOut(__this_02,2.0",
        "MainGame__ChangeState(__this_01,0xe",
        "DetectionScriptInputClient__Stop",
        "return 2",
      ];
    const offsets = names.map((n) => c.indexOf(n));
    assert.ok(
      offsets.every((n, i) => n >= 0 && (i === 0 || n > offsets[i - 1])),
    );
    assert.match(c, /has_value = false/);
    assert.equal(
      binary("3750c0").subarray(0, 6).toString("hex"),
      "b802000000c3",
    );
  },
);
check(
  "fader setup disables overlay, button and script-input registration",
  () => {
    const c = code.get("ae75c0");
    assert.match(c, /set_enabled[\s\S]*false/);
    assert.match(c, /set_interactable[\s\S]*false/);
    assert.match(c, /isStartedScriptInputClient = false/);
  },
);
check(
  "fader waits for a live main script and input manager before registering skip callback once",
  () => {
    const c = code.get("ae76d0");
    assert.match(c, /isStartedScriptInputClient == false/);
    assert.ok(
      c.indexOf("IsMainCoreAlive") <
        c.indexOf("DetectionScriptInputClient__Start"),
    );
    assert.match(c, /if \(!bVar2\)/);
    assert.match(c, /isStartedScriptInputClient = true/);
    assert.ok(ripLoads("ae76d0").includes(0x1fd3cd8));
  },
);
check(
  "raw skip callback continues beyond Ghidra PIC truncation into StartCoroutine and Stop",
  () => {
    assert.match(code.get("ae7600"), /Possible PIC construction/);
    assert.ok(branches("ae7600", 0xe8).includes(0x1005650));
    assert.ok(branches("ae7600", 0xe9).includes(0xaaebc0));
  },
);
check(
  "skip coroutine accumulates deltaTime for two seconds then changes title, purges scripts and seals fade",
  () => {
    const c = code.get("afb260");
    assert.match(c, /fVar16 < 2\.0/);
    assert.match(c, /Mathf__Lerp\(0\.0,1\.0,fVar16 \* 0\.5/);
    assert.ok(c.indexOf("Mathf__Lerp") < c.indexOf("Time__get_deltaTime"));
    assert.match(c, /iVar11 != 0xe/);
    for (const name of [
      "MainGame__ChangeState",
      "Integrator__Purge",
      "FadeManager__FadeOut(__this_05,0.0",
    ])
      assert.ok(c.includes(name));
  },
);
check(
  "title Start clears an old fader independently of fresh map content",
  () => {
    const refs = ripLoads("ae7c50"),
      c = code.get("ae7c50");
    for (const address of [0x1fd7540, 0x1fdbfb0, 0x1fc0ce8])
      assert.ok(refs.includes(address));
    assert.match(c, /UnityEngine_Object__Destroy\(pUVar28,/);
    assert.ok(branches("ae7c50", 0xe8).includes(0x10061c0));
  },
);
check(
  "only completed attract sequence callback starts opening and creates the fader",
  () => {
    const c = code.get("ae8c60");
    assert.match(c, /if \(72\.2 < \(__this->fields\)\.adv_time\)/);
    assert.match(c, /FUN_18004f780\(8\)/); // ITitleWindowForAdvertisement.PlayOpening slot 8.
    assert.match(c, /advertisementOpeningFaderPrefab/);
    assert.ok(ripLoads("ae8c60").includes(0x1fc4258));
    assert.match(c, /\*\(undefined1 \*\)\(lVar13 \+ 0x28\) = 0/);
    assert.ok(ripLoads("ae8f30").includes(0x1fd3d30));
  },
);
check(
  "title PlayOpening explicitly marks advertisement origin and selects NewGame state four",
  () => {
    assert.match(code.get("8b4e30"), /startedNewGameFromAdvertisement = true/);
    assert.ok(binary("8b4e30").includes(Buffer.from("c6838100000001", "hex")));
    assert.ok(binary("8b4e30").includes(Buffer.from("ba04000000", "hex")));
  },
);
const report = {
  formatVersion: 1,
  status: "pass",
  kind: "source-presentation-native-static-check",
  nativeSha256,
  symbolsSha256,
  headerSha256,
  semanticsVerified: false,
  methods,
  rawMethods: raw.slice(methods.length).map(({ hex: _, ...r }) => r),
  metadata: metadata.map(([address, name]) => ({
    address: "0x" + address.toString(16),
    name,
  })),
  checks,
  limitations: [
    "Static native source interpretation, not original-game execution or timing acceptance.",
    "The active advertisement input callback and coroutine are researched but not a complete Web title/demo host.",
    "Ordinary absence is valid only after actual title cleanup without an advertisement opening callback.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    status: report.status,
    methods: methods.length,
    rawRanges: raw.length,
    checks: checks.length,
    report: reportPath,
  }),
);
