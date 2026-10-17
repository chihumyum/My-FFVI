import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeAcceptanceState } from "../../apps/play/acceptance-state.js";

const boundaries = new Set(["map", "script", "battle", "battle-end"]);
const animationCommands = new Set([
  "CueAnim",
  "PlayAnim",
  "SetPos",
  "Move",
  "MoveBirdView",
  "MoveTo",
  "Lerp",
  "Route",
]);

// A passive observer: never calls snapshot/party/actor, never changes game time,
// random, cursors, inputs or the regression policy. Bytes are frozen synchronously
// at the event; filesystem writes may finish later.
export class BoundaryCheckpoints {
  constructor(directory, presentationAudit, { select } = {}) {
    this.directory = directory;
    this.presentation = presentationAudit;
    this.entries = [];
    this.writes = [];
    this.visualEvents = [];
    this.recentEvents = [];
    this.pending = [];
    this.programEntries = new Set();
    this.select = select;
    this.sequence = 0;
  }
  async open() {
    await mkdir(this.directory, { recursive: true });
    return this;
  }
  presentationEvent(event) {
    if (event.kind === "presentation-command" && !animationCommands.has(event.name))
      this.visualEvents.push(event);
  }
  instruction(game, task, program, index) {
    if (!program) return;
    // Every foreground story start is already captured via its event. Also
    // sample each executed helper/initializer/actor program once, to expose
    // sources that have no foreground event without photographing every NPC
    // movement callback for the entire game.
    if (this.programEntries.has(String(task.program))) return;
    this.programEntries.add(String(task.program));
    const entry = this.capture(game, "program-entry", {
      script: program.name,
      instructionIndex: index,
      taskId: task.id,
      programId: String(task.program),
    });
    this.pending.push({ parent: entry.sequence, at: game.time + 0.5, mapId: game.mapId });
  }
  event(game, event) {
    if (event.kind === "map") this.visualEvents.push(event);
    this.recentEvents.push(event);
    if (this.recentEvents.length > 20) this.recentEvents.shift();
    if (event.kind === "battle") this.lastBattle = game.battle;
    if (!boundaries.has(event.kind)) return;
    const entry = this.capture(
      game,
      event.kind,
      event,
      event.kind === "battle-end" ? this.lastBattle : null,
    );
    this.pending.push({ parent: entry.sequence, at: game.time + 0.5, mapId: game.mapId });
    if (event.kind === "battle-end") this.lastBattle = null;
  }
  observe(game) {
    const fade = game.fade,
      progress = fade
        ? Math.max(0, Math.min(1, (game.time - fade.start) / (fade.duration || 0.000001)))
        : 0,
      alpha = fade ? fade.from + (fade.to - fade.from) * progress : 0;
    // Retain black boundary frames; wait for a visible companion rather than
    // treating the first half-second of a long fade as the scene composition.
    if (alpha > 0.1) {
      this.pending = this.pending.filter((row) => row.mapId === game.mapId);
      return;
    }
    const ready = this.pending.filter((row) => row.at <= game.time && row.mapId === game.mapId);
    this.pending = this.pending.filter((row) => row.at > game.time && row.mapId === game.mapId);
    if (ready.length) this.capture(game, "context", { parents: ready.map((row) => row.parent) });
  }
  capture(game, kind, event = {}, displayBattle = null) {
    const sequence = ++this.sequence,
      battle = displayBattle || game.battle;
    const metadata = {
      sequence,
      kind,
      parents: event.parents || [],
      time: game.time,
      mapId: game.mapId,
      map: this.presentation?.shared.catalogs.presentation.mapNames?.[game.mapId] || game.map?.name,
      script: event.script || game.lastInstruction?.script || game.furthest?.script || null,
      instruction: kind === "script" ? 0 : (game.lastInstruction?.index ?? null),
      programInstruction: event.instructionIndex ?? null,
      taskId: event.taskId ?? null,
      programId: event.programId ?? null,
      encounterId: event.encounterId ?? battle?.encounterId ?? null,
      outcome: battle?.outcome ?? null,
      player: { x: game.player.x, y: game.player.y, layer: game.player.layer },
      dialogue: !!game.dialogue,
      fade: game.fade && { ...game.fade },
    };
    if (this.select) {
      const selected = this.select(metadata);
      if (!selected) return metadata;
      Object.assign(metadata, selected);
    }
    const name = `${String(sequence).padStart(5, "0")}-${kind}-${game.mapId}`;
    metadata.file = `${name}.json`;
    const actors = [game.player, ...game.actors.values(), ...(game.partyPositions || [])];
    const state = Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(game))
        .filter(([, descriptor]) => descriptor.enumerable && Object.hasOwn(descriptor, "value"))
        .map(([key, descriptor]) => [key, descriptor.value]),
    );
    state.battle = battle;
    const field = this.presentation?.field.capture(actors) || [],
      battleRows = battle
        ? [...battle.players, ...battle.enemies].map((unit) => ({
            unit,
            row: this.presentation?.battleRows.get(unit),
          }))
        : [];
    const graph = encodeAcceptanceState(
      {
        state,
        field,
        battleRows,
        visualEvents: this.visualEvents,
        recentEvents: this.recentEvents,
      },
      { data: game.data, battleData: game.battleData, map: game.map },
    );
    const programIds = [
      ...new Set(
        (game.tasks || [])
          .flatMap((task) => [
            task.program,
            ...task.stack.map((row) => row.program),
            ...(task.scriptFrames || []).map((row) => row.program),
          ])
          .filter((id) => id != null)
          .map(String),
      ),
    ];
    const checkpoint = { ...graph, metadata, programIds };
    const bytes = JSON.stringify(checkpoint);
    metadata.bytes = Buffer.byteLength(bytes);
    this.entries.push(metadata);
    this.writes.push(writeFile(path.join(this.directory, metadata.file), bytes));
    return metadata;
  }
  async flush() {
    await Promise.all(this.writes.splice(0));
  }
  async finish(run) {
    await this.flush();
    const counts = Object.fromEntries(
      [...boundaries, "program-entry", "context"].map((kind) => [
        kind,
        this.entries.filter((row) => row.kind === kind).length,
      ]),
    );
    const manifest = {
      schema: "ffvi-boundary-checkpoints",
      run,
      counts,
      selection: this.select ? "Explicit current-run visual reference points" : "Every boundary",
      scope: this.select
        ? "Selected source points from this actual regression run; other boundaries still participate in context timing and occurrence counting but are not serialized. No old state, normalization or story input is substituted. Frozen VM/battle/presentation frames, not playable saves."
        : "Every emitted map/story-script/battle start/end, a supplementary first-entry frame for each executed program (including initializer, NPC/actor and called programs), plus visible context frames after at least half a second. Frozen VM/battle/presentation state, not playable saves. Exact black/faded boundaries are retained. Context frames may be absent when the source leaves the map earlier. No game simulation occurs during screenshot restore.",
      entries: this.entries,
    };
    await writeFile(path.join(this.directory, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  }
}
