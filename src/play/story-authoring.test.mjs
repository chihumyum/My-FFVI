import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
import {
  compileStoryProject,
  withStoryProject,
  storyBank,
  sceneName,
  validateStoryProject,
} from "./story-authoring.js";
import { createStoryProject } from "./story-demo.js";
const make = (project) => {
  const map = {
    id: 1,
    width: 12,
    height: 12,
    initializer: "init",
    areaId: 1,
    entities: [
      { id: "entry", kind: 0, objectId: 1, x: 2, y: 3, layer: 0, direction: "up" },
      { id: "7", kind: 6, x: 2, y: 2, layer: 0, npc: { collision: true } },
    ],
    groups: {},
    collisions: { 0: Array(144).fill(0) },
  };
  return new (withStoryProject(PlayGame))({
    project,
    data: {
      entry: { mapId: 1, entrance: 1 },
      init: [],
      programs: { init: { name: "init", ops: [["Exit", [], [], []]] } },
      global: { init: "init" },
      byMap: {},
      messages: {},
      speakers: {},
      characters: {},
    },
    loadMap: async () => structuredClone(map),
  });
};
test("graph compilation relocates branches after node reordering and persists a named world outcome", async () => {
  const project = createStoryProject("compiler-regression");
  project.variables = [{ key: "door.open", slot: 4, initial: 0 }];
  project.bindings = [
    {
      id: "npc",
      kind: "npc",
      mapId: 1,
      entityId: "7",
      scene: "first-scene",
      variants: [{ when: [{ variable: "door.open", value: 1 }], properties: { x: 4 } }],
    },
  ];
  project.scenes[0] = {
    id: "first-scene",
    title: "门",
    entry: "choose",
    nodes: [
      { id: "end", type: "end" },
      { id: "set", type: "set", variable: "door.open", value: 1, next: "end" },
      {
        id: "choose",
        type: "choice",
        options: [
          { text: "打开", target: "set" },
          { text: "保持", target: "end" },
        ],
      },
    ],
  };
  const g = make(project);
  await g.start();
  g.tick(0.1);
  g.confirm();
  g.tick(0.1);
  assert.deepEqual(g.dialogue.choices, ["打开", "保持"]);
  g.confirm(0);
  g.tick(0.1);
  assert.equal(g.banks[storyBank(project)][4], 1);
  assert.equal(g.actors.get("7").x, 4);
  const saved = structuredClone(g.snapshot());
  await g.enter(1, 1);
  g.tick(0.1);
  assert.equal(g.actors.get("7").x, 4);
  const reloaded = make(project);
  await reloaded.restore(saved);
  assert.equal(reloaded.actors.get("7").x, 4);
  assert.equal(reloaded.banks[storyBank(project)][4], 1);
});
test("parallel authored movement waits for both original VM puppet tasks before the next dialogue", async () => {
  const project = createStoryProject("parallel-regression");
  project.scenes[0].entry = "parallel";
  project.scenes[0].nodes.unshift({
    id: "parallel",
    type: "parallel",
    tracks: [
      { actor: 7, x: 4, y: 2, duration: 0.6 },
      { actor: -1001, x: 3, y: 3, duration: 0.3 },
    ],
    next: "hello",
  });
  const g = make(project);
  await g.start();
  g.tick(0.1);
  g.startScript(sceneName(project, "first-scene"));
  g.tick(0.1);
  assert.equal(g.dialogue, null);
  for (let i = 0; i < 15; i++) g.tick(0.1);
  assert.equal(g.dialogue.text, "你好，旅行者。");
  assert.equal(g.actor(7).x, 4);
  assert.equal(g.player.x, 3);
});
test("conditional binding is removed from a live actor when its world prerequisite becomes false", async () => {
  const project = createStoryProject("condition-regression");
  project.variables = [{ key: "available", slot: 0, initial: 1 }];
  project.bindings = [
    {
      id: "npc",
      kind: "npc",
      mapId: 1,
      entityId: "7",
      scene: "first-scene",
      when: [{ variable: "available", value: 1 }],
    },
  ];
  const g = make(project);
  await g.start();
  g.tick(0.1);
  assert.equal(g.actor(7).script, sceneName(project, "first-scene"));
  g.actor(7).x = 5;
  g.write(storyBank(project), 0, 0, {});
  assert.equal(g.actor(7).script, undefined);
  assert.equal(g.actor(7).x, 5, "a condition update must not reset an unrelated puppet position");
  assert.equal(g.map.entities.find((e) => e.id === "7").script, undefined);
});
test("invalid graph connections and reused variable slots are rejected before preview", () => {
  const p = createStoryProject();
  p.scenes[0].nodes[0].next = "missing";
  p.variables = [
    { key: "a", slot: 0 },
    { key: "b", slot: 0 },
  ];
  assert.equal(validateStoryProject(p).length, 2);
  assert.throws(() => compileStoryProject(p), /连接目标/);
});

test("multiple entry bindings run in authored order after the map initializer", async () => {
  const project = createStoryProject("entry-regression");
  project.variables = [{ key: "visits", slot: 0, initial: 0 }];
  project.scenes = ["first", "second"].map((id) => ({
    id,
    title: id,
    entry: "add",
    nodes: [
      { id: "add", type: "set", variable: "visits", value: 1, operation: "add", next: "end" },
      { id: "end", type: "end" },
    ],
  }));
  project.bindings = project.scenes.map((s) => ({
    id: s.id,
    kind: "entry",
    mapId: 1,
    scene: s.id,
  }));
  const g = make(project);
  await g.start();
  for (let i = 0; i < 5; i++) g.tick(0.1);
  assert.equal(g.banks[storyBank(project)][0], 2);
});

test("battle script overrides reach the battle VM copy without mutating its base data", () => {
  const program = { name: "sc_ai_sample", ops: [["Exit", [], [], []]] },
    modified = structuredClone(program);
  modified.ops[0][0] = "Nop";
  const battleData = { aiPrograms: { sc_ai_sample: program } },
    base = {
      programs: { 1: program },
      global: { sc_ai_sample: 1 },
      byMap: {},
      messages: {},
      speakers: {},
    };
  const g = new (withStoryProject(PlayGame))({
    project: createStoryProject(),
    data: base,
    battleData,
    loadMap: async () => ({}),
    overrides: [{ source: { programId: "1", program }, program: modified }],
  });
  assert.equal(g.battleData.aiPrograms.sc_ai_sample.ops[0][0], "Nop");
  assert.equal(battleData.aiPrograms.sc_ai_sample.ops[0][0], "Exit");
  assert.equal(base.programs[1].ops[0][0], "Exit");
});
