// Exact source calls in controlled owners/FieldGame. Not source scene reachability.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>",
);
const compiled = resolve(root, args[1] ?? "dist"),
  module = (name) =>
    import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = (data) => createHash("sha256").update(data).digest("hex");
const { loadCorpus } = await module("compiler/corpus"),
  { compileFieldFadeInstruction } = await module("compiler/field-fade"),
  { decodeFieldOp } = await module("compiler/field"),
  { hash } = await module("compiler/content"),
  { FieldFadeState, fieldFadeOverlay } = await module("core/field-fade"),
  { FieldGame } = await module("core/field");
const output = root + "build/reports/field-fade-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-fade-native.mjs"], {
  cwd: root,
  stdio: "pipe",
});
const nativeBytes = await readFile(
    root + "build/reports/field-fade-native-check.json",
  ),
  native = JSON.parse(nativeBytes),
  corpus = await loadCorpus(root);
assert.equal(native.semanticsVerified, false);
assert.equal(
  corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256,
  native.nativeSha256,
);
const calls = [],
  blockers = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script"))
  for (const [index, instruction] of (asset.data.Mnemonics ?? []).entries()) {
    if (!["FadeIn", "FadeOut"].includes(instruction.mnemonic)) continue;
    const site = {
      script: asset.data.Name ?? basename(asset.source.assetPath, ".json"),
      index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` },
    };
    assert.equal(typeof site.source.objectId, "string");
    const decoded = decodeFieldOp(instruction, site, {}, corpus.tables);
    let direct;
    try {
      direct = compileFieldFadeInstruction(instruction);
    } catch (error) {
      assert.equal(decoded.kind, "blocked");
      blockers.push({
        site,
        mnemonic: instruction.mnemonic,
        instructionHash: hash(instruction),
        reason: error.message,
      });
      continue;
    }
    assert.deepEqual(
      decoded,
      { ...site, ...direct },
      "Shared field decoder uses the strict source fade compiler",
    );
    calls.push({
      site,
      mnemonic: instruction.mnemonic,
      instructionHash: hash(instruction),
      op: decoded,
    });
  }
assert.equal(calls.length + blockers.length, 1620);
assert.equal(calls.length, 1619);
assert.equal(blockers.length, 1);
assert.equal(blockers[0].site.script, "sc_e_1030_3");
assert.equal(blockers[0].site.index, 42);
assert.match(blockers[0].reason, /0\.\.255/);
const source = { file: "controlled", assetPath: "ordinary-fade-host" };
function seed(direction) {
  return {
    imageColor: { r: 0, g: 0, b: 0, a: 1 },
    rendererColor: { r: 1, g: 1, b: 1, a: direction === "in" ? 1 : 0 },
    raycastTarget: direction === "in",
  };
}
function content(op, initial = seed(op.direction)) {
  return {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    contentHash: hash({ controlled: true, op, initial }),
    map: {
      id: "controlled-fade-host",
      width: 3,
      height: 3,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(9).fill(0) },
      entities: [],
      source,
    },
    characters: {},
    scripts: {
      probe: [op, { kind: "exit", script: "probe", index: 1, source }],
    },
    entry: {
      ...(initial ? { fade: initial } : {}),
      player: {
        x: 1,
        y: 1,
        layer: 1,
        direction: "up",
        asset: "controlled",
        mount: "",
      },
      evidence: [source],
      description:
        "Controlled geometry and initial fade, exact source instruction",
    },
    limitations: [],
  };
}
const probes = [],
  fieldProbes = [];
for (const call of calls) {
  const op = call.op,
    owner = new FieldFadeState(seed(op.direction));
  assert.equal(owner.start(op, 0), op.seconds < 0 ? "next" : "wait");
  let frames = 0;
  while (owner.active && frames < 1000) {
    owner.advance(0.01);
    frames++;
  }
  assert.equal(owner.active, false, JSON.stringify(call.site));
  assert.equal(owner.poll(op.direction), "next", JSON.stringify(call.site));
  // Run Update once for zero-alpha raycast/color cleanup after final coroutine resume.
  owner.advance(0.01);
  const saved = owner.snapshot(),
    restored = FieldFadeState.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot(), saved);
  const overlay = fieldFadeOverlay(owner.projection);
  for (const channel of Object.values(overlay))
    assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 1);
  probes.push({
    site: call.site,
    asynchronous: op.seconds < 0,
    frames,
    final: saved,
    overlay,
    stableRestore: true,
  });

  const field = new FieldGame(content(op));
  assert.equal(field.startEvent("probe"), true);
  assert.equal(field.stop, null);
  if (op.seconds >= 0) {
    assert.equal(field.busy, true);
    assert.equal(field.checkpointReady, false);
  }
  if (field.fader.active) assert.equal(field.checkpointReady, false);
  let ticks = 0;
  while ((field.busy || field.fader.active) && !field.stop && ticks < 1000) {
    field.advance(10);
    ticks++;
  }
  assert.equal(field.stop, null, JSON.stringify(call.site));
  assert.equal(field.busy, false);
  assert.equal(field.fader.active, false);
  field.advance(10);
  assert.deepEqual(field.fader.snapshot(), saved);
  assert.equal(field.checkpointReady, true);
  const checkpoint = field.checkpoint();
  assert.deepEqual(checkpoint.fade, saved);
  fieldProbes.push({
    site: call.site,
    ticks,
    completed: true,
    checkpointFadePreserved: true,
  });
}
const controlled = [];
function check(name, fn) {
  fn();
  controlled.push({ name, pass: true });
}
check(
  "missing entry fade host blocks without fabricating initial alpha",
  () => {
    const field = new FieldGame(content(calls[0].op, null));
    field.startEvent("probe");
    assert.equal(field.stop?.kind, "unsupported");
    assert.match(field.stop.message, /Unknown initial field fade/);
    assert.equal(field.fader.snapshot(), null);
    assert.equal(field.checkpointReady, false);
  },
);
check("source nonopaque blue image retains both alpha layers", () => {
  const blue = calls.find(
    (c) =>
      c.op.direction === "out" &&
      c.op.color?.b === 1 &&
      c.op.color.a === Math.fround(200 / 255),
  );
  assert.ok(blue);
  const owner = new FieldFadeState(seed("out"));
  owner.start(blue.op, 0);
  while (owner.active) owner.advance(0.01);
  const overlay = fieldFadeOverlay(owner.projection),
    alpha = Math.fround(200 / 255);
  assert.equal(overlay.b, 1);
  assert.equal(overlay.a, Math.fround(alpha * alpha));
});
check(
  "source nullable sandbox FadeIn retains the preceding colored FadeOut image",
  () => {
    const out = calls.find(
        (c) => c.site.script === "script_sandbox" && c.site.index === 34,
      ),
      fadeIn = calls.find(
        (c) => c.site.script === "script_sandbox" && c.site.index === 35,
      );
    assert.ok(out && fadeIn);
    assert.equal(fadeIn.op.color, null);
    const owner = new FieldFadeState(seed("out"));
    owner.start(out.op, 0);
    while (owner.active) owner.advance(0.01);
    const before = owner.projection.imageColor;
    owner.start(fadeIn.op, 0);
    assert.deepEqual(owner.projection.imageColor, before);
  },
);
const modules = {};
for (const file of [
  "compiler/field-fade",
  "compiler/field",
  "core/field-fade",
  "core/field",
])
  modules[file] = sha(await readFile(resolve(compiled, "src", file + ".js")));
const report = {
  formatVersion: 1,
  kind: "source-field-fade",
  sourceSetHash: corpus.sourceSetHash,
  nativeReportSha256: sha(nativeBytes),
  semanticsVerified: false,
  modules,
  sourceSites: calls.length + blockers.length,
  supported: calls.length,
  blockers,
  fadeIn: calls.filter((c) => c.op.direction === "in").length,
  fadeOut: calls.filter((c) => c.op.direction === "out").length,
  asynchronous: calls.filter((c) => c.op.seconds < 0).length,
  nullableColor: calls.filter((c) => c.op.color === null).length,
  calls,
  probes,
  fieldProbes,
  controlled,
  limitations: [
    "Exact source operands in controlled active image hosts; no scene reachability or whole-game coverage claim.",
    "Source new-game initial fade host is not inferred from the development transparent seed.",
    "Static native evidence is not original frame-order/GPU/pixel acceptance; Web uses explicit 10ms scaled steps.",
    "External ColorFade, inactive image hierarchy, finish callbacks and alpha outside 0..255 remain unimplemented.",
  ],
};
const bytes = JSON.stringify(report, null, 2) + "\n";
await writeFile(output, bytes);
console.log(
  JSON.stringify(
    {
      sourceSites: report.sourceSites,
      supported: calls.length,
      blocked: blockers.length,
      ownerProbes: probes.length,
      fieldProbes: fieldProbes.length,
      controlled: controlled.length,
      asynchronous: report.asynchronous,
      nullableColor: report.nullableColor,
      reportSha256: sha(bytes),
      reportPath: output,
    },
    null,
    2,
  ),
);
