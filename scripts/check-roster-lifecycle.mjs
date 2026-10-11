// Real selectors on controlled shared ownership; callback probes are not rendered gameplay.
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
const {
  compileInitialRosterLifecycle,
  compileRosterLifecycleEvent,
  rosterLifecycleSelectors,
} = await module("compiler/roster");
const { decodeFieldOp } = await module("compiler/field");
const { hash } = await module("compiler/content");
const { EventState } = await module("core/event-state");
const { FieldGame } = await module("core/field");
const { GameState } = await module("core/game-state");
const { executeRosterLifecycleEvent } = await module("core/roster");
const { activePartyMembers } = await module("core/party");
const { firstJoinLevelAdjustments } = await module("core/character-growth");

const corpus = await loadCorpus(root);
function sourceEmptyEquipment(id) {
  const content = corpus.tables["content.csv"].find((row) => Number(row.id) === id);
  assert.ok(content && ["2", "3"].includes(content.type_id));
  const table = content.type_id === "2" ? "weapon.csv" : "armor.csv";
  const equipment = corpus.tables[table].find((row) => row.id === content.type_value);
  assert.ok(equipment);
  return equipment.type_id === "2";
}
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
assert.equal(initial.formatVersion, 7);
const { dependencies, ...initialMetadata } = compileInitialRosterLifecycle(
  corpus.tables,
  initial.roster,
);
const { firstJoinLevelAdjustments: compiledAdjustments, ...publishedInitialMetadata } = catalog.gameState.rosterLifecycle;
assert.deepEqual(publishedInitialMetadata, initialMetadata);
assert.deepEqual(compiledAdjustments, firstJoinLevelAdjustments);
assert.equal(Object.keys(catalog.gameState.characterInitializations).length, 18);
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
  dynamicOwnedPublications = [],
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
    const template = Object.values(catalog.gameState.characterInitializations)
      .find((t) => t.initial.sourceId === op.command.sourceId);
    if (!member && (op.command.kind === "secede" || !template)) {
      assert.throws(
        () =>
          executeRosterLifecycleEvent(op, owned.fieldRoster, () => () => {}),
        /character initialization|unowned character/,
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
      target = after.roster.find((m) => m.sourceId === op.command.sourceId);
    assert.deepEqual(presented, activePartyMembers(after.party));
    assert.deepEqual(
      after.roster.slice(0, before.roster.length).map((m) => [m.id, m.sourceId, m.ownedId]),
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
          // RemoveEquipmentsItems (7fd310) skips ListTypeId 2, unlike
          // AddFromMaster's unconditional per-slot initial grants.
          const removed = member.equipment.filter(
            (id) => id === stack.id && !sourceEmptyEquipment(id),
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
      if (member) {
        assert.equal(after.roster.length, before.roster.length);
        assert.deepEqual(after.party, before.party);
        assert.deepEqual(after.equipmentStock, before.equipmentStock);
      } else {
        assert.equal(target.sourceId, 2);
        assert.equal(target.ownedId, 4);
        assert.equal(target.level, 5);
        assert.equal(target.exp, 400);
        assert.equal(target.hp, template.initial.hp);
        assert.equal(target.mp, template.initial.mp);
        assert.equal(after.roster.length, before.roster.length + 1);
        assert.deepEqual(after.party.slots[0][3], { id: target.id, row: "front" });
        assert.deepEqual(after.learnedAbilityIds, [...before.learnedAbilityIds, 229]);
        assert.deepEqual(after.characterNames, { ...before.characterNames, ROCK: target.name });
        const sourceCharacter = corpus.tables["character_status.csv"].find((row) => Number(row.id) === target.sourceId);
        assert.ok(sourceCharacter);
        const sourceEquipment = Array.from({ length: 6 }, (_, i) => Number(sourceCharacter[`content_id${i + 1}`]));
        assert.deepEqual(template.initial.equipment, sourceEquipment);
        const expectedCounts = new Map(before.equipmentStock.map(({ id, count }) => [id, count]));
        // AddFromMaster (328110) grants all six source slots, including the
        // repeated empty accessories; this is a new owner, not a rejoin.
        for (const id of sourceEquipment) expectedCounts.set(id, (expectedCounts.get(id) ?? 0) + 1);
        assert.deepEqual(after.equipmentStock, [...expectedCounts].sort(([a], [b]) => a - b)
          .map(([id, count]) => ({ id, count })));
        dynamicOwnedPublications.push({ site, selector, sourceId: target.sourceId, ownedId: target.ownedId,
          level: target.level, hp: target.hp, maxHp: target.maxHp, ownedHash: hash(after) });
      }
      assert.ok(after.releasedJobIds.includes(target.jobId));
      for (const owner of after.roster)
        assert.ok(owner.ownedJobs.some((j) => j.id === target.jobId));
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
assert.equal(controlledPublications.length + missingOwnedProviders.length, decoded.length);
assert.equal(controlledPublications.length, 18);
assert.equal(dynamicOwnedPublications.length, 8);
assert.equal(missingOwnedProviders.length, 1);
const report = {
  lane: "source-roster-lifecycle-controlled-ownership",
  sourceSetHash: corpus.sourceSetHash,
  catalogHash: catalog.contentHash,
  nativeReportHash: hash(native),
  initialMetadata,
  firstJoinLevelAdjustments: compiledAdjustments,
  dependencies,
  summary: {
    decodedSourceInstructions: decoded.length,
    blockedSourceInstructions: blockedSelectors.length,
    actualFieldHostBlockers: actualHostBlockers.length,
    controlledCallbackPublications: controlledPublications.length,
    controlledNewOwnerPublications: dynamicOwnedPublications.length,
    missingOwnedProviders: missingOwnedProviders.length,
  },
  decoded,
  blockedSelectors,
  actualHostBlockers,
  controlledPublications,
  dynamicOwnedPublications,
  missingOwnedProviders,
  doesNotEstablish: [
    "complete-new-owned-initialization",
    "all-source-growth-and-learning-providers",
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
