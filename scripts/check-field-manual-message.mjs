// Raw source instructions and the shared session/flow. Surrounding marker
// events, geometry and yes/no options are controlled, not a played story.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { syncFieldMessageView } from "../apps/game/source-message-view.js";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"),
  module = name => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = value => createHash("sha256").update(value).digest("hex");
const { loadCorpus } = await module("compiler/corpus"), { decodeFieldOp } = await module("compiler/field"),
  { compileManualMessageInstruction } = await module("compiler/message"), { GameSession } = await module("core/game-session"),
  { GameFlow } = await module("core/game-flow"), { hash } = await module("compiler/content");
const { loadSystemSource } = await module("compiler/system-source"),
  { fieldMessageNameReferences } = await module("core/field-message-template");
const { choiceFixture, choiceDefinition, choiceAssign, choiceExit, choiceVariable } =
  await import(pathToFileURL(resolve(compiled, "tests/fixtures/field-choice.js")).href);
await mkdir(root + "build/reports", { recursive: true });
execFileSync(process.execPath, [root + "scripts/check-source-message-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/source-message-native-check.json"), native = JSON.parse(nativeBytes),
  symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8")),
  dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.equal(sha(await readFile(root + "build/native/il2cpp/script.json")), native.symbolsSha256);
assert.equal(symbols.ScriptString.find(row => row.Address === 0x1fd8b30)?.Value, "Select");
assert.equal(symbols.ScriptString.find(row => row.Address === 0x1fda990)?.Value, "Msg");
assert.ok(dump.includes('NewPageTagRegex = "<(?i)P(?-i)>";'));
const contentCode = await readFile(root + "build/native/v31-source-message/98c360.c", "utf8"),
  pageCode = await readFile(root + "build/native/v31-message-playback/98dd40.c", "utf8");
assert.match(contentCode, /case 3:[\s\S]*NewLineTag/);
assert.match(pageCode, /newPageLineList[\s\S]*Contains[\s\S]*if \(bVar7\) break/);
// Shared get_Type RVA is bound to NewPageContent; do not infer it from the
// unrelated function name used by Ghidra for a shared constant-return body.
const newPage = symbols.ScriptMethod.find(row => row.Name === "Last.Systems.Message.NewPageContent$$get_Type");
assert.equal(newPage?.Address, 0x3759d0);
const pageType = execFileSync(root + ".venv/bin/python", ["-c", String.raw`import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1]); from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
print(p.read(0x3759d0,6)[2].hex())`, root], { encoding: "utf8" }).trim();
assert.equal(pageType, "b803000000c3");
const corpus = await loadCorpus(root), plan = JSON.parse(await readFile(root + "build/reports/corpus-plan.json", "utf8"));
assert.equal(plan.sourceSetHash, corpus.sourceSetHash);
assert.equal(corpus.manifest.sources.find(row => row.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const systemSource = await loadSystemSource(root, corpus.manifest.parentSourceSetHash),
  nameRows = corpus.tables["character_default_name.csv"];
assert.equal(systemSource.sourceSetHash, corpus.sourceSetHash);
assert.equal(nameRows.length, 14);
assert.deepEqual(systemSource.tables["character_default_name.csv"], nameRows);
const sourceNameRows = nameRows.map(value => {
  const row = systemSource.reader.row("character_default_name.csv", value.id);
  assert.deepEqual(row.values, value);
  assert.match(row.source.objectId, /^-?(?:0|[1-9]\d*)$/);
  return { rowId: Number(value.id), sourceId: Number(value.character_id), tag: value.tag_name, source: row.source };
});
const bindRef = ref => {
  const row = sourceNameRows.find(value => value.rowId === ref.rowId);
  assert.equal(row?.tag, ref.tag); assert.equal(row?.sourceId, ref.sourceId);
  return { ...ref, source: row.source };
};
const fieldIds = new Set(plan.scripts.filter(script => script.domain === "field").map(script => script.id)),
  accepted = [], blocked = [], samples = [];
let sites = 0;
for (const asset of corpus.assets.filter(asset => asset.kind === "script" && fieldIds.has(asset.id))) {
  const instructions = asset.data.Mnemonics ?? [];
  for (const [index, raw] of instructions.entries()) {
    if (raw.mnemonic !== "Msg") continue;
    sites++;
    const context = { nextMnemonic: instructions[index + 1]?.mnemonic ?? null },
      site = { script: asset.data.Name, index, source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
    let op;
    try { op = compileManualMessageInstruction(raw, corpus.messages, context, nameRows); }
    catch (error) { blocked.push({ ...site, reason: error.message }); continue; }
    assert.deepEqual(decodeFieldOp(raw, site, corpus.messages, corpus.tables, context), { ...site, ...op });
    accepted.push({ ...site, instructionHash: hash(raw), key: op.key, speakerHash: hash(op.speaker),
      pageHashes: op.manual.pages.map(hash), window: op.manual.window, anchor: op.manual.anchor, after: op.manual.after,
      alignment: op.alignment ?? "left", nameReferences: op.template ? fieldMessageNameReferences(op.template).map(bindRef) : [] });
    samples.push({ site, op });
  }
}
assert.equal(sites, 4615);
// This older journey deliberately retains its static-dialogue scope. Dynamic
// source names use the real owned provider in check-field-message-names.mjs.
const paged = samples.find(sample => !sample.op.template && sample.op.manual.pages.length > 1 && sample.op.manual.window === "frame" && sample.op.manual.after === "close"),
  windowless = samples.find(sample => !sample.op.template && sample.op.manual.window === "none" && sample.op.manual.after === "close");
assert.ok(paged, "A real explicit-page framed message is required");
assert.ok(windowless, "A real windowless synchronous message is required");
const prompt = compileManualMessageInstruction({ type: 1, mnemonic: "Msg", operands: {
  iValues: [0, 2, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0),
  sValues: ["CONTROLLED_PROMPT", "", "", "", "", "", "", ""],
} }, { story_mes_zhc: { CONTROLLED_PROMPT: "Choose the controlled route." }, story_cha_zhc: { CONTROLLED_PROMPT: "" } },
{ nextMnemonic: "Select" });
const f = choiceFixture([paged.op, choiceAssign(1), windowless.op, choiceAssign(2), prompt,
  choiceDefinition({ presentation: "yes-no", anchor: "bottom-right", initialIndex: 1 }), choiceAssign(3), choiceExit]);
const game = new GameSession(f.content, f.battle, 1), flow = new GameFlow(game),
  ready = { visible: true, mediaReady: true, overlayOpen: false }, stages = [],
  record = name => stages.push({ name, phase: flow.phase, mask: game.field.updateAttributeMask,
    marker: game.field.eventState.read(choiceVariable()), page: game.field.dialogue?.manual?.page ?? null });
// These two event values belong to the controlled surrounding script, not to
// the original story. A fresh session must not infer unobserved source flags.
game.field.eventState.write(choiceVariable(), 0);
game.field.eventState.write({ category: "MessageSelection", index: 0 }, 0);
flow.start(); flow.advance(0, ready); game.field.startEvent("choice"); record("source-paged-message");
assert.equal(game.field.updateAttributeMask, 9);
assert.equal(game.field.menuReady, false); assert.throws(() => game.checkpoint(), /save/i);
assert.throws(() => game.field.previewMap(2, 1), /during an event/);
flow.pause(true); flow.confirm(); flow.advance(1000, ready); assert.equal(game.field.dialogue.manual.page, 0);
record("paused"); flow.pause(false);
flow.advance(10, { ...ready, visible: false }); flow.confirm(); assert.equal(game.field.dialogue.manual.page, 0);
flow.advance(10, { ...ready, mediaReady: false }); flow.confirm(); assert.equal(game.field.dialogue.manual.page, 0);
record("input-gated");
let confirmations = 0;
while (!game.field.choice && game.field.busy && !game.field.stop) {
  assert.ok(confirmations++ < 100);
  flow.advance(10, ready); assert.ok(game.field.dialogue);
  const before = game.field.dialogue;
  flow.confirm(); const after = game.field.dialogue;
  flow.confirm(); assert.equal(game.field.dialogue, after, "same clock cannot consume the following page/window");
  if (after && after.key === before.key) assert.equal(after.manual.page, before.manual.page + 1);
}
assert.equal(game.field.stop, null); assert.ok(game.field.choice); record("yes-no-retains-prompt");
const request = game.field.choice;
assert.equal(game.field.messageWindow.key, "CONTROLLED_PROMPT");
flow.confirm(); assert.equal(game.field.choice, request); assert.equal(game.field.eventState.read({ category: "MessageSelection", index: 0 }), 0);
assert.equal(flow.choose(request.id, 1), true); assert.equal(flow.choose(request.id, 0), false);
flow.advance(10, ready); assert.equal(flow.phase, "exploration"); assert.equal(game.field.updateAttributeMask, 3);
assert.equal(game.field.eventState.read(choiceVariable()), 3); record("event-complete");
const saved = game.checkpoint(), restored = GameSession.restore(JSON.parse(JSON.stringify(saved)), f.content, f.battle);
assert.deepEqual(restored.state.snapshot(), game.state.snapshot());
assert.equal(restored.field.eventState.read(choiceVariable()), 3); assert.equal(restored.field.messageWindow, null);
const again = new GameFlow(restored); again.start(); again.advance(0, ready);
assert.equal(again.choose(request.id, 0), false); assert.equal(again.phase, "exploration"); record("saved-and-restored");

// Execute the actual app projection block against an explicit DOM-shaped host.
// This verifies wiring, not browser CSS layout or original-game pixels.
const appBytes = await readFile(root + "apps/game/app.js"), app = appBytes.toString(),
  helperBytes = await readFile(root + "apps/game/source-message-view.js"),
  block = app.match(/^  syncFieldMessageView\(\{ dialogue: \$\("dialogue"\), speaker: \$\("speaker"\), message: \$\("message"\), next: \$\("next"\) \}, game, flow\.paused\);$/m)?.[0];
assert.ok(app.includes('import { syncFieldMessageView } from "./source-message-view.js";'));
assert.ok(block, "The real app must call its production message projection helper");
const nodes = Object.fromEntries(["speaker", "message", "dialogue", "next"].map(id => [id, { textContent: "", style: {}, dataset: {}, scrollTop: 0 }]));
const render = new Function("game", "$", "flow", "syncFieldMessageView", block);
for (const [window, anchor] of [["none", "middle"], ["frame", "top"], ["frame", "bottom"]]) {
  render({ messageWindow: { text: "Page", speaker: "Guide", manual: { window, anchor } } },
    id => nodes[id], { paused: false }, syncFieldMessageView);
  assert.equal(nodes.dialogue.dataset.window, window); assert.equal(nodes.dialogue.dataset.anchor, anchor);
}
render({ messageWindow: { text: "Legacy", speaker: "", alignment: "center" } }, id => nodes[id],
  { paused: false }, syncFieldMessageView);
assert.equal(nodes.dialogue.dataset.window, "frame"); assert.equal(nodes.dialogue.dataset.anchor, "bottom");
assert.equal(nodes.message.style.textAlign, "center");
const report = { kind: "field-manual-message-check", lane: "source compilation and controlled shared GameSession/Flow",
  sourceSetHash: corpus.sourceSetHash, sourceSites: sites, admitted: accepted.length, blocked: blocked.length,
  admittedWindows: Object.fromEntries(["frame", "none"].map(window => [window, accepted.filter(row => row.window === window).length])),
  explicitPageSites: accepted.filter(row => row.pageHashes.length > 1).length,
  typedNameSites: accepted.filter(row => row.nameReferences.length).length,
  typedNameReferences: accepted.reduce((sum, row) => sum + row.nameReferences.length, 0),
  centeredSites: accepted.filter(row => row.alignment === "center").length,
  sourceNameTable: { table: "character_default_name.csv", rows: sourceNameRows },
  syntaxOnly: true, sourceGameplayVerified: false,
  sourceCalls: accepted, blockers: blocked, nativeReceipt: { file: "source-message-native-check.json", sha256: sha(nativeBytes),
    methods: native.methods.length, rawMethods: native.rawMethods.length, pageTypeRva: "0x3759d0", pageTypeBytes: pageType },
  controlledJourney: { sourceSamples: [paged.site, windowless.site],
    initializedEventValues: { "MapLocalVariable[0]": 0, "MessageSelection[0]": 0 }, stages, confirmations, savedAndRestored: true },
  appProjection: { sourceSha256: sha(appBytes), helperSha256: sha(helperBytes), cases: 4, browser: false },
  originalGameExecuted: false, semanticsVerified: false,
  limitations: ["Not source-story reachability or complete game migration", "Web confirmation and page layout; native UI frame/font parity unverified",
    "Typed name references still require a live held owner; syntax acceptance does not establish that dependency or story reachability",
    "Positive/negative timing, WAIT/AUTO/PRESS, other message values and other message families remain outside this manual capability",
    "Existing asynchronous source-message capability remains separately checked"] };
await writeFile(root + "build/reports/field-manual-message-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceSites: sites, admitted: accepted.length, blocked: blocked.length,
  explicitPageSites: report.explicitPageSites, windows: report.admittedWindows, stages: stages.length,
  typedNameSites: report.typedNameSites, centeredSites: report.centeredSites,
  appProjectionCases: 4, originalGameExecuted: false }));
