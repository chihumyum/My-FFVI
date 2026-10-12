// Source instructions plus controlled readonly contexts and shared FieldGame.
// This does not establish that the surrounding source stories are playable.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { decodeFieldOp } = await module("compiler/field");
const { hash } = await module("compiler/content");
const { compileEventContextBranchInstruction, eventContextBranchMnemonics } = await module("compiler/event-context-branch");
const { prepareEventContextBranch } = await module("core/event-context-branch");
const { FieldGame } = await module("core/field");
const { EventState } = await module("core/event-state");
const { checkpointFixture } = await import(pathToFileURL(resolve(compiled, "tests/fixtures/checkpoint-game.js")).href);
const output = root + "build/reports/event-context-branch-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-event-context-branch-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/event-context-branch-native-check.json");
const native = JSON.parse(nativeBytes), corpus = await loadCorpus(root);
assert.equal(native.semanticsVerified, false);
assert.equal(corpus.manifest.sources.find((source) => source.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const sourceCounts = {}, decoded = [], sourceTargets = {}, pure = [];
const contextRoster = (sourceId, scope, present) => ({
  owned: [
    { ownedId: 501, sourceId, enabled: scope === 1 && present, conditionTypes: [] },
    { ownedId: 502, sourceId: sourceId === 18 ? 17 : 18, enabled: true, conditionTypes: [] },
  ],
  party: [scope === 0 && present ? 501 : 502, 0, 0, 0],
});
for (const asset of corpus.assets.filter((asset) => asset.kind === "script")) {
  const instructions = asset.data.Mnemonics ?? [];
  for (const [index, raw] of instructions.entries()) {
    if (!eventContextBranchMnemonics.includes(raw.mnemonic)) continue;
    const site = { script: asset.data.Name ?? asset.id, index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
    assert.match(site.source.objectId, /^-?\d+$/);
    const op = compileEventContextBranchInstruction(raw);
    assert.deepEqual(decodeFieldOp(raw, site, {}, corpus.tables), { ...site, ...op });
    sourceCounts[raw.mnemonic] = (sourceCounts[raw.mnemonic] ?? 0) + 1;
    const ints = raw.operands.iValues, range = { min: 0, max: instructions.length - 1 };
    const targets = raw.mnemonic === "BranchByCharacter" ? [ints[3]] : ints.slice(0, 4);
    for (const target of targets) {
      assert.ok(target >= 0 && target + 1 < instructions.length);
      const mnemonic = instructions[target]?.mnemonic;
      assert.equal(typeof mnemonic, "string");
      sourceTargets[mnemonic] = (sourceTargets[mnemonic] ?? 0) + 1;
    }
    if (raw.mnemonic === "BranchByCharacter") {
      for (const present of [false, true]) {
        const roster = contextRoster(ints[0], ints[2], present), before = structuredClone(roster);
        const result = prepareEventContextBranch(op, { nextPc: index + 1, range, roster });
        const expectedTaken = Number(!present) === ints[1];
        assert.deepEqual(result, { pc: expectedTaken ? ints[3] + 1 : index + 1, branched: expectedTaken });
        assert.deepEqual(roster, before);
        pure.push({ instructionHash: hash(raw), present, result });
      }
    } else {
      for (const [playerDirection, selector] of [["up", 0], ["right", 1], ["down", 2], ["left", 3], [null, 2]]) {
        const result = prepareEventContextBranch(op, { nextPc: index + 1, range, playerDirection });
        assert.deepEqual(result, { pc: ints[selector] + 1, branched: true });
        pure.push({ instructionHash: hash(raw), playerDirection, result });
      }
    }
    decoded.push({ site, mnemonic: raw.mnemonic, instructionHash: hash(raw), op, ints, sourceLength: instructions.length });
  }
}
assert.deepEqual(sourceCounts, { BranchByCharacter: 441, BranchByPlayerDirection: 129 });
assert.equal(pure.length, 1527);

// Keep exact source instruction/addresses. Only surrounding marker instructions,
// actor pose and readonly roster are controlled to isolate the VM route.
const controlled = [], ref = { category: "MapLocalVariable", index: 0 };
function hostFixture(entry, markerTargets, roster, playerDirection) {
  const { field } = checkpointFixture();
  const script = "controlled-event-context-branch";
  const source = { file: "synthetic", assetPath: "context-branch-route-markers" };
  const marker = (index, value) => ({ kind: "calc", left: ref, operator: "←", right: { kind: "immediate", value }, script, index, source });
  const ops = Array.from({ length: entry.sourceLength }, (_, index) => ({ kind: "nop", script, index, source }));
  for (const [target, value] of markerTargets) {
    ops[target] = marker(target, value);
    ops[target + 1] = { kind: "exit", script, index: target + 1, source };
  }
  ops[entry.site.index] = { ...entry.site, ...entry.op, script };
  field.scripts[script] = ops;
  const state = EventState.initialized(); state.write(ref, 0);
  const game = new FieldGame(field, state, undefined, undefined,
    roster === undefined ? {} : { puppetRoster: { current: () => structuredClone(roster) } });
  if (playerDirection !== undefined) game.player.direction = playerDirection;
  return { game, state, field, script };
}
for (const scope of [0, 1]) for (const absent of [0, 1]) {
  const entry = decoded.find((e) => e.mnemonic === "BranchByCharacter" &&
    e.ints[1] === absent && e.ints[2] === scope && e.ints[3] >= e.site.index + 2 &&
    e.ints[3] + 2 < e.sourceLength);
  assert.ok(entry, `Required real source form i1=${absent}, i2=${scope}`);
  for (const present of [false, true]) {
    const roster = contextRoster(entry.ints[0], scope, present), expected = Number(!present) === absent ? 33 : 22;
    const { game, state, script } = hostFixture(entry, [[entry.site.index + 1, 22], [entry.ints[3] + 1, 33]], roster);
    assert.equal(game.startEvent(script), true);
    assert.equal(game.stop, null); assert.equal(game.busy, false); assert.equal(state.read(ref), expected);
    const saved = game.checkpoint();
    const restored = FieldGame.restore(game.content, saved, { puppetRoster: { current: () => structuredClone(roster) } });
    assert.equal(restored.eventState.read(ref), expected);
    assert.equal(restored.busy, false);
    controlled.push({ source: entry.site, lane: "source instruction / controlled shared FieldGame", present, marker: expected, checkpointRestored: true });
  }
}
const directionEntry = decoded.find((e) => e.mnemonic === "BranchByPlayerDirection" &&
  new Set(e.ints.slice(0, 4)).size === 4 && e.ints.slice(0, 4).every((target) => target > e.site.index && target + 2 < e.sourceLength) &&
  e.ints.slice(0, 4).every((a, i, all) => all.every((b, j) => i === j || Math.abs(a - b) >= 3)));
assert.ok(directionEntry, "Distinct source direction labels with separate controlled marker paths");
for (const [playerDirection, selector] of [["up", 0], ["right", 1], ["down", 2], ["left", 3]]) {
  const markers = directionEntry.ints.slice(0, 4).map((target, index) => [target + 1, 10 + index]);
  const { game, state, script } = hostFixture(directionEntry, markers, undefined, playerDirection);
  assert.equal(game.startEvent(script), true);
  assert.equal(game.stop, null); assert.equal(game.busy, false); assert.equal(state.read(ref), 10 + selector);
  controlled.push({ source: directionEntry.site, lane: "source instruction / controlled actual-player pose", playerDirection, marker: 10 + selector });
}
const characterEntry = decoded.find((e) => e.mnemonic === "BranchByCharacter" && e.site.index === 1 && e.ints[3] > 4);
assert.ok(characterEntry);
for (const mode of ["missing-roster", "unresolved-owned-id"]) {
  const roster = mode === "missing-roster" ? undefined : { owned: [], party: [999, 0, 0, 0] };
  const { game, state, script } = hostFixture(characterEntry, [[characterEntry.site.index + 1, 22], [characterEntry.ints[3] + 1, 33]], roster);
  const before = state.snapshot();
  game.startEvent(script);
  assert.equal(game.stop?.kind, "unsupported");
  assert.match(game.stop.message, /roster provider|corps identity/);
  assert.deepEqual(state.snapshot(), before);
  controlled.push({ source: characterEntry.site, lane: "controlled unavailable owner", mode, blockedBeforeMarker: true });
}
assert.equal(controlled.length, 14);
const invalid = {
  type: 1, mnemonic: "BranchByCharacter", operands: {
    iValues: [1, 2, 0, 4, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill(""),
  },
};
assert.equal(decodeFieldOp(invalid, characterEntry.site, {}, corpus.tables).kind, "blocked");
const report = {
  kind: "event-context-branch-source", sourceSetHash: corpus.manifest.sourceSetHash,
  nativeReportSha256: createHash("sha256").update(nativeBytes).digest("hex"),
  originalGameExecuted: false, sourceCounts, decoded: decoded.length,
  sourceTargetMnemonics: sourceTargets, pureCases: pure.length, controlledHostCases: controlled.length,
  sourceInstructions: decoded, pure, controlled,
  limits: ["Surrounding story scripts/actor initialization are not executed", "Roster contents and pose are controlled mechanism probes",
    "Known-zero direction is tested in the pure model; FieldGame requires a prepared player pose before starting these controlled events",
    "Source decoding count does not establish map playability", "No original-game dynamic equivalence claim"],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", sourceCounts, pureCases: pure.length,
  controlledHostCases: controlled.length, originalGameExecuted: false }));
