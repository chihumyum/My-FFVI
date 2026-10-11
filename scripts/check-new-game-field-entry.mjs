// The exact new-game route drives the real entry protocol. The small FieldGame
// probe below is deliberately controlled; it is not a replay of the full intro.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const { readSnapshot, snapshotFile } = await module("compiler/integrity"),
  { loadCorpus } = await module("compiler/corpus"),
  { battleTableIndex } = await module("compiler/battle"),
  { compileNewGame } = await module("compiler/new-game"),
  { compileNewGameFieldEntry } = await module("compiler/new-game-field-entry"),
  { compileOrdinaryWeaponEffects } = await module("compiler/ordinary-weapon"),
  { decodeFieldOp } = await module("compiler/field"),
  { hash } = await module("compiler/content"),
  { createNewGame } = await module("core/new-game"),
  { NewGameFieldEntry } = await module("core/new-game-field-entry"),
  { FieldFadeState } = await module("core/field-fade"),
  { createSourcePresentationContext } = await module(
    "core/source-presentation",
  ),
  { EventState } = await module("core/event-state"),
  { FieldGame } = await module("core/field");
const output = root + "build/reports/new-game-field-entry-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
execFileSync(
  process.execPath,
  [root + "scripts/check-new-game-field-entry-native.mjs"],
  { cwd: root, stdio: "pipe" },
);
const nativeBytes = await readFile(
    root + "build/reports/new-game-field-entry-native-check.json",
  ),
  native = JSON.parse(nativeBytes),
  corpus = await loadCorpus(root),
  project = JSON.parse(
    snapshotFile(await readSnapshot(root + "build/import"), "project.json"),
  ),
  battle = JSON.parse(
    snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"),
  ),
  field = JSON.parse(
    snapshotFile(await readSnapshot(root + "build/field"), "field.json"),
  );
assert.equal(native.semanticsVerified, false);
assert.equal(corpus.manifest.parentSourceSetHash, project.sourceSetHash);
assert.equal(battle.parentSourceSetHash, project.sourceSetHash);
assert.equal(
  corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256,
  native.nativeSha256,
);
const reader = () => battleTableIndex(corpus.tables, battle.tableSources),
  extra = corpus.assets.filter(
    (a) =>
      a.source.assetPath ===
      "Assets/GameAssets/Serial/Data/BattleExtraData/battle_extra_data.json",
  );
assert.equal(extra.length, 1);
const effects = compileOrdinaryWeaponEffects(reader(), extra[0].data).catalog,
  before = hash(corpus.tables),
  initial = compileNewGame(
    reader(),
    corpus.tables,
    (key) => {
      const value = field.messages.system_zhc[key];
      assert.equal(typeof value, "string", "Missing source name: " + key);
      return value;
    },
    effects,
  ),
  plan = createNewGame(initial.definition),
  bound = compileNewGameFieldEntry(reader(), initial.definition, corpus.assets),
  definition = bound.definition,
  asset = corpus.assets.find(
    (a) => a.source.assetPath === bound.reservedScriptSource.assetPath,
  );
assert.ok(asset);
const context = () =>
    createSourcePresentationContext({
      kind: "title-new-game",
      titleCleanupComplete: true,
      openingCallbackStarted: false,
    }),
  host = { active: true, callbacks: "absent" },
  // This is an authored Web title host, not an inferred native prefab color.
  title = () =>
    new FieldFadeState({
      imageColor: { r: 1, g: 0, b: 0, a: 1 },
      rendererColor: { r: 1, g: 1, b: 1, a: 0.25 },
      raycastTarget: false,
    }),
  receipt = () => ({
    kind: "source-new-game-field-prepared-v1",
    mapId: definition.mapId,
    entrance: definition.entrance,
    reservedScriptName: definition.reservedScript.name,
    firstLoad: true,
    mapLoadComplete: true,
    mapSetupComplete: true,
    mapViewSetupComplete: true,
    firstFieldSceneInitialized: true,
    fieldUiReady: true,
  }),
  cases = [];
function check(name, run) {
  run();
  cases.push({ name, pass: true });
}
function toPreparation() {
  const entry = new NewGameFieldEntry(definition, context()),
    start = entry.prepareStart(title(), host);
  start.commit();
  let fade = start.fade;
  fade.advance(0.5);
  for (let i = 0; i < 3; i++) {
    const next = entry.prepareResume(fade, true);
    assert.ok(next);
    next.commit();
    fade = next.fade;
  }
  assert.equal(entry.phase, "field-preparing");
  return { entry, fade };
}
check(
  "source reserve and fallback are separately bound without reading development checkpoint seeds",
  () => {
    assert.equal(definition.mapId, 609);
    assert.equal(definition.entrance, 1);
    assert.deepEqual(definition.reservedScript, {
      id: 1,
      name: "sc_e_0001",
      contentHash:
        "d03b4052156ef1fedd279fd083b2e8f6ffd94a9dbcb2f1f8b5e926816782aa63",
    });
    assert.equal(definition.fallbackScript.id, 609);
    assert.notEqual(
      definition.fallbackScript.name,
      definition.reservedScript.name,
    );
    assert.equal(bound.reservedScriptSource.objectId, "7846844822230752744");
    assert.equal(hash(asset.data), definition.reservedScript.contentHash);
    assert.equal(plan.entry.entrySynchronized, false);
  },
);
check(
  "unresolved or demo context and unknown fade cannot publish ordinary source entry",
  () => {
    for (const value of [
      createSourcePresentationContext({ kind: "unresolved" }),
      createSourcePresentationContext({
        kind: "advertisement-opening",
        faderSetupComplete: true,
      }),
    ])
      assert.throws(() => new NewGameFieldEntry(definition, value), /ordinary/);
    const entry = new NewGameFieldEntry(definition, context());
    assert.throws(
      () => entry.prepareStart(new FieldFadeState(null), host),
      /Unknown initial/,
    );
    assert.equal(entry.phase, "created");
  },
);
check(
  "map preload starts during half-second title fade and loaded assets cannot shortcut alpha",
  () => {
    const entry = new NewGameFieldEntry(definition, context()),
      original = title(),
      before = original.snapshot(),
      start = entry.prepareStart(original, host, 0.25);
    assert.deepEqual(original.snapshot(), before);
    assert.deepEqual(start.effects, [
      { kind: "stop-title-bgm", channel: 0, seconds: 2 },
      { kind: "begin-map-load", mapId: 609, entrance: 1 },
    ]);
    assert.equal(start.fade.projection.rendererColor.a, 0.625);
    start.commit();
    assert.equal(entry.prepareResume(start.fade, true), null);
    start.fade.advance(0.25);
    assert.equal(start.fade.active, true);
    const next = entry.prepareResume(start.fade, true);
    assert.deepEqual(
      next.effects.map((e) => e.kind),
      ["hide-title", "request-main-scene"],
    );
  },
);
check(
  "request, actual loading, scene activation and title destruction require separate resumes",
  () => {
    const entry = new NewGameFieldEntry(definition, context()),
      start = entry.prepareStart(title(), host);
    start.commit();
    start.fade.advance(0.5);
    const request = entry.prepareResume(start.fade, true);
    request.commit();
    assert.equal(entry.prepareResume(request.fade, null), null);
    assert.equal(entry.prepareResume(request.fade, false), null);
    const activate = entry.prepareResume(request.fade, true);
    assert.deepEqual(activate.effects, [{ kind: "activate-main-scene" }]);
    activate.commit();
    const destroy = entry.prepareResume(activate.fade, null);
    assert.deepEqual(destroy.effects, [{ kind: "destroy-title" }]);
    destroy.commit();
    assert.equal(entry.phase, "field-preparing");
  },
);
check(
  "a replaced fade delays activation while completed loading stays latched",
  () => {
    const entry = new NewGameFieldEntry(definition, context()),
      start = entry.prepareStart(title(), host);
    start.commit();
    start.fade.advance(0.5);
    const request = entry.prepareResume(start.fade, true);
    request.commit();
    request.fade.start(
      { kind: "field-fade", direction: "in", seconds: -1, color: null },
      0.25,
    );
    const loaded = entry.prepareResume(request.fade, true);
    loaded.commit();
    assert.equal(entry.phase, "scene-loaded");
    assert.equal(entry.prepareResume(loaded.fade, null), null);
    loaded.fade.start({
      kind: "field-fade",
      direction: "out",
      seconds: 0,
      color: { r: 0, g: 0, b: 0, a: 1 },
    });
    assert.deepEqual(entry.prepareResume(loaded.fade, null).effects, [
      { kind: "activate-main-scene" },
    ]);
  },
);
check(
  "unknown field preparation does not consume the source launch or substitute map initializer",
  () => {
    const { entry, fade } = toPreparation();
    for (const key of [
      "firstLoad",
      "mapLoadComplete",
      "mapSetupComplete",
      "mapViewSetupComplete",
      "firstFieldSceneInitialized",
      "fieldUiReady",
    ])
      assert.throws(
        () => entry.prepareLaunch(fade, { ...receipt(), [key]: false }),
        /Unproved/,
      );
    assert.throws(
      () =>
        entry.prepareLaunch(fade, {
          ...receipt(),
          reservedScriptName: definition.fallbackScript.name,
        }),
      /Unproved/,
    );
    assert.equal(entry.phase, "field-preparing");
  },
);
check(
  "successful reserve inherits in-flight fader and leaves encounter synchronization unproved",
  () => {
    const { entry, fade } = toPreparation(),
      prepared = entry.prepareLaunch(fade, receipt());
    assert.equal(prepared.launch.scriptName, "sc_e_0001");
    assert.equal(
      prepared.launch.scriptContentHash,
      definition.reservedScript.contentHash,
    );
    assert.deepEqual(prepared.launch.fade.snapshot(), fade.snapshot());
    assert.equal(prepared.launch.fade.active, true);
    assert.equal(prepared.launch.fade.projection.rendererColor.a, 1);
    assert.equal(prepared.launch.entrySynchronized, false);
    assert.equal(prepared.launch.startChangeState, true);
    assert.equal(prepared.launch.endChangeState, true);
    assert.equal(
      prepared.launch.fallbackBranch,
      "discard-after-reserved-script",
    );
    assert.throws(
      () => FieldFadeState.restore(prepared.launch.fade.snapshot()),
      /active/,
    );
    prepared.commit();
    assert.equal(entry.phase, "launched");
  },
);
check(
  "failed candidates and stale clocks cannot consume or duplicate the source launch",
  () => {
    const { entry, fade } = toPreparation(),
      aborted = entry.prepareLaunch(fade, receipt()),
      before = fade.snapshot();
    aborted.launch.fade.advance(0.1);
    assert.deepEqual(fade.snapshot(), before);
    const accepted = entry.prepareLaunch(fade, receipt());
    accepted.commit();
    assert.throws(() => aborted.commit(), /Stale/);
    assert.throws(() => accepted.commit(), /repeated/);
    const again = toPreparation(),
      stale = again.entry.prepareLaunch(again.fade, receipt());
    again.fade.advance(0);
    assert.throws(() => stale.commit(), /Stale/);
    assert.equal(again.entry.phase, "field-preparing");
  },
);

const sourceOps = [1, 12].map((index) => {
  const instruction = asset.data.Mnemonics[index],
    site = {
      script: definition.reservedScript.name,
      index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` },
    };
  return {
    site,
    instructionHash: hash(instruction),
    op: decodeFieldOp(instruction, site, {}, corpus.tables),
  };
});
assert.equal(sourceOps[0].op.kind, "source-presentation");
assert.equal(sourceOps[1].op.kind, "field-fade");
const controlled = {
  file: "controlled",
  assetPath: "new-game-field-entry-probe",
};
function probeContent() {
  return {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    contentHash: hash({ controlled: true, sourceOps }),
    map: {
      id: "controlled-new-game-handoff",
      width: 3,
      height: 3,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: Array(9).fill(0) },
      entities: [],
      source: controlled,
    },
    characters: {},
    scripts: {
      probe: [
        ...sourceOps.map((entry) => entry.op),
        { kind: "exit", script: "probe", index: 2, source: controlled },
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
      description:
        "Controlled two-instruction fade/presentation handoff, not the intro script",
      evidence: [controlled],
    },
    limitations: [
      "Controlled geometry and two selected source operations only.",
    ],
  };
}
check(
  "real FieldGame accepts the transferred owner and exact source probe/fade without replaying title fade",
  () => {
    const { entry, fade } = toPreparation(),
      prepared = entry.prepareLaunch(fade, receipt()),
      state = new EventState(plan.events),
      game = new FieldGame(
        probeContent(),
        state,
        undefined,
        undefined,
        {
          sourcePresentation: {
            context: () => prepared.launch.sourcePresentation,
          },
        },
        prepared.launch.fade,
      );
    assert.equal(game.fader, prepared.launch.fade);
    assert.equal(game.fader.projection.rendererColor.a, 1);
    assert.equal(game.startEvent("probe"), true);
    assert.equal(game.stop, null);
    assert.equal(state.read({ category: "MapLocalVariable", index: 7 }), 0);
    assert.equal(game.fader.snapshot().tween.duration, Math.fround(1.4));
    assert.equal(game.checkpointReady, false);
    assert.equal(entry.phase, "field-preparing");
    prepared.commit();
    let ticks = 0;
    while (game.fader.active && ticks++ < 200) game.advance(10);
    assert.equal(game.stop, null);
    assert.equal(game.fader.active, false);
    assert.equal(game.fader.projection.rendererColor.a, 0);
    assert.equal(fade.projection.rendererColor.a, 1);
  },
);
check(
  "missing presentation port stops the field candidate before source fade or event writes",
  () => {
    const { entry, fade } = toPreparation(),
      prepared = entry.prepareLaunch(fade, receipt()),
      state = new EventState(plan.events),
      before = state.snapshot(),
      game = new FieldGame(
        probeContent(),
        state,
        undefined,
        undefined,
        {},
        prepared.launch.fade,
      );
    assert.equal(game.startEvent("probe"), true);
    assert.equal(game.stop?.kind, "unsupported");
    assert.match(game.stop.message, /presentation host/);
    assert.deepEqual(state.snapshot(), before);
    assert.deepEqual(game.fader.snapshot(), fade.snapshot());
    assert.equal(entry.phase, "field-preparing");
  },
);
assert.equal(hash(corpus.tables), before);
assert.equal(hash(asset.data), definition.reservedScript.contentHash);
const implementation = {};
for (const file of [
  "src/core/new-game-field-entry.ts",
  "src/compiler/new-game-field-entry.ts",
  "src/core/field-fade.ts",
  "src/core/source-presentation.ts",
  "src/core/field.ts",
])
  implementation[file] = sha(await readFile(root + file));
const report = {
  formatVersion: 1,
  kind: "source-new-game-field-entry-check",
  status: "pass",
  sourceSetHash: corpus.manifest.sourceSetHash,
  parentSourceSetHash: project.sourceSetHash,
  nativeReportHash: sha(nativeBytes),
  semanticsVerified: false,
  newGameSessionPublished: false,
  definition,
  definitionHash: hash(definition),
  sourceDependencies: bound.sources,
  reservedScriptSource: bound.reservedScriptSource,
  controlledSourceOperations: sourceOps,
  implementation,
  counts: { cases: cases.length, controlledFieldGameProbes: 2 },
  cases,
  limitations: [
    "Static native evidence and source-bound controlled execution; no native audiovisual oracle.",
    "The authored title color and preparation receipts are controlled host inputs, not native prefab discoveries.",
    "The two-instruction FieldGame fixture is not a replay or reachability claim for the complete opening script.",
    "This checker does not publish a GameSession, run a browser, or validate unmodeled title callbacks.",
  ],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    output,
    cases: cases.length,
    controlledFieldGameProbes: 2,
    newGameSessionPublished: false,
  }),
);
