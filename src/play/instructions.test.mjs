import test from "node:test";
import assert from "node:assert/strict";
import { executeInstruction } from "./instructions.js";
import { executeSyscall } from "./syscalls.js";
import { PlayGame } from "./game.js";

const game = () => ({
  player: { x: 14.5, y: 15.5, layer: 0, direction: "down" },
  camera: {},
  partySlots: [[1, 2], [], []],
  partyIndex: 0,
  party: [{ id: 1 }, { id: 2 }],
  roster: { 1: { id: 1 }, 2: { id: 2 }, 3: { id: 3, enabled: true }, 4: { id: 4, enabled: false } },
  actor() {
    return this.player;
  },
  compare(a, operator, b) {
    return operator === "＝" ? a === b : a !== b;
  },
});

test("authored flashes let delayed puppet replacements complete before FinishPuppet", () => {
  // PR source0302_4 spawns the Ramuh/magicite puppets, flashes twice, then
  // finishes them. Treating Flash as instantaneous cancels both before 0.2s.
  const g = new PlayGame({
    data: {
      byMap: {},
      global: { replacement: 0 },
      programs: {
        0: {
          name: "replacement",
          ops: [
            ["SetPuppet", [0, 21, 7], [], []],
            ["SetPuppet", [1, 2, 11], [], []],
            ["ExecPuppet", [1], [], []],
            ["Flash", [255, 255, 255, 200], [0.175], []],
            ["Flash", [255, 255, 255, 200], [0.175], []],
            ["FinishPuppet", [], [], []],
            ["Exit", [], [], []],
            ["Wait", [], [0.2], []],
            ["SetPos", [0, 0, 0, 1, 2], [], ["Default_01"]],
            ["Show", [], [], []],
            ["Exit", [], [], []],
            ["Wait", [], [0.2], []],
            ["Hide", [], [], []],
            ["Exit", [], [], []],
          ],
        },
      },
    },
  });
  const ramuh = { id: "2", kind: 6, x: 84, y: 17, layer: 1 },
    stone = { id: "21", kind: 10, x: 84, y: 4, layer: 1 };
  Object.assign(g, { mapId: 395, map: { entities: [ramuh, stone], width: 100, height: 50 } });
  g.refreshActors();
  g.actor(21).visible = false;
  g.startScript("replacement");
  g.tick(0.05);
  assert.equal(g.busy, true);
  assert.equal(g.actor(21).y, 4);
  assert.equal(g.actor(2).visible, true);
  for (let tick = 0; tick < 12; tick++) g.tick(0.05);
  assert.equal(g.busy, false);
  assert.equal(g.actor(21).x, 84);
  assert.equal(g.actor(21).y, 17);
  assert.equal(g.actor(21).visible, true);
  assert.equal(g.actor(2).visible, false);
});

test("PR random variable draws every integer from one through its sole upper bound", () => {
  for (const upper of [1, 4, 6, 8]) {
    const g = new PlayGame({
      data: {
        programs: {
          0: {
            name: "random-lot",
            ops: [["SetRandomValue", [2, upper, 0, 0], [], ["MapLocalVariable"]]],
          },
        },
      },
    });
    for (let expected = 1; expected <= upper; expected++) {
      for (const offset of [0, 0.999999]) {
        g.random = () => (expected - 1 + offset) / upper;
        g.step({ program: 0, pc: 0, actor: null, locals: [] });
        assert.equal(g.banks.MapLocalVariable[2], expected);
      }
    }
  }
});

test("an ordinary confirm displays a PR direct-message NPC and releases control on dismissal", () => {
  const g = new PlayGame({
    data: { messages: { greeting: "欢迎\\n<C1>！" }, speakers: { greeting: "居民" } },
  });
  g.unit(1).name = "蒂娜";
  Object.assign(g.player, { x: 12, y: 13, layer: 2, direction: "up" });
  g.entities = [
    {
      id: "6",
      kind: 6,
      x: 12,
      y: 12,
      layer: 2,
      group: "town",
      npc: {
        interaction: {
          kind: "talk",
          actionId: 4,
          message: { key: "greeting", text: "fallback", speaker: "" },
        },
      },
    },
  ];
  assert.equal(g.confirm(), true);
  assert.equal(g.dialogue.text, "欢迎\n蒂娜！");
  assert.equal(g.dialogue.speaker, "居民");
  assert.equal(g.tasks.length, 0);
  assert.equal(g.busy, true);
  assert.equal(g.confirm(), true);
  assert.equal(g.dialogue, null);
  assert.equal(g.busy, false);
  g.player.layer = 1;
  assert.equal(g.confirm(), false);
});

test("source rejoin returns a staged character to the active party without duplication or free healing", () => {
  const g = new PlayGame({ data: {} });
  g.partySlots = [[3, 5], [2], [7]];
  g.partyIndex = 0;
  const unit = g.unit(2);
  Object.assign(unit, { enabled: true, hasJoined: true, hp: 17, mp: 3, level: 9 });
  executeSyscall(g, { locals: [] }, "メンバー加入：ロック");
  assert.deepEqual(g.partySlots, [[3, 5, 2], [], [7]]);
  assert.equal(unit.hp, 17);
  assert.equal(unit.mp, 3);
  assert.equal(unit.level, 9);
  executeSyscall(g, { locals: [] }, "メンバー加入：ロック");
  assert.deepEqual(g.partySlots, [[3, 5, 2], [], [7]]);
});

test("the source party-switch flag ends a cooperative deployment without removing reserve members", () => {
  const g = new PlayGame({ data: {} });
  g.rts = { active: true, count: 2 };
  g.partySlots = [[7, 2], [5], []];
  g.write("ScenarioFlag3", 45, 0, {});
  assert.equal(g.rts.active, false);
  assert.equal(g.banks.ScenarioFlag3[45], 0);
  assert.deepEqual(g.partySlots, [[7, 2], [5], []]);
  g.write("ScenarioFlag3", 45, 1, {});
  assert.equal(g.rts.active, true);
});

test("relative SetPos keeps a separate character on the player reference without copying its layer", () => {
  const g = game(),
    character = { x: 8, y: 6, layer: 1 },
    task = {};
  executeInstruction(g, task, "SetPos", [1, -1, 0, 1, -1001], [], [], character);
  assert.deepEqual(character, { x: 15, y: 14, layer: 1, motion: null });
  executeInstruction(g, task, "SetPos", [-1, 7, 0], [], [], character);
  assert.equal(character.x, 15);
  assert.equal(character.y, 7);
  executeInstruction(g, task, "SetPos", [15, 7, 2], [], [], character);
  assert.equal(character.layer, 1);
});

test("character branch reads presence, roster scope and jump PC from their PR slots", () => {
  const g = game(),
    t = { pc: 2 };
  executeInstruction(g, t, "BranchByCharacter", [3, 0, 1, 19]);
  assert.equal(t.pc, 19);
  t.pc = 2;
  executeInstruction(g, t, "BranchByCharacter", [3, 1, 0, 23]);
  assert.equal(t.pc, 23);
  t.pc = 2;
  executeInstruction(g, t, "BranchByCharacter", [4, 0, 1, 40]);
  assert.equal(t.pc, 2);
});

test("member count and direction branches use the PR comparison and direction target tables", () => {
  const g = game(),
    t = { pc: 1 };
  executeInstruction(g, t, "BranchByNumOfMember", [1, 3, 12], [], ["＝"]);
  assert.equal(t.pc, 12);
  executeInstruction(g, t, "BranchByPlayerDirection", [6, 8, 6, 3]);
  assert.equal(t.pc, 6);
});

test("field battle handoff preserves scripted return codes and restores Vargas party data", () => {
  const g = game(),
    task = { locals: [] };
  Object.assign(g.roster[1], { hp: 0, mp: 0, conditions: [5], removed: true, hidden: true });
  g.banks = { PlaySystems: { battle0055: [{ id: 1, hp: 73, mp: 12, conditions: [] }] } };
  g.battles = [{ outcome: "victory", code: 4 }];
  g.unit = (id) => g.roster[id];
  executeSyscall(g, task, "戦闘結果取得");
  assert.equal(task.locals[0], 4);
  executeSyscall(g, task, "バトルデータ復元：sc_b_0055");
  assert.equal(g.roster[1].hp, 73);
  assert.equal(g.roster[1].mp, 12);
  assert.deepEqual(g.roster[1].conditions, []);
  assert.equal(g.roster[1].removed, false);
  assert.equal(g.roster[1].hidden, false);
  assert.equal(g.banks.PlaySystems.battle0055, undefined);
});
test("field payments use the PR product group fee and return affordability without taking partial funds", () => {
  const game = new PlayGame({
    data: {
      programs: { 0: { name: "inn", ops: [["RemoveGil", [127], [], []]] } },
      systemTables: { product: [{ id: 528, group_id: 127, content_id: 0, coefficient: 1 }] },
    },
  });
  const task = () => ({ program: 0, pc: 0, actor: null, locals: [] });
  game.gil = 2;
  game.step(task());
  assert.equal(game.gil, 1);
  assert.equal(game.banks.MapLocalVariable[0], 1);
  game.gil = 0;
  game.step(task());
  assert.equal(game.gil, 0);
  assert.equal(game.banks.MapLocalVariable[0], 0);
});

test("assigned PR NPC routes preserve stored layers and set the correct bank after movement", () => {
  const game = new PlayGame({ data: { programs: {}, global: {}, byMap: {} } });
  game.mapId = 214;
  game.map = {
    routes: {
      201203: [
        { instruction_type: 1, cellx: 21, celly: 54, layer: 2, speed_id: 1 },
        { instruction_type: 9, category: 2, index: 63, value: 1 },
      ],
    },
  };
  const npc = game.actor(1);
  Object.assign(npc, { x: 21, y: 53, layer: 2 });
  executeInstruction(game, { pc: 0 }, "AssignMoveRoute", [1, 201203, 0]);
  game.tick(0.1);
  assert.equal(npc.layer, 2);
  assert.equal(game.banks.ScenarioFlag3?.[63], undefined);
  for (let n = 0; n < 8; n++) game.tick(0.1);
  assert.equal(npc.y, 54);
  assert.equal(game.banks.ScenarioFlag3[63], 1);
  assert.equal(game.banks.MapLocalVariable?.[63], undefined);
});

test("a field save resumes an NPC route cursor before its pending source flag write", async () => {
  const map = {
    width: 4,
    height: 4,
    collisions: { 1: Array(16).fill(0) },
    entities: [],
    groups: {},
    routes: {
      12: [
        { instruction_type: 1, cellx: 2, celly: 1, layer: 2, speed_id: 1 },
        { instruction_type: 9, category: 2, index: 63, value: 1 },
      ],
    },
  };
  const data = { programs: {}, global: {}, byMap: {} };
  const game = new PlayGame({ data, loadMap: async () => map });
  game.warn = () => {};
  await game.enter(1);
  Object.assign(game.actor(1), { x: 1, y: 1, layer: 1 });
  executeInstruction(game, { pc: 0 }, "AssignMoveRoute", [1, 12, 0]);
  game.tick(0.1);
  const saved = JSON.parse(JSON.stringify(game.snapshot()));
  const restored = new PlayGame({ data, loadMap: async () => map });
  restored.warn = () => {};
  await restored.restore(saved);
  assert.equal(restored.banks.ScenarioFlag3?.[63], undefined);
  for (let n = 0; n < 8; n++) restored.tick(0.1);
  assert.equal(restored.actor(1).x, 2);
  assert.equal(restored.banks.ScenarioFlag3[63], 1);
  assert.equal(restored.actor(1).layer, 1);
});

test("a boss defeat cannot start a victory continuation unless the source explicitly reads the result", () => {
  class Encounter {
    constructor(options) {
      this.complete = options.onEnd;
    }
  }
  const make = (ops) =>
    new PlayGame({
      Battle: Encounter,
      data: {
        byMap: {},
        global: { after: 0 },
        programs: { 0: { name: "after", ops, locals: [] } },
      },
    });
  const game = make([["SetFlag", [99], [], ["ScenarioFlag2"]]]),
    task = {};
  game.encounter(472, "after", task);
  game.battle.complete({ outcome: "defeat", code: 2 });
  assert(game.over);
  assert.equal(game.history.length, 0);
  assert.equal(game.tasks.length, 0);
  const handled = make([["SysCall", [], [], ["戦闘結果取得"]]]);
  handled.encounter(472, "after", {});
  handled.battle.complete({ outcome: "defeat", code: 2 });
  assert.equal(handled.over, undefined);
  assert.equal(handled.history[0].script, "after");
});
