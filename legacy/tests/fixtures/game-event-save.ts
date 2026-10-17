import { GameFlow } from "../../src/core/game-flow.js";
import { GameSession } from "../../src/core/game-session.js";
import type { Op, Site } from "../../src/field/types.js";
import { checkpointFixture } from "./checkpoint-game.js";

export const eventSaveReadyHost = { visible: true, mediaReady: true, overlayOpen: false };
export const afterEventSave = { category: "ScenarioFlag1", index: 4 } as const;
type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;

/** Explicit, redistributable Web event-save content. Source AutoSave is not
 * compiled into this protocol, and no source story progress is granted here. */
export function gameEventSaveFixture() {
  const fixture = checkpointFixture();
  const commands: Instruction<Op>[] = [
    { kind: "inventory", command: { kind: "grant-item", id: 10, count: 2 }, result: null, dependencies: [] },
    { kind: "event-save" },
    { kind: "inventory", command: { kind: "grant-item", id: 10, count: 3 }, result: null, dependencies: [] },
    { kind: "flag", ref: afterEventSave, operation: "set" },
    { kind: "exit" },
  ];
  fixture.field.scripts.saveFlow = commands.map((command, index) => ({ ...command, script: "saveFlow", index,
    source: { file: "synthetic", assetPath: "game-event-save" } }));
  const session = new GameSession(fixture.field, fixture.battle, 314), flow = new GameFlow(session);
  session.field.eventState.write(afterEventSave, 0);
  flow.start(); flow.advance(0, eventSaveReadyHost);
  const itemCount = (owner = session) => owner.state.snapshot().items.find((item) => item.id === 10)?.count ?? 0;
  return { ...fixture, session, flow, itemCount,
    start() {
      if (!session.field.startEvent("saveFlow") || !session.eventSaveRequest)
        throw new Error("Controlled event-save content did not reach its request barrier");
      return session.eventSaveRequest;
    } };
}
