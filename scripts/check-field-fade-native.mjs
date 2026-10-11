// Static PE evidence only. Never loads or executes the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  output = root + "build/reports/field-fade-native-check.json",
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
  "v28-opening-primitives": [
    ["b4ba80", "Last.Interpreter.Instructions.External.Fader$$FadeIn"],
    ["b4bc60", "Last.Interpreter.Instructions.External.Fader$$FadeOut"],
  ],
  "v28-fader": [
    ["b4be40", "Last.Interpreter.Instructions.External.Fader$$FaderCommon"],
    [
      "b543e0",
      "Last.Interpreter.Instructions.External.Fader.<>c$$<FadeIn>b__9_0",
    ],
    [
      "b54470",
      "Last.Interpreter.Instructions.External.Fader.<>c$$<FadeIn>b__9_1",
    ],
    [
      "b544e0",
      "Last.Interpreter.Instructions.External.Fader.<>c$$<FadeOut>b__7_0",
    ],
    [
      "b54570",
      "Last.Interpreter.Instructions.External.Fader.<>c$$<FadeOut>b__7_1",
    ],
  ],
  "v28-visibility-fade-host": [
    ["b029e0", "System.Fade.FadeManager$$FadeIn"],
    ["b02ad0", "System.Fade.FadeManager$$FadeIn"],
    ["b02c00", "System.Fade.FadeManager$$FadeOut"],
    ["b02b60", "System.Fade.FadeManager$$FadeOut"],
    ["b02cf0", "System.Fade.FadeManager$$Initialize"],
    ["b03080", "System.Fade.FadeManager$$Update"],
  ],
  "v29-field-hosts": [
    ["de3c00", "UnityEngine.UI.Graphic$$CrossFadeAlpha"],
    ["de3d10", "UnityEngine.UI.Graphic$$CrossFadeColor"],
    ["de6bc0", "UnityEngine.UI.Graphic$$set_color"],
    ["c3870", "UnityEngine.UI.CoroutineTween.ColorTween$$TweenValue"],
    [
      "146d8f0",
      "UnityEngine.UI.CoroutineTween.TweenRunner<ColorTween>$$StartTween",
    ],
    [
      "146ddf0",
      "UnityEngine.UI.CoroutineTween.TweenRunner.<Start>d__2<ColorTween>$$MoveNext",
    ],
    ["b031d0", "System.Fade.FadeManager$$.cctor"],
    ["dea630", "UnityEngine.UI.Image$$GenerateSimpleSprite"],
  ],
  "v26-new-game-entry": [
    ["655040", "Serial.FF6.UI.KeyInput.NewGameWindowController$$InitSelect"],
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
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].Name, name);
    const entries = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(entries.length, 1);
    const method = entries[0],
      body = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((a) => a > address),
    );
    assert.equal(sha(body), method.decompiledSha256);
    assert.ok(body.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method });
    code.set(rva, body.toString());
  }
}
const rawSpecs = [
  ["b02f30", "System.Fade.FadeManager$$IsStateFadeIn"],
  ["b02f70", "System.Fade.FadeManager$$IsStateFadeOut"],
  [
    "146dc60",
    "UnityEngine.UI.CoroutineTween.TweenRunner<ColorTween>$$StopTween",
  ],
  ["fc4d70", "UnityEngine.Color$$Lerp"],
  ["fc5110", "UnityEngine.Color$$get_black"],
  ["fc4860", "UnityEngine.Color32$$op_Implicit"],
  ["fc4970", "UnityEngine.Color32$$op_Implicit"],
  ["ffb170", "UnityEngine.Mathf$$Clamp01"],
  ["34c9f0", "Last.Interpreter.Core$$get_Blank"],
  ["409ff0", "Last.Interpreter.Core$$get_Next"],
].map(([hex, name]) => {
  const rva = "0x" + hex,
    address = Number(rva);
  assert.equal(
    symbols.ScriptMethod.filter((m) => m.Address === address && m.Name === name)
      .length,
    1,
  );
  return { rva, name, size: addresses.find((a) => a > address) - address };
});
// Direct native helpers have no ScriptMethod entry; callers and layouts below bind their actual role.
const helperSpecs = [
  {
    rva: "0xc2eb40",
    size: 0x100,
    role: "unboxed Alpha ColorTween, called by MoveNext",
  },
  {
    rva: "0xfc4be0",
    size: 0x80,
    role: "unboxed Color.Equals, called by CrossFadeColor",
  },
  {
    rva: "0x108e3d0",
    size: 0x40,
    role: "Single.Equals, called by Color.Equals",
  },
  {
    rva: "0x50c20",
    size: 0xc0,
    role: "float round-to-even, called by Color32 conversion",
  },
  {
    rva: "0x239e78",
    size: 0xe0,
    role: "fraction/integral split used by round-to-even",
  },
  {
    rva: "0x239fe0",
    size: 0x80,
    role: "float floor used for non-half positive colors",
  },
];
const ranges = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
  })),
  ...rawSpecs,
  ...helperSpecs,
];
const python = String.raw`import json,sys,hashlib,struct,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True;out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size']);ins=[];constants=[]
 for i in md.disasm(data,int(r['rva'],0)):
  ins.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str))
  for o in i.operands:
   if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP and o.size in [4,8] and i.mnemonic in ['movss','movsd','addss','ucomisd','divss']:
    address=i.address+i.size+o.mem.disp;b=p.read(address,o.size)[2]
    constants.append(dict(instruction=hex(i.address),rva=hex(address),hex=b.hex(),value=struct.unpack('<f' if o.size==4 else '<d',b)[0]))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),hex=data.hex(),instructions=ins,constants=constants))
print(json.dumps(out))`;
const native = JSON.parse(
  execFileSync(root + ".venv/bin/python", ["-c", python, root], {
    input: JSON.stringify(ranges),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }),
);
for (const [i, method] of methods.entries())
  assert.equal(native[i].sha256, method.nativeRangeSha256);
const range = (rva) => native.find((r) => r.rva === rva),
  has = (rva, mnemonic, operands) =>
    assert.ok(
      range(rva).instructions.some(
        (i) => i.mnemonic === mnemonic && i.operands === operands,
      ),
      `${rva} ${mnemonic} ${operands}`,
    ),
  call = (rva, address) => has(rva, "call", address),
  c = (rva) => code.get(rva),
  checks = [];
function check(name, fn) {
  fn();
  checks.push({ name, pass: true });
}
check(
  "first interpreter clock starts and later clocks observe the current shared host",
  () => {
    for (const rva of ["0xb4ba80", "0xb4bc60"]) {
      assert.match(c(rva), /_clockCount_k__BackingField/);
      assert.match(c(rva), /mc,iVar1 == 1/);
      call(rva, "0xb4be40");
    }
    assert.match(c("0xb4be40"), /if \(!set\)[\s\S]*System_Func_bool___Invoke/);
    has("0x34c9f0", "mov", "eax, 1");
    has("0x409ff0", "xor", "eax, eax");
  },
);
check(
  "source RGBA divides int32 channels by 255 and negative float32 duration means asynchronous",
  () => {
    const body = c("0xb4be40");
    for (const index of [0, 1, 2, 3])
      assert.match(body, new RegExp(`m_Items\\[${index}\\]`));
    assert.match(body, /\(float\)iVar5 \/ 255\.0/);
    assert.match(body, /\(float\)pSVar2->m_Items\[0\]/);
    assert.match(body, /arg1 < 0\.0[\s\S]*arg1 = -arg1;[\s\S]*bVar4 = true/);
    assert.match(
      body,
      /if \(bVar4 == false\)[\s\S]*0x00018034c9f0[\s\S]*0x000180409ff0/,
    );
    assert.ok(
      range("0xb4be40").instructions.some(
        (i) => i.mnemonic === "cvtpd2ps" && i.operands === "xmm6, xmm6",
      ),
    );
  },
);
check(
  "nullable FadeIn keeps Image.color while nullable FadeOut uses black",
  () => {
    assert.match(c("0xb029e0"), /has_value == false[\s\S]*_22_get_color/);
    assert.match(
      c("0xb02c00"),
      /has_value == false[\s\S]*UnityEngine_Color__get_black/,
    );
    for (const rva of ["0xb029e0", "0xb02ad0", "0xb02c00", "0xb02b60"])
      assert.match(c(rva), /_23_set_color[\s\S]*_49_CrossFadeAlpha/);
  },
);
check(
  "completion compares canvas alpha with zero or current Image.color alpha exactly",
  () => {
    has("0xb54470", "jmp", "0xb02f30");
    has("0xb54570", "jmp", "0xb02f70");
    has("0xb02f30", "mov", "rcx, qword ptr [rcx + 0x28]");
    has("0xb02f30", "ucomiss", "xmm0, xmm1");
    has("0xb02f70", "mov", "rdx, qword ptr [rbx + 0x20]");
    has("0xb02f70", "ucomiss", "xmm6, dword ptr [rax + 0xc]");
  },
);
check("Graphic color is vertex data, independent from the canvas tween", () => {
  assert.match(c("0xde6bc0"), /SetColor[\s\S]*m_Color[\s\S]*SetVerticesDirty/);
  assert.match(
    c("0xdea630"),
    /_22_get_color[\s\S]*Color32__op_Implicit[\s\S]*VertexHelper__AddVert/,
  );
});
check(
  "CrossFadeAlpha uses black target RGB and Alpha-only interpolation",
  () => {
    call("0xde3c00", "0xfc5110");
    has("0xde3c00", "mov", "byte ptr [rsp + 0x28], 0");
    has("0xde3c00", "mov", "byte ptr [rsp + 0x20], 1");
    assert.match(c("0xde3d10"), /iVar7 = 2 - \(uint\)useRGB/);
    has("0xc2eb40", "cmp", "eax, 2");
    for (const [reg, offset] of [
      ["xmm3", "8"],
      ["xmm2", "0xc"],
      ["xmm1", "0x10"],
    ])
      has("0xc2eb40", "movss", `${reg}, dword ptr [rbx + ${offset}]`);
  },
);
check(
  "replacement stops the previous coroutine and full-color equality can stop without starting",
  () => {
    call("0xde3d10", "0xfc4be0");
    call("0xde3d10", "0x146dc60");
    call("0xde3d10", "0x146d8f0");
    assert.match(
      c("0x146d8f0"),
      /StopTween[\s\S]*get_activeInHierarchy[\s\S]*StartCoroutine/,
    );
    call("0x146dc60", "0x1005a30");
    has("0x146dc60", "mov", "qword ptr [rbx], 0");
    assert.equal(
      range("0xfc4be0").instructions.filter(
        (i) => i.mnemonic === "call" && i.operands === "0x108e3d0",
      ).length,
      4,
    );
    has("0x108e3d0", "ucomiss", "xmm1, xmm0");
  },
);
check(
  "MoveNext adds scaled delta in float32 before its sample and yields once after reaching duration",
  () => {
    assert.match(
      c("0x146ddf0"),
      /m_Duration <= fVar7[\s\S]*FUN_180c2eb40[\s\S]*return false/,
    );
    assert.match(
      c("0x146ddf0"),
      /m_IgnoreTimeScale == false[\s\S]*get_deltaTime/,
    );
    has("0x146ddf0", "addss", "xmm6, xmm0");
    has("0x146ddf0", "divss", "xmm6, xmm7");
    call("0x146ddf0", "0xc2eb40");
    assert.match(c("0x146ddf0"), /_1__state = 1;[\s\S]*return true/);
  },
);
check(
  "Color.Lerp uses separate float32 subtract, multiply and add without final target snapping",
  () => {
    call("0xc2eb40", "0xfc4d70");
    call("0xfc4d70", "0xffb170");
    has("0xfc4d70", "subss", "xmm7, dword ptr [rdi + 0xc]");
    has("0xfc4d70", "mulss", "xmm7, xmm10");
    has("0xfc4d70", "addss", "xmm7, dword ptr [rdi + 0xc]");
  },
);
check(
  "zero-alpha manager cleanup writes white transparent canvas and disables raycast",
  () => {
    assert.match(
      c("0xb03080"),
      /fVar4 == 0\.0[\s\S]*CanvasRenderer__SetColor[\s\S]*SetRaycastTargetEnable\(__this,false/,
    );
    assert.match(c("0xb031d0"), /0x3f800000,0x3f800000,0x3f800000,0,0/);
  },
);
check(
  "Color32 uses clamped float32 times255 and exact-half round-to-even",
  () => {
    assert.equal(
      range("0xfc4860").instructions.filter(
        (i) => i.mnemonic === "call" && i.operands === "0xffb170",
      ).length,
      4,
    );
    assert.equal(
      range("0xfc4860").instructions.filter(
        (i) => i.mnemonic === "call" && i.operands === "0x50c20",
      ).length,
      4,
    );
    assert.ok(range("0xfc4860").constants.some((k) => k.value === 255));
    has("0x50c20", "test", "al, 1");
    call("0x50c20", "0x239e78");
    has("0x50c20", "jmp", "0x239fe0");
    has("0x239e78", "movsd", "qword ptr [rdx], xmm2");
    has("0x239e78", "subsd", "xmm1, xmm2");
    has("0x239fe0", "shr", "eax, 0x17");
    has("0x239fe0", "and", "eax, edx");
    assert.ok(range("0x50c20").constants.some((k) => k.value === 0.5));
    assert.ok(range("0x50c20").constants.some((k) => k.value === 1));
    has("0xfc4970", "divss", "xmm1, xmm3");
  },
);
check(
  "new-game selection starts a half-second black fade but does not prove it already completed",
  () => {
    assert.match(
      c("0x655040"),
      /Color__get_black[\s\S]*FadeManager__FadeOut\(__this_03,0\.5,color/,
    );
  },
);
const report = {
  formatVersion: 1,
  kind: "static-field-fade",
  ...identity,
  semanticsVerified: false,
  methods,
  rawRanges: native,
  checks,
  limitations: [
    "Static source evidence only; no original executable, frame-order, GPU or browser pixel acceptance.",
    "Ordinary active image host only; inactive hierarchy, external ColorFade and registered finish callbacks are not migrated.",
    "RGBA outside 0..255 remains blocked; native script alpha355 is retained as a source blocker.",
    "New-game InitSelect initiates a fade; it is not permission to invent a completed black entry state.",
  ],
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(output, bytes);
console.log(
  JSON.stringify(
    {
      methods: methods.length,
      rawRanges: native.length,
      checks: checks.length,
      semanticsVerified: false,
      reportSha256: sha(bytes),
      reportPath: output,
    },
    null,
    2,
  ),
);
