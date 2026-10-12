// Exact source selectors in controlled event/field hosts. This is deliberately
// not a launch of the original title demo, source new game or complete prelude.
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
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) =>
  import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { hash } = await module("compiler/content");
const { decodeFieldOp } = await module("compiler/field");
const { compileSourcePresentationInstruction, sourcePresentationSelectors } =
  await module("compiler/source-presentation");
const { createSourcePresentationContext, executeSourcePresentation } =
  await module("core/source-presentation");
const { EventState, executeEventControl } = await module("core/event-state");
const { FieldGame } = await module("core/field");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reportPath = root + "build/reports/source-presentation-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(
  process.execPath,
  [root + "scripts/check-source-presentation-native.mjs"],
  { cwd: root, stdio: "pipe" },
);
const nativeBytes = await readFile(
    root + "build/reports/source-presentation-native-check.json",
  ),
  native = JSON.parse(nativeBytes);
const corpus = await loadCorpus(root);
const messages = JSON.parse(
  snapshotFile(await readSnapshot(root + "build/field"), "field.json"),
).messages;
assert.equal(native.semanticsVerified, false);
assert.equal(
  corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256,
  native.nativeSha256,
);
const contexts = {
  normal: createSourcePresentationContext({
    kind: "title-new-game",
    titleCleanupComplete: true,
    openingCallbackStarted: false,
  }),
  advertisement: createSourcePresentationContext({
    kind: "advertisement-opening",
    faderSetupComplete: true,
  }),
  unknown: createSourcePresentationContext({ kind: "unresolved" }),
};
const calls = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script"))
  for (const [index, instruction] of (asset.data.Mnemonics ?? []).entries())
    if (
      instruction.mnemonic === "SysCall" &&
      sourcePresentationSelectors.includes(instruction.operands?.sValues?.[0])
    ) {
      const site = {
        script: asset.data.Name,
        index,
        source: { ...asset.source, pointer: `/Mnemonics/${index}` },
      };
      const direct = compileSourcePresentationInstruction(instruction),
        decoded = decodeFieldOp(instruction, site, messages, corpus.tables);
      assert.equal(
        decoded.kind,
        "source-presentation",
        "Shared field decoder must route exact presentation selectors",
      );
      assert.deepEqual(decoded.command, direct.command);
      assert.equal(typeof site.source.objectId, "string");
      assert.match(site.source.objectId, /^-?\d+$/);
      calls.push({
        site,
        command: direct.command,
        instructionHash: hash(instruction),
        op: decoded,
      });
    }
assert.equal(calls.length, 4);
assert.equal(
  calls.filter((c) => c.command.kind === "advertisement-probe").length,
  3,
);
const probes = [],
  controlled = [];
const mapFlag = { category: "MapLocalVariable", index: 7 };
const syntheticSource = {
  file: "controlled",
  assetPath: "synthetic-presentation-host",
};
function content(op) {
  return {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    contentHash: hash({ controlled: true, op }),
    map: {
      id: "controlled-presentation-host",
      width: 3,
      height: 3,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(9).fill(0) },
      entities: [],
      source: syntheticSource,
    },
    characters: {},
    scripts: {
      probe: [
        op,
        { kind: "exit", script: "probe", index: 1, source: syntheticSource },
      ],
    },
    entry: {
      player: {
        x: 1,
        y: 1,
        layer: 1,
        direction: "up",
        asset: "controlled",
        mount: "",
      },
      evidence: [syntheticSource],
      description: "Controlled geometry, exact source instruction",
    },
    limitations: [],
  };
}
for (const call of calls) {
  if (call.command.kind === "advertisement-probe") {
    for (const [name, context] of Object.entries(contexts)) {
      const state = EventState.initialized(),
        before = state.snapshot(),
        fixture = content(call.op);
      const field = new FieldGame(fixture, state, undefined, undefined, {
        sourcePresentation: { context: () => context },
      });
      assert.equal(field.startEvent("probe"), true);
      if (name === "unknown") {
        assert.equal(field.stop?.kind, "unsupported");
        assert.match(field.stop.message, /Unknown advertisement/);
        assert.deepEqual(state.snapshot(), before);
      } else {
        assert.equal(field.stop, null);
        assert.equal(state.read(mapFlag), name === "advertisement" ? 1 : 0);
        assert.equal(field.checkpointReady, name === "normal");
        if (name === "normal") {
          const saved = field.checkpoint(),
            restored = FieldGame.restore(fixture, saved, {
              sourcePresentation: { context: () => context },
            });
          assert.deepEqual(restored.checkpoint(), saved);
          assert.throws(
            () => FieldGame.restore(fixture, saved),
            /presentation context mismatch/,
          );
        }
      }
      probes.push({
        script: call.site.script,
        index: call.site.index,
        context: name,
        mapLocal7: state.snapshot().map[7],
        blocked: field.stop !== null,
        checkpointReady: field.checkpointReady,
      });
    }
    // Absence does not overwrite a local retained by some other caller.
    const state = EventState.initialized();
    state.write(mapFlag, 9);
    assert.equal(
      executeSourcePresentation(call.op, state, {
        context: () => contexts.normal,
      }),
      "next",
    );
    assert.equal(state.read(mapFlag), 9);
    probes.push({
      script: call.site.script,
      index: call.site.index,
      context: "normal-existing-local",
      mapLocal7: 9,
      blocked: false,
    });
  } else {
    const fixture = content(call.op),
      state = EventState.initialized(),
      published = [];
    const field = new FieldGame(fixture, state, undefined, undefined, {
      sourcePresentation: {
        context: () => contexts.advertisement,
        prepare: (effects) => ({
          commit: () => published.push(...structuredClone(effects)),
        }),
      },
    });
    assert.equal(field.startEvent("probe"), true);
    assert.equal(field.stop, null);
    assert.deepEqual(published, [
      { kind: "fade-out", seconds: 2, color: null },
      { kind: "goto-title" },
      { kind: "stop-script-input" },
    ]);
    probes.push({
      script: call.site.script,
      index: call.site.index,
      context: "controlled-title-host",
      effects: published,
      flow: "end",
    });
    const unavailable = new FieldGame(
      fixture,
      EventState.initialized(),
      undefined,
      undefined,
      { sourcePresentation: { context: () => contexts.advertisement } },
    );
    assert.equal(unavailable.startEvent("probe"), true);
    assert.equal(unavailable.stop?.kind, "unsupported");
    assert.match(unavailable.stop.message, /effect host is unavailable/);
    probes.push({
      script: call.site.script,
      index: call.site.index,
      context: "missing-title-host",
      blocked: true,
    });
  }
}
const prelude = corpus.assets.filter(
  (a) =>
    a.kind === "script" &&
    /\/sc_e_0001(?:_[1-5])?\.json$/.test(a.source.assetPath),
);
assert.equal(prelude.length, 6);
const entryDependencies = prelude.map((asset) => {
  const ops = asset.data.Mnemonics.map((m, index) =>
    decodeFieldOp(
      m,
      {
        script: asset.data.Name,
        index,
        source: { ...asset.source, pointer: `/Mnemonics/${index}` },
      },
      messages,
      corpus.tables,
      { nextMnemonic: asset.data.Mnemonics[index + 1]?.mnemonic ?? null },
    ),
  );
  return {
    script: asset.data.Name,
    source: asset.source,
    scriptHash: hash(asset.data),
    instructions: ops.length,
    decodedBlockers: ops
      .filter((op) => op.kind === "blocked")
      .map((op) => ({
        index: op.index,
        mnemonic: op.mnemonic,
        reason: op.reason,
      })),
    runtimeProvidersStillRequired: ops
      .filter((op) =>
        [
          "source-presentation",
          "puppet",
          "position",
          "owned-condition",
          "change-map",
        ].includes(op.kind),
      )
      .map((op) => ({ index: op.index, kind: op.kind })),
  };
});
const first = prelude.find((a) => a.data.Name === "sc_e_0001");
assert.ok(first);
for (const [name, context, target] of [
  ["normal", contexts.normal, 6],
  ["advertisement", contexts.advertisement, 4],
]) {
  const state = EventState.initialized(),
    site = { script: first.data.Name, index: 1, source: first.source };
  const probe = decodeFieldOp(
    first.data.Mnemonics[1],
    site,
    messages,
    corpus.tables,
  );
  executeSourcePresentation(probe, state, { context: () => context });
  const branch = decodeFieldOp(
      first.data.Mnemonics[3],
      { ...site, index: 3 },
      messages,
      corpus.tables,
    ),
    cursor = { pc: 4 };
  assert.equal(
    executeEventControl(branch, state, cursor, first.data.Mnemonics.length),
    true,
  );
  assert.equal(cursor.pc, target);
  const selected =
    first.data.Mnemonics[cursor.pc].mnemonic === "Nop"
      ? cursor.pc + 1
      : cursor.pc;
  const bgm = decodeFieldOp(
    first.data.Mnemonics[selected],
    { ...site, index: selected },
    messages,
    corpus.tables,
  );
  assert.equal(bgm.kind, "bgm-play");
  assert.equal(bgm.track, name === "normal" ? 1 : 105);
  assert.equal(bgm.seek, name === "normal" ? 0 : Math.fround(72.8));
  controlled.push({
    name: "actual-source-branch-" + name,
    mapLocal7: state.read(mapFlag),
    target: cursor.pc,
    bgm: { track: bgm.track, seek: bgm.seek },
  });
}
// Keep all source PCs and instructions. The tiny host is only a dependency
// probe: running the first call must reveal, not skip, the next missing feature.
const fixture = content(calls.find((c) => c.site.script === "sc_e_0001").op);
fixture.scripts.probe = first.data.Mnemonics.map((m, index) =>
  decodeFieldOp(
    m,
    {
      script: first.data.Name,
      index,
      source: { ...first.source, pointer: `/Mnemonics/${index}` },
    },
    messages,
    corpus.tables,
    { nextMnemonic: first.data.Mnemonics[index + 1]?.mnemonic ?? null },
  ),
);
fixture.contentHash = hash({ controlled: true, script: fixture.scripts.probe });
const firstField = new FieldGame(
  fixture,
  EventState.initialized(),
  undefined,
  undefined,
  { sourcePresentation: { context: () => contexts.normal } },
);
assert.equal(firstField.startEvent("probe"), true);
assert.equal(firstField.stop?.kind, "unsupported");
assert.equal(firstField.stop.site.index, 2);
assert.equal(firstField.stop.site.script, "sc_e_0001");
assert.equal(firstField.checkpointReady, false);
controlled.push({
  name: "full-source-first-script-retains-next-host-blocker",
  stop: firstField.stop,
  newGameSessionPublished: false,
});
const report = {
  formatVersion: 1,
  kind: "source-presentation-controlled-check",
  status: "pass",
  sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  nativeReportSha256: sha(nativeBytes),
  semanticsVerified: false,
  newGameSessionPublished: false,
  calls: calls.map(({ op: _, ...call }) => call),
  probes,
  controlled,
  entryDependencies,
  counts: {
    sourceCallSites: calls.length,
    probeCallSites: 3,
    titleReturnCallSites: 1,
    controlledInvocations: probes.length,
    sourceBranchAndEntryChecks: controlled.length,
    preludeScriptsInspected: entryDependencies.length,
    decodedBlockers: entryDependencies.reduce(
      (n, script) => n + script.decodedBlockers.length,
      0,
    ),
  },
  limitations: [
    "Exact source instructions run in controlled hosts; this does not make the six opening scripts playable.",
    "Source presentation context is a trusted session port, never a map-id or checkpoint-derived false default.",
    "The returned title/fade/input plan requires an actual title host; the controlled receiver only records effects.",
    "Active advertisement fader input/coroutine, camera, message modes and other explicit prelude dependencies remain unhosted.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    status: report.status,
    report: reportPath,
    ...report.counts,
    semanticsVerified: false,
    newGameSessionPublished: false,
  }),
);
