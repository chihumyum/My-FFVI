// Static source receipts and receiver-bound bytes; never executes GameAssembly.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-camera-native-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [file, expected] of [["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(root + file)), expected, file);
const batches = {
  "v29-field-hosts": ["2d9b50", "5f2ca0", "26a1f0", "26a2a0", "7ad1f0"],
  "v29-field-providers": ["2d2a10", "e1f630", "e1f520", "30a930", "7ad240"],
  "v29-field-following": ["e0dc00", "879480", "387250"],
  "v29-event-camera": ["7ad6c0"],
  "v28-opening-primitives": ["2c6a30", "2c10c0"],
  "v29-camera-coordinates-complete": ["2c26f0", "2d6690", "2d6800", "2dfe30", "2f5d50"],
  "v29-camera-map-range": ["2fe6c0", "b277c0"],
  "npc-actions": ["7ad3f0"],
};
const methods = [], code = new Map();
for (const [batch, rvas] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256); assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  for (const rva of rvas) {
    const found = receipt.methods.filter((m) => m.rva === "0x" + rva); assert.equal(found.length, 1, rva);
    const bytes = await readFile(root + `build/native/${batch}/${rva}.c`);
    assert.equal(sha(bytes), found[0].decompiledSha256, rva);
    code.set(rva, bytes.toString("utf8")); methods.push({ batch, ...found[0] });
  }
}
const rawRanges = [
  ["0x387210", 64, "487231ab77e29738b8972c34ea892a7a6e5476823050c926d12f86e0b91ae5dc", "CameraFollowing.SetupMoveCallbackEntity only changes TargetEntity"],
  ["0xe1f7d0", 128, "8e1d4bcd989ae00cc9c9439b67aaf9fe5b310cac700556d2cc67cec42d1294f4", "Dummy ctor initializes zero visual offset then calls Entity ctor"],
  ["0xb25450", 304, "df50431e887864f8437969e0628528fb920bab5e580491b752d0e625bb7c5ba3", "GetLayerByInt validates exact LayerSetting.Layers enum; unknown returns Default"],
  ["0xb25900", 64, "f347de5622244f3bfba4e6c8b1a04fd4921f9ad06cfc7c6e5e6b1c8c79e9c069", "Z 349/249/149/49 maps to Unity layer 9/10/11/12; other Z maps 0"],
  ["0xb25940", 48, "0151abd5a1f0912f61465bd6bc2fb262f31aa2a7214747a2879d6d4b104d180a", "Unity layer 9/10/11/12 maps to Z 349/249/149/49; other layers map 0"],
  ["0x2d2380", 240, "035d6110ab9d091b83568fc08348c3110888e88f177d70a02225757cf5c77b22", "Shared Map/Library helper binds the exact coordinate arguments, not an arbitrary alias"],
  ["0x2c0040", 688, "0a634421419637ec76f33115fea51899f9ce81f6c964fff63d6354769da54886", "GetChangeLayerValue preserves current Z through kLayerValues[layer-9], with bounds check"],
  ["0x2c81f0", 3328, "96a6cd6536296614ea661b4a69b15220ecf96728fc89dbfd5dbf8433978277a9", "Puppet ctor initializes kLayerValues to a three-element [0,1,2] array and SetPosCallback null"],
  ["0x2ca720", 176, "b5e8f790d9ca1e7c830cc1850abf41bf32f1a5cc1d2de433d238fdff20bba2a8", "Positive Lerp animation callback checks IsNullOrEmpty before PlayAnimation"],
  ["0x2ca7d0", 64, "827e06bb975b23fe69de8ab61012be0668b08d0ac45dec29ad3ef25064853e2d", "Zero Lerp dispatches CueAnimation slot51 on the exact dummy receiver"],
  ["0x2ca950", 320, "b9c9beeb129ff35433f027d864b35bf70a403ff7ac2f2f446a28f29f740301eb", "SetPos animation closure dispatches CueAnimation slot51"],
  ["0x2c8ef0", 16, "28f844b5972c241e804231b0e41b93e13696e59b98dde74f19029386db5da0c5", "FieldEntity base CueAnimation is ret0; FieldScrollDummyEntity has no override"],
].map(([rva, size, expectedSha256, role]) => ({ rva, size, expectedSha256, role }));
const requests = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const ranges = JSON.parse(execFileSync("python3", ["-c", `import json,sys,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
print(json.dumps([dict(rva=r['rva'],size=r['size'],sha256=hashlib.sha256(p.read(int(r['rva'],0),r['size'])[2]).hexdigest()) for r in json.load(sys.stdin)]))`, root],
  { input: JSON.stringify(requests), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
rawRanges.forEach((m, i) => assert.equal(ranges[methods.length + i].sha256, m.expectedSha256, m.rva));
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /public const LayerSetting\.Layers BottomLayer = 9/);
assert.match(dump, /public const LayerSetting\.Layers GroundLayer = 10/);
assert.match(dump, /public const LayerSetting\.Layers UpperLayer = 11/);
assert.match(dump, /private static readonly MapConstants\.ChangeLayer\[\] kLayerValues; \/\/ 0x10/);
assert.match(dump, /public static Puppet\.SetPosCallback s_set_pos_callback; \/\/ 0x20/);
const dummyBody = dump.slice(dump.indexOf("public class FieldScrollDummyEntity :"),
  dump.indexOf("\n// Namespace:", dump.indexOf("public class FieldScrollDummyEntity :")));
assert.doesNotMatch(dummyBody, /CueAnimation|PlayAnimation/);
assert.match(dump, /RVA: 0x2C8EF0[^\n]*Slot: 51\s+public virtual void CueAnimation/);
assert.match(code.get("2d9b50"), /entityId == 0[\s\S]*scrollDummy/);
assert.match(code.get("2d2a10"), /has_value == false[\s\S]*player/);
assert.match(code.get("2d2a10"), /_TargetEntity_k__BackingField/);
assert.match(code.get("2d2a10"), /FieldScrollDummyEntity__SetEntityOffset/);
assert.match(code.get("2d2a10"), /_28_Init/);
assert.match(code.get("2d2a10"), /_MoveCallback_k__BackingField/);
assert.match(code.get("2d2a10"), /CameraFollowing__UpdateController/);
assert.match(code.get("7ad6c0"), /cVar9 != '\\0'[\s\S]*ea6bc0\(&uStackX_8,0,[\s\S]*FUN_18004e9e0\(0xf,[\s\S]*if \(startChangeState\)/);
assert.match(code.get("30a930"), /0x46ea6000,0x447a0000,0xc47a0000/);
assert.match(code.get("5f2ca0"), /set_layer/);
assert.match(code.get("5f2ca0"), /set_localPosition/);
assert.doesNotMatch(code.get("5f2ca0"), /SetEntityOffset|ChangeCameraTarget|_28_Init/);
assert.match(code.get("e1f520"), /offset/);
assert.match(code.get("e1f630"), /get_position/);
assert.match(code.get("387250"), /mapScrollOffset/);
assert.match(code.get("2dfe30"), /\*cellX = \*cellX -/);
assert.match(code.get("2dfe30"), /\*cellY = \*cellY -/);
assert.match(code.get("2d6690"), /width \* 0\.5\) \* 16\.0 \+/);
assert.match(code.get("2f5d50"), /FloorToInt/);
assert.match(code.get("2c26f0"), /GetChangeLayerValue/);
assert.match(code.get("2c26f0"), /if \(layer == 0\)/);
assert.match(code.get("2c6a30"), /if \(-1 < aiStackX_8\[0\]\)/);
assert.match(code.get("2c10c0"), /Core__IsFirstClock/);
assert.match(code.get("2c10c0"), /Core__set_r2\(pLVar23,\(double\)fVar24/);
assert.match(code.get("2c10c0"), /\(\(double\)fVar24 - dVar25\) \/ pSVar6->m_Items\[0\]/);
assert.match(code.get("2c10c0"), /if \(1\.0 < dVar25\)/);
assert.match(code.get("2c10c0"), /\(float\)iVar12 - 5\.0/);
assert.match(code.get("2c10c0"), /if \(dVar25 == 1\.0\)/);
assert.match(code.get("2c10c0"), /func_0x00018034c9f0/);
assert.match(code.get("2fe6c0"), /&LStack_18,0,0,\(pTVar3->fields\)\.width,\(pTVar3->fields\)\.height/);
assert.match(code.get("2fe6c0"), /MapUtility__ParseMapRange/);
assert.match(code.get("2fe6c0"), /mapRange\.fields\.x = LStack_18\.x/);
assert.match(code.get("b277c0"), /_object_type_k__BackingField == 0x1b/);
assert.match(code.get("b277c0"), /iVar5 >> 0x1f & 0xfU/);
assert.match(code.get("b277c0"), /mapRange->fields\)\.height = uStack_30\._4_4_;\s+return;/);
const report = { lane: "static-native-field-camera", nativeSha256, symbolsSha256, headerSha256,
  methods, rawRanges, bindings: {
    sourceActor0: "FieldController.scrollDummy, independent from player and collider list",
    successfulScriptStart: "ChangeCameraTarget(Some(0)), independent of startChangeState",
    targetPlayer: "ChangeCameraTarget(null), real player rather than -1001 puppet",
    motion: "SetPos absolute / preserve-layer / empty animation; Lerp preserve-layer / empty animation, signed duration",
    sourceTiming: "float32 Unity Time.time, first clock records start then projects same time",
    mapRange: "full tile dimensions at origin0, overridden by first source type27 rectangle with signed /16 truncation",
    lifecycle: "InitCameraDummy copies position/layer; End 0,2,3,4,6 restores player",
  }, semanticsVerified: false, originalGameExecuted: false,
  doesNotEstablish: ["native-dynamic-parity", "arbitrary-SetPos-callback-host", "layer-changing-animation-host",
    "viewport-clamp-loop-and-effect-parity", "full-prelude-reachability", "all-map-playability"] };
const bytes = JSON.stringify(report, null, 2) + "\n"; await writeFile(output, bytes);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length,
  reportSha256: sha(bytes), semanticsVerified: false, originalGameExecuted: false }));
