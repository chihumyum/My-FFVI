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
    this.vehicleVisibility = { checked: 0, mismatches: [] };
    this.puppetHandoff = { checked: 0, mismatches: [] };
    this.mobVisibility = { checked: 0, mismatches: [] };
    this.emptyPuppets = { checked: 0, mismatches: [] };
    this.ordinaryMovement = { checked: 0, mismatches: [] };
    this.controlReturns = { checked: 0, mismatches: [] };
    this.before = new WeakMap();
  }
  movement(game, moved, direction) {
    if (!moved || (game.map?.worldTerrain && game.player.vehicle > 1)) return;
    this.ordinaryMovement.checked++;
    if (game.player.visible === false)
      this.ordinaryMovement.mismatches.push({
        mapId: game.mapId,
        script: game.lastInstruction?.script,
        instruction: game.lastInstruction?.index,
        time: game.time,
        direction,
        x: game.player.x,
        y: game.player.y,
        reason: "Ordinary field movement advanced an invisible controlled player",
      });
  }
  event(game, event) {
    if (event.kind !== "player-control-return") return;
    this.controlReturns.checked++;
    const puppet = game.actors.get(String(-event.characterId));
    if (
      game.player.visible === false ||
      game.camera.manual ||
      ["x", "y", "layer"].some((key) => game.player[key] !== event[key]) ||
      (event.body === "leader-puppet" && puppet?.visible)
    )
      this.controlReturns.mismatches.push({
        ...event,
        reason: "Returning ordinary control lost the visible body, source pose or following camera",
      });
  }
  completedInstruction(game, task, program, pc, op) {
    const before = this.before.get(task);
    this.before.delete(task);
    const context = { mapId: game.mapId, script: program?.name, instruction: pc, time: game.time };
    if (before?.kind === "vehicle") {
      this.vehicleVisibility.checked++;
      if (before.hidden && game.player.visible !== false)
        this.vehicleVisibility.mismatches.push({
          ...context,
          reason: "Vehicle appearance revealed a hidden story player",
        });
    }
    if (before?.kind === "handoff") {
      this.puppetHandoff.checked++;
      if (
        game.player.visible !== true ||
        ["x", "y", "layer"].some((key) => game.player[key] !== before.pose[key])
      )
        this.puppetHandoff.mismatches.push({
          ...context,
          expected: before.pose,
          actual: { x: game.player.x, y: game.player.y, layer: game.player.layer },
          reason: "Retiring a leader puppet lost its authored control pose",
        });
    }
    if (before?.kind === "restore-mobs") {
      for (const [actor, visible] of before.actors) {
        if (game.actors.get(String(actor.id)) !== actor) continue;
        this.mobVisibility.checked++;
        if (actor.visible !== visible)
          this.mobVisibility.mismatches.push({
            ...context,
            entityId: actor.id,
            expected: visible,
            actual: actor.visible,
          });
      }
    }
    if (before?.kind === "empty-puppets") {
      this.emptyPuppets.checked += before.selectors.length;
      for (const selector of before.selectors)
        if (task.children.some((child) => child.actor === selector))
          this.emptyPuppets.mismatches.push({
            ...context,
            selector,
            reason: "An empty party position dispatched a body callback",
          });
    }
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
    if (op[0] === "RestoreMob" && game.hiddenMobs?.mapId === game.mapId)
      this.before.set(task, { kind: "restore-mobs", actors: [...game.hiddenMobs.actors] });
    if (op[0] === "ExecPuppet") {
      const selectors = Object.values(task.bindings)
        .map((binding) => binding.actor)
        .filter(
          (actor) =>
            actor <= -1002 && actor >= -1005 && !game.partySlots[game.partyIndex][-actor - 1001],
        );
      if (selectors.length) this.before.set(task, { kind: "empty-puppets", selectors });
    }
    if (op[0] === "SysCall" && /^乗り物(?:に乗る|から降りる)/.test(op[3]?.[0] || ""))
      this.before.set(task, { kind: "vehicle", hidden: game.player.visible === false });
    if (
      op[0] === "ChangeScript" &&
      op[3]?.[0] === game.map?.initializer &&
      game.player.visible === false
    ) {
      const leader = game.partySlots[game.partyIndex][0] ?? game.player.characterId,
        puppet = game.actors.get(String(-leader));
      if (puppet?.visible)
        this.before.set(task, {
          kind: "handoff",
          pose: { x: puppet.x, y: puppet.y, layer: puppet.layer },
        });
    }
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
        vehicleVisibility: this.vehicleVisibility,
        puppetHandoff: this.puppetHandoff,
        mobVisibility: this.mobVisibility,
        emptyPuppets: this.emptyPuppets,
        ordinaryMovement: this.ordinaryMovement,
        controlReturns: this.controlReturns,
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
