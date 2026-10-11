// Real selectors on the existing opening owners; callback probes are not rendered gameplay.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../dist/src/compiler/corpus.js";
import { compileOpeningBattle } from "../dist/src/compiler/battle.js";
import { compileOpeningPlayable } from "../dist/src/compiler/opening-playable.js";
import {
  compileInitialRosterLifecycle,
  compileRosterLifecycleEvent,
  rosterLifecycleSelectors,
} from "../dist/src/compiler/roster.js";
import { decodeFieldOp } from "../dist/src/compiler/field.js";
import { hash } from "../dist/src/compiler/content.js";
import { EventState } from "../dist/src/core/event-state.js";
import { FieldGame } from "../dist/src/core/field.js";
import { GameState } from "../dist/src/core/game-state.js";
import { executeRosterLifecycleEvent } from "../dist/src/core/roster.js";
import { activePartyMembers } from "../dist/src/core/party.js";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const corpus = await loadCorpus(root);
const native = JSON.parse(
  await readFile(
    root + "/build/reports/roster-lifecycle-native-check.json",
    "utf8",
  ),
);
assert.equal(native.semanticsVerified, false);
assert.equal(native.methods.length, 33);
assert.equal(native.selectorBindings.length, 6);
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
assert.equal(initial.formatVersion, 5);
const { dependencies, ...initialMetadata } = compileInitialRosterLifecycle(
  corpus.tables,
  initial.roster,
);
assert.deepEqual(catalog.gameState.rosterLifecycle, initialMetadata);
assert.deepEqual(initial.releasedJobIds, [1]);
assert.deepEqual(
  initial.roster.map((r) => [
    r.sourceId,
    r.ownedId,
    r.jobId,
    r.additionalLevel,
    r.magicStoneId,
  ]),
  [
    [1, 1, 19, 3, 0],
    [31, 2, 18, 1, 0],
    [32, 3, 18, 1, 0],
  ],
);
for (const owner of initial.roster)
  assert.deepEqual(owner.ownedJobs, [
    { id: owner.jobId, level: 1, proficiency: 0 },
    { id: 1, level: 1, proficiency: 0 },
  ]);
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
const decoded = [],
  blockedSelectors = [],
  actualHostBlockers = [],
  controlledPublications = [],
  missingOwnedProviders = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    const selector = raw.operands?.sValues?.[0];
    if (raw.mnemonic !== "SysCall" || !/^メンバー(加入|離脱)：/.test(selector))
      continue;
    const site = {
      script: asset.id,
      index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` },
    };
    const op = decodeFieldOp(raw, site, corpus.messages, corpus.tables);
    if (!rosterLifecycleSelectors.includes(selector)) {
      assert.equal(op.kind, "blocked");
      blockedSelectors.push({ site, selector, reason: op.reason });
      continue;
    }
    assert.equal(op.kind, "roster");
    assert.deepEqual(
      op.command,
      compileRosterLifecycleEvent(selector, corpus.tables).command,
    );
    decoded.push({ site, selector, command: op.command });
    const owned = make(),
      before = owned.snapshot();
    const game = new FieldGame(
      controlledField(site, op),
      EventState.initialized(),
      undefined,
      undefined,
      { roster: owned.fieldRoster },
    );
    game.startEvent(asset.id);
    game.advance(1000);
    assert.equal(game.stop?.kind, "unsupported");
    assert.deepEqual(
      owned.snapshot(),
      before,
      "actual field rejection must not publish any partial lifecycle mutation",
    );
    actualHostBlockers.push({ site, selector, stop: game.stop });
    const member = before.roster.find(
      (m) => m.sourceId === op.command.sourceId,
    );
    if (!member) {
      assert.throws(
        () =>
          executeRosterLifecycleEvent(op, owned.fieldRoster, () => () => {}),
        /owned-character initialization|unowned character/,
      );
      assert.deepEqual(owned.snapshot(), before);
      missingOwnedProviders.push({
        site,
        selector,
        sourceId: op.command.sourceId,
      });
      continue;
    }
    let presented;
    executeRosterLifecycleEvent(op, owned.fieldRoster, (members) => {
      assert.deepEqual(
        owned.snapshot(),
        before,
        "presentation prepares before shared publication",
      );
      return () => {
        presented = structuredClone(members);
      };
    });
    const after = owned.snapshot(),
      target = after.roster.find((m) => m.id === member.id);
    assert.deepEqual(presented, activePartyMembers(after.party));
    assert.deepEqual(
      after.roster.map((m) => [m.id, m.sourceId, m.ownedId]),
      before.roster.map((m) => [m.id, m.sourceId, m.ownedId]),
    );
    assert.deepEqual(after.items, before.items);
    assert.equal(after.gil, before.gil);
    assert.deepEqual(after.completedBattles, before.completedBattles);
    if (op.command.kind === "secede") {
      assert.equal(target.enabled, false);
      assert.equal(target.magicStoneId, 0);
      assert.deepEqual(after.party.slots.slice(1), before.party.slots.slice(1));
      assert.equal(
        after.party.slots[0].find((c) => c.id === member.id),
        undefined,
      );
      if (op.command.removeEquipment) {
        assert.deepEqual(target.equipment, member.equipment);
        for (const stack of before.equipmentStock) {
          const removed = member.equipment.filter(
            (id) => id === stack.id,
          ).length;
          assert.equal(
            after.equipmentStock.find((s) => s.id === stack.id).count,
            stack.count - removed,
          );
        }
      } else {
        assert.deepEqual(after.equipmentStock, before.equipmentStock);
        assert.deepEqual(
          target.equipment,
          catalog.gameState.equipmentSystem.catalog.characters[member.sourceId]
            .emptySlots,
        );
      }
      assert.equal(after.releasedJobIds.includes(member.jobId), false);
    } else {
      assert.equal(target.enabled, true);
      assert.deepEqual(after.party, before.party);
      assert.deepEqual(after.equipmentStock, before.equipmentStock);
      assert.ok(after.releasedJobIds.includes(member.jobId));
      for (const owner of after.roster)
        assert.ok(owner.ownedJobs.some((j) => j.id === member.jobId));
    }
    const restored = make();
    restored.restore(JSON.parse(JSON.stringify(after)));
    assert.deepEqual(restored.snapshot(), after);
    controlledPublications.push({
      site,
      selector,
      activeMembers: presented,
      ownedHash: hash(after),
      kind: "callback-only-no-rendering",
    });
  }
}
assert.equal(decoded.length, 19);
assert.equal(blockedSelectors.length, 103);
assert.equal(actualHostBlockers.length, 19);
assert.equal(controlledPublications.length, 10);
assert.equal(missingOwnedProviders.length, 9);
const report = {
  lane: "source-roster-lifecycle-controlled-ownership",
  sourceSetHash: corpus.sourceSetHash,
  catalogHash: catalog.contentHash,
  nativeReportHash: hash(native),
  initialMetadata,
  dependencies,
  summary: {
    decodedSourceInstructions: decoded.length,
    blockedSourceInstructions: blockedSelectors.length,
    actualFieldHostBlockers: actualHostBlockers.length,
    controlledCallbackPublications: controlledPublications.length,
    missingOwnedProviders: missingOwnedProviders.length,
  },
  decoded,
  blockedSelectors,
  actualHostBlockers,
  controlledPublications,
  missingOwnedProviders,
  doesNotEstablish: [
    "complete-new-owned-initialization",
    "source-growth-and-learning",
    "rendered-actor-refresh",
    "story-reachability",
    "original-game-execution",
    "full-game-parity",
  ],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "/build/reports/roster-lifecycle-check.json", output);
console.log(
  JSON.stringify({ ...report.summary, reportSha256: hash(report) }, null, 2),
);
