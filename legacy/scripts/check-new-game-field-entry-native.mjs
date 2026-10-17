// Static source evidence only. Re-read original PE ranges; an old report is not
// accepted as proof and no original executable is loaded or run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  output = root + "build/reports/new-game-field-entry-native-check.json",
  sha = (value) => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256:
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256:
    "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256:
    "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
for (const [key, file] of Object.entries({
  nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json",
  headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
}))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(
    await readFile(root + "build/native/il2cpp/script.json", "utf8"),
  ),
  addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort(
    (a, b) => a - b,
  );
const batches = {
  "v26-new-game-entry": [
    ["655040", "Serial.FF6.UI.KeyInput.NewGameWindowController$$InitSelect"],
    ["655510", "Serial.FF6.UI.KeyInput.NewGameWindowController$$UpdateSelect"],
  ],
  "v30-field-factories-complete": [
    [
      "8b69d0",
      "Last.UI.KeyInput.TitleWindowController.<SubSceneLoadingWait>d__21$$MoveNext",
    ],
    ["439720", "MainGame$$CreateInstance"],
    ["448730", "MainGame.<SubSceneLoadingWait>d__24$$MoveNext"],
    ["43aca0", "MainGame$$Update"],
  ],
  "v30-field-entry": [
    ["38eeb0", "FieldMap$$InitChangeMap"],
    ["155fc10", "FieldMap.<StartFadeIn>d__64$$MoveNext"],
  ],
  "v19-transport-lifecycle": [
    ["155ed20", "FieldMap.<InitSetup>d__48$$MoveNext"],
  ],
  "map-script-entry": [
    ["58a910", "Last.Map.FieldController.<LastSettings>d__199$$MoveNext"],
  ],
  "map-event-entry": [["2ccac0", "Last.Map.EventProcedure$$EventRunScript"]],
  "event-operators": [["5f2530", "Last.Interpreter.Integrator$$Execute"]],
  "v29-event-camera": [["7ad6c0", "Last.Map.EventActionScript$$RunScript"]],
  "v28-visibility-fade-host": [
    ["b02b60", "System.Fade.FadeManager$$FadeOut"],
    ["b03080", "System.Fade.FadeManager$$Update"],
  ],
};
const methods = [],
  code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(
    await readFile(root + `build/native/${batch}/complete.json`, "utf8"),
  );
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false);
  for (const [key, expected] of Object.entries(identity))
    assert.equal(receipt[key], expected);
  for (const [hex, name] of entries) {
    const rva = "0x" + hex,
      address = Number(rva),
      aliases = symbols.ScriptMethod.filter((m) => m.Address === address);
    assert.equal(aliases.length, 1, name);
    assert.equal(aliases[0].Name, name);
    const entries = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(entries.length, 1, batch + ":" + rva);
    const method = entries[0],
      body = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((a) => a > address),
    );
    assert.equal(sha(body), method.decompiledSha256);
    assert.ok(body.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method });
    code.set(hex, body.toString());
  }
}
const rawSpecs = [
  ["8b5790", "Last.UI.KeyInput.TitleWindowController$$SubSceneLoadingWait"],
  ["b02f70", "System.Fade.FadeManager$$IsStateFadeOut"],
  ["302cf0", "Last.Map.MapLoadProcessor$$Update"],
  ["2e37a0", "Last.Map.FieldController$$LoadMapInit"],
  ["5f4e10", "Last.Interpreter.Integrator$$ReserveScript"],
  ["2ce0f0", "Last.Map.EventProcedure$$Init"],
  ["705f50", "Last.Management.SceneManager$$ChangeScene"],
  ["38dda0", "FieldMap$$CreateInstance"],
  ["38f790", "FieldMap$$InitFieldComplete"],
  ["2c8ef0", "Last.UI.KeyInput.TitleWindowController$$SetTitleFadeCallback"],
].map(([hex, name]) => {
  const address = Number("0x" + hex);
  assert.equal(
    symbols.ScriptMethod.filter((m) => m.Address === address && m.Name === name)
      .length,
    1,
  );
  return {
    rva: "0x" + hex,
    size: addresses.find((a) => a > address) - address,
    name,
  };
});
const ranges = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
  })),
  ...rawSpecs,
];
const python = `import json,sys,hashlib
from pathlib import Path
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=Cs(CS_ARCH_X86,CS_MODE_64)
out=[]
for r in json.load(sys.stdin):
 _,_,data=p.read(int(r['rva'],16),r['size'])
 ops=[dict(address=i.address,size=i.size,mnemonic=i.mnemonic,op=i.op_str) for i in cs.disasm(data,int(r['rva'],16))]
 out.append(dict(r,sha256=hashlib.sha256(data).hexdigest(),instructions=ops))
print(json.dumps(out))`;
const raw = JSON.parse(
  execFileSync(root + ".venv/bin/python", ["-c", python, root], {
    input: JSON.stringify(ranges),
    encoding: "utf8",
    maxBuffer: 12 * 1024 * 1024,
  }),
);
for (let i = 0; i < methods.length; i++)
  assert.equal(raw[i].sha256, methods[i].nativeRangeSha256, methods[i].rva);
const ops = (hex) => raw.find((r) => r.rva === "0x" + hex).instructions,
  calls = (hex) =>
    ops(hex)
      .filter(
        (i) =>
          ["call", "jmp"].includes(i.mnemonic) && /^0x[\da-f]+$/.test(i.op),
      )
      .map((i) => Number(i.op)),
  references = (hex) =>
    ops(hex)
      .filter((i) => /\[rip \+ 0x[\da-f]+\]/.test(i.op))
      .map(
        (i) =>
          i.address + i.size + Number(i.op.match(/\[rip \+ (0x[\da-f]+)\]/)[1]),
      );
function ordered(values, expected) {
  let from = 0;
  for (const value of expected) {
    const at = values.indexOf(value, from);
    assert.ok(at >= from, "Missing ordered value: " + value);
    from = at + 1;
  }
}
function metadata(address, expected) {
  assert.equal(
    symbols.ScriptMetadataMethod.filter(
      (m) => m.Address === address && m.Name === expected,
    ).length,
    1,
    expected,
  );
}
const checks = [];
function check(name, body) {
  body();
  checks.push({ name, pass: true });
}
check(
  "InitSelect performs data initialization then BGM stop and explicit black half-second fade before map preload",
  () => {
    const c = code.get("655040");
    ordered(c, [
      "UserDataManager__Initialize",
      "DataInitializeManager__Create",
      "AudioManager__Stop",
      "get_black",
      "FadeManager__FadeOut",
      "Last_Map_LoadData__RestoreSaveData",
    ]);
    assert.match(c, /AudioManager__Stop\([^;]*,0,2\.0,/);
    assert.match(c, /FadeManager__FadeOut\([^;]*,0\.5,/);
    const initialize = symbols.ScriptMethod.find(
      (m) => m.Name === "Last.Management.UserDataManager$$Initialize",
    );
    ordered(calls("655040"), [initialize.Address, 0xb02b60]);
  },
);
check(
  "UpdateSelect advances map loading before checking exact fade completion and starts one coroutine with useFade false",
  () => {
    ordered(
      calls("655510"),
      [0x302cf0, 0xb02f70, 0x8b5450, 0x8b5790, 0x1005650],
    );
    const c = code.get("655510");
    assert.match(c, /fields\)\.fade != false/);
    assert.match(c, /SubSceneLoadingWait\s*\(pLVar1,false,/);
    assert.match(c, /fields\)\.fade = true/);
    assert.ok(ops("8b5790").some((i) => i.op === "byte ptr [rbx + 0x20], sil"));
  },
);
check(
  "ordinary subscene request keeps useFade false and does not rerun the optional two-second fade",
  () => {
    const c = code.get("8b69d0");
    assert.match(
      c,
      /if \(\(__this->fields\)\.useFade != false\)[\s\S]*FadeManager__FadeOut\(pSVar9,2\.0/,
    );
    metadata(
      0x1fceea0,
      "Method$Last.Management.SceneManager.RequestLoadScene<SubSceneManagerMainGame>()",
    );
    assert.ok(references("8b69d0").includes(0x1fceea0));
    assert.match(c, /startedNewGameFromAdvertisement != false/);
    assert.match(c, /RequestLoadScene[\s\S]*__1__state = 1;\s*return true/);
  },
);
check(
  "scene request yields, waits real loading, checks fade again, activates, then destroys old title on a later resume",
  () => {
    const c = code.get("8b69d0");
    assert.match(
      c,
      /case 1:\s*case 2:[\s\S]*CheckSceneLoadingCompleted[\s\S]*__1__state = 2/,
    );
    assert.match(c, /case 3:\s*\(__this->fields\)\.__1__state = -1;\s*break/);
    assert.match(c, /IsStateFadeOut[\s\S]*__1__state = 3/);
    assert.match(c, /ChangeScene_705f50\(pLVar10,0\)[\s\S]*__1__state = 4/);
    assert.match(c, /case 4:[\s\S]*_8_Destroy[\s\S]*__1__state = 5/);
  },
);
check(
  "fade completion compares CanvasRenderer alpha to Image alpha and does not inspect elapsed time",
  () => {
    assert.ok(calls("b02f70").includes(0x1530860));
    assert.ok(
      ops("b02f70").some(
        (i) =>
          i.mnemonic === "ucomiss" && i.op === "xmm6, dword ptr [rax + 0xc]",
      ),
    );
    assert.ok(!calls("b02f70").includes(0x12e9710));
  },
);
check(
  "MainGame creation truncated by Ghidra is checked from raw calls and does not reset the global fade",
  () => {
    assert.match(code.get("439720"), /Possible PIC construction/);
    assert.ok(calls("439720").includes(0x2ce0f0));
    const creation = references("439720");
    for (const type of [
      "MainGame.<LoadSubScene>d__23_TypeInfo",
      "MainGame.<SubSceneLoadingWait>d__24_TypeInfo",
      "MainGame.<LateLoadSubScenes>d__25_TypeInfo",
    ]) {
      const found = symbols.ScriptMetadata.filter((m) => m.Name === type);
      assert.equal(found.length, 1);
      assert.ok(creation.includes(found[0].Address));
    }
    for (const address of [0xb02cf0, 0xb02b60, 0xb02c00, 0xb029e0, 0xb02ad0])
      assert.ok(!calls("439720").includes(address));
    assert.ok(
      ops("705f50").some(
        (i) => i.mnemonic === "call" && i.op === "qword ptr [rax + 0x170]",
      ),
    );
  },
);
check(
  "main scene waits first-scene initialization before state1 and runs resident tasks before field/event updates",
  () => {
    const c = code.get("448730");
    ordered(c, [
      "CheckFirstLoadSceneCompleted",
      "ProgressMonitor__Start",
      "SubSceneManagerMainGame__ChangeState(pLVar11,1",
    ]);
    ordered(calls("43aca0"), [0x8646f0, 0x712650, 0x2cf3c0]);
    assert.ok(calls("38f790").includes(0x43a890));
  },
);
check(
  "Field InitSetup yields and waits UI before restoring LoadData and reserving its explicit script",
  () => {
    const c = code.get("155ed20");
    assert.match(c, /iVar11 == 0[\s\S]*__1__state = 1;\s*return true/);
    ordered(c, [
      "Last_Map_FieldController__ConnectUI",
      "Last_Map_LoadData__RestoreSaveData",
      "fields).nextMap",
      "Last_Interpreter_Integrator__ReserveScript",
    ]);
    assert.match(c, /ReserveScript[\s\S]*_ScriptName_k__BackingField/);
    assert.ok(
      ops("5f4e10").some(
        (i) => i.mnemonic === "cmp" && i.op === "qword ptr [rdi + 0x70], 0",
      ),
    );
    assert.ok(
      ops("5f4e10").some(
        (i) => i.mnemonic === "lea" && i.op === "rcx, [rdi + 0x70]",
      ),
    );
  },
);
check(
  "first map loads MapInitialize then MapSetup and MapViewSetup before LastSettings",
  () => {
    assert.deepEqual(
      calls("2e37a0").filter((a) => [0x2e39a0, 0x2e3d30, 0x2e6fe0].includes(a)),
      [0x2e39a0, 0x2e3d30, 0x2e6fe0],
    );
    const refs = references("38eeb0");
    metadata(0x1ffbca8, "Method$Last.Map.FieldController.LoadMapInit()");
    assert.ok(refs.includes(0x1ffbca8));
    assert.match(
      code.get("38eeb0"),
      /pLVar8 == \(Last_Map_LoadData_o \*\)0x0\) \{\s*isFirst = true/,
    );
  },
);
check(
  "automatic entities/BGM/fade/title live inside a separate branch passed to LastSettings",
  () => {
    const c = code.get("38eeb0");
    ordered(c, [
      "_FieldMap__ReadyToShowMap_d__69_TypeInfo",
      "_FieldMap__MapReady_d__67_TypeInfo",
      "Last_Map_FieldController__PlayBgmOrLoad",
      "FieldMap__StartFadeIn",
      "Last_Map_FieldController__LastSettings",
    ]);
    assert.match(c, /FieldMap__StartFadeIn\s*\(__this,0\.5,isFirst,/);
    assert.match(c, /LastSettings\s*\(pLVar3,pLVar11,/);
    assert.match(
      code.get("155fc10"),
      /FUN_18004f780\(0x22,_Last_Map_IEventAccessor_TypeInfo/,
    );
  },
);
check(
  "reserved script is tried first with both scene-change flags and discards fallback after completion",
  () => {
    const c = code.get("58a910");
    assert.match(
      c,
      /RunScript\s*\(pLVar11,\(System_String_o \*\)0x0,true,true,/,
    );
    assert.match(
      c,
      /if \(!bVar7\)[\s\S]*GetMapScriptName[\s\S]*RunScript\s*\(pLVar11,scriptName,false,false,/,
    );
    assert.match(c, /_ScriptFinished_k__BackingField == false/);
    const tail = c.slice(
      c.lastIndexOf("pLVar11 = (__this->fields)._scriptAction_5__2;"),
    );
    ordered(tail, [
      "_ScriptFinished_k__BackingField",
      "branchTask",
      "TaskMachine__Destroy",
      "SetupEncountData",
    ]);
  },
);
check(
  "null EventRunScript reaches the reserved-script loader and consumes the reservation only there",
  () => {
    assert.match(
      code.get("2ccac0"),
      /System_String__IsNullOrEmpty\(scriptName/,
    );
    assert.match(
      code.get("2ccac0"),
      /Integrator__Execute\(pLVar9,json,callbacks,true/,
    );
    const c = code.get("5f2530");
    assert.match(c, /reservedScript == \(System_String_o \*\)0x0/);
    ordered(c, [
      "reservedScript",
      "Integrator__SetScriptName",
      "reservedScript = (System_String_o *)0x0",
    ]);
    assert.match(code.get("7ad6c0"), /if \(startChangeState\)/);
  },
);
check(
  "fade callbacks remain independent and KeyInput title registers no title-fade callback",
  () => {
    const c = code.get("b03080");
    assert.match(c, /fadeInFinishedCallback[\s\S]*fadeOutFinishedCallback/);
    assert.doesNotMatch(code.get("b02b60"), /FinishedCallback/);
    assert.equal(ops("2c8ef0")[0].mnemonic, "ret");
  },
);

const report = {
  formatVersion: 1,
  kind: "new-game-field-entry-native-check",
  ...identity,
  semanticsVerified: false,
  execution: "static-original-PE-and-decompiler-checks",
  methods,
  rawMethods: rawSpecs.map((r) => ({
    ...r,
    sha256: raw.find((v) => v.rva === r.rva).sha256,
  })),
  checks,
  limitations: [
    "No native execution or original-game audiovisual timing comparison.",
    "Ghidra CreateInstance output is incomplete; only recorded raw call/metadata assertions are admitted.",
    "Initial serialized prefab colors and callbacks are not inferred; the runtime requires an explicit active callback-free host.",
  ],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    methods: methods.length,
    rawMethods: rawSpecs.length,
    checks: checks.length,
    semanticsVerified: false,
  }),
);
