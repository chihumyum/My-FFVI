import { GameSession } from "../../src/core/game-session.js";
import { GameFlow } from "../../src/core/game-flow.js";
import type { FrameworkWalkEncounterPolicy } from "../../src/core/walk-encounters.js";
import { checkpointFixture } from "./checkpoint-game.js";

export function walkEncounterFixture(steps = 2) {
  const f = checkpointFixture();
  const policy: FrameworkWalkEncounterPolicy = { kind: "framework-walk-encounters-v1", id: "synthetic-walk",
    minSteps: steps, maxSteps: steps, transportationIds: [1], parties: [{ partyId: 1000, weight: 1 }] };
  f.field.entry.transportationId = 1;
  f.field.walkEncounters = policy;
  f.field.map.entities = [];
  f.field.map.groups!.entity_default!.entities = [];
  f.field.scripts = {};
  f.target.walkEncounters = structuredClone(policy);
  const point = f.target.map!.entities.find(e => e.kind === 0)!;
  f.target.map!.entities = [point];
  f.target.map!.groups!.entity_default!.entities = [point];
  f.target.scripts = {}; f.target.initializer = null;
  const game = new GameSession(f.field, f.battle, 314);
  return { ...f, policy, game, flow: new GameFlow(game) };
}

export const walkHost = { visible: true, mediaReady: true, overlayOpen: false };
export function winWalkEncounter(flow: GameFlow): void {
  for (let n = 0; n < 20000 && flow.session.battle?.phase === "active"; n++) {
    const battle = flow.session.battle;
    for (const actor of battle.ready) {
      const target = battle.targets(actor.id, 10)[0];
      if (target) battle.command(actor.id, 10, target.id);
    }
    flow.advance(10, walkHost);
  }
  if (flow.session.battle?.phase !== "victory") throw new Error("Controlled walking encounter did not reach victory");
}
