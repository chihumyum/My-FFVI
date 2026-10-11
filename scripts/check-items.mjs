// Controlled source probes, not story grants or original-game parity.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { compileOpeningBattle } from "../dist/src/compiler/battle.js";
import { compileOpeningPlayable } from "../dist/src/compiler/opening-playable.js";
import { GameState } from "../dist/src/core/game-state.js";
import { GameSession } from "../dist/src/core/game-session.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { sourceBattleContent as encounterContent, controlledBattleContent } from "./battle-probe-context.mjs";
import {
  encodeSavedGame,
  decodeSavedGame,
} from "../dist/src/core/saved-game.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { hash } from "../dist/src/compiler/content.js";
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const source = await compileOpeningBattle(root);
const catalog = await verifyContent(
  JSON.parse(
    await readFile(root + "/build/game/opening-playable.json", "utf8"),
  ),
);
assert.deepEqual(catalog, await compileOpeningPlayable(root, source));
const field = await verifyContent(
  JSON.parse(await readFile(root + "/build/game/narshe.json", "utf8")),
);
const make = () =>
  new GameState(
    catalog.gameState,
    catalog.common.players,
    catalog.contentHash,
    catalog.common.conditions,
  );
const setup = (id) => {
  const state = make(),
    s = state.snapshot();
  s.roster.forEach((p) => {
    p.hp = 1;
    p.mp = 0;
  });
  state.restore(s);
  state.changeItems([{ id, count: 1 }], "grant");
  return state;
};
const checks = [],
  coverage = [];
for (const item of Object.values(catalog.gameState.items).sort(
  (a, b) => a.id - b.id,
)) {
  const row = source.tables["item.csv"][item.itemId],
    content = source.tables["content.csv"][item.id];
  assert.equal(content.values.type_value, String(item.itemId));
  for (const context of ["menu", "battle"]) {
    const use = item.uses[context];
    assert.equal(
      use.program.groupId,
      Number(row.values[`${context}_function_group_id`]),
    );
    assert.equal(use.program.range, Number(row.values[`${context}_renge_id`]));
    coverage.push({
      id: item.id,
      itemId: item.itemId,
      context,
      admitted: !!use.plan,
      checkedFixedRecovery:
        !!use.plan &&
        use.plan.effects.every(
          (e) => e.kind === "recovery" && e.calculation === "fixed",
        ),
      blockers: use.blockers,
      contentSource: content.source,
      itemSource: row.source,
      program: use.program,
    });
    if (
      !use.plan ||
      !use.plan.effects.every(
        (e) => e.kind === "recovery" && e.calculation === "fixed",
      )
    )
      continue;
    const expect = (before) => {
      const after = { hp: before.hp, mp: before.mp };
      // Independent source interpretation of the admitted function.type_id=1,
      // value1=1 provider. No expected values are read from the compiled plan.
      const group =
        source.tables["function_group.csv"][use.program.groupId].values;
      for (let slot = 1; slot <= 3; slot++) {
        const fn = Number(group[`function${slot}_id`]);
        if (!fn) continue;
        assert.equal(source.tables["function.csv"][fn].values.type_id, "1");
        assert.equal(group[`function${slot}_value1`], "1");
        const resource = { 2: "hp", 3: "mp" }[group[`function${slot}_value2`]];
        assert.ok(resource);
        after[resource] = Math.min(
          resource === "hp" ? before.maxHp : before.maxMp,
          after[resource] + Number(row.values.standard_value),
        );
      }
      return after;
    };
    if (context === "menu") {
      const state = setup(item.id),
        before = state.snapshot().roster[0];
      assert.equal(state.useMenuItem(item.id, before.id), true);
      const after = state.snapshot().roster[0];
      assert.deepEqual({ hp: after.hp, mp: after.mp }, expect(before));
      assert.equal(
        state.snapshot().items.find((i) => i.id === item.id).count,
        0,
      );
      state.changeItems([{ id: item.id, count: 1 }], "grant");
      const full = state.snapshot();
      full.roster[0].hp = full.roster[0].maxHp;
      full.roster[0].mp = full.roster[0].maxMp;
      full.roster[0].conditionIds = [];
      state.restore(full);
      assert.equal(state.useMenuItem(item.id, before.id), false);
      assert.deepEqual(state.snapshot(), full);
      // Whole game checkpoint, encoded payload and restore retain the new quantity.
      const game = new GameSession(field, catalog);
      game.state.restore(state.snapshot());
      const saved = await decodeSavedGame(
        await encodeSavedGame(game.checkpoint(), 0),
      );
      assert.deepEqual(
        GameSession.restore(saved.checkpoint, field, catalog).checkpoint(),
        game.checkpoint(),
      );
      checks.push({
        id: item.id,
        context,
        before,
        after,
        saved: true,
        fullTargetDoesNotConsume: true,
      });
    } else {
      const run = (parts) => {
        const state = setup(item.id),
          entry = state.snapshot(),
          lease = state.openBattle(3);
        const battle = new BattleGame(
          encounterContent(catalog, 3),
          42,
          state.battlePlayers(lease),
          state.battleInventory(lease),
        );
        battle.players.forEach((p) => {
          p.atb = 100;
        });
        battle.enemies.forEach((p) => {
          p.atb = 0;
        });
        const actor = battle.players[0],
          choice = battle.itemTargetChoices(actor.id, item.id)[0];
        const before = structuredClone(battle.players);
        assert.equal(
          battle.commandItem(actor.id, item.id, choice.selection, 3),
          true,
        );
        assert.equal(
          battle.canUseItem(battle.players[1].id, item.id, 3),
          false,
        );
        for (const ms of parts) battle.advance(ms);
        const after = structuredClone(battle.players);
        for (const [index, p] of after.entries())
          assert.deepEqual(
            { hp: p.hp, mp: p.mp },
            choice.targetIds.includes(p.id)
              ? expect(before[index])
              : { hp: before[index].hp, mp: before[index].mp },
          );
        assert.equal(battle.inventory.find((i) => i.id === item.id).count, 0);
        assert.deepEqual(state.snapshot(), entry);
        battle.enemies.forEach((p) => {
          p.hp = 0;
        });
        battle.advance(600);
        const result = battle.previewVictory();
        assert.ok(result);
        assert.deepEqual(result.consumedItems, [{ id: item.id, count: 1 }]);
        const commit = state.prepareVictory(lease, result);
        commit();
        assert.throws(commit, /Stale/);
        assert.equal(
          state.snapshot().items.find((i) => i.id === item.id).count,
          0,
        );
        return {
          before,
          after,
          state: state.snapshot(),
          events: battle.events,
          selection: choice.selection,
        };
      };
      const result = run([410]);
      assert.deepEqual(result, run(Array(41).fill(10)));
      checks.push({
        id: item.id,
        context,
        ...result,
        reservation: true,
        exactlyOnceVictory: true,
        framePartition: true,
      });
    }
  }
}
const report = {
  lane: "controlled-source-item-actions",
  sourceSetHash: source.parentSourceSetHash,
  catalogHash: catalog.contentHash,
  battleProfile: catalog.common.profile,
  coverage,
  checks,
  limitations: [
    "controlled stock and damaged party are not story grants",
    "player targets only",
    "fixed ordinary HP/MP recovery only",
    "original timing, reservation refunds and behavior parity unverified",
    "revival and condition cures are checked separately by check-item-status.mjs",
    "this lane does not check equipment-use, non-guaranteed consumption, shops, drops or event inventory",
  ],
};
report.contentHash = hash(report);
await writeFile(
  root + "/build/reports/items-check.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contentHash: report.contentHash,
    decoded: coverage.length,
    admittedMenu: coverage.filter((c) => c.admitted && c.context === "menu")
      .length,
    admittedBattle: coverage.filter((c) => c.admitted && c.context === "battle")
      .length,
    checked: checks.length,
  }),
);
