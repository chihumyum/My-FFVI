// Static source inventory and a narrow raw-byte binding. This does not execute
// AutoSave, decode it as supported, or prove a native event-resume format.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"),
  module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = (data) => createHash("sha256").update(data).digest("hex");
const { loadCorpus } = await module("compiler/corpus"),
  { bindMapPackages, resolveMapScript } = await module("compiler/map-package"),
  { hash } = await module("compiler/content"),
  corpus = await loadCorpus(root),
  scripts = corpus.assets.filter((asset) => asset.kind === "script"),
  byId = new Map(scripts.map((asset) => [asset.id, asset])), users = new Map();

// Match the existing corpus map-domain definition. This is association through
// bound package aliases, not proof that any story can reach a call at runtime.
for (const map of bindMapPackages(corpus.assets, corpus.tables)) {
  const queue = [...map.scripts], seen = new Set();
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const asset = byId.get(id); assert.ok(asset, `Unknown bound script ${id}`);
    if (!users.has(id)) users.set(id, new Set());
    users.get(id).add(map.id);
    for (const raw of asset.data.Mnemonics) {
      if (!["Encount", "ChangeScript"].includes(raw.mnemonic)) continue;
      const name = raw.operands?.sValues?.[0], target = name ? resolveMapScript(map, name) : null;
      if (target) queue.push(target);
    }
  }
}

const calls = [];
for (const asset of scripts) {
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    if (raw.mnemonic !== "AutoSave") continue;
    const shape = { type: raw.type, ...raw.operands };
    assert.deepEqual(shape, { type: 1, iValues: Array(8).fill(0),
      rValues: Array(8).fill(0), sValues: Array(8).fill("") }, asset.id);
    const segments = asset.data.Segments.filter((s) => index >= s.EntryPoint && index < s.EntryPoint + s.Count);
    assert.equal(segments.length, 1); assert.equal(segments[0].Label, "Main");
    calls.push({ assetId: asset.id, name: asset.data.Name, index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` },
      instructionHash: hash(raw), scriptHash: hash(asset.data), shape,
      maps: [...(users.get(asset.id) ?? [])].sort((a, b) => Number(a) - Number(b)),
      declaredSegment: segments[0], nextMnemonic: asset.data.Mnemonics[index + 1]?.mnemonic ?? null });
  }
}
const fieldCalls = calls.filter((call) => call.maps.length),
  countNext = (sites) => Object.fromEntries([...new Set(sites.map((site) => site.nextMnemonic))]
    .sort().map((name) => [name, sites.filter((site) => site.nextMnemonic === name).length])),
  unassociatedCalls = calls.filter((call) => !call.maps.length),
  fieldScripts = scripts.filter((asset) => users.has(asset.id));
assert.equal(corpus.sourceSetHash, "8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed");
assert.equal(corpus.manifest.parentSourceSetHash, "6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965");
assert.equal(scripts.length, 3304); assert.equal(fieldScripts.length, 2804);
assert.equal(calls.length, 95); assert.equal(new Set(calls.map((site) => site.assetId)).size, 95);
assert.equal(fieldCalls.length, 94); assert.equal(new Set(fieldCalls.flatMap((site) => site.maps)).size, 58);
assert.equal(new Set(calls.map((site) => hash(site.shape))).size, 1);
assert.deepEqual(countNext(calls), { ChangeScript: 1, Exit: 53, FadeIn: 17,
  ShowHelpAndExit: 1, ShowMapTitle: 22, Wait: 1 });
assert.deepEqual(countNext(fieldCalls), { ChangeScript: 1, Exit: 52, FadeIn: 17,
  ShowHelpAndExit: 1, ShowMapTitle: 22, Wait: 1 });
assert.deepEqual(unassociatedCalls.map((site) => [site.name, site.index]), [["sc_sht_corps_after", 5]]);

const nativeIdentity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
}, nativeBytes = await readFile(root + "build/runtime/game/GameAssembly.dll"),
  symbolBytes = await readFile(root + "build/native/il2cpp/script.json"),
  symbols = JSON.parse(symbolBytes),
  addresses = [...new Set(symbols.ScriptMethod.map((method) => method.Address))].sort((a, b) => a - b);
assert.equal(sha(nativeBytes), nativeIdentity.nativeSha256);
assert.equal(sha(symbolBytes), nativeIdentity.symbolsSha256);
assert.equal(corpus.manifest.sources.find((source) => source.file === "GameAssembly.dll")?.sha256,
  nativeIdentity.nativeSha256);
const ranges = [
  ["0xb4e860", "Last.Interpreter.Instructions.External.Misc$$AutoSave", true],
  ["0x38da10", "FieldMap$$AutoSave", true],
  // These code-sharing leaves are bound by the exact Core alias and bytes;
  // another first alias at the same address does not define their semantics.
  ["0x409ff0", "Last.Interpreter.Core$$get_Next", false],
  ["0x34c9f0", "Last.Interpreter.Core$$get_Blank", false],
].map(([rva, name, unique]) => {
  const matches = symbols.ScriptMethod.filter((method) => method.Address === Number(rva));
  assert.equal(matches.filter((method) => method.Name === name).length, 1, name);
  if (unique) assert.equal(matches.length, 1, name);
  const nextSymbolRva = addresses.find((address) => address > Number(rva));
  assert.ok(nextSymbolRva);
  return { rva, name, nextSymbolRva: "0x" + nextSymbolRva.toString(16), size: nextSymbolRva - Number(rva) };
});
const python = String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
pe=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
out=[]
for r in json.load(sys.stdin):
 section,offset,data=pe.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),
  instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in cs.disasm(data,int(r['rva'],0))]))
print(json.dumps(out))`;
const nativeRanges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root],
  { input: JSON.stringify(ranges), maxBuffer: 2 * 1024 * 1024 })),
  instructions = (rva) => nativeRanges.find((range) => range.rva === rva).instructions,
  at = (rva, mnemonic, operands) => assert.ok(instructions("0xb4e860")
    .some((instruction) => instruction.rva === rva && instruction.mnemonic === mnemonic && instruction.operands === operands),
  `${rva}: ${mnemonic} ${operands}`);
at("0xb4e89c", "call", "0x82da70"); // Core.IsFirstClock
at("0xb4e8a3", "jne", "0xb4e922"); // first clock branch
at("0xb4e8f3", "xor", "r9d, r9d"); // isClear false
at("0xb4e8ff", "xor", "r8d, r8d"); // callback null
at("0xb4e907", "call", "0x704060"); // Save(autoSlot.id, null, false)
at("0xb4e91d", "jmp", "0x409ff0"); // Next without testing save result
at("0xb4ebd3", "jmp", "0x34c9f0"); // first clock -> Blank
assert.ok(instructions("0xb4e860").filter((i) => Number(i.rva) > 0xb4e907 && Number(i.rva) < 0xb4e91d)
  .every((i) => !/^(j|call|test|cmp)/.test(i.mnemonic)), "save result is not checked before Next");
assert.equal(instructions("0xb4e860").filter((i) => i.mnemonic === "call" && i.operands === "0x704060").length, 1);
assert.deepEqual(instructions("0x409ff0").slice(0, 2).map((i) => [i.mnemonic, i.operands]), [["xor", "eax, eax"], ["ret", ""]]);
assert.deepEqual(instructions("0x34c9f0").slice(0, 2).map((i) => [i.mnemonic, i.operands]), [["mov", "eax, 1"], ["ret", ""]]);
assert.ok(instructions("0x38da10").some((i) => i.mnemonic === "call" && i.operands === "0x704060"));

const report = {
  kind: "event-save-source-check", lane: "static-corpus-and-native-instruction-binding",
  sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  semanticsVerified: false, originalGameExecuted: false, sourceAdmission: false,
  counts: { rawScripts: scripts.length, fieldScripts: fieldScripts.length,
    rawSites: calls.length, fieldSites: fieldCalls.length, fieldCallScripts: new Set(fieldCalls.map((c) => c.assetId)).size,
    associatedMapRecords: new Set(fieldCalls.flatMap((c) => c.maps)).size, argumentForms: 1,
    nativeRanges: nativeRanges.length },
  domainBasis: "Existing corpus map package aliases plus Encount/ChangeScript references; association is not runtime reachability",
  successors: { all: countNext(calls), field: countNext(fieldCalls) }, unassociatedCalls,
  native: { ...nativeIdentity, ranges: nativeRanges,
    observations: ["First clock branches to actor synchronization and returns Blank=1",
      "Subsequent clock calls Save(autoSlot.id, callback=null, isClear=false) and returns Next=0",
      "The VM instruction does not test Save's return value or install a completion callback"],
    unknowns: ["Full storage completion/failure semantics behind Save", "Native persisted VM PC/call-stack/actor-task restoration",
      "Native load re-entry and scene script selection for each autosave"] },
  limits: ["No source AutoSave decoder/runtime admission is granted by this inventory",
    "Web success-ACK/retry/post-ACK continuation is an explicit development persistence protocol",
    "No native save file or original game execution was used as an oracle"], calls,
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/event-save-source-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.counts,
  semanticsVerified: false, originalGameExecuted: false, sourceAdmission: false }));
