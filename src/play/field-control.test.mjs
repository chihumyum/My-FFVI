import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "./game.js";
import { submitVehicleInput } from "./vehicle-input.js";

const json = async (name) =>
  JSON.parse(await readFile(new URL(`../../build/web-data/${name}`, import.meta.url)));
const data = await json("data.json"),
  battleData = await json("battle.json");
const loadMap = (id) => json(`maps/${id}.json`);

async function scene(mapId, name, leader = 1, onEvent = () => {}, slots = [[leader], [], []]) {
  const game = new PlayGame({ data, battleData, loadMap, interactiveNames: true, onEvent });
  game.partySlots = structuredClone(slots);
  game.player.characterId = leader;
  game.player.asset = `mo_ff6_p${String(leader).padStart(3, "0")}`;
  await game.enter(mapId, 1, name);
  return game;
}

async function finish(game) {
  for (let n = 0; n < 4000; n++) {
    if (game.pending) {
      await game.pending;
      game.pending = null;
    }
    if (game.dialogue) game.confirm();
    if (game.nameInput) game.submitName(game.nameInput.original);
    game.tick(0.1);
    if (!game.busy) return;
  }
  assert.fail("The real source scene did not return ordinary control");
}

test("the real Sabin memory return hands Terra's authored body back to ordinary WASD control", async () => {
  const events = [],
    game = await scene(27, "sc_e_0028_2", 1, (event) => events.push(event));
  await finish(game);
  assert.equal(game.banks.ScenarioFlag1[16], 1);
  assert.equal(game.player.visible, true);
  assert.deepEqual([game.player.x, game.player.y, game.player.layer], [59, 21, 2]);
  assert.equal(game.player.direction, "left", "The source SetPos uses the authored WalkL pose");
  assert.equal(game.actors.get("-1").visible, false, "Only one controlled Terra body remains");
  assert.equal(game.camera.manual, false);
  assert.equal(game.move("down"), true);
  assert.deepEqual([game.player.x, game.player.y], [59, 22]);
  assert.equal(game.player.visible, true, "Moving the camera must not leave Terra behind");
  assert.equal(events.filter((event) => event.kind === "player-control-return").length, 1);
});

test("Kefka's real arrival returns the authored Edgar body after its source Hide and move", async () => {
  const events = [],
    game = await scene(21, "sc_e_0029_1", 5, (event) => events.push(event));
  await finish(game);
  assert.equal(game.banks.ScenarioFlag1[17], 1);
  assert.equal(game.player.visible, true);
  assert.deepEqual([game.player.x, game.player.y, game.player.layer], [28, 22, 1]);
  assert.equal(game.player.asset, "mo_ff6_p005");
  assert.equal(game.actors.get("-5")?.visible ?? false, false);
  assert.equal(game.move("up"), true);
  assert.equal(game.player.y, 21);
  assert.equal(game.player.visible, true);
  assert.equal(game.camera.manual, false);
  assert.equal(
    events.find((event) => event.kind === "player-control-return")?.body,
    "authored-player",
  );
});

test("the source autosave before Kefka's final Exit retains its pending control handoff", async () => {
  let saved;
  const game = await scene(21, "sc_e_0029_1", 5, (event) => {
    if (event.kind === "autosave") saved = structuredClone(game.snapshot());
  });
  await finish(game);
  assert.equal(saved.player.visible, false, "The save occurs before the source's final Exit");
  assert.equal(saved.fieldControl.authoredPose, true);
  const original = JSON.stringify(saved),
    restored = new PlayGame({ data, battleData, loadMap });
  await restored.restore(saved);
  assert.equal(restored.player.visible, true);
  assert.deepEqual([restored.player.x, restored.player.y], [28, 22]);
  assert.equal(JSON.stringify(saved), original, "Loading must not rewrite the caller's save");
});

async function legacyKefkaAutosave() {
  let saved;
  const game = await scene(34, "sc_e_0029", 1, (event) => {
    if (event.kind === "autosave") saved = structuredClone(game.snapshot());
  });
  await finish(game);
  assert.equal(saved.history.at(-2).script, "sc_e_0029");
  assert.equal(saved.history.at(-1).script, "sc_e_0029_1");
  // The historical serializer had no scene ownership field. All pose/history/
  // flags here come from the real PR source chain, including its own AutoSave.
  delete saved.fieldControl;
  return saved;
}

test("an old real-source Kefka autosave recovers only its independently proven authored pose", async () => {
  const saved = await legacyKefkaAutosave(),
    original = JSON.stringify(saved),
    events = [],
    game = new PlayGame({ data, battleData, loadMap, onEvent: (event) => events.push(event) });
  assert.equal(saved.player.visible, false);
  await game.restore(saved);
  assert.equal(game.player.visible, true);
  assert.deepEqual([game.player.x, game.player.y, game.player.layer], [28, 22, 1]);
  assert.deepEqual(events.find((event) => event.kind === "player-control-return").legacyAutosave, {
    pc: 30,
    source: "sc_e_0029_1",
  });
  assert.equal(game.move("up"), true);
  assert.equal(game.player.visible, true);
  assert.equal(game.camera.manual, false);
  assert.equal(JSON.stringify(saved), original);
});

test("an old save's flag17 alone cannot reveal an unproven hidden body", async () => {
  const source = await legacyKefkaAutosave();
  for (const mutate of [
    (saved) => saved.player.x++,
    (saved) => (saved.player.layer = 2),
    (saved) => (saved.player.asset = "mo_ff6_p001"),
    (saved) => saved.history.pop(),
    (saved) => (saved.history.at(-2).script = "sc_e_0028_2"),
    (saved) => (saved.banks.ScenarioFlag1[17] = 0),
    (saved) => saved.groups.splice(saved.groups.indexOf("ev_e_0033"), 1),
    (saved) => (saved.player.vehicle = 5),
    (saved) => (saved.titleScreen = true),
  ]) {
    const saved = structuredClone(source);
    mutate(saved);
    const original = JSON.stringify(saved),
      game = new PlayGame({ data, battleData, loadMap });
    await game.restore(saved);
    assert.equal(game.player.visible, false, mutate.toString());
    assert.equal(JSON.stringify(saved), original);
  }
});

test("legacy recovery rejects a nonzero source layer request rather than treating it as a raw layer", async () => {
  const saved = await legacyKefkaAutosave(),
    changed = structuredClone(data),
    id = changed.byMap[21].sc_e_0029_1 ?? changed.global.sc_e_0029_1;
  assert.equal(changed.programs[id].ops[231][0], "SetPos");
  changed.programs[id].ops[231][1][2] = 2;
  // A raw-layer calculation would incorrectly accept2. PR request2 means L1;
  // this narrow migration intentionally does not prove nonzero requests.
  saved.player.layer = 2;
  const before = JSON.stringify(saved),
    game = new PlayGame({ data: changed, battleData, loadMap });
  await game.restore(saved);
  assert.equal(game.player.visible, false);
  assert.equal(JSON.stringify(saved), before);
});

const hiddenScene = (pose = false) => ({
  name: "hidden",
  ops: [
    ["SetPuppet", [0, -1001, 3], [], []],
    ["ExecPuppet", [], [], []],
    ["Exit", [], [], []],
    ["Hide", [], [], []],
    ...(pose ? [["SetPos", [2, 2], [], []]] : []),
    ["Exit", [], [], []],
  ],
});
async function hiddenGame({ pose = false, world = false, title = false, control = true } = {}) {
  const game = new PlayGame({
    data: {
      init: [],
      programs: { hidden: hiddenScene(pose) },
      global: { hidden: "hidden" },
      byMap: {},
    },
  });
  game.mapId = 1;
  game.map = { width: 5, height: 5, worldTerrain: world ? {} : undefined };
  game.titleScreen = title;
  game.control = control;
  if (world) game.player.vehicle = 5;
  game.startScript("hidden");
  await finish(game);
  return game;
}

test("ordinary idle does not undo pure Hide, disabled control, hidden flight, or title scenes", async () => {
  for (const options of [
    {},
    { pose: true, control: false },
    { pose: true, world: true },
    { pose: true, title: true },
  ]) {
    const game = await hiddenGame(options);
    assert.equal(game.player.visible, false, JSON.stringify(options));
    assert.equal(game.fieldControl, null);
  }
});

for (const [map, name, leader, slots] of [
  [113, "sc_e_0316", 5, [[5], [3], [2]]],
  [131, "sc_e_0512", 2, [[2, 1], [], []]],
  [130, "sc_e_0514_2", 2, [[2, 1], [], []]],
  [440, "sc_e_0672_1", 7],
  [455, "sc_e_0682", 10],
  [201, "sc_e_0639", 7],
])
  test(`${name} returns its authored ordinary body even when its last callback only faces or hides it`, async () => {
    const events = [],
      game = await scene(map, name, leader, (event) => events.push(event), slots);
    await finish(game);
    assert.equal(game.player.visible, true);
    assert.equal(game.camera.manual, false);
    const returned = events.find((event) => event.kind === "player-control-return");
    assert.ok(returned, "The actual source scene must return ordinary control");
    assert.deepEqual(
      [game.player.x, game.player.y, game.player.layer],
      [returned.x, returned.y, returned.layer],
    );
    assert.equal(game.actors.get(String(-game.player.characterId))?.visible ?? false, false);
    const direction = ["down", "up", "left", "right"].find((direction) => game.move(direction));
    assert.ok(direction, "At least one ordinary cell must be reachable from the returned body");
    assert.equal(game.player.visible, true);
  });

test("a scene's final pose does not reveal its player while the owning foreground scene still waits", async () => {
  const program = hiddenScene(true);
  // Shift the callback down by one to place the explicit wait in Main.
  program.ops[0][1][2]++;
  program.ops.splice(2, 0, ["Wait", [], [2], []]);
  const game = new PlayGame({
    data: { init: [], programs: { hidden: program }, global: { hidden: "hidden" }, byMap: {} },
  });
  game.mapId = 1;
  game.map = { width: 5, height: 5 };
  game.startScript("hidden");
  for (let n = 0; n < 5; n++) game.tick(0.1);
  assert.equal(game.busy, true);
  assert.equal(game.player.visible, false);
  assert.equal(game.move("down"), false);
  await finish(game);
  assert.equal(game.player.visible, true);
});

test("an old input-boundary save can take the actual visible leader body on its first ordinary move", async () => {
  const game = await scene(27, "sc_e_0028_2");
  await finish(game);
  const saved = structuredClone(game.snapshot());
  delete saved.fieldControl;
  // Reproduce the historical two-body state, not a new source pose.
  saved.player.visible = false;
  saved.player.x = 67;
  saved.player.y = 27;
  saved.actors.find(([id]) => id === "-1")[1].visible = true;
  const restored = new PlayGame({ data, battleData, loadMap });
  await restored.restore(saved);
  assert.equal(restored.move("down"), true);
  assert.deepEqual([restored.player.x, restored.player.y], [59, 22]);
  assert.equal(restored.player.visible, true);
  assert.equal(restored.actors.get("-1").visible, false);
});

test("the real Falcon landing shows the walking leader at its first idle input boundary", async () => {
  const saved = JSON.parse(
      await readFile(
        new URL("../../build/play/stage1-checkpoints/kefka-tower.json", import.meta.url),
      ),
    ),
    events = [],
    game = new PlayGame({ data, battleData, loadMap, onEvent: (event) => events.push(event) });
  await game.restore(saved);
  assert.equal(game.player.vehicle, 5);
  const flown = [game.player.x, game.player.y];
  assert.equal(submitVehicleInput(game, "land"), true);
  let descentHidden = false;
  for (let n = 0; n < 1000; n++) {
    if (game.pending) {
      await game.pending;
      game.pending = null;
    }
    game.tick(0.1);
    if (game.busy && game.player.visible === false) descentHidden = true;
    if (!game.busy) break;
  }
  assert.equal(game.busy, false);
  assert.equal(descentHidden, true, "The source Hide still covers the authored descent");
  assert.equal(game.player.vehicle ?? 1, 1);
  assert.equal(game.player.visible, true, "No extra idle tick or player input may be required");
  assert.deepEqual([game.player.x, game.player.y], flown);
  assert.equal(events.filter((event) => event.kind === "vehicle-landed").length, 1);
  assert.equal(game.banks.PlaySystems.landingVehicle, undefined);
  assert.equal(game.move("left"), true);
  assert.equal(game.player.visible, true);
  assert.equal(game.camera.manual, false);
});
