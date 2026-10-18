// Browser presentation barrier. Combat still settles exactly once in src/play;
// subsequent host ticks wait while its emitted actions/results are displayed.
const snapshot = (battle) => ({
  ...battle,
  players: battle.players.map((unit) => ({ ...unit, conditions: [...(unit.conditions || [])] })),
  enemies: battle.enemies.map((unit) => ({ ...unit, conditions: [...(unit.conditions || [])] })),
  log: [...battle.log],
});
const musicCommands = new Set(["PlayBGM", "ReplayBgm", "StopBGM", "PauseBGM"]);

export class BattleFlow {
  constructor({ audio, emit = () => {} }) {
    Object.assign(this, { audio, emit });
    this.reset();
  }
  reset() {
    this.battle = this.view = this.current = this.result = this.ending = null;
    this.queue = [];
    this.openingEvents = [];
    this.phase = "idle";
    this.banner = "";
    this.clock = 0;
    this.previousMusic = null;
    this.fieldMusic = null;
    this.trace = [];
  }
  record(kind, details = {}) {
    this.trace.push({ kind, ...details });
    if (this.trace.length > 40) this.trace.shift();
  }
  audioCommand(command) {
    // Track pending as well as decoded field music: a fast encounter can start
    // while the previous map's track is still loading over the network.
    if (!this.battle && musicCommands.has(command.name)) {
      if (command.name === "PlayBGM" || (command.name === "ReplayBgm" && command.i?.[0]))
        this.fieldMusic = { id: command.i[0], offset: 0 };
      else if (command.name === "StopBGM") this.fieldMusic = null;
    }
  }
  begin(battle) {
    this.battle = battle;
    this.view = snapshot(battle);
    this.before = new Map(
      battle.players.map((unit) => [
        unit.id,
        { level: unit.level, exp: unit.exp || 0, abilities: [...(unit.abilities || [])] },
      ]),
    );
    this.previousMusic = this.audio.musicState
      ? this.audio.musicState()
      : this.audio.current
        ? { id: this.audio.current.id, offset: this.audio.position() }
        : this.fieldMusic;
    this.phase = "battle";
    const id = battle.formation.bgmId;
    // PR's zero deliberately keeps the scene music (opera/final sequences).
    if (id > 0) this.audio.playMusic(id, { restart: true });
    this.record("battle", { encounterId: battle.encounterId, bgmId: id });
    for (const event of this.openingEvents.splice(0)) this.event(event, battle);
  }
  event(event, battle) {
    if (event.kind === "battle") {
      this.begin(battle);
      return;
    }
    if (!this.battle) {
      // PR start-of-battle AI can emit hits inside Battle's constructor,
      // before PlayGame publishes its `battle` event and assigns the instance.
      if ((event.kind === "battle-action" && event.result) || event.kind === "battle-party")
        this.openingEvents.push(event);
      return;
    }
    if (event.kind === "battle-action" && event.result) {
      const last = this.queue.at(-1);
      if (
        last?.kind === "action" &&
        event.actionId != null &&
        last.events[0].actionId === event.actionId &&
        last.events[0].abilityId === event.abilityId
      ) {
        last.events.push(event);
        last.view = snapshot(this.battle);
      } else this.queue.push({ kind: "action", events: [event], view: snapshot(this.battle) });
    } else if (event.kind === "battle-party")
      this.queue.push({ kind: "party", event, view: snapshot(this.battle) });
    else if (event.kind === "battle-end") {
      this.ending = { ...event, view: snapshot(this.battle) };
      // This reports already granted rewards; never grants them a second time.
      this.result = {
        ...event,
        players: this.battle.players.map((unit) => {
          const old = this.before.get(unit.id);
          return {
            name: unit.name,
            level: unit.level,
            levels: old ? unit.level - old.level : 0,
            exp: old ? (unit.exp || 0) - old.exp : 0,
            learned: old ? (unit.abilities || []).filter((id) => !old.abilities.includes(id)) : [],
          };
        }),
      };
    }
  }
  get busy() {
    return !!(this.current || this.queue.length || this.ending);
  }
  update(dt, { auto = false, fast = false } = {}) {
    if (!this.battle) return;
    if (this.current) {
      const action = this.current;
      action.age += dt * (fast ? 8 : 1);
      if (!action.emitted && action.age >= 0.16) {
        action.emitted = true;
        Object.assign(this.view, action.view);
        for (const event of action.events) this.emit(event);
        this.record("action", {
          abilityId: action.events[0].abilityId,
          targets: action.events.length,
        });
      }
      if (action.age < action.duration) return;
      this.current = null;
      this.banner = "";
    }
    while (this.queue.length) {
      const next = this.queue.shift();
      if (next.kind === "party") {
        Object.assign(this.view, next.view);
        this.emit(next.event);
        continue;
      }
      const event = next.events[0],
        ability = this.battle.data.abilities[event.abilityId],
        named = ![1, 2].includes(event.abilityId);
      this.banner = named ? event.abilityName || ability?.name || "技能" : "";
      // Timings approximate the PR choreography. Only wall-clock presentation
      // waits here; ATB/status timers and the random stream never tick ahead.
      this.current = { ...next, age: 0, emitted: false, duration: named ? 1.65 : 0.95 };
      this.phase = "action";
      return;
    }
    if (!this.ending) {
      this.phase = "battle";
      Object.assign(this.view, snapshot(this.battle));
      return;
    }
    if (!["victory", "result", "exit"].includes(this.phase)) {
      Object.assign(this.view, this.ending.view);
      this.phase = this.ending.outcome === "victory" ? "victory" : "exit";
      this.clock = 0;
      const id =
        this.battle.data.limits?.[
          this.ending.outcome === "victory" ? "BGM_BATTLE_WIN" : "BGM_BATTLE_LOSE"
        ];
      if (id && this.ending.outcome !== "escape") this.audio.playMusic(id, { restart: true });
      this.record(this.phase, { bgmId: this.ending.outcome === "escape" ? null : id });
    }
    this.clock += dt * (fast ? 8 : 1);
    if (this.phase === "exit" && this.clock >= 0.8) this.finish();
    else if (this.phase === "victory" && this.clock >= 1.2) {
      this.phase = "result";
      this.clock = 0;
      this.record("result");
    } else if (this.phase === "result" && auto && this.clock >= 1.5) this.confirm();
  }
  confirm() {
    if (this.phase !== "result") return false;
    this.finish();
    return true;
  }
  finish() {
    const outcome = this.ending?.outcome,
      saved = this.previousMusic;
    this.battle = this.view = this.current = this.ending = this.result = null;
    this.queue = [];
    this.banner = "";
    this.phase = "idle";
    if (outcome !== "defeat")
      this.audio.playMusic(saved?.id || 0, { offset: saved?.offset || 0, restart: true });
    this.record("return", { outcome, bgmId: outcome === "defeat" ? null : saved?.id || 0 });
  }
  diagnostics() {
    return {
      phase: this.phase,
      busy: this.busy,
      banner: this.banner,
      pending: this.queue.length,
      music: this.audio.current?.id || null,
      audioState: this.audio.context?.state || null,
      musicPosition: this.audio.current ? this.audio.position() : null,
      musicSyncPending: !!this.audio.syncPending,
      musicLoading: !!this.audio.musicPending,
      previousMusic: this.previousMusic,
      trace: [...this.trace],
    };
  }
}
