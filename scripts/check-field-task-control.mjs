// Full local corpus decoding plus bounded pure control projections. No field
// host, source actor alias resolution or playable-map coverage is claimed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { decodeFieldOp } = await module("compiler/field");
const { hash } = await module("compiler/content");
const { compileFieldTaskControlInstruction, fieldTaskControlMnemonics } = await module("compiler/field-task-control");
const { prepareFieldCall, prepareFieldReturn, prepareFieldPuppetEntry, fieldPuppetControlStep,
  projectFieldPuppetReady, fieldPuppetMainEnd } = await module("core/field-task-control");
const output = root + "build/reports/field-task-control-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-task-control-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-task-control-native-check.json");
const native = JSON.parse(nativeBytes), corpus = await loadCorpus(root);
assert.equal(native.semanticsVerified, false);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const sourceCounts = {}, decoded = [], blocked = [], shared = {}, pairs = [];
const sleeping = () => Array(32).fill("sleep");
const formComplete = (raw) => raw.operands && ["iValues", "rValues", "sValues"].every((key) =>
  Array.isArray(raw.operands[key]) && raw.operands[key].length === 8);
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  const instructions = asset.data.Mnemonics ?? [];
  const shapes = instructions.map((i) => ({ kind: i.mnemonic === "Exit" ? "exit" : "other" }));
  for (const [index, raw] of instructions.entries()) {
    if (!fieldTaskControlMnemonics.includes(raw.mnemonic)) continue;
    const counts = sourceCounts[raw.mnemonic] ??= { total: 0, decoded: 0, blocked: 0 };
    counts.total++;
    const site = { script: asset.data.Name ?? asset.id, index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
    assert.match(site.source.objectId, /^-?\d+$/);
    let op;
    try { op = compileFieldTaskControlInstruction(raw); }
    catch (error) {
      assert.equal(!!formComplete(raw), false, "A complete source form must not silently enter legacy rejection counts");
      counts.blocked++;
      blocked.push({ site, mnemonic: raw.mnemonic, instructionHash: hash(raw), reason: error.message });
      continue;
    }
    assert.ok(formComplete(raw));
    counts.decoded++;
    const current = decodeFieldOp(raw, site, {}, corpus.tables);
    const routes = shared[raw.mnemonic] ??= {};
    routes[current.kind] = (routes[current.kind] ?? 0) + 1;
    const result = { site, mnemonic: raw.mnemonic, instructionHash: hash(raw), op, sharedKind: current.kind };
    if (op.kind === "call") {
      assert.equal(instructions[op.target]?.mnemonic, "Nop", "Source Call targets its label");
      const range = { min: 0, max: instructions.length - 1 };
      const call = prepareFieldCall({ nextPc: index + 1, target: op.target, stack: [], range });
      assert.equal(call.pc, raw.operands.iValues[0] + 1);
      assert.deepEqual(prepareFieldReturn({ stack: call.stack, range }), { pc: index + 1, stack: [] });
      result.projection = call;
      if (instructions[op.target].type === 2) {
        const end = instructions.findIndex((i, n) => n > op.target && i.mnemonic === "Return");
        assert.ok(end > op.target);
        const execs = instructions.slice(op.target + 1, end).filter((i) => i.mnemonic === "ExecPuppet");
        assert.equal(execs.length, 1);
        assert.equal(execs[0].operands.iValues[0], raw.operands.iValues[1]);
        pairs.push({ site, marker: raw.operands.iValues[1], target: op.target, returnIndex: end,
          execHash: hash(execs[0]), asynchronous: compileFieldTaskControlInstruction(execs[0]).asynchronous });
      }
    } else if (op.kind === "puppet") {
      assert.equal(instructions[op.target]?.mnemonic, "Nop");
      const entry = prepareFieldPuppetEntry({ ...op, slots: sleeping(), instructions: shapes });
      assert.equal(entry.pc, raw.operands.iValues[2]);
      assert.equal(instructions[entry.range.max].mnemonic, "Exit");
      assert.ok(!instructions.slice(entry.range.min, entry.range.max).some((i) => i.mnemonic === "Exit"));
      result.projection = entry;
    }
    decoded.push(result);
  }
}
assert.deepEqual(sourceCounts, {
  Call: { total: 7898, decoded: 7892, blocked: 6 },
  Return: { total: 7916, decoded: 7907, blocked: 9 },
  SetPuppet: { total: 18915, decoded: 18888, blocked: 27 },
  ExecPuppet: { total: 7810, decoded: 7796, blocked: 14 },
  FinishPuppet: { total: 477, decoded: 477, blocked: 0 },
});
assert.equal(pairs.length, 7796);
assert.equal(pairs.filter((p) => p.marker === 1 && p.asynchronous).length, 477);
// Explicitly distinguish the staged capability from current production routing.
assert.equal(shared.ExecPuppet["exec-puppets"] ?? 0, 0);
assert.equal(shared.FinishPuppet["finish-puppets"] ?? 0, 0);

const controlled = [];
for (const asynchronous of [false, true]) {
  const sourceOp = decoded.find((entry) => entry.op.kind === "exec-puppets" && entry.op.asynchronous === asynchronous);
  assert.ok(sourceOp);
  const slots = sleeping(); slots[20] = "awake"; slots[4] = "awake"; slots[30] = "ready";
  const input = { kind: "exec", firstClock: true, asynchronous, worldMapScript: false, callback: "absent", slots };
  const before = structuredClone(input), start = fieldPuppetControlStep(input);
  assert.deepEqual(input, before);
  assert.deepEqual(start.startSlots, [4, 20]);
  assert.equal(start.flow, asynchronous ? "next" : "wait");
  assert.equal(start.collisionEnabled, false);
  for (const slot of start.startSlots) slots[slot] = projectFieldPuppetReady("present").status;
  const finish = fieldPuppetControlStep({ ...input, kind: "finish", slots });
  assert.equal(finish.flow, "wait");
  slots[4] = "sleep"; slots[20] = "sleep";
  assert.equal(fieldPuppetControlStep({ ...input, kind: "finish", slots }).flow, "wait", "Unrelated global Ready slot still owns work");
  const cancelled = fieldPuppetMainEnd(slots);
  assert.deepEqual(cancelled.forcedExitSlots, [30]);
  slots[30] = "sleep";
  const done = fieldPuppetControlStep({ ...input, kind: "finish", slots });
  assert.equal(done.flow, "next"); assert.equal(done.collisionEnabled, true);
  const staged = sleeping(); staged[9] = "awake";
  const pendingOnly = fieldPuppetControlStep({ ...input, kind: "finish", slots: staged });
  assert.deepEqual(pendingOnly.startSlots, []); assert.equal(pendingOnly.flow, "next");
  for (const callback of ["unknown", "unsupported"])
    assert.throws(() => fieldPuppetControlStep({ ...input, slots: staged, callback }), /callback/);
  controlled.push({ source: sourceOp.site, controlledSlotAndActorContext: true, start, finish, cancelled, done, pendingOnly });
}
const report = { kind: "field-task-control", sourceSetHash: corpus.sourceSetHash,
  nativeReportSha256: createHash("sha256").update(nativeBytes).digest("hex"),
  originalGameExecuted: false, sharedFieldSchedulerIntegrated: false,
  sourceCounts, totalDecoded: decoded.length, totalBlocked: blocked.length,
  generatedHelperPairs: pairs.length, asynchronousHelpers: pairs.filter((p) => p.asynchronous).length,
  sharedDecoderRoutes: shared, controlled, decoded, blocked,
  limits: ["All-corpus counts include legacy and development records and do not measure playable content",
    "Actor aliases, callbacks, first/last InitializePlayerPuppetEntities and host publication remain unintegrated",
    "Current shared synchronous join is a development approximation; async and Finish remain blocked"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", decoded: decoded.length, blocked: blocked.length,
  generatedHelperPairs: pairs.length, asynchronousHelpers: report.asynchronousHelpers,
  controlledPureProbes: controlled.length, sharedFieldSchedulerIntegrated: false }));
