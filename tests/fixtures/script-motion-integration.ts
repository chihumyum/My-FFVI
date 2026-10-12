import { decodeFieldOp } from "../../src/compiler/field.js";
import { GameSession, type GameCheckpoint } from "../../src/core/game-session.js";
import { NewGameFieldEntry } from "../../src/core/new-game-field-entry.js";
import type { Op, Site } from "../../src/field/types.js";
import { checkpointFixture } from "./checkpoint-game.js";
import { sourceNewGameFixture } from "./source-new-game.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
export const scriptMotionFlags = {
  syncStarted: { category: "ScenarioFlag1" as const, index: 40 },
  syncCompleted: { category: "ScenarioFlag1" as const, index: 41 },
  asyncStarted: { category: "ScenarioFlag1" as const, index: 42 },
  asyncCompleted: { category: "ScenarioFlag1" as const, index: 43 },
  failedCompleted: { category: "ScenarioFlag1" as const, index: 44 },
  cameraFailedCompleted: { category: "ScenarioFlag1" as const, index: 45 },
  actorConflictCompleted: { category: "ScenarioFlag1" as const, index: 46 },
};

/** Deliberately authored choreography on the existing synthetic source factory.
 * It exercises the real GameSession/VM/camera/actor owners, not story reachability
 * or original-runtime timing. Motion operands go through the shared decoder. */
export function scriptMotionIntegrationFixture() {
  const f = sourceNewGameFixture();
  const source = { file: "controlled-script-motion", assetPath: "Fixtures/ScriptMotion/v1" };
  const baseContext = f.map.scriptPuppetContexts!.reserved!;
  const emit = (script: string, instructions: Instruction<Op>[]): Op[] => instructions.map((instruction, index) =>
    ({ ...instruction, script, index, source }) as Op);
  const motion = (mnemonic: "Move" | "Lerp", ints: number[], reals: number[] = [], animation = ""): Instruction<Op> => {
    const raw = { type: 2, mnemonic, operands: {
      iValues: [...ints, ...Array(8 - ints.length).fill(0)],
      rValues: [...reals, ...Array(8 - reals.length).fill(0)],
      sValues: [animation, ...Array(7).fill("")],
    } };
    const decoded = decodeFieldOp(raw, { script: "controlled-motion-decoder", index: 0, source }, {});
    if (decoded.kind === "blocked") throw new Error("Controlled motion did not compile: " + decoded.reason);
    if (decoded.kind !== "field-script-motion") throw new Error("Controlled motion did not use the common motion decoder");
    const { script: _, index: __, source: ___, ...instruction } = decoded;
    return instruction as Instruction<Op>;
  };
  const add = (name: string, instructions: Instruction<Op>[], hash: string) => {
    f.map.scripts[name] = emit(name, instructions);
    f.map.scriptPuppetContexts![name] = { ...baseContext, scriptHash: hash.repeat(64) };
    f.map.scriptLocals![name] = null;
  };
  const parallel = (asynchronous: boolean): Instruction<Op>[] => [
    { kind: "puppet", slot: 0, actor: "-1001", target: 8 },
    { kind: "puppet", slot: 1, actor: "0", target: 12 },
    { kind: "exec-puppets", asynchronous },
    { kind: "flag", ref: asynchronous ? scriptMotionFlags.asyncStarted : scriptMotionFlags.syncStarted, operation: "set" },
    { kind: "finish-puppets" },
    { kind: "message", key: "CONTROLLED_MOTION_COMPLETE", speaker: "", text: "Both movement tracks have completed." },
    { kind: "flag", ref: asynchronous ? scriptMotionFlags.asyncCompleted : scriptMotionFlags.syncCompleted, operation: "set" },
    { kind: "exit" },
    { kind: "nop" },
    motion("Move", [asynchronous ? 3 : 1, asynchronous ? 1 : 2, 1], [], asynchronous ? "WalkL" : "WalkR"),
    motion("Lerp", [asynchronous ? 7 : 6, asynchronous ? 5 : 4, 0], [0.3, 0]),
    { kind: "exit" },
    { kind: "nop" },
    motion("Lerp", [asynchronous ? 9 : 8, 6, 0], [0.4, 0]),
    { kind: "exit" },
  ];
  add("motion_sync", parallel(false), "d");
  add("motion_async", parallel(true), "e");
  add("motion_missing_animation", [
    { kind: "puppet", slot: 0, actor: "-1001", target: 4 },
    { kind: "exec-puppets", asynchronous: false },
    { kind: "flag", ref: scriptMotionFlags.failedCompleted, operation: "set" },
    { kind: "exit" },
    { kind: "nop" },
    { kind: "wait", seconds: 0.03 },
    motion("Move", [1, 1, 1], [], "MissingControlledAnimation"),
    { kind: "exit" },
  ], "f");
  add("motion_camera_move", [
    { kind: "puppet", slot: 0, actor: "0", target: 4 },
    { kind: "exec-puppets", asynchronous: false },
    { kind: "flag", ref: scriptMotionFlags.cameraFailedCompleted, operation: "set" },
    { kind: "exit" },
    { kind: "nop" },
    { kind: "wait", seconds: 0.03 },
    motion("Move", [0, 1, 1]),
    { kind: "exit" },
  ], "9");
  add("motion_actor_conflict", [
    { kind: "puppet", slot: 0, actor: "-1001", target: 5 },
    { kind: "puppet", slot: 1, actor: "-1001", target: 8 },
    { kind: "exec-puppets", asynchronous: false },
    { kind: "flag", ref: scriptMotionFlags.actorConflictCompleted, operation: "set" },
    { kind: "exit" },
    { kind: "nop" },
    motion("Move", [1, 2, 1]),
    { kind: "exit" },
    { kind: "nop" },
    { kind: "wait", seconds: 0.03 },
    motion("Lerp", [9, 6, 0], [0.4, 0]),
    { kind: "exit" },
  ], "8");
  const initial = checkpointFixture().field;
  initial.parentSourceSetHash = f.content.parentSourceSetHash;
  const dependencies = { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } };
  return { ...f, initial, dependencies,
    restore: (checkpoint: GameCheckpoint) => GameSession.restore(checkpoint, initial, f.battle, dependencies),
  };
}

/** Runs the ordinary title/launch protocol, leaving the first reserved script
 * alive so the GameFlow caller advances and observes the field entry itself. */
export function launchScriptMotionIntegration(f: ReturnType<typeof scriptMotionIntegrationFixture>): GameSession {
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
  let fade = start.fade;
  fade.advance(0.5);
  for (let i = 0; i < 3; i++) {
    const next = entry.prepareResume(fade, true);
    if (!next) throw new Error("Controlled title protocol did not advance");
    next.commit(); fade = next.fade;
  }
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit();
  return game;
}
