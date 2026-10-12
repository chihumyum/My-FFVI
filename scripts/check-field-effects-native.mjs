// Static source binding only: no Windows executable or Unity player was run.
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
const groups = {
  "v33-field-effect-lifecycle": [0x9f2440, 0x87dc90, 0x574910, 0x575400, 0x87f0d0, 0x87dc00, 0x87f570, 0xe0c570, 0xe0cc30],
  "v33-field-effect-control": [0x574790, 0x575200, 0xe0cc60, 0xe0d030, 0xe0d060, 0x87f260, 0x87f600],
  "v33-native-map-hosts": [0x309e30], "tile-binding": [0x305420, 0x2c4800], "minimap-anchor": [0xb27340],
  "minimap": [0x9f2700], "open-trigger": [0x9f2c60],
  "v19-transport-lifecycle": [0x2e3d30], "map-lifecycle": [0x2ed6f0, 0x352d90],
  "v33-field-pools-targets": [0x308cf0, 0x3083c0],
};
const methods = [], code = new Map();
for (const [batch, addresses] of Object.entries(groups)) {
  const receipt = JSON.parse(await readFile(resolve(root, "build/native", batch, "complete.json")));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256); assert.equal(receipt.symbolsSha256, symbolsSha256); assert.equal(receipt.headerSha256, headerSha256);
  for (const rva of addresses) {
    const method = receipt.methods.find((entry) => Number(entry.rva) === rva); assert.ok(method);
    const matched = symbols.ScriptMethod.filter((entry) => entry.Address === rva); assert.equal(matched.length, 1);
    const bytes = await readFile(resolve(root, "build/native", batch, rva.toString(16) + ".c"));
    assert.equal(sha(bytes), method.decompiledSha256); code.set(rva, bytes.toString());
    methods.push({ batch, symbol: matched[0].Name, ...method });
  }
}
const raw = [
  [0x9f25c0, 0x50, "Last.Map.PropertyEffectEntity$$.ctor"],
  [0x43e0c0, 0x100, "MapObjectProperty$$.ctor"],
  [0x5759b0, 0x120, "Last.Map.FieldEffectInstanceManager$$.ctor"],
  [0xe0d3b0, 0x90, "Last.Entity.Field.FieldEffectParticleEntity$$.ctor"],
  [0xe0cff0, 0x40, "Last.Entity.Field.FieldEffectParticleEntity$$Show"],
  [0xe0c530, 0x40, "Last.Entity.Field.FieldEffectParticleEntity$$Hide"],
  [0x87f320, 0x110, "Last.Entity.Field.FieldEffectBoardEntity$$PlayAnimation"],
  [0x2c8ef0, 3, "Last.Entity.Field.FieldEffectBoardEntity$$CueAnimation"],
  [0x311ad0, 0x20, "Last.Map.MapManager$$SetupActivateEffect"],
  [0x9eb2f0, 6, "Last.Entity.Field.FieldEffectParticleEntity$$GetUpdateAttribute"],
  [0x3750c0, 6, "Last.Entity.Field.FieldEntity$$GetUpdateAttribute"],
  [0x87f760, 0x50, "Last.Entity.Field.FieldEffectBoardEntity$$get_IsPlayingAnim"],
];
raw.forEach(([rva, , name]) => assert.ok(symbols.ScriptMethod.some((entry) => entry.Address === rva && entry.Name === name)));
const ranges = [...methods.map((method) => ({ rva: method.rva, size: Number(method.nextSymbolRva) - Number(method.rva) })),
  ...raw.map(([rva, size]) => ({ rva: "0x" + rva.toString(16), size }))];
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
const readRanges = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((method, index) => assert.equal(readRanges[index].sha256, method.nativeRangeSha256));
const bytes = new Map(readRanges.map((range) => [Number(range.rva), Buffer.from(range.hex, "hex")]));
const hex = (rva) => bytes.get(rva).toString("hex");
assert.ok(hex(0x9f25c0).includes("c781c000000004000000"), "ZTest default is CompareFunction.LessEqual=4");
assert.ok(hex(0x43e0c0).includes("c6437001"), "MapObjectProperty PlayOnAwake defaults true");
assert.ok(hex(0x43e0c0).includes("c78334010000ffffffff"), "MapObjectProperty zoffset defaults -1");
// Ghidra incorrectly treats the managed write barrier as noreturn in OnDestroy.
// Bind its real tail: IEffectPlayer slot 5 (Release) precedes base OnDestroy.
assert.ok(hex(0x87f0d0).includes("488b8b48010000") || hex(0x87f0d0).includes("4c8b8348010000"));
const releaseOffset = 0x87f230 - 0x87f0d0;
assert.equal(bytes.get(0x87f0d0).subarray(releaseOffset, releaseOffset + 5).toString("hex"), "b905000000");
assert.equal(bytes.get(0x87f0d0)[0x87f253 - 0x87f0d0], 0xe9);
assert.equal(0x87f258 + bytes.get(0x87f0d0).readInt32LE(0x87f254 - 0x87f0d0), 0xe0f3a0);
// RenderTexture dimensions are truncated float32 (orthographicSize * 2), not
// copied from the serialized placeholder texture.
assert.ok(hex(0xe0c570).includes("f30f58c0"));
assert.ok(hex(0xe0c570).includes("f30f2cd0448bc2"));
assert.ok(hex(0x87dc90).includes("4183e00f") || hex(0x87dc90).includes("83e20f"), "Source signed remainder is retained");
assert.ok(hex(0x87f320).includes("48c1e8200fb6e885db8bc70f94c023e8"), "Nullable mode hasValue && value==0 is the integer loopLimit");
assert.equal(hex(0x2c8ef0), "c20000", "This exact override's shared CueAnimation is ret 0");
assert.equal(bytes.get(0x311ad0)[15], 0xe9);
assert.equal(0x311ae4 + bytes.get(0x311ad0).readInt32LE(16), 0x575400);
assert.equal(hex(0x9eb2f0), "b82a000000c3");
assert.equal(hex(0x3750c0), "b802000000c3");
assert.ok(hex(0x87f760).includes("b904000000"), "Board IsPlayingAnim invokes IEffectPlayer slot4 IsPlayingEffect");
const bindings = [
  [0x305420, /case 0xb:[\s\S]*PropertyEffectEntity___ctor[\s\S]*fieldEffectInstanceManager[\s\S]*effectBoardEntityPrefab[\s\S]*CreateOutOfRangeMapPosition/,
    "Kind11 constructs effect boards using a separately created shared effect player."],
  [0x9f2440, /_IsFront_k__BackingField[\s\S]*_IsSplit_k__BackingField[\s\S]*_Building_k__BackingField[\s\S]*_ZOffset_k__BackingField/,
    "Property conversion has independent nullable front/split defaults and building overrides."],
  [0x574910, /if \(isShareInstance\)[\s\S]*return pLVar11;[\s\S]*instanceCount \+ 1[\s\S]*createdParticleRefCnt[\s\S]*nextParticlePositionY/,
    "Shared asset-group hits reuse the same camera before allocating another instance."],
  [0x87dc90, /ClearRenderTexture[\s\S]*CeilToInt[\s\S]*0\.0625[\s\S]*set_size[\s\S]*set_renderQueue[\s\S]*set_vertices[\s\S]*_EffectPlayer_k__BackingField[\s\S]*FUN_18004f780\(6/,
    "Every board clears RT, builds its source split mesh and increments the shared reference count."],
  [0x574790, /createdParticleRefCnt[\s\S]*iVar\d+ \+ 1/,
    "Board AddReference increments one camera reference count."],
  [0x575200, /iVar6 \+ -1[\s\S]*iVar6 != 0[\s\S]*Destroy[\s\S]*Remove/,
    "Last release destroys the live particle owner and removes created/refcount entries."],
  [0x575400, /preActivateList[\s\S]*UnregisterEntity[\s\S]*FieldEffectBoardEntity[\s\S]*FieldEffectParticleEntity__Show[\s\S]*if \(!groupUpdate\)[\s\S]*FieldEffectParticleEntity__Hide[\s\S]*RegisterEntity/,
    "SetupActivate registers one camera per selected board group and only hides unused players on full setup."],
  [0xe0cc60, /effectEntityInstance,false[\s\S]*effectEntityInstance,true[\s\S]*loopCount = 0[\s\S]*loopLimit < 1[\s\S]*loopLimit = 0/,
    "Play restarts emitter activation, clears loop count and derives nonpositive limit from native loop flags."],
  [0xe0d030, /effectEntityInstance,false[\s\S]*isPlaying = false/,
    "Stop deactivates the effect child without hiding the board."],
  [0xe0d060, /isPlaying == false[\s\S]*get_deltaTime[\s\S]*elapsedSec = fVar13 \+ fVar14[\s\S]*SetFloat[\s\S]*0 < \(__this->fields\)\.loopLimit[\s\S]*loopCount[\s\S]*get_loop_Injected[\s\S]*!bVar9[\s\S]*get_isPlaying/,
    "Update uses actual deltaTime and shader elapsed time; only non-looping particle isPlaying postpones completion."],
  [0x87f570, /duration != 0\.0[\s\S]*fadeAlpha = 1\.0[\s\S]*UpdateFadeRenderer[\s\S]*SafeActiveSet\(obj,true/,
    "Zero-duration Show changes board alpha/active state, not shared playback."],
  [0x87dc00, /duration == 0\.0[\s\S]*fadeAlpha = 0\.0[\s\S]*SafeActiveSet\(obj,false/,
    "Zero-duration Hide changes board alpha/active state, not shared playback."],
  [0xb27340, /iVar2 \* -0x10[\s\S]*uVar7 \* -0x10[\s\S]*_TilePos_k__BackingField[\s\S]*_pos_k__BackingField/,
    "Entity placement starts from raw integer pixels relative to native mapRange."],
  [0x309e30, /fVar5 < 0\.0[\s\S]*width <= fVar5[\s\S]*fVar4 <= 0\.0[\s\S]*height < fVar4[\s\S]*standbyEntityAnchor/,
    "Out-of-range placement uses the source standby anchor, preserving property Z."],
  [0x2e3d30, /MapManager__SetupActivateEffect\(pLVar8,false/,
    "Full MapSetup uses groupUpdate=false."],
  [0x2ed6f0, /EntitiesSetup[\s\S]*MapManager__SetupActivateEffect\(pLVar4,true/,
    "Event-group setup uses groupUpdate=true after updating registered entities."],
  [0x352d90, /eventEntityInfo[\s\S]*GetEntitiesEvent[\s\S]*GameObject__SetActive\(__this_01,false/,
    "Disabling event groups directly changes activeSelf, independently of Show/Hide alpha."],
  [0x308cf0, /CreateGroupEntity[\s\S]*_DefaultEntityInfo_k__BackingField[\s\S]*eventEntityInfo[\s\S]*GetEnumerator[\s\S]*CreateGroupEntity/,
    "CreateMapEntity constructs all default boards before enumerating the event dictionary; event insertion order is not inferred."],
  [0x3083c0, /mapObjectGroupDatas->m_Items\[\(int\)uVar7\][\s\S]*_properties_k__BackingField[\s\S]*CreateEntity[\s\S]*pMVar2->m_Items\[\(int\)uVar6\]/,
    "Within each group native creation retains the group-data array and property-array order."],
  [0x2c4800, /iVar13 == 0[\s\S]*set_i1[\s\S]*iVar13 < 0[\s\S]*elementNames = 1[\s\S]*set_i0/,
    "The admitted script count 0/1 invokes mode0; negative count invokes mode1 and advances without waiting."],
];
for (const [rva, pattern, meaning] of bindings) assert.match(code.get(rva), pattern, meaning);
assert.doesNotMatch(code.get(0x575200), /shareEffectParticleEntityList/, "Do not invent shared-cache deletion on last release");
assert.doesNotMatch(code.get(0xe0cc60), /elapsedSec/, "Play does not reset shader elapsed time");
assert.doesNotMatch(code.get(0x87f570) + code.get(0x87dc00), /PlayEffect|StopEffect/, "Board visibility is separate from playback");
const string = (address, value) => assert.ok(symbols.ScriptString.some((item) => item.Address === address && item.Value === value));
string(0x1ff17e8, "Prefabs/EffectPrefab"); string(0x2005e50, "_MainTex"); string(0x1fdcd70, "_ElapsedSec");
const dump = await readFile(resolve(root, "build/native/il2cpp/dump.cs"), "utf8");
assert.match(dump, /EffectEntity = 11;/); assert.match(dump, /private bool <play_on_awake>k__BackingField; \/\/ 0x70/);
assert.match(dump, /private int <zoffset>k__BackingField; \/\/ 0x134/);
assert.match(dump, /public const int Field = 2;[\s\S]*public const int Message = 8;[\s\S]*public const int FieldReady = 32;/);
const report = { formatVersion: 1, lane: "static-native-field-effect-lifecycle", nativeSha256, symbolsSha256, headerSha256,
  semanticsVerified: false, originalGameExecuted: false, methods, ranges: readRanges,
  bindings: bindings.map(([, , meaning]) => meaning), rawBindings: raw.map(([rva, size, symbol]) => ({ rva, size, symbol })),
  limitations: ["Unity particle simulation and shaders not reimplemented", "No original-game execution", "No source visual parity"],
  checkerSha256: sha(await readFile(fileURLToPath(import.meta.url))) };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-effects-native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawBindings: raw.length, bindings: bindings.length, semanticsVerified: false }));
