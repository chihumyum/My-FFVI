// Full source-site inventory plus controlled Web lifecycle. No native sync,
// native save/slot parity, full source-program execution or story claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";
const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir", "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"), load = path => import(pathToFileURL(resolve(compiled, path + ".js")).href);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const [{ loadCorpus }, { bindMapPackages, resolveMapScript }, { decodeFieldOp }, { hash },
  { fieldInstructionRequirements }, { WEB_AUTO_SAVE_LIMITATIONS, SOURCE_AUTO_SAVE }, { sourceAutoSaveFixture },
  { FieldGame }, { GameSession }, { GameEventSaveCoordinator }, { CheckpointStorage },
  { loadSystemMessages }, { readSnapshot }] = await Promise.all([
  load("src/compiler/corpus"), load("src/compiler/map-package"), load("src/compiler/field"), load("src/compiler/content"),
  load("src/core/field-content-admission"), load("src/core/field-auto-save"), load("tests/fixtures/field-auto-save"),
  load("src/core/field"), load("src/core/game-session"), load("src/core/game-event-save"), load("src/core/saved-game"),
  load("src/compiler/system-messages"), load("src/compiler/integrity"),
]);
const runtimeBefore = await runtimeDigest(root, compiled);
const report = { kind: "field-auto-save-web-batch-v1", result: "running", sourceOpcodeFullyMigrated: false,
  sourceProgramsExecuted: 0, nativeParity: false, nativeSynchronization: "unassessed",
  originalGameExecuted: false, browserVerified: false, sourceStoryReachable: false,
  controlled: ["source-site substituted into synthetic gameplay program", "same production session/field/owned owners",
    "existing event continuation/save coordinator", "memory storage", "delayed encoding and quota failure"],
  limitations: [...WEB_AUTO_SAVE_LIMITATIONS], calls: [], programs: [], lifecycle: [] };
report.runtimeSha256 = runtimeBefore;
report.runtimeScope = { compiledDirectory: compiled,
  folders: [resolve(compiled, "src"), resolve(compiled, "tests"), resolve(root, "apps/game"), resolve(root, "scripts")],
  extensions: ["js", "mjs", "json"] };
const path = resolve(root, "build/reports/field-auto-save-check.json");
await mkdir(resolve(path, ".."), { recursive: true });
try {
  const snapshots = await Promise.all(["corpus", "field"].map(async name => {
    const path = resolve(root, "build", name, "snapshot.json"), bytes = await readFile(path);
    return { name, path, sha256: sha(bytes), manifest: JSON.parse(bytes) };
  }));
  for (const snapshot of snapshots) await readSnapshot(resolve(root, "build", snapshot.name));
  report.snapshots = snapshots.map(({ name, sha256, manifest }) => ({ name, sha256, manifest }));
  const corpus = await loadCorpus(root), scripts = corpus.assets.filter(asset => asset.kind === "script"),
    byId = new Map(scripts.map(asset => [asset.id, asset])), users = new Map();
  const system = await loadSystemMessages(root, corpus.manifest.parentSourceSetHash, corpus.manifest.sources),
    messages = { ...corpus.messages, system_zhc: system.messages };
  report.decoderInputs = { sourceSetHash: corpus.sourceSetHash, systemMessagesSource: system.source,
    messageTables: Object.keys(messages).sort(), conditionAndItemTables: Object.keys(corpus.tables).sort() };
  report.sourceSetHash = corpus.sourceSetHash; report.parentSourceSetHash = corpus.manifest.parentSourceSetHash;
  for (const map of bindMapPackages(corpus.assets, corpus.tables)) {
    const pending = [...map.scripts], visited = new Set();
    while (pending.length) {
      const id = pending.pop(); if (visited.has(id)) continue; visited.add(id);
      const asset = byId.get(id); assert.ok(asset);
      if (!users.has(id)) users.set(id, new Set()); users.get(id).add(map.id);
      for (const raw of asset.data.Mnemonics) {
        if (!["Encount", "ChangeScript"].includes(raw.mnemonic)) continue;
        const name = raw.operands?.sValues?.[0], target = name && resolveMapScript(map, name);
        if (target) pending.push(target);
      }
    }
  }
  for (const asset of scripts) {
    if (!asset.data.Mnemonics.some(op => op.mnemonic === "AutoSave")) continue;
    const instructions = asset.data.Mnemonics.map((raw, index) => {
      const site = { script: asset.data.Name, index, source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
      try { return decodeFieldOp(raw, site, messages, corpus.tables); }
      catch (error) { return { ...site, kind: "blocked", mnemonic: raw.mnemonic, reason: String(error) }; }
    });
    const program = { assetId: asset.id, source: asset.source, scriptHash: hash(asset.data), instructionRecords: instructions.length,
      maps: [...(users.get(asset.id) ?? [])].sort((a, b) => a - b),
      decodeDiagnostics: instructions.filter(op => op.kind === "blocked"),
      providerRequirements: instructions.flatMap(op => fieldInstructionRequirements(op)) };
    report.programs.push(program);
    for (const [index, raw] of asset.data.Mnemonics.entries()) {
      if (raw.mnemonic !== "AutoSave") continue;
      const op = instructions[index]; assert.equal(op.kind, "event-save"); assert.equal(op.sourceAutoSave, SOURCE_AUTO_SAVE);
      assert.ok(program.providerRequirements.some(req => req.site.index === index && req.capability === "sourceAutoSaveSync"));
      const call = { assetId: asset.id, source: op.source, script: op.script, index, raw,
        instructionHash: hash(raw), scriptHash: program.scriptHash, maps: program.maps,
        nextMnemonic: asset.data.Mnemonics[index + 1]?.mnemonic ?? null, controlledWebExecution: "not-run" };
      report.calls.push(call);
      const f = sourceAutoSaveFixture(), controls = f.field.scripts.saveFlow;
      const programOps = controls.map((control, pc) => ({ ...control, script: op.script, index: 10000 + index + pc }));
      programOps[1] = structuredClone(op); f.field.scripts[op.script] = programOps;
      assert.equal(f.session.field.startEvent(op.script), true); assert.equal(f.session.eventSaveRequest, null);
      f.session.advance(10); const request = f.session.eventSaveRequest; assert.ok(request);
      const checkpoint = f.session.field.eventCheckpoint(request), restored = FieldGame.restore(f.field, checkpoint);
      assert.equal(restored.eventSaveRequest, null);
      assert.equal(checkpoint.execution.main.pc, 2); assert.equal(checkpoint.execution.barrier.pc, 1);
      f.session.field.acknowledgeEventSave(request); f.session.advance(10);
      assert.equal(f.itemCount(), 5); assert.equal(f.session.field.stop, null);
      call.controlledWebExecution = "first-clock-yield-request-checkpoint-restore-ACK-continue";
    }
  }
  assert.equal(report.calls.length, 95); assert.equal(report.calls.filter(call => call.maps.length).length, 94);
  assert.deepEqual(report.calls.filter(call => !call.maps.length).map(call => [call.script, call.index]), [["sc_sht_corps_after", 5]]);
  report.counts = { sourceSites: report.calls.length, fieldSites: 94, associatedMaps: new Set(report.calls.flatMap(call => call.maps)).size,
    completeSourceProgramsInventoried: report.programs.length, controlledSourceSiteExecutions: report.calls.length,
    unassociatedResidentSites: 1, remainingDecodeDiagnostics: report.programs.reduce((sum, p) => sum + p.decodeDiagnostics.length, 0),
    providerRequirements: report.programs.reduce((sum, p) => sum + p.providerRequirements.length, 0) };
  assert.equal(report.counts.associatedMaps, 58);
  const receiptPath = resolve(root, "build/native/story-autosave/complete.json"), receiptBytes = await readFile(receiptPath),
    receipt = JSON.parse(receiptBytes),
    symbols = await readFile(resolve(root, "build/native/il2cpp/script.json")),
    native = await readFile(resolve(root, "build/runtime/game/GameAssembly.dll")),
    header = await readFile(resolve(root, "build/native/il2cpp/il2cpp_ghidra.h"));
  const nativeFiles = [{ path: receiptPath, sha256: sha(receiptBytes) },
    { path: resolve(root, "build/native/il2cpp/script.json"), sha256: sha(symbols) },
    { path: resolve(root, "build/runtime/game/GameAssembly.dll"), sha256: sha(native) },
    { path: resolve(root, "build/native/il2cpp/il2cpp_ghidra.h"), sha256: sha(header) }];
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc");
  assert.equal(receipt.symbolsSha256, "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3");
  assert.equal(receipt.headerSha256, "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718");
  assert.equal(corpus.manifest.sources.find(entry => entry.file === "GameAssembly.dll")?.sha256, receipt.nativeSha256);
  assert.equal(sha(native), receipt.nativeSha256); assert.equal(sha(symbols), receipt.symbolsSha256); assert.equal(sha(header), receipt.headerSha256);
  assert.deepEqual(receipt.methods.map(method => method.rva).sort(), ["0x38da10", "0xb4e860"]);
  for (const method of receipt.methods) {
    const path = resolve(root, `build/native/story-autosave/${method.rva.slice(2)}.c`), digest = sha(await readFile(path));
    assert.equal(digest, method.decompiledSha256); nativeFiles.push({ path, sha256: digest });
  }
  const py = String.raw`import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
pe=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
print(json.dumps([dict(rva=m['rva'],sha256=hashlib.sha256(pe.read(int(m['rva'],0),int(m['nextSymbolRva'],0)-int(m['rva'],0))[2]).hexdigest()) for m in json.load(sys.stdin)]))`;
  const ranges = JSON.parse(execFileSync("python3", ["-c", py, root], { input: JSON.stringify(receipt.methods) }));
  for (const range of ranges) assert.equal(range.sha256, receipt.methods.find(m => m.rva === range.rva).nativeRangeSha256);
  report.native = { ...receipt, receiptSha256: sha(receiptBytes), inputFiles: nativeFiles,
    observations: ["First clock synchronizes native leader/player/camera and returns Blank",
    "Second clock Save(autoSlot.id, null, false), then Next without completion check"],
    unknown: ["Complete native actor synchronization side effects", "Source AutoSlot namespace",
      "Native persistence/failure/durability", "Native load/VM continuation applicability"] };
  const f = sourceAutoSaveFixture(), values = new Map(); let writes = 0, fail = false;
  const storage = new CheckpointStorage({ getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (fail) throw new Error("controlled quota"); writes++; values.set(key, value); } });
  await storage.save(f.session.checkpoint(), 1); const prior = [...values], request = f.start();
  let release, entered; const gate = new Promise(yes => { release = yes; }), started = new Promise(yes => { entered = yes; });
  const cancelled = new GameEventSaveCoordinator(f.flow, { prepareSave: async (...args) => {
    const prepared = await storage.prepareSave(...args); entered(); await gate; return prepared;
  } });
  const pending = cancelled.save(2); await started; cancelled.cancel(); release();
  assert.equal((await pending).status, "cancelled"); assert.deepEqual([...values], prior); assert.equal(f.session.eventSaveRequest, request);
  report.lifecycle.push("cancelled encoder cannot replace storage or ACK");
  const saver = new GameEventSaveCoordinator(f.flow, storage); fail = true;
  assert.equal((await saver.save(3)).status, "failed"); assert.deepEqual([...values], prior);
  assert.equal(f.session.eventSaveRequest, request); assert.equal(f.itemCount(), 2);
  report.lifecycle.push("quota failure preserves previous slot, same request and prior grants");
  fail = false; assert.equal((await saver.save(4)).status, "committed"); assert.equal(writes, 2); assert.equal(f.itemCount(), 2);
  const saved = await storage.load(), next = GameSession.restore(saved.checkpoint, f.field, f.battle);
  assert.equal(next.eventSaveRequest, null); assert.equal(f.itemCount(next), 2);
  next.advance(0); assert.equal(f.itemCount(next), 2); next.advance(10); f.session.advance(10);
  assert.equal(f.itemCount(next), 5); assert.deepEqual(next.checkpoint(), f.session.checkpoint());
  report.lifecycle.push("retry commits once; post-ACK restore does not replay grants and resumes next clock");
  // All source-listed payloads are reverified, and the exact starting headers
  // prevent a newly valid snapshot from replacing this run's decoder inputs.
  for (const snapshot of snapshots) {
    assert.equal(sha(await readFile(snapshot.path)), snapshot.sha256, "Source snapshot header changed");
    await readSnapshot(resolve(root, "build", snapshot.name));
  }
  for (const file of nativeFiles) assert.equal(sha(await readFile(file.path)), file.sha256, "Native evidence bytes changed");
  report.runtimeAfterSha256 = await runtimeDigest(root, compiled);
  report.runtimeStable = report.runtimeAfterSha256 === runtimeBefore;
  assert.equal(report.runtimeStable, true, "AutoSave receipt runtime changed during execution");
  report.sourceSnapshotsRevalidated = true; report.nativeEvidenceRevalidated = true;
  report.result = "pass";
} catch (error) { report.result = "failed"; report.error = String(error); throw error; }
finally { await writeFile(path, JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n"); }
console.log(JSON.stringify({ result: report.result, ...report.counts, lifecycle: report.lifecycle,
  runtimeStable: report.runtimeStable, runtimeSha256: report.runtimeSha256,
  sourceOpcodeFullyMigrated: false, sourceProgramsExecuted: 0, nativeParity: false }));
