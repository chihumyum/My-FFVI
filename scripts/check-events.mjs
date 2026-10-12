// Execute a capability-selected batch of private source scripts through the game VM.
// Controlled states and a headless host do not establish story reachability or playability.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeCorpus, loadCorpus } from "../dist/src/compiler/corpus.js";
import {
  decodeFieldOp,
  decodeScriptLocals,
} from "../dist/src/compiler/field.js";
import { hash } from "../dist/src/compiler/content.js";
import { EventState } from "../dist/src/core/event-state.js";
import { FieldGame } from "../dist/src/core/field.js";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const corpus = await loadCorpus(root);
for (const [suffix, sha256] of [
  [
    "GameAssembly.dll",
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  ],
  [
    "/Metadata/global-metadata.dat",
    "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
  ],
])
  assert.ok(
    corpus.manifest.sources.some(
      (s) => s.file.endsWith(suffix) && s.sha256 === sha256,
    ),
    "Unreviewed event VM source profile",
  );

const plan = analyzeCorpus(
  corpus.assets,
  corpus.tables,
  corpus.messages,
  corpus.sourceSetHash,
);
const members = new Map(
  plan.scripts.filter((s) => s.domain === "field").map((s) => [s.id, s.maps]),
);
const allowed = new Set([
  "nop",
  "exit",
  "return",
  "call",
  "wait",
  "jump",
  "branch",
  "calc",
  "flag",
  "message",
]);
const candidates = [],
  exclusions = [];
for (const asset of corpus.assets
  .filter((a) => members.has(a.id))
  .sort((a, b) => a.id.localeCompare(b.id))) {
  let ops;
  try {
    ops = asset.data.Mnemonics.map((raw, index) =>
      decodeFieldOp(
        raw,
        { script: asset.id, index, source: asset.source },
        corpus.messages,
        corpus.tables,
        { nextMnemonic: asset.data.Mnemonics[index + 1]?.mnemonic ?? null },
      ),
    );
  } catch {
    exclusions.push({ id: asset.id, reason: "operand-decoder-rejected" });
    continue;
  }
  if (
    !ops.some((op) => op.kind === "branch") ||
    !ops.every((op) => allowed.has(op.kind))
  ) {
    exclusions.push({
      id: asset.id,
      reason: "outside-control-and-dialogue-capabilities",
    });
    continue;
  }
  const segments = asset.data.Segments;
  if (
    !Array.isArray(segments) ||
    segments.length !== 1 ||
    segments[0].EntryPoint !== 0 ||
    segments[0].Count !== ops.length
  ) {
    exclusions.push({ id: asset.id, reason: "segment-lifecycle-not-restored" });
    continue;
  }
  candidates.push({ asset, ops, locals: decodeScriptLocals(asset.data) });
}

function inputs(ops) {
  const cases = new Map([["initialized-zero", []]]);
  for (const op of ops.filter(
    (o) => o.kind === "branch" && o.right.kind === "immediate",
  )) {
    if (
      ["ScriptLocalVariable", "MessageSelection", "ItemSelection"].includes(
        op.left.category,
      )
    )
      continue;
    const values = op.left.category.includes("Flag")
      ? [0, 1]
      : [op.right.value - 1, op.right.value, op.right.value + 1];
    for (const value of values)
      if (
        Number.isInteger(value) &&
        value >= -2147483648 &&
        value <= 2147483647 &&
        value !== 0
      )
        cases.set(`${op.left.category}[${op.left.index}]=${value}`, [
          { ref: op.left, value },
        ]);
  }
  return [...cases].map(([id, patch]) => ({ id, patch }));
}

function run(candidate, input) {
  const { asset, ops, locals } = candidate;
  const state = EventState.initialized();
  for (const { ref, value } of input.patch) state.write(ref, value);
  const before = state.snapshot();
  const content = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.sourceSetHash,
    contentHash: hash({ id: asset.id, data: asset.data }),
    map: {
      id: "headless-event-check",
      width: 1,
      height: 1,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: [0] },
      entities: [],
      source: asset.source,
    },
    characters: {},
    scripts: { [asset.id]: ops },
    scriptLocals: { [asset.id]: locals },
    entry: {
      player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
      description: "Controlled event execution; not a story checkpoint",
      evidence: [asset.source],
    },
    limitations: ["headless-host", "controlled-state", "no-original-oracle"],
  };
  // A JSON roundtrip exercises the same state transfer boundary needed by future saving.
  const game = new FieldGame(
    content,
    new EventState(JSON.parse(JSON.stringify(before))),
  );
  const messages = [];
  assert.equal(game.startEvent(asset.id), true);
  for (let n = 0; n < 6000 && game.busy && !game.stop; n++) {
    if (game.dialogue) {
      if (game.dialogue.manual) game.advance(10);
      messages.push(game.dialogue.key);
      game.confirm();
    } else game.advance(10);
  }
  const after = game.eventState.snapshot(),
    changes = [];
  for (const bank of ["scenario", "treasure", "global", "area", "map"])
    after[bank].forEach((value, index) => {
      if (value !== before[bank][index])
        changes.push({
          bank,
          index,
          before: before[bank][index],
          after: value,
        });
    });
  return {
    input,
    messages,
    changes,
    stateHash: hash(after),
    outcome: game.stop
      ? "stopped"
      : game.busy
        ? "budget-exhausted"
        : "finished",
    stop: game.stop,
  };
}

const results = candidates.map((candidate) => ({
  id: candidate.asset.id,
  source: candidate.asset.source,
  maps: members.get(candidate.asset.id),
  cases: inputs(candidate.ops).map((input) => {
    const first = run(candidate, input);
    assert.deepEqual(
      run(candidate, input),
      first,
      "Source event replay must be deterministic",
    );
    return first;
  }),
}));
const allCases = results.flatMap((r) => r.cases);
const dialogueVariants = results.filter(
  (r) => new Set(r.cases.map((c) => JSON.stringify(c.messages))).size > 1,
);
const counts = {
  scripts: results.length,
  cases: allCases.length,
  finished: allCases.filter((c) => c.outcome === "finished").length,
  stopped: allCases.filter((c) => c.outcome === "stopped").length,
  budgetExhausted: allCases.filter((c) => c.outcome === "budget-exhausted")
    .length,
  scriptsWithDialogueVariants: dialogueVariants.length,
  scriptsWithStateChanges: results.filter((r) =>
    r.cases.some((c) => c.changes.length),
  ).length,
  distinctPackageFiles: new Set(results.map((r) => r.source.file)).size,
};
const receipt = {
  formatVersion: 1,
  kind: "source-event-batch-check",
  lane: "implementation-only",
  sourceSetHash: corpus.sourceSetHash,
  selection: {
    capabilities: [...allowed],
    requiresBranch: true,
    segments: "single-full-program",
    initialStates:
      "zero plus one-cell branch boundary inputs; not source saves",
  },
  counts,
  results,
  exclusions,
  doesNotEstablish: [
    "all-path-coverage",
    "authentic-story-checkpoint",
    "full-map-runtime",
    "original-parity",
    "playability",
  ],
};
await mkdir(root + "/build/reports", { recursive: true });
await writeFile(
  root + "/build/reports/event-batch-check.json",
  JSON.stringify({ ...receipt, contentHash: hash(receipt) }, null, 2) + "\n",
);
console.log(JSON.stringify({ counts, contentHash: hash(receipt) }, null, 2));
assert.ok(results.length > 0, "No source scripts selected");
assert.equal(
  counts.finished,
  counts.cases,
  "Selected source events did not all finish; see receipt",
);
assert.ok(
  dialogueVariants.some((r) => !r.source.assetPath.includes("/Map_20010/")),
  "No dialogue branch observed beyond the opening fixture",
);
// Source-checked held-out cases: one dialogue branch and one side-effect branch.
const dialogue = results.find((r) =>
  r.source.assetPath.endsWith("/Map_20051/Map_20051_10/sc_npc_20051_10_1.json"),
);
assert.deepEqual(
  dialogue?.cases.map((c) => c.messages),
  [["N001_C00_031_01_01"], ["N001_C00_031_01_02"]],
);
const flags = results.find((r) =>
  r.source.assetPath.endsWith("/Map_20110/Map_20110/sc_e_0226.json"),
);
assert.deepEqual(
  flags?.cases.find((c) => c.input.id === "initialized-zero")?.changes,
  [],
);
assert.deepEqual(
  flags?.cases.find((c) => c.input.id === "ScenarioFlag2[248]=1")?.changes,
  [{ bank: "scenario", index: 505, before: 0, after: 1 }],
);
