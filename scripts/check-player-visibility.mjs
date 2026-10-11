// Exact source instructions exercised against explicit controlled field owners.
// Counts describe decoded sites and pure transitions, never reachable maps.
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
const { hash } = await module("compiler/content");
const { decodeFieldOp } = await module("compiler/field");
const { compilePlayerVisibilityInstruction, compilePlayerVisibilityFactory, playerVisibilityMnemonics } = await module("compiler/player-visibility");
const { projectPlayerVisibility } = await module("core/player-visibility");
const { FieldGame } = await module("core/field");
const { EventState } = await module("core/event-state");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportPath = root + "build/reports/player-visibility-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(process.execPath, [root + "scripts/check-player-visibility-native.mjs"],
  { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/player-visibility-native-check.json");
const native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const corpus = await loadCorpus(root);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const factory = compilePlayerVisibilityFactory(corpus.manifest.sources);
assert.equal(factory.capability.childEntityObject, "absent");
assert.equal(native.playerFactory.capability.childEntityObject, "absent");
const calls = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  for (const [index, instruction] of (asset.data.Mnemonics ?? []).entries()) {
    if (!playerVisibilityMnemonics.includes(instruction.mnemonic)) continue;
    const site = { script: asset.data.Name, index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
    assert.equal(typeof site.source.objectId, "string");
    assert.match(site.source.objectId, /^-?\d+$/);
    const direct = compilePlayerVisibilityInstruction(instruction);
    const decoded = decodeFieldOp(instruction, site, {}, corpus.tables);
    assert.equal(decoded.kind, "player-visibility", "Shared decoder must use the exact player-specific operation");
    assert.deepEqual(decoded.command, direct.command);
    assert.deepEqual(decoded.source, site.source);
    calls.push({ site, command: direct.command, instructionHash: hash(instruction), op: decoded });
  }
}
assert.equal(calls.length, 112);
assert.equal(calls.filter((c) => c.command.kind === "hide-player").length, 107);
assert.equal(calls.filter((c) => c.command.kind === "show-player").length, 5);
assert.ok(calls.some((c) => c.site.script === "sc_e_0001" && c.site.index === 2 && c.command.kind === "hide-player"));

const binding = {
  playerId: "controlled:real-player", partyPlayerId: "controlled:real-player",
  childEntityObject: "absent",
};
const controlled = [];
const fieldExecutions = [];
const controlledSource = { file: "controlled", assetPath: "player-visibility-host" };
const successorFlag = { category: "ScenarioFlag1", index: 14 };
const provedHost = { playerVisibility: factory.capability };
function fieldContent(op, playerVisible) {
  const site = { script: "controlled-visibility", index: 1, source: controlledSource };
  return {
    formatVersion: 1, kind: "field-development", sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    contentHash: hash({ controlled: true, op, playerVisible }),
    map: {
      id: "controlled-visibility", width: 3, height: 3, tileSize: 16,
      layers: [], tilesets: [], textures: {}, collisions: { 1: Array(9).fill(0) },
      source: controlledSource,
      entities: [{ id: "npc", kind: 6, x: 2, y: 1, layer: 1, width: 1, height: 1,
        direction: "left", asset: "controlled-npc", script: null,
        collision: null, destinationLayer: null, source: controlledSource }],
    },
    characters: {},
    scripts: { probe: [op, { ...site, kind: "flag", ref: successorFlag, operation: "set" },
      { ...site, index: 2, kind: "exit" }] },
    entry: { player: { x: 1, y: 1, layer: 1, direction: "right",
      asset: "controlled-body", mount: "controlled-armor" }, playerVisible,
      evidence: [controlledSource], description: "Controlled field geometry and mounted actor; exact source visibility instruction" },
    limitations: ["Logic-only controlled host; no browser or native rendering claim"],
  };
}
for (const call of calls) for (const initiallyVisible of [true, false]) {
  const owner = new Set(["controlled:npc", "native:puppet:1"]);
  if (!initiallyVisible) owner.add(binding.playerId);
  const before = [...owner], hostBefore = structuredClone(binding);
  const plan = projectPlayerVisibility(call.command, binding, owner);
  const visible = call.command.kind === "show-player";
  assert.equal(plan.hiddenEntities.has(binding.playerId), !visible);
  assert.equal(plan.visible, visible);
  assert.equal(plan.fadeAlpha, visible ? 1 : 0);
  assert.equal(plan.currentFadeStatus, 0);
  assert.equal(plan.flow, "next");
  assert.ok(plan.hiddenEntities.has("controlled:npc"));
  assert.ok(plan.hiddenEntities.has("native:puppet:1"));
  assert.ok(!plan.hiddenEntities.has("-1001"));
  assert.deepEqual([...owner], before);
  assert.deepEqual(binding, hostBefore);
  // A candidate can be serialized by the field's single hiddenEntities owner.
  const restoredOwner = new Set(JSON.parse(JSON.stringify([...plan.hiddenEntities])));
  const again = projectPlayerVisibility(call.command, binding, restoredOwner);
  assert.deepEqual(again.hiddenEntities, plan.hiddenEntities);
  controlled.push({ script: call.site.script, index: call.site.index, initiallyVisible,
    visible, alpha: plan.fadeAlpha, flow: plan.flow, preservesOtherIdentities: true });

  const content = fieldContent(call.op, initiallyVisible);
  const field = new FieldGame(content, EventState.initialized(), undefined, undefined, provedHost);
  field.hiddenEntities.add("npc");
  const fieldOwner = field.hiddenEntities, body = JSON.stringify(field.player);
  assert.equal(field.startEvent("probe"), true);
  assert.equal(field.stop, null);
  assert.equal(field.busy, false);
  assert.equal(field.time, 0);
  assert.equal(field.eventState.read(successorFlag), 1);
  assert.equal(field.hiddenEntities, fieldOwner);
  assert.equal(fieldOwner.has(field.player.id), !visible);
  assert.ok(fieldOwner.has("npc"));
  assert.equal(JSON.stringify(field.player), body);
  const checkpoint = field.checkpoint();
  assert.ok(!Object.hasOwn(checkpoint, "playerVisibility"));
  const restored = FieldGame.restore(content, checkpoint, provedHost);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  fieldExecutions.push({ script: call.site.script, index: call.site.index,
    initiallyVisible, visible, bodyAndMountPreserved: true,
    sameHiddenOwner: true, checkpointRoundTrip: true, noAdmissionInSave: true });
}
const rejected = [];
for (const [name, bad] of [
  ["unresolved-child", { ...binding, childEntityObject: "unresolved" }],
  ["puppet-instead-of-player", { ...binding, partyPlayerId: "native:puppet:0" }],
]) for (const kind of ["hide-player", "show-player"]) {
  const owner = new Set([binding.playerId, "controlled:npc"]), before = [...owner];
  assert.throws(() => projectPlayerVisibility({ kind }, bad, owner));
  assert.deepEqual([...owner], before);
  rejected.push({ name, kind, preserved: true });
}
const rejectedFields = [];
for (const kind of ["hide-player", "show-player"]) {
  const call = calls.find((c) => c.command.kind === kind);
  for (const [name, host] of [["no-capability", {}],
    ["unresolved-child", { playerVisibility: { childEntityObject: "unresolved" } }]]) {
    const content = fieldContent(call.op, kind === "hide-player");
    const field = new FieldGame(content, EventState.initialized(), undefined, undefined, host);
    const owner = field.hiddenEntities, before = [...owner], player = JSON.stringify(field.player);
    field.startEvent("probe");
    assert.equal(field.stop?.kind, "unsupported");
    assert.match(field.stop.message, /child-entity propagation is unresolved/);
    assert.deepEqual([...owner], before);
    assert.equal(field.hiddenEntities, owner);
    assert.equal(JSON.stringify(field.player), player);
    assert.equal(field.eventState.read(successorFlag), 0);
    rejectedFields.push({ name, kind, ownerUnchanged: true, successorPrevented: true });
  }
}
const hideCall = calls.find((c) => c.command.kind === "hide-player");
const showCall = calls.find((c) => c.command.kind === "show-player");
const resumeContent = fieldContent(hideCall.op, true);
resumeContent.scripts.resume = [showCall.op,
  { kind: "exit", script: "controlled-resume", index: 1, source: controlledSource }];
const beforeSave = new FieldGame(resumeContent, EventState.initialized(), undefined, undefined, provedHost);
beforeSave.startEvent("probe");
const saved = beforeSave.checkpoint();
const noSavedAdmission = FieldGame.restore(resumeContent, saved);
noSavedAdmission.startEvent("resume");
assert.equal(noSavedAdmission.stop?.kind, "unsupported");
assert.ok(noSavedAdmission.hiddenEntities.has(noSavedAdmission.player.id));
const resumed = FieldGame.restore(resumeContent, saved, provedHost);
resumed.startEvent("resume");
assert.equal(resumed.stop, null);
assert.ok(!resumed.hiddenEntities.has(resumed.player.id));
assert.ok(beforeSave.hiddenEntities.has(beforeSave.player.id));
const restoreAndShow = { hideSite: hideCall.site, showSite: showCall.site,
  noSavedAdmission: true, explicitShowRestores: true, originalOwnerUnchanged: true };
const report = {
  lane: "source-player-visibility-controlled-projection", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  nativeReportSha256: sha(nativeBytes), calls, controlled, rejected,
  fieldExecutions, rejectedFields, restoreAndShow, factory,
  controlledHost: { ...binding,
    note: "Controlled field geometry/identity; child capability compiled from the exact reviewed DLL and complete prefab source" },
  semanticsVerified: false, originalGameExecuted: false,
  doesNotEstablish: ["native-dynamic-parity", "arbitrary-or-rebound-child-absence", "browser-rendering",
    "complete-prelude-execution", "reachable-script-or-map-coverage", "full-game-migration"],
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, bytes);
console.log(JSON.stringify({ decodedSourceSites: calls.length, hide: 107, show: 5,
  controlledProjections: controlled.length, rejectedHostCases: rejected.length,
  controlledFieldExecutions: fieldExecutions.length, rejectedFieldCases: rejectedFields.length,
  reportSha256: sha(bytes), semanticsVerified: false, originalGameExecuted: false }));
