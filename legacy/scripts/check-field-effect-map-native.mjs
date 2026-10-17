// The supplied build's ordinary clear/load order. No native game was executed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const source = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
for (const [file, expected] of [["build/runtime/game/GameAssembly.dll", source.nativeSha256],
  ["build/native/il2cpp/script.json", source.symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", source.headerSha256]])
  assert.equal(sha(await readFile(resolve(root, file))), expected);
const groups = {
  "v35-field-map-cleanup": [0x2e3870, 0x58b130, 0x2e37d0],
  "v35-field-map-cleanup-detail": [0x2e38f0, 0x30cce0, 0x30e4f0, 0x30b680],
  "v30-field-entry": [0x38eeb0], "v32-native-map-lifecycle": [0x58ae20],
  "v33-field-effect-control": [0x351aa0], "v33-native-map-hosts": [0x304070],
  "v34-map-manager-effect-lifecycle": [0x303450], "v34-field-effect-map-release": [0x303710, 0x575150],
};
const methods = [], code = new Map();
for (const [batch, addresses] of Object.entries(groups)) {
  const receipt = JSON.parse(await readFile(resolve(root, "build/native", batch, "complete.json")));
  for (const [key, expected] of Object.entries(source)) assert.equal(receipt[key], expected);
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const address of addresses) {
    const method = receipt.methods.find((m) => Number(m.rva) === address); assert.ok(method);
    const text = await readFile(resolve(root, "build/native", batch, address.toString(16) + ".c"));
    assert.equal(sha(text), method.decompiledSha256); code.set(address, text.toString());
    methods.push({ batch, ...method });
  }
}
const python = `import json,hashlib,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
pe=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
print(json.dumps([hashlib.sha256(pe.read(int(x['rva'],0),int(x['nextSymbolRva'],0)-int(x['rva'],0))[2]).hexdigest() for x in json.load(sys.stdin)]))`;
const digests = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(methods), encoding: "utf8" }));
methods.forEach((method, i) => assert.equal(method.nativeRangeSha256, digests[i]));
const checks = [
  [0x38eeb0, /MapCleanTask[\s\S]*LoadMap\(/, "ordinary change-map task enqueues cleanup before loading"],
  [0x58b130, /MapClean\s*[\s\S]*__2__current[\s\S]*__1__state = 1;[\s\S]*return true;/, "cleanup coroutine yields before finishing"],
  [0x2e38f0, /ClearCurrentMap\(__this_00,disabledClearMap/, "cleanup passes the explicit retained-map flag"],
  [0x303450, /ClearMap\([\s\S]*ClearMapAsset\(/, "ordinary branch clears map objects then releases asset caches"],
  [0x304070, /MapModel__Destroy\([\s\S]*UnityEngine_Object__Destroy\(/, "old map schedules Unity object destruction"],
  [0x351aa0, /code_r0x000180351c4b:[\s\S]*get_gameObject[\s\S]*UnityEngine_Object__Destroy\(pUVar6[\s\S]*UnityEngine_Object__Destroy\(\(UnityEngine_Object_o \*\)uVar7/, "default entity collection queues component and game object destruction"],
  [0x303710, /particleAssetList[\s\S]*ReleaseAlreadyLoadPrefabs[\s\S]*DestroyGroupAsset[\s\S]*particleAssetList[\s\S]*Clear/, "loaded particle groups release the shared prefab cache before the coroutine yield"],
  [0x575150, /alreadyLoadPrefabList[\s\S]*Remove[\s\S]*shareEffectParticleEntityList[\s\S]*Remove/, "prefab release removes two caches without resetting allocation counters"],
  [0x58ae20, /GC__Collect[\s\S]*__1__state = 1;[\s\S]*MapLoadProcessor__Start[\s\S]*MapCreateTask/, "new map load and entity creation follow their own yielded load phase"],
  [0x30e4f0, /_DefaultEntityInfo_k__BackingField[\s\S]*LoadFieldEntityAssets[\s\S]*eventEntityInfo[\s\S]*LoadFieldEntityAssets/, "asset requests process default before event groups"],
  [0x30cce0, /case 0xb:[\s\S]*IsAlreadyLoadPrefab[\s\S]*LoadAsset[\s\S]*particleAssetList/, "kind 11 prefab loads are recorded for later cache retirement"],
];
for (const [rva, pattern, meaning] of checks) assert.match(code.get(rva), pattern, meaning);
const report = { formatVersion: 1, lane: "source-field-effect-map-lifecycle", status: "pass", ...source,
  semanticsVerified: false, originalGameExecuted: false, browserExecuted: false, methods,
  checks: checks.map(([rva, , meaning]) => ({ rva: "0x" + rva.toString(16), meaning, pass: true })),
  limitations: ["The Web transaction collapses cleanup, deferred destruction and destination preparation into one publication; native callback cadence has not been measured.",
    "Only the ordinary clear-current-map branch is admitted. Retained/copy maps, event-group FX and resident FX remain unsupported.",
    "Source particle emission, geometry and materials require independent providers; this check does not admit the real five emitters.",
    "Logical manager history is not a particle/RNG save codec, even when the current map has no effect boards."] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-effect-map-native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, methods: methods.length, checks: checks.length, semanticsVerified: false }));
