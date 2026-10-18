import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fieldActorParts } from "../../apps/play/field-animation.js";
import { loadAppearanceAudit } from "./audit-appearances.mjs";
import { BattleAppearanceAudit } from "./audit-battle-appearances.mjs";

// Read plain state only. In particular, do not call game.party, game.actor or
// snapshot: lazy roster/actor construction would change the run being checked.
export function appearanceState(game) {
  return {
    mapId: game.mapId,
    actors: game.actors,
    player: game.player,
    groups: [...game.groups],
    partySlots: game.partySlots,
    partyIndex: game.partyIndex,
    roster: game.roster,
    banks: game.banks,
  };
}

export class AppearanceObserver {
  static async open(options) {
    const [field, battle] = await Promise.all([
      loadAppearanceAudit(options),
      BattleAppearanceAudit.open(options),
    ]);
    return new AppearanceObserver(field, battle);
  }
  constructor(field, battle) {
    this.field = field;
    this.battle = battle;
    this.records = new Map();
    this.samples = 0;
    this.counts = { checked: 0, matches: 0, mismatches: 0, unknown: 0 };
    this.maps = new Set();
    this.puppetVisibility = { checked: 0, mismatches: [] };
  }
  completedInstruction(game, task, program, pc, op) {
    if (op?.[0] !== "SetPuppet") return;
    const selector = op[1][1];
    if (selector > -1002 || selector < -1005) return;
    const member = game.partySlots[game.partyIndex][-selector - 1001];
    if (!member) return;
    this.puppetVisibility.checked++;
    // Read existing actors only; an audit must never create the missing body.
    if (game.actors.get(String(-member))?.visible !== true)
      this.puppetVisibility.mismatches.push({
        mapId: game.mapId,
        script: program.name,
        instruction: pc,
        selector,
        member,
        time: game.time,
        reason: "An occupied party puppet is still hidden after binding",
      });
  }
  instruction(game, task, program, pc, op) {
    if (!op || !program) return;
    if (
      op[0] !== "SetPuppet" &&
      op[0] !== "RideVehicleNPC" &&
      !(op[0] === "SysCall" && /パペット|変装|乗り物|オペラ用ロック戻す/.test(op[3]?.[0] || ""))
    )
      return;
    this.field.sourceInstruction({
      mapId: game.mapId,
      programName: program.name,
      pc,
      actor: task.actor,
      locals: task.locals,
      snapshot: appearanceState(game),
    });
  }
  observe(game, presentation) {
    this.samples++;
    this.maps.add(game.mapId);
    this.field.enterMap(game.mapId);
    const context = {
      mapId: game.mapId,
      script: game.lastInstruction?.script,
      instructionIndex: game.lastInstruction?.index,
    };
    if (game.battle) {
      if (!presentation) throw Error("Battle appearance audit requires actual render selectors");
      this.battle.observe(game.battle, { frameActors: presentation.battleFrames, context });
      return;
    }
    const state = appearanceState(game),
      parts = new Map([...game.actors].map(([id, actor]) => [String(id), fieldActorParts(actor)]));
    parts.set("player", fieldActorParts(game.player));
    const report = this.field.compare(state, { actorParts: parts });
    for (const [key, value] of Object.entries(report.summary)) this.counts[key] += value;
    for (const check of [...report.mismatches, ...report.unknown]) {
      const record = { ...context, ...check },
        key = JSON.stringify(record),
        prior = this.records.get(key);
      if (prior) prior.count++;
      else this.records.set(key, { ...record, count: 1, firstTime: game.time });
    }
  }
  report(run = {}) {
    return {
      schema: "ffvi-appearance-acceptance",
      run,
      scope:
        "Independent raw PR appearance lookup versus actual state and render selection. No GPU pixels or occlusion acceptance.",
      samples: this.samples,
      maps: [...this.maps].sort((a, b) => a - b),
      field: {
        puppetVisibility: this.puppetVisibility,
        ...this.counts,
        records: [...this.records.values()].sort((a, b) => b.count - a.count),
        inventory: this.field.inventory(),
      },
      battle: this.battle.summary(),
    };
  }
  async write(file, run) {
    await mkdir(path.dirname(file), { recursive: true });
    const report = this.report(run);
    await writeFile(file, JSON.stringify(report, null, 2) + "\n");
    return report;
  }
}
