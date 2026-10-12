// Compile every source Select, then execute complete, unmodified source scripts
// in a controlled field. Branch endpoints are not proof of story reachability.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>",
);
const compiled = resolve(root, args[1] ?? "dist"),
  module = (name) =>
    import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const { loadCorpus } = await module("compiler/corpus"),
  { loadSystemMessages } = await module("compiler/system-messages"),
  { hash } = await module("compiler/content"),
  { compileFieldChoiceInstruction } = await module("compiler/field-choice"),
  { decodeFieldOp, decodeScriptLocals } = await module("compiler/field"),
  { EventState } = await module("core/event-state"),
  { FieldGame } = await module("core/field");
const output = root + "build/reports/field-choice-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
execFileSync(
  process.execPath,
  [root + "scripts/check-field-choice-native.mjs"],
  { cwd: root, stdio: "pipe" },
);
const nativeBytes = await readFile(
    root + "build/reports/field-choice-native-check.json",
  ),
  native = JSON.parse(nativeBytes),
  corpus = await loadCorpus(root),
  system = await loadSystemMessages(
    root,
    corpus.manifest.parentSourceSetHash,
    corpus.manifest.sources,
  ),
  messages = { ...corpus.messages, system_zhc: system.messages };
assert.equal(
  corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256,
  native.nativeSha256,
);
assert.equal(native.semanticsVerified, false);
const scripts = corpus.assets.filter((a) => a.kind === "script"),
  calls = [],
  blocked = [];
const site = (asset, index) => ({
  script: asset.data.Name,
  index,
  source: { ...asset.source, pointer: `/Mnemonics/${index}` },
});
for (const asset of scripts) {
  const raw = asset.data.Mnemonics ?? [];
  for (const [index, instruction] of raw.entries()) {
    if (instruction.mnemonic !== "Select") continue;
    const context = { nextMnemonic: raw[index + 1]?.mnemonic ?? null };
    let op;
    try {
      op = compileFieldChoiceInstruction(
        instruction,
        messages,
        corpus.tables,
        context,
      );
    } catch (error) {
      blocked.push({ ...site(asset, index), reason: error.message });
      continue;
    }
    assert.deepEqual(
      decodeFieldOp(
        instruction,
        site(asset, index),
        messages,
        corpus.tables,
        context,
      ),
      { ...site(asset, index), ...op },
    );
    assert.equal(op.cancelIndex, null);
    assert.equal(op.retainMessage, context.nextMnemonic === "Msg");
    if (instruction.operands.sValues[0] === "") {
      assert.equal(op.presentation, "yes-no");
      assert.equal(op.options.length, 2);
      assert.equal(op.initialIndex, instruction.operands.iValues[2]);
    } else {
      assert.equal(op.presentation, "multiple");
      assert.equal(op.initialIndex, 0);
      assert.equal(op.anchor, "bottom-center");
      assert.deepEqual(
        op.options.map((option) => option.key),
        instruction.operands.sValues.slice(0, op.options.length),
      );
    }
    calls.push({
      ...site(asset, index),
      assetId: asset.id,
      instructionHash: hash(instruction),
      opHash: hash(op),
      presentation: op.presentation,
      initialIndex: op.initialIndex,
      anchor: op.anchor,
      retainMessage: op.retainMessage,
      nextMnemonic: context.nextMnemonic,
      options: op.options.map((option) => ({
        key: option.key,
        textHash: hash(option.text),
      })),
    });
  }
}
assert.equal(calls.length + blocked.length, 293);
assert.equal(blocked.length, 0);
assert.equal(new Set(calls.map((call) => call.assetId)).size, 244);
assert.equal(
  calls.filter((call) => call.presentation === "yes-no").length,
  187,
);
assert.equal(
  calls.filter((call) => call.presentation === "multiple").length,
  106,
);
const explicitOptionCounts = Object.fromEntries(
  [2, 3, 4, 5, 6].map((count) => [
    count,
    calls.filter(
      (call) =>
        call.presentation === "multiple" && call.options.length === count,
    ).length,
  ]),
);
assert.deepEqual(explicitOptionCounts, { 2: 86, 3: 16, 4: 1, 5: 2, 6: 1 });
const defaultCall = calls.find((call) => call.presentation === "yes-no"),
  defaultAsset = scripts.find((asset) => asset.id === defaultCall.assetId),
  defaultRaw = defaultAsset.data.Mnemonics[defaultCall.index],
  defaultContext = { nextMnemonic: defaultCall.nextMnemonic };
assert.throws(
  () => compileFieldChoiceInstruction(defaultRaw, messages, corpus.tables),
  /following source mnemonic/,
);
assert.throws(
  () =>
    compileFieldChoiceInstruction(
      defaultRaw,
      { ...messages, system_zhc: {} },
      corpus.tables,
      defaultContext,
    ),
  /Missing localized/,
);
assert.throws(
  () =>
    compileFieldChoiceInstruction(
      defaultRaw,
      messages,
      { ...corpus.tables, "message_conclusion.csv": [] },
      defaultContext,
    ),
  /Missing or ambiguous/,
);
assert.equal(
  decodeFieldOp(
    defaultRaw,
    site(defaultAsset, defaultCall.index),
    messages,
    corpus.tables,
  ).kind,
  "blocked",
);

const selection = { category: "MessageSelection", index: 0 };
const journeys = [
  {
    name: "sc_e_0023",
    expected: [
      { outcome: "unsupported", index: 5, mnemonic: "Msg" },
      { outcome: "finished" },
    ],
  },
  {
    name: "sc_e_0256",
    expected: [
      {
        outcome: "map-transition",
        index: 6,
        mapId: 584,
        entrance: 1,
        continuation: "sc_e_0256_1",
      },
      { outcome: "finished" },
    ],
  },
  {
    name: "sc_e_0219",
    expected: [
      { outcome: "finished", message: "E0219_00_084_a_02" },
      {
        outcome: "map-transition",
        index: 4,
        mapId: 1,
        entrance: 1,
        continuation: "sc_e_0219_1",
      },
    ],
  },
  {
    name: "sc_e_0676",
    expected: [
      { outcome: "unsupported", index: 7, mnemonic: "SysCall" },
      { outcome: "finished" },
      { outcome: "unsupported", index: 10, mnemonic: "Msg" },
    ],
  },
];
const results = [];
for (const journey of journeys) {
  const matches = scripts.filter((asset) => asset.data.Name === journey.name);
  assert.equal(matches.length, 1, journey.name);
  const asset = matches[0],
    raw = asset.data.Mnemonics,
    ops = raw.map((instruction, index) =>
      decodeFieldOp(instruction, site(asset, index), messages, corpus.tables, {
        nextMnemonic: raw[index + 1]?.mnemonic ?? null,
      }),
    );
  assert.equal(ops.filter((op) => op.kind === "choice").length, 1);
  assert.equal(
    ops.find((op) => op.kind === "choice").options.length,
    journey.expected.length,
  );
  assert.deepEqual(asset.data.Segments, [
    { Count: ops.length, EntryPoint: 0, Label: "Main" },
  ]);
  for (const [answer, expected] of journey.expected.entries()) {
    const source = asset.source;
    const content = {
      formatVersion: 1,
      kind: "field-development",
      sourceSetHash: corpus.sourceSetHash,
      parentSourceSetHash: corpus.manifest.parentSourceSetHash,
      contentHash: hash({
        kind: "controlled-source-choice",
        asset: asset.id,
        instructions: ops,
      }),
      map: {
        id: "controlled-source-choice",
        width: 1,
        height: 1,
        tileSize: 16,
        layers: [],
        tilesets: [],
        textures: {},
        collisions: { 1: [0] },
        entities: [],
        source,
      },
      characters: {},
      scripts: { [journey.name]: ops },
      scriptLocals: { [journey.name]: decodeScriptLocals(asset.data) },
      entry: {
        player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
        description:
          "Controlled geometry and initialized event state; full source instructions remain unchanged",
        evidence: [source],
      },
      limitations: [
        "controlled-geometry",
        "controlled-event-state",
        "no-native-host",
        "no-original-oracle",
      ],
    };
    const state = EventState.initialized();
    const field = new FieldGame(content, state),
      shown = [];
    assert.equal(field.startEvent(journey.name), true);
    for (
      let step = 0;
      step < 1000 && !field.choice && !field.stop && field.busy;
      step++
    ) {
      if (field.dialogue) {
        shown.push(field.dialogue.key);
        field.confirm();
      } else field.advance(10);
    }
    assert.equal(field.stop, null, journey.name + " reaches source choice");
    const request = field.choice;
    assert.ok(request);
    const waitingSnapshot = state.snapshot();
    field.confirm();
    field.advance(100);
    assert.equal(field.choice, request);
    assert.deepEqual(state.snapshot(), waitingSnapshot);
    assert.equal(field.checkpointReady, false);
    assert.throws(() => field.checkpoint(), /Cannot save/);
    for (const invalid of [-1, request.options.length, 0.5, "cancel"])
      assert.equal(field.choose(request.id, invalid), false);
    assert.equal(
      state.read(selection),
      0,
      "source script initialization sets the register; highlight/invalid input must not answer",
    );
    assert.equal(field.choose(request.id, answer), true);
    assert.equal(field.choice, null);
    assert.equal(field.choicePending, true);
    assert.equal(state.read(selection), answer);
    assert.equal(state.read({ ...selection, index: 1 }), answer);
    assert.equal(
      field.choose(request.id, answer),
      false,
      "one request cannot answer twice",
    );
    for (let step = 0; step < 1000 && field.busy && !field.stop; step++) {
      if (field.dialogue) {
        shown.push(field.dialogue.key);
        field.confirm();
      } else field.advance(10);
    }
    const outcome =
      field.stop?.kind ?? (field.busy ? "budget-exhausted" : "finished");
    assert.equal(outcome, expected.outcome, `${journey.name} option ${answer}`);
    assert.equal(field.choicePending, false);
    assert.equal(state.read(selection), answer);
    if (expected.index !== undefined)
      assert.equal(field.stop?.site?.index, expected.index);
    if (expected.mnemonic)
      assert.equal(field.stop?.site?.mnemonic, expected.mnemonic);
    if (expected.outcome === "map-transition") {
      assert.equal(field.stop.request.mapId, expected.mapId);
      assert.equal(field.stop.request.entrance, expected.entrance);
      assert.equal(field.stop.request.continuation, expected.continuation);
    }
    if (expected.message) assert.ok(shown.includes(expected.message));
    let saved = false;
    if (outcome === "finished") {
      assert.equal(field.checkpointReady, true);
      const checkpoint = JSON.parse(JSON.stringify(field.checkpoint())),
        restored = FieldGame.restore(content, checkpoint);
      assert.equal(restored.eventState.read(selection), answer);
      assert.equal(restored.choice, null);
      assert.equal(restored.choose(request.id, 0), false);
      saved = true;
    } else assert.equal(field.checkpointReady, false);
    results.push({
      script: journey.name,
      source,
      scriptHash: hash(asset.data),
      answer,
      presentation: request.presentation,
      shownMessageKeys: shown,
      expected,
      outcome,
      stateHash: hash(state.snapshot()),
      stableCheckpointRestored: saved,
    });
  }
}
assert.equal(results.length, 9);
const report = {
  kind: "source-field-choice",
  sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  nativeReportSha256: sha(nativeBytes),
  nativeSha256: native.nativeSha256,
  systemMessageSource: system.source,
  admitted: {
    sites: calls.length,
    scriptAssets: 244,
    yesNo: 187,
    multiple: 106,
    explicitOptionCounts,
  },
  calls,
  blocked,
  missingDependencyProbes: 4,
  journeys: results,
  journeySummary: {
    fullSourceScripts: journeys.length,
    branches: results.length,
    stableCheckpointRestores: results.filter(
      (result) => result.stableCheckpointRestored,
    ).length,
    mapRequestsOnly: results.filter(
      (result) => result.outcome === "map-transition",
    ).length,
    preservedUnsupportedEndpoints: results.filter(
      (result) => result.outcome === "unsupported",
    ).length,
  },
  semanticsVerified: false,
  originalGameExecuted: false,
  browserVerified: false,
  doesNotEstablish: [
    "source script reachability",
    "whole-scene playability",
    "destination map publication",
    "native UI pixels or input repeat timing",
    "original game consistency",
  ],
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(output, bytes);
console.log(
  JSON.stringify({
    result: "pass",
    admitted: report.admitted,
    journeys: report.journeySummary,
    reportSha256: sha(bytes),
    semanticsVerified: false,
  }),
);
