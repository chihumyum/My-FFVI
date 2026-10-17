import test from "node:test";
import assert from "node:assert/strict";
import {
  configureSyscallTimer,
  updateSyscallSystems,
  pendingEventInput,
  finishSyscallTimer,
  executeEventSystem,
} from "./event-systems.js";

function host() {
  return {
    banks: {},
    mapId: 119,
    data: { programs: { 1: { name: "source-deck-departure" } } },
    time: 0,
    tasks: [],
    events: [],
    started: [],
    resolve(name, map = this.mapId) {
      return map === 119 && name === "source-interception" ? 2 : undefined;
    },
    event(kind, payload) {
      this.events.push({ kind, ...payload });
    },
    startScript(name) {
      this.started.push(name);
    },
  };
}
const caller = { program: 1, pc: 6 };

test("source timer exposes a read-only waiting input instead of authorizing early callbacks", () => {
  const game = host();
  assert.equal(pendingEventInput(game), null);
  assert.deepEqual(game.banks, {});
  configureSyscallTimer(game, caller, [1, 1, 0, 0], [8], ["source-interception"]);
  updateSyscallSystems(game, 2);
  const banks = structuredClone(game.banks),
    input = pendingEventInput(game);
  assert.equal(input.status, "wait-event");
  assert.equal(input.remaining, 6);
  assert.equal(input.callback, "source-interception");
  assert.equal(input.timer.advancing, true);
  assert.deepEqual(input.timer.source, { script: "source-deck-departure", index: 5, mapId: 119 });
  assert.deepEqual(game.banks, banks);
  assert.deepEqual(game.started, []);
  updateSyscallSystems(game, 5.9);
  assert.deepEqual(game.started, []);
  updateSyscallSystems(game, 0.1);
  assert.deepEqual(game.started, ["source-interception"]);
  assert.equal(pendingEventInput(game), null);
  updateSyscallSystems(game, 1);
  assert.deepEqual(game.started, ["source-interception"]);
});

test("paused or missing callbacks cannot hold an await-source objective in a fabricated wait", () => {
  const game = host();
  configureSyscallTimer(game, caller, [1, 1, 0, 0], [8], ["missing"]);
  assert.equal(pendingEventInput(game), null);
  configureSyscallTimer(game, caller, [1, 1, 0, 0], [8], ["source-interception"]);
  game.banks.PlaySystems.timer.paused = true;
  assert.equal(pendingEventInput(game), null);
  updateSyscallSystems(game, 20);
  assert.equal(game.banks.PlaySystems.timer.remaining, 8);
  game.banks.PlaySystems.timer.paused = false;
  game.battle = {};
  updateSyscallSystems(game, 20);
  assert.equal(game.banks.PlaySystems.timer.remaining, 8);
  assert.equal(pendingEventInput(game).timer.advancing, false);
  finishSyscallTimer(game);
  assert.equal(pendingEventInput(game), null);
});

test("an expired source callback waits for a manual vehicle menu to close", () => {
  const game = host();
  configureSyscallTimer(game, caller, [1, 1, 0, 0], [1], ["source-interception"]);
  game.vehicleMenu = {};
  updateSyscallSystems(game, 1);
  assert.deepEqual(game.started, []);
  assert.equal(pendingEventInput(game).timer.expired, true);
  game.vehicleMenu = null;
  updateSyscallSystems(game, 0);
  assert.deepEqual(game.started, ["source-interception"]);
});

const cid = (game, name) =>
  executeEventSystem(game, caller, `シドタイマー：${name}`, [], [], {
    characterSelectors: {},
    names: {},
    warn() {},
  });

test("a source Cid health restart replaces the initial callback and only spends player time", () => {
  const game = host();
  configureSyscallTimer(game, caller, [1, 1, 0, 0], [120], ["source-interception"]);
  updateSyscallSystems(game, 20);
  cid(game, "HPチェック");
  assert.equal(game.banks.ScenarioVariable[2], 100);
  // Input to the selector is the source ScenarioVariable, after the source
  // feeding arithmetic; it is not a separate health owned by the host.
  cid(game, "タイマーチェック");
  assert.equal(game.banks.PlaySystems.timer, null);
  assert.equal(game.banks.PlaySystems.cid.remaining, 100);
  assert.equal(pendingEventInput(game).counter, "cid");
  assert.equal(pendingEventInput(game).callback, null);
  game.dialogue = {};
  updateSyscallSystems(game, 20);
  assert.equal(game.banks.PlaySystems.cid.remaining, 100);
  game.dialogue = null;
  game.tasks = [{ done: false, actor: null, background: false }];
  updateSyscallSystems(game, 20);
  assert.equal(game.banks.PlaySystems.cid.remaining, 100);
  game.tasks = [];
  updateSyscallSystems(game, 101);
  assert.equal(pendingEventInput(game), null);
  assert.deepEqual(game.started, []); // No implicit Cid death callback exists.
  assert.equal(game.banks.ScenarioVariable[2], 100);
  cid(game, "HPチェック");
  assert.equal(game.banks.ScenarioVariable[2], 0);
  finishSyscallTimer(game);
  assert.equal(game.banks.PlaySystems.cid, null);
});

test("Cid suspension saves the source counter and removes it until the source resume", () => {
  const game = host();
  configureSyscallTimer(game, caller, [1, 1, 0, 0], [120], ["source-interception"]);
  updateSyscallSystems(game, 52.1);
  cid(game, "一時停止");
  assert.equal(game.banks.ScenarioVariable[2], 67);
  assert.equal(game.banks.PlaySystems.timer, null);
  assert.equal(game.banks.PlaySystems.cid, null);
  assert.equal(pendingEventInput(game), null);
  updateSyscallSystems(game, 200);
  cid(game, "再開");
  assert.equal(game.banks.PlaySystems.cid.remaining, 67);
  updateSyscallSystems(game, 1);
  assert.equal(game.banks.PlaySystems.cid.remaining, 66);
  assert.equal(game.banks.ScenarioVariable[2], 67);
  configureSyscallTimer(game, caller, [1, 1, 0, 0], [1], ["source-interception"]);
  assert.equal(game.banks.PlaySystems.cid, null);
  assert.equal(game.banks.ScenarioFlag2, undefined);
  assert.equal(game.banks.ScenarioFlag3, undefined);
});

test("Shadow arrival uses the authorized paused escape timer, dispatches source609 once and never grants the survival flag itself", () => {
  const game = host();
  game.mapId = 631;
  game.player = { x: 115, y: 25 };
  game.map = { groups: { ev_e_0608: { entities: [{ kind: 2, x: 115, y: 25 }] } } };
  game.banks.ScenarioFlag2 = { 40: 1 };
  game.resolve = (name) => (["sc_e_0609", "source-interception"].includes(name) ? 2 : undefined);
  game.warn = () => {};
  const context = { characterSelectors: {}, names: {}, warn() {} };
  configureSyscallTimer(game, caller, [0, 0, 1, 1], [10], ["source-interception"]);
  executeEventSystem(game, caller, "シャドウタイマー設定", [], [], context);
  game.banks.PlaySystems.timer.paused = true;
  updateSyscallSystems(game, 10);
  assert.equal(game.banks.PlaySystems.shadow.remaining, 5);
  assert.deepEqual(game.started, []);
  game.banks.PlaySystems.timer.paused = false;
  assert.equal(pendingEventInput(game).callback, "sc_e_0609");
  game.busy = true;
  updateSyscallSystems(game, 5);
  assert.deepEqual(game.started, []);
  game.busy = false;
  updateSyscallSystems(game, 0);
  assert.deepEqual(game.started, ["sc_e_0609"]);
  updateSyscallSystems(game, 0);
  assert.deepEqual(game.started, ["sc_e_0609"]);
  assert.equal(game.banks.ScenarioFlag2?.[42], undefined);
});
