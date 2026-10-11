// Source instructions in controlled inventory states. This is not story reachability
// or an original-game behavior comparison.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../dist/src/compiler/corpus.js";
import { compileOpeningBattle } from "../dist/src/compiler/battle.js";
import { compileOpeningPlayable } from "../dist/src/compiler/opening-playable.js";
import { decodeFieldOp } from "../dist/src/compiler/field.js";
import { hash } from "../dist/src/compiler/content.js";
import { EventState } from "../dist/src/core/event-state.js";
import { FieldGame } from "../dist/src/core/field.js";
import { GameState } from "../dist/src/core/game-state.js";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const corpus = await loadCorpus(root),
  sourceBattle = await compileOpeningBattle(root);
const catalog = await compileOpeningPlayable(root, sourceBattle);
const native = JSON.parse(
  await readFile(
    root + "/build/reports/inventory-events-native-check.json",
    "utf8",
  ),
);
assert.equal(
  native.sourceSha256,
  "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
);
assert.ok(
  corpus.manifest.sources.some(
    (s) => s.file === "GameAssembly.dll" && s.sha256 === native.sourceSha256,
  ),
);
const make = () =>
  new GameState(
    catalog.gameState,
    catalog.common.players,
    catalog.contentHash,
    catalog.common.conditions,
  );
const entries = [],
  checks = [];
for (const asset of corpus.assets.filter((a) => a.kind === "script")) {
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    if (!["GetItem", "RemoveItem", "RemoveGil"].includes(raw.mnemonic))
      continue;
    const site = {
      script: asset.id,
      index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` },
    };
    const op = decodeFieldOp(raw, site, corpus.messages, corpus.tables);
    entries.push({ site, mnemonic: raw.mnemonic, op });
    if (op.kind === "blocked") continue;
    assert.equal(op.kind, "inventory");
    // Expectations use raw source identity/coefficient, not the compiled command.
    const sourceId = raw.operands.iValues[0],
      amount = raw.operands.iValues[1];
    const content = corpus.tables["content.csv"].find(
      (r) => +r.id === sourceId,
    );
    const product = corpus.tables["product.csv"].filter(
      (r) => +r.group_id === sourceId,
    );
    const item = raw.mnemonic !== "RemoveGil" && content.type_id === "1";
    const payment = raw.mnemonic === "RemoveGil";
    const fee = payment ? Number(product[0].coefficient) : null;
    const initials = item
      ? [0, 1, catalog.gameState.limits.item]
      : payment
        ? [...new Set([0, Math.max(0, fee - 1), fee, fee + 1])]
        : [0, catalog.gameState.limits.gil - 1, catalog.gameState.limits.gil];
    for (const initial of initials) {
      const owned = make(),
        before = owned.snapshot();
      if (item) {
        before.items = before.items.filter((x) => x.id !== sourceId);
        if (initial) before.items.push({ id: sourceId, count: initial });
        before.items.sort((a, b) => a.id - b.id);
      } else before.gil = before.totalGil = initial;
      owned.restore(before);
      const field = {
        formatVersion: 1,
        kind: "field-development",
        sourceSetHash: corpus.sourceSetHash,
        parentSourceSetHash: corpus.sourceSetHash,
        contentHash: hash({ site, raw }),
        map: {
          id: "inventory-probe",
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
        scripts: {
          [asset.id]: [
            { ...op, index: 0 },
            { ...site, index: 1, kind: "exit" },
          ],
        },
        entry: {
          player: {
            x: 0,
            y: 0,
            layer: 1,
            direction: "up",
            asset: "",
            mount: "",
          },
          description:
            "Isolated source inventory instruction; controlled state",
          evidence: [asset.source],
        },
        limitations: [
          "controlled-state",
          "isolated-instruction",
          "no-original-oracle",
        ],
      };
      const game = new FieldGame(
        field,
        EventState.initialized(),
        undefined,
        undefined,
        { inventory: owned.fieldInventory },
      );
      game.startEvent(asset.id);
      game.advance(1000);
      assert.equal(game.stop, null);
      assert.equal(game.busy, false);
      const after = owned.snapshot();
      if (item) {
        const expected =
          raw.mnemonic === "GetItem"
            ? Math.min(catalog.gameState.limits.item, initial + amount)
            : Math.max(0, initial - amount);
        assert.equal(
          after.items.find((x) => x.id === sourceId)?.count ?? 0,
          expected,
        );
        assert.equal(after.gil, before.gil);
        assert.equal(after.totalGil, before.totalGil);
      } else if (payment) {
        const paid = initial >= fee;
        assert.equal(after.gil, paid ? initial - fee : initial);
        assert.equal(after.totalGil, before.totalGil);
        assert.equal(
          game.eventState.read({ category: "MapLocalVariable", index: 0 }),
          Number(paid),
        );
      } else {
        assert.equal(
          after.gil,
          Math.min(catalog.gameState.limits.gil, initial + amount),
        );
        assert.equal(after.totalGil, initial + amount);
      }
      assert.deepEqual(after.roster, before.roster);
      assert.deepEqual(after.completedBattles, before.completedBattles);
      const stable = JSON.stringify(after);
      const restored = FieldGame.restore(
        field,
        JSON.parse(JSON.stringify(game.checkpoint())),
        { inventory: owned.fieldInventory },
      );
      restored.advance(1000);
      assert.equal(
        JSON.stringify(owned.snapshot()),
        stable,
        "restoring idle field must not repeat inventory command",
      );
      checks.push({
        site,
        initial,
        ownedBefore: hash(before),
        ownedAfter: hash(after),
        fieldAfter: hash(game.checkpoint()),
      });
    }
  }
}
const report = {
  kind: "field-inventory-source-check",
  formatVersion: 1,
  sourceSetHash: corpus.sourceSetHash,
  catalogHash: catalog.contentHash,
  nativeReportHash: hash(native),
  counts: {
    sourceSites: entries.length,
    admittedSites: entries.filter((e) => e.op.kind === "inventory").length,
    blockedSites: entries.filter((e) => e.op.kind === "blocked").length,
    probes: checks.length,
  },
  entries,
  checks,
  limitations: [
    "No new maps or story unlocks",
    "Isolated instructions with controlled stock and Gil",
    "Equipment/magic/esper content stays blocked",
    "No general item-count query or arbitrary SysCall support",
    "No original dynamic parity",
    "Source remove-zero record deletion is projected as canonical zero count",
  ],
};
const result = { ...report, contentHash: hash(report) };
await writeFile(
  root + "/build/reports/inventory-events-check.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    ...report.counts,
    contentHash: result.contentHash,
    catalogHash: result.catalogHash,
  }),
);
