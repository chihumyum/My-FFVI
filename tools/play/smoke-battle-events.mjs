import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { Battle } from "../../src/play/battle.js";

// Independent boosted battle fixtures using the exported PR programs and
// formations. This is neither a normal-new-game playthrough nor balance acceptance.
const data = JSON.parse(await fs.readFile(process.argv[2] ?? "build/web-data/battle.json", "utf8"));
const start = performance.now(),
  simulatedLimit = 240,
  wallLimit = 30_000,
  step = 0.05;
const warnings = new Set();

class ObservedBattle extends Battle {
  notifyAction(action) {
    (this.observedActions ??= []).push({
      actorId: action.actor.id,
      actorSide: action.actor.side,
      targetId: action.target.id,
      monsterId: action.target.monsterId,
      abilityId: action.ability?.id,
      selectedAbilityId: action.selectedAbilityId,
      hit: action.hit,
      amount: action.amount,
      targetHp: action.target.hp,
      time: this.elapsed,
    });
    super.notifyAction(action);
  }
}

function run(encounterId, partyIds = [1, 2, 5, 6], expectedOutcome = "victory") {
  assert.ok(data.parties[encounterId], `Missing PR formation ${encounterId}`);
  const units = {},
    events = [],
    banks = {};
  const character = (id) =>
    (units[id] ??= {
      ...structuredClone(data.characters[id]),
      id,
      level: 99,
      hp: 9999,
      maxHp: 9999,
      mp: 999,
      maxMp: 999,
      strength: 255,
      magic: 255,
      attack: 255,
      defense: 250,
      magicDefense: 250,
      speed: 255,
      accuracy: 255,
    });
  let ended = 0;
  const battle = new ObservedBattle({
    data,
    encounterId,
    party: partyIds.map(character),
    character,
    banks,
    random: () => 0.35,
    warn: (message) => warnings.add(message),
    onEnd: () => ended++,
    event: (kind, payload) => events.push({ kind, ...payload }),
  });
  const ticks = Math.ceil(simulatedLimit / step);
  for (let tick = 0; tick < ticks && battle.phase === "active"; tick++) {
    assert.ok(
      performance.now() - start < wallLimit,
      "Battle-event smoke exceeded 30 seconds of wall time",
    );
    battle.tick(step, true);
  }
  const diagnostic = JSON.stringify({
    encounterId,
    script: battle.events.program?.name,
    phase: battle.phase,
    elapsed: battle.elapsed,
    pc: battle.events.pc,
    locals: battle.events.locals,
    paused: battle.events.paused,
    enemies: battle.enemies.map((unit) => ({
      id: unit.monsterId,
      hp: unit.hp,
      hidden: unit.hidden,
      removed: unit.removed,
    })),
    log: battle.log.slice(-5),
  });
  assert.equal(battle.phase, expectedOutcome, diagnostic);
  assert.ok(battle.events.done, `PR event program did not finish: ${diagnostic}`);
  assert.equal(ended, 1, `Battle completion was not delivered once: ${diagnostic}`);
  assert.ok(battle.elapsed <= simulatedLimit, diagnostic);
  for (const unit of [...battle.players, ...battle.enemies]) {
    assert.ok(
      Number.isFinite(unit.hp) && Number.isFinite(unit.mp),
      `Nonfinite battle resources: ${diagnostic}`,
    );
  }
  return { battle, events, banks };
}

assert.equal(
  Object.keys(data.eventPrograms).length,
  53,
  "Expected 52 PR BattleScript programs plus CommonBattleScript/sc_b_none",
);
const formations = Object.values(data.parties);
const linked = Object.keys(data.eventPrograms).flatMap((name) => {
  const formation = formations.find((formation) => data.scriptNames[formation.script] === name);
  return formation ? [{ name, encounterId: formation.id }] : [];
});
assert.equal(linked.length, 42, "Expected 42 PR event programs with a direct formation binding");
for (const { name, encounterId } of linked) {
  const { battle } = run(encounterId);
  assert.equal(
    battle.events.program.name,
    name,
    `Formation ${encounterId} resolved the wrong event program`,
  );
}

const vargas = run(436, [1, 2, 5]);
const blitz = vargas.battle.observedActions.filter(
  (action) =>
    action.actorSide === "player" &&
    action.actorId === 6 &&
    action.monsterId === 260 &&
    action.abilityId === 132 &&
    action.hit,
);
assert.ok(
  blitz.length > 0,
  "Vargas ended without Sabin actually hitting him with PR Blitz ability 132",
);
assert.ok(
  vargas.battle.observedActions.some(
    (action) =>
      action.actorSide === "player" &&
      action.monsterId === 260 &&
      action.abilityId !== 132 &&
      action.amount > 0 &&
      action.time < blitz[0].time,
  ),
  "Vargas did not receive ordinary damage before the Sabin phase",
);
assert.ok(
  vargas.battle.observedActions
    .filter(
      (action) =>
        action.actorSide === "player" && action.monsterId === 260 && action.abilityId !== 132,
    )
    .every((action) => action.targetHp > 0),
  "An ordinary player attack killed Vargas before the event defeat condition",
);
assert.equal(vargas.battle.enemies.find((unit) => unit.monsterId === 260).aiState.mode, 3);
assert.equal(vargas.battle.events.locals[1], 4);
assert.deepEqual(vargas.battle.events.forcedOutcome, {
  outcome: "victory",
  code: 4,
  saved: true,
});
assert.deepEqual(
  vargas.banks.PlaySystems.battle0055.map((unit) => unit.id),
  [1, 2, 5],
);

// PR's surviving merchant actually uses Escape after Steal, rather than dying.
// This terminal return cannot grant ordinary victory rewards.
const clothes = run(44, [2], "escape"),
  locke = clothes.battle.players.find((unit) => unit.id === 2);
assert.ok(
  clothes.battle.observedActions.some(
    (action) => action.actorId === 2 && action.abilityId === 8 && action.hit,
  ),
  "Merchant clothes were obtained without an actual PR Steal action",
);
assert.ok(
  locke.conditions.includes(80),
  "The source event did not apply the merchant disguise condition",
);
assert.equal(locke.disguise, 1);
assert.equal(clothes.banks.ScenarioFlag1[52], 1);
assert.equal(clothes.banks.ScenarioFlag1[53], 0);
assert.ok(
  clothes.battle.enemies[0].escaped,
  "The merchant did not execute his source escape action",
);
assert.equal(clothes.battle.enemies[0].hp, clothes.battle.enemies[0].maxHp);
assert.deepEqual(
  [clothes.battle.result.exp, clothes.battle.result.gil, clothes.battle.result.ap],
  [0, 0, 0],
);
assert.equal(locke.hp, locke.maxHp, "Presentation-only change-of-clothes actions damaged Locke");

const finale = run(472);
assert.deepEqual(
  [
    472,
    ...finale.events.filter((event) => event.kind === "battle-party").map((event) => event.partyId),
  ],
  [472, 513, 514, 515],
  "The final battle skipped or repeated a PR enemy-party stage",
);
for (const partyId of [472, 513, 514, 515]) {
  const enemyIds = new Set(data.parties[partyId].members.map((member) => member.monsterId));
  assert.ok(
    finale.battle.observedActions.some(
      (action) =>
        action.actorSide === "player" &&
        enemyIds.has(action.monsterId) &&
        action.hit &&
        action.amount > 0,
    ),
    `Final battle stage ${partyId} ended without a player actually damaging its PR enemies`,
  );
}
assert.equal(finale.battle.events.locals[1], 8);
assert.ok(
  finale.battle.enemies.some((unit) => unit.monsterId === 299 && unit.hp === 0),
  "Final Kefka was not defeated",
);
assert.equal(
  finale.battle.events.forcedOutcome,
  null,
  "The final battle was replaced with a forced return",
);

console.log(
  `Independent boosted PR battle fixtures: ${linked.length} formation-bound event programs completed.`,
);
console.log(
  `Vargas: Sabin Blitz 132 → AI mode 3 → source saved return (${vargas.battle.elapsed.toFixed(2)} simulated seconds).`,
);
console.log(
  `Merchant: Steal 8 → disguise condition 80 and source flags → enemy escape (${clothes.battle.elapsed.toFixed(2)} simulated seconds).`,
);
console.log(
  `Final battle: 472 → 513 → 514 → 515 → Kefka 299 defeated (${finale.battle.elapsed.toFixed(2)} simulated seconds).`,
);
console.log(
  `Wall time: ${((performance.now() - start) / 1000).toFixed(2)} seconds; unique warnings/fallbacks: ${warnings.size}.`,
);
console.log(
  "This isolated fixture smoke does not establish main-story completion or normal battle balance.",
);
