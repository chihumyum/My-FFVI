// Source party instructions in controlled states. These probes establish neither
// story reachability nor actor rendering/native execution parity.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const outDirFlag = process.argv.includes("--compiled-dir") ? "--compiled-dir" : "--dist";
const outDirIndex = process.argv.indexOf(outDirFlag);
const outDir = outDirIndex < 0 ? "dist" : process.argv[outDirIndex + 1];
if (!outDir || outDir.startsWith("--")) throw new Error("Missing compiled output directory");
const module = (path) => import(pathToFileURL(resolve(root, outDir, "src", path + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { compileOpeningBattle } = await module("compiler/battle");
const { compileOpeningPlayable } = await module("compiler/opening-playable");
const { compileInitialPartyState } = await module("compiler/party");
const { decodeFieldOp } = await module("compiler/field");
const { hash } = await module("compiler/content");
const { EventState } = await module("core/event-state");
const { FieldGame } = await module("core/field");
const { GameState } = await module("core/game-state");
const {
  activePartyMembers,
  emptyPartyState,
  executePartyEvent,
  previewPartyCommand,
} = await module("core/party");

const corpus = await loadCorpus(root);
const native = JSON.parse(
  await readFile(root + "/build/reports/party-native-check.json", "utf8"),
);
assert.equal(native.semanticsVerified, false);
assert.equal(native.methods.length, 36);
assert.equal(native.rawRanges.length, 12);
assert.ok(
  corpus.manifest.sources.some(
    (s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256,
  ),
);
const catalog = await compileOpeningPlayable(
  root,
  await compileOpeningBattle(root),
);
const make = () =>
  new GameState(
    catalog.gameState,
    catalog.common.players,
    catalog.contentHash,
    catalog.common.conditions,
  );
const initial = make().snapshot();
assert.equal(initial.formatVersion, 8);
assert.equal(Object.keys(catalog.gameState.characterInitializations).length, 18);
assert.deepEqual(
  initial.roster.map((p) => [p.sourceId, p.enabled]),
  [
    [1, true],
    [31, true],
    [32, true],
  ],
);
const compiledInitial = compileInitialPartyState(corpus.tables, initial.roster);
assert.deepEqual(initial.party, compiledInitial.state);
assert.deepEqual(catalog.gameState.initialParty, compiledInitial.state);
assert.deepEqual(activePartyMembers(initial.party), [
  { id: "player:1", index: 0, row: "front" },
  { id: "player:31", index: 1, row: "front" },
  { id: "player:32", index: 2, row: "front" },
]);
assert.deepEqual(initial.party.slots[0][3], { id: null, row: "front" });

// Identity-only synthetic owners cover reference/slot rules. They are never
// injected into the actual GameState catalog, roster, or published bootstrap.
const identityRoster = corpus.tables["character_status.csv"].map((r) => ({
  id: "probe-owned:" + r.id,
  sourceId: Number(r.id),
  enabled: Number(r.id) % 2 === 0,
}));
const identityBySource = new Map(identityRoster.map((r) => [r.sourceId, r.id]));
function probeState(selectedSlot) {
  const state = emptyPartyState();
  state.selectedSlot = selectedSlot;
  for (const slot of state.slots)
    slot.forEach((cell, position) => {
      cell.id = identityRoster[position].id;
      cell.row = position % 2 ? "front" : "back";
    });
  return state;
}
function controlledField(site, instruction) {
  return {
    kind: "field-development",
    formatVersion: 1,
    contentHash: hash({
      site,
      instruction,
      kind: "isolated-source-party-probe",
    }),
    sourceSetHash: catalog.common.fieldSourceSetHash,
    parentSourceSetHash: corpus.sourceSetHash,
    map: {
      id: "party-probe",
      width: 1,
      height: 1,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: [0] },
      entities: [],
      source: site.source,
    },
    characters: {},
    scripts: {
      [site.script]: [
        { ...instruction, index: 0 },
        { ...site, index: 1, kind: "exit" },
      ],
    },
    entry: {
      player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
      description: "Isolated source party instruction; controlled state",
      evidence: [site.source],
    },
    limitations: [
      "controlled-state",
      "isolated-instruction",
      "no-actor-refresh",
      "no-original-oracle",
    ],
  };
}
const entries = [],
  pureChecks = [],
  falseHostChecks = [],
  trueHostBlockers = [],
  controlledRefreshChecks = [],
  rosterBlockers = [],
  lifecycleBlockers = [],
  lifecycleDecoded = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    const site = {
      script: asset.id,
      index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` },
    };
    if (
      raw.mnemonic === "SysCall" &&
      /^メンバー(加入|離脱)：/.test(raw.operands.sValues?.[0] ?? "")
    ) {
      const decoded = decodeFieldOp(raw, site, corpus.messages, corpus.tables);
      if (decoded.kind === "roster")
        lifecycleDecoded.push({ site, selector: raw.operands.sValues[0] });
      else {
        assert.equal(decoded.kind, "blocked");
        lifecycleBlockers.push({
          site,
          selector: raw.operands.sValues[0],
          reason: decoded.reason,
        });
      }
    }
    if (!["OrganizePartySlot", "ChangePartySlot"].includes(raw.mnemonic))
      continue;
    const instruction = decodeFieldOp(
      raw,
      site,
      corpus.messages,
      corpus.tables,
    );
    entries.push({ site, mnemonic: raw.mnemonic, instruction });
    assert.equal(instruction.kind, "party");
    const i = raw.operands.iValues,
      sourceSlot = i[0] - 1;
    for (const selectedSlot of [sourceSlot, (sourceSlot + 1) % 3]) {
      const before = probeState(selectedSlot),
        expected = structuredClone(before);
      if (raw.mnemonic === "ChangePartySlot")
        expected.selectedSlot = sourceSlot;
      else
        expected.slots[sourceSlot].forEach((cell, position) => {
          const sourceId = i[position + 1];
          if (sourceId < 1) cell.id = null;
          else {
            assert.ok(identityBySource.has(sourceId));
            cell.id = identityBySource.get(sourceId);
            cell.row = "front";
          }
        });
      const stableBefore = structuredClone(before);
      const preview = previewPartyCommand(
        before,
        identityRoster,
        instruction.command,
      );
      assert.deepEqual(preview.state, expected);
      assert.deepEqual(before, stableBefore);
      assert.deepEqual(preview.activeMembers, activePartyMembers(expected));
      assert.equal(
        preview.refreshActors,
        raw.mnemonic === "OrganizePartySlot" || i[1] !== 0,
      );
      pureChecks.push({
        site,
        selectedSlot,
        after: preview.state,
        activeMembers: preview.activeMembers,
      });
    }

    const owned = make(),
      before = owned.snapshot();
    const field = controlledField(site, instruction);
    const game = new FieldGame(
      field,
      EventState.initialized(),
      undefined,
      undefined,
      { party: owned.fieldParty },
    );
    game.startEvent(asset.id);
    game.advance(1000);
    if (!instruction.command.refreshActors) {
      assert.equal(game.stop, null);
      assert.equal(game.busy, false);
      const after = owned.snapshot();
      assert.equal(after.party.selectedSlot, sourceSlot);
      assert.deepEqual(after.party.slots, before.party.slots);
      assert.deepEqual({ ...after, party: before.party }, before);
      assert.deepEqual(owned.activeParty, activePartyMembers(after.party));
      assert.deepEqual(
        owned.partyPlayers().map((p) => p.id),
        owned.activeParty.map((p) => p.id),
      );
      if (!owned.activeParty.length) assert.ok(owned.battlePartyBlocker);
      const restored = make();
      restored.restore(JSON.parse(JSON.stringify(after)));
      assert.deepEqual(restored.snapshot(), after);
      const resumed = FieldGame.restore(
        field,
        JSON.parse(JSON.stringify(game.checkpoint())),
        { party: restored.fieldParty },
      );
      resumed.advance(1000);
      assert.deepEqual(
        restored.snapshot(),
        after,
        "checkpoint restore must not replay source party changes",
      );
      falseHostChecks.push({
        site,
        selectedSlot: sourceSlot,
        activeMembers: owned.activeParty,
      });
    } else {
      assert.equal(game.stop?.kind, "unsupported");
      assert.deepEqual(owned.snapshot(), before);
      trueHostBlockers.push({ site, stop: game.stop });
      const needed =
        instruction.command.kind === "organize-slot"
          ? instruction.command.members.filter((id) => id !== null)
          : [];
      const unowned = needed.filter(
        (id) => !before.roster.some((r) => r.sourceId === id),
      );
      if (unowned.length) {
        assert.throws(
          () =>
            executePartyEvent(instruction, owned.fieldParty, () => () => {}),
          /unowned/,
        );
        assert.deepEqual(owned.snapshot(), before);
        rosterBlockers.push({ site, unowned });
        continue;
      }
      let presented = null;
      executePartyEvent(instruction, owned.fieldParty, (members) => {
        assert.deepEqual(owned.snapshot(), before);
        const prepared = structuredClone(members);
        return () => {
          presented = prepared;
        };
      });
      const after = owned.snapshot();
      assert.deepEqual(presented, activePartyMembers(after.party));
      assert.deepEqual({ ...after, party: before.party }, before);
      const restored = make();
      restored.restore(JSON.parse(JSON.stringify(after)));
      assert.deepEqual(restored.snapshot(), after);
      controlledRefreshChecks.push({
        site,
        activeMembers: presented,
        kind: "callback-only-no-rendering",
      });
    }
  }
}
assert.equal(entries.length, 196);
assert.equal(pureChecks.length, 392);
assert.equal(falseHostChecks.length, 45);
assert.equal(trueHostBlockers.length, 151);
assert.equal(
  entries.filter((e) => e.mnemonic === "OrganizePartySlot").length,
  92,
);
assert.equal(
  entries.filter((e) => e.mnemonic === "ChangePartySlot").length,
  104,
);
// Reuse one actual source organization instruction after source 2 is acquired
// through the shared roster port. The callback remains an isolated renderer stub.
const dynamicEntry = entries.find((entry) => entry.instruction.command.kind === "organize-slot" &&
  entry.instruction.command.members.includes(2) && entry.instruction.command.members.every((id) =>
    id === null || [1, 2, 31, 32].includes(id)));
assert.ok(dynamicEntry, "Missing a source party organization for the controlled new owner");
const dynamicOwnerState = make();
dynamicOwnerState.fieldRoster.prepare({ kind: "join", sourceId: 2, position: null, row: "front",
  refreshActors: false, recovery: false, refitEquipment: false }).commit();
const dynamicBefore = dynamicOwnerState.snapshot();
assert.equal(dynamicBefore.roster.find((p) => p.sourceId === 2).ownedId, 4);
let dynamicPresented;
executePartyEvent(dynamicEntry.instruction, dynamicOwnerState.fieldParty, (members) => {
  assert.deepEqual(dynamicOwnerState.snapshot(), dynamicBefore);
  return () => { dynamicPresented = structuredClone(members); };
});
const dynamicAfter = dynamicOwnerState.snapshot();
assert.deepEqual({ ...dynamicAfter, party: dynamicBefore.party }, dynamicBefore);
assert.deepEqual(dynamicPresented, activePartyMembers(dynamicAfter.party));
assert.ok(dynamicAfter.party.slots[dynamicEntry.instruction.command.slot].some((cell) => cell.id === "player:2"));
const dynamicRestored = make();
dynamicRestored.restore(JSON.parse(JSON.stringify(dynamicAfter)));
assert.deepEqual(dynamicRestored.snapshot(), dynamicAfter);
const dynamicOwnerCheck = { site: dynamicEntry.site, command: dynamicEntry.instruction.command,
  ownedId: 4, activeMembers: dynamicPresented, ownedHash: hash(dynamicAfter),
  kind: "source-organization-after-controlled-join-callback-only-no-rendering" };
const report = {
  lane: "source-party-controlled-states",
  sourceSetHash: corpus.sourceSetHash,
  catalogHash: catalog.contentHash,
  nativeReportHash: hash(native),
  compiledInitial,
  summary: {
    decodedSourceInstructions: entries.length,
    pureStateProbes: pureChecks.length,
    falseRefreshFieldHostPasses: falseHostChecks.length,
    trueRefreshFieldHostBlockers: trueHostBlockers.length,
    controlledRefreshCallbacks: controlledRefreshChecks.length,
    unownedRosterBlockers: rosterBlockers.length,
    lifecycleSelectorsBlocked: lifecycleBlockers.length,
    lifecycleSelectorsDecoded: lifecycleDecoded.length,
    dynamicOwnerOrganizations: 1,
  },
  entries,
  pureChecks,
  falseHostChecks,
  trueHostBlockers,
  controlledRefreshChecks,
  rosterBlockers,
  lifecycleBlockers,
  lifecycleDecoded,
  dynamicOwnerCheck,
  doesNotEstablish: [
    "story-reachability",
    "all-additional-owned-characters",
    "story-join-or-departure",
    "actor-refresh-rendering",
    "original-game-execution",
    "full-game-parity",
  ],
};
await writeFile(
  root + "/build/reports/party-check.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      ...report.summary,
      catalogHash: catalog.contentHash,
      reportHash: hash(report),
    },
    null,
    2,
  ),
);
