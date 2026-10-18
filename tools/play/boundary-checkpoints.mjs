import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeAcceptanceState } from "../../apps/play/acceptance-state.js";

const boundaries = new Set(["map", "script", "battle", "battle-end"]);
const animationCommands = new Set([
  "CueAnim",
  "PlayAnim",
  "LookAt",
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
  constructor(directory, presentationAudit, { select, handoffs = false } = {}) {
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
    this.handoffs = handoffs;
    this.before = new Map();
    this.switches = new WeakMap();
    this.unresolved = [];
    this.wasBusy = false;
    this.dialogueScenes = new Set();
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
    const op = program.ops[index];
    if (this.handoffs && op?.[0] === "SysCall" && /キー入力待ち/.test(op[3]?.[0] || ""))
      this.capture(game, "story-input", {
        script: program.name,
        instructionIndex: index,
        taskId: task.id,
        programId: String(task.program),
      });
    if (this.handoffs && task.actor === null && op?.[0] === "ChangeScript") {
      const before = this.beforeBoundary(game, "script", { nextScript: op[3]?.[0] });
      this.switches.set(task, { before, program: task.program });
    }
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
    const before = this.before.get(event.kind);
    this.before.delete(event.kind);
    const entry = this.capture(
      game,
      event.kind,
      { ...event, before: before?.sequence },
      event.kind === "battle-end" ? this.lastBattle : null,
    );
    this.pending.push({
      parent: entry.sequence,
      before: before?.sequence,
      at: game.time + 0.5,
      mapId: game.mapId,
    });
    if (event.kind === "battle-end") this.lastBattle = null;
  }
  observe(game) {
    if (this.handoffs && this.wasBusy && !game.busy) {
      this.capture(game, "control-return", { script: game.furthest?.script });
    }
    this.wasBusy = game.busy;
    const departed = this.pending.filter((row) => row.mapId !== game.mapId);
    this.unresolved.push(
      ...departed.map((row) => ({ ...row, reason: "map-left-before-visible-context" })),
    );
    this.pending = this.pending.filter((row) => row.mapId === game.mapId);
    const fade = game.fade,
      progress = fade
        ? Math.max(0, Math.min(1, (game.time - fade.start) / (fade.duration || 0.000001)))
        : 0,
      alpha = fade ? fade.from + (fade.to - fade.from) * progress : 0;
    // Retain black boundary frames; wait for a visible companion rather than
    // treating the first half-second of a long fade as the scene composition.
    if (alpha > 0.1 || game.loading || (this.handoffs && game.camera?.motion)) return;
    // The first visible context can precede the cast's arrival (the opening
    // camera pan is one example). Also retain the first visible spoken pose
    // of every foreground script occurrence, without capturing every line.
    if (this.handoffs && game.dialogue) {
      const task =
          game.dialogue.task || game.tasks.find((task) => !task.done && task.actor === null),
        key = `${game.mapId}:${task?.id}:${task?.program}`;
      if (!this.dialogueScenes.has(key)) {
        this.dialogueScenes.add(key);
        this.capture(game, "story-ready", { script: game.data.programs[task?.program]?.name });
      }
    }
    const ready = this.pending.filter((row) => row.at <= game.time && row.mapId === game.mapId);
    this.pending = this.pending.filter((row) => row.at > game.time && row.mapId === game.mapId);
    if (ready.length) {
      const context = this.capture(game, "context", {
        parents: ready.flatMap((row) => [row.before, row.parent]).filter(Boolean),
      });
      if (this.select && !context.file) this.missedContext = context;
    }
  }
  completedInstruction(game, task, program, index) {
    if (this.handoffs) {
      const switched = this.switches.get(task);
      this.switches.delete(task);
      if (
        switched &&
        task.program !== switched.program &&
        this.before.get("script") === switched.before
      ) {
        this.before.delete("script");
        const entry = this.capture(game, "script-switch", {
          script: game.data.programs[task.program]?.name,
          before: switched.before?.sequence,
        });
        this.pending.push({
          parent: entry.sequence,
          before: switched.before?.sequence,
          at: game.time + 0.5,
          mapId: game.mapId,
        });
      }
      if (task.actor === null && task.done && program?.ops[index]?.[0] === "Exit") {
        const entry = this.capture(game, "script-return", { script: program.name });
        this.pending.push({ parent: entry.sequence, at: game.time + 0.5, mapId: game.mapId });
      }
    }
    // A half-second context can coincide with a child puppet's Exit rather
    // than the foreground Exit requested by a reviewed reference. Preserve
    // the exact configured source point by also observing its real completion;
    // never substitute an old save or change the pixel comparison threshold.
    const missed = this.missedContext;
    if (
      !this.select ||
      task.actor !== null ||
      program?.ops[index]?.[0] !== "Exit" ||
      missed?.mapId !== game.mapId ||
      missed?.script !== program.name
    )
      return;
    this.capture(game, "context", { script: program.name, parents: missed.parents });
  }
  beforeBoundary(game, kind, event = {}) {
    if (!this.handoffs || !game.map) return null;
    const entry = this.capture(game, `${kind}-before`, event);
    this.before.set(kind, entry);
    return entry;
  }
  capture(game, kind, event = {}, displayBattle = null) {
    const sequence = ++this.sequence,
      battle = displayBattle || game.battle;
    const metadata = {
      sequence,
      kind,
      parents: event.parents || [],
      before: event.before ?? null,
      nextScript: event.nextScript ?? null,
      nextMapId: event.nextMapId ?? null,
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
      [
        ...boundaries,
        "program-entry",
        "context",
        ...(this.handoffs
          ? [
              "map-before",
              "script-before",
              "battle-before",
              "script-switch",
              "script-return",
              "control-return",
              "story-ready",
              "story-input",
            ]
          : []),
      ].map((kind) => [kind, this.entries.filter((row) => row.kind === kind).length]),
    );
    const manifest = {
      schema: "ffvi-boundary-checkpoints",
      run,
      counts,
      unresolved: this.handoffs
        ? [
            ...this.unresolved,
            ...this.pending.map((row) => ({ ...row, reason: "run-ended-before-visible-context" })),
          ]
        : [],
      selection: this.select ? "Explicit current-run visual reference points" : "Every boundary",
      scope: this.select
        ? "Selected source points from this actual regression run; other boundaries still participate in context timing and occurrence counting but are not serialized. No old state, normalization or story input is substituted. Frozen VM/battle/presentation frames, not playable saves."
        : "Every emitted map/story-script/battle start/end and program first entry, with pre-map/script/battle frames, ChangeScript switches, script/control returns and first visible dialogue per foreground program when handoffs are enabled. Each boundary also requests a visible context after at least half a second, completed camera motion and fade-in; unresolved contexts retain map-left/run-ended reasons. Frozen VM/battle/presentation state, not playable saves. Exact black/faded boundaries are retained. No game simulation occurs during screenshot restore.",
      entries: this.entries,
    };
    await writeFile(path.join(this.directory, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  }
}
