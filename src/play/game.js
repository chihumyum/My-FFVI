import { executeInstruction } from "./instructions.js";
import {
  fieldBlockerAt,
  fieldEntityVisible,
  walkingLayerAt,
  openedDoorTerrainAt,
  applyTileAnimation,
  openableDoorAt,
  openFieldDoor,
} from "./field-collision.js";
import {
  acceptsFieldInteraction,
  sameCellFieldInteraction,
  dispatchFieldInteraction,
} from "./field-interaction.js";
import { updateNpcMovement, tryNpcContact } from "./npc-movement.js";
import { executePartyInput, autoPartyInput } from "./party-input.js";
import { walkEncounter, worldCollisionAt } from "./encounters.js";
import {
  executeVehicleInstruction,
  executeVehicleSyscall,
  updateVehicleInput,
  moveVehicle,
  canVehicleMove,
} from "./vehicle-input.js";
import { autoShopInput, buyFromShop, sellToShop } from "./event-systems.js";
import { createCharacter, applyTestBoost } from "./progression.js";
import {
  equip,
  optimizeEquipment,
  equipMagicite,
  useFieldItem,
  useFieldAbility,
  canUseTent,
  changeInventory,
  activeSavePoint,
  openTreasure,
} from "./resources.js";
import { updateCooperativeInput, saveCooperativePosition } from "./cooperative-input.js";
import {
  executeSyscall,
  updateSyscallSystems,
  configureSyscallTimer,
  finishSyscallTimer,
} from "./syscalls.js";
import {
  fieldCharacterAsset,
  puppetFieldAsset,
  refreshCostume,
  setPartyAppearance,
} from "./appearance.js";
const dirs = ["up", "right", "down", "left"],
  delta = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
const presentation = new Set([
  "ColorFade",
  "Shake",
  "Flash",
  "ScreenEffect",
  "BackdropColor",
  "Orient",
  "Water",
  "ChangeView",
  "ChangeMapRenderArea",
  "PlayBattleEffect",
  "SyncBattleEffect",
  "BattleAnim",
  "BattleSyncAction",
  "BattleCondition",
  "SetVolume",
  "PauseBGM",
  "ReadyBGM",
  "LoadSE",
  "StopSE",
  "SyncSE",
  "SyncBGM",
  "PitchEnvSe",
  "PauseEnvSe",
  "SetAnimOnlyJockey",
  "ResetAnimOnlyJockey",
]);
export class PlayGame {
  constructor({
    data,
    loadMap,
    battleData = {},
    Battle = null,
    testBoost = false,
    interactiveNames = false,
    onEvent = () => {},
    random = Math.random,
  }) {
    Object.assign(this, { data, loadMap, battleData, Battle, testBoost, onEvent, random });
    this.interactiveNames = interactiveNames;
    this.nameInput = null;
    this.regressionOnly = true;
    this.settings = { atbMode: "wait", battleSpeed: 3, textSpeed: 3, volume: 0.7 };
    this.time = 0;
    this.stepCount = 0;
    this.tasks = [];
    this.warnings = [];
    this.warned = new Set();
    this.history = [];
    this.banks = {};
    this.inventory = {};
    this.gil = 0;
    this.groups = new Set();
    this.roster = {};
    this.partySlots = [[], [], []];
    this.partyIndex = 0;
    this.telepo = [];
    this.nextTask = 1;
    this.visited = [];
    this.battles = [];
    this.camera = { x: 0, y: 0, manual: false };
    this.player = {
      id: -1001,
      x: 0,
      y: 0,
      layer: 0,
      direction: "down",
      visible: true,
      asset: "mo_ff6_p001",
      animation: "Default",
    };
    this.actors = new Map();
    this.dialogue = null;
    this.battle = null;
    this.pending = null;
    this.control = true;
    this.furthest = null;
    const init = this.data.init || [];
    for (const row of init) {
      if (row.key_name.startsWith("INIT_PARTY_") && +row.value1 > 0)
        this.partySlots[0].push(+row.value1);
      if (row.key_name === "INIT_GIL") this.gil = +row.value1;
    }
    if (!this.partySlots[0].length) this.partySlots[0] = [1, 31, 32];
    for (const id of this.partySlots[0]) this.unit(id).magitek = true;
  }
  get party() {
    return this.partySlots[this.partyIndex].map((id) => this.unit(id));
  }
  get busy() {
    return !!(
      this.loading ||
      this.battle ||
      this.dialogue ||
      this.nameInput ||
      this.partySelection ||
      this.shop ||
      this.colosseumMenu ||
      this.vehicleMenu ||
      this.tasks.some((t) => !t.done && !t.background)
    );
  }
  unit(id) {
    return (this.roster[id] ??= createCharacter(this.battleData, id, this.testBoost));
  }
  warn(task, message) {
    const name = this.data.programs[task?.program]?.name || "runtime",
      key = `${name}:${task?.pc - 1}:${message}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    const value = { script: name, index: task ? task.pc - 1 : -1, message };
    this.warnings.push(value);
    console.warn("[play guess]", value);
    this.onEvent({ kind: "warning", ...value });
  }
  event(kind, value = {}) {
    this.onEvent({ kind, time: this.time, mapId: this.mapId, ...value });
  }
  resolve(name, map = this.mapId) {
    return this.data.byMap[map]?.[name] ?? this.data.global[name];
  }
  startScript(name, { actor = null, pc = 0, background = false, init = false } = {}) {
    const program = this.resolve(name);
    if (program === undefined) {
      this.warn(null, `Missing script ${name}; skipped`);
      return null;
    }
    const task = {
      id: this.nextTask++,
      program,
      pc,
      actor,
      stack: [],
      bindings: {},
      children: [],
      locals: [...(this.data.programs[program].locals || [])],
      scriptFrames: [],
      wait: 0,
      waitFor: null,
      done: false,
      background,
      init,
    };
    this.tasks.push(task);
    if (!init && actor === null) {
      this.furthest = {
        script: name,
        scene: this.data.programs[program].title || name,
        mapId: this.mapId,
      };
      this.history.push({ ...this.furthest, time: this.time });
      this.event("script", this.furthest);
    }
    return task;
  }
  async start() {
    await this.enter(this.data.entry.mapId, this.data.entry.entrance, this.data.entry.script);
    return this;
  }
  async enter(mapId, entrance = 1, continuation = "") {
    saveCooperativePosition(this);
    this.loading = true;
    this.tasks = [];
    this.assignedRouteTasks = new Map();
    this.dialogue = null;
    this.partySelection = null;
    this.nameInput = null;
    this.shop = null;
    this.colosseumMenu = null;
    this.vehicleMenu = null;
    this.triggerChangesScript = false;
    this.triggerScriptProgram = null;
    try {
      this.map = await this.loadMap(mapId);
      this.mapId = +mapId;
      if (this.areaId !== this.map.areaId) {
        this.banks.AreaLocalVariable = {};
        this.areaId = this.map.areaId;
      }
      this.visited.push(+mapId);
      this.groups = new Set(["entity_default"]);
      this.actors = new Map();
      if (this.banks.PlaySystems?.vehicleActive === false) {
        this.banks.PlaySystems.vehicleActive = true;
        this.warn(
          null,
          "SwitchVehicleActive hides this scene's vehicle bodies; a new map restores their default visibility. PR scene lifetime is inferred.",
        );
      }
      this.banks.MapLocalVariable = {};
      const point = this.map.entities.find((e) => e.kind === 0 && e.objectId === entrance) ||
        this.map.entities.find((e) => e.kind === 0) || { x: 1, y: 1, layer: 0, direction: "down" };
      Object.assign(this.player, {
        x: point.x,
        y: point.y,
        layer: point.layer,
        direction: point.direction || "down",
        motion: null,
        visible: true,
      });
      Object.assign(this.camera, { x: point.x, y: point.y, manual: false, motion: null });
      this.triggered = new Set();
      this.refreshActors();
      for (const guess of this.map.guesses || []) this.warn(null, guess);
      // PR ChangeMap reserves its explicit entry script. Integrator.Execute
      // selects that reserved script instead of the map's default initializer;
      // running both materializes stale event bodies (opera room's Locke).
      const init = this.startScript(continuation || this.map.initializer, {
        init: !continuation,
      });
      this.afterInit = "";
      this.loading = false;
      if (!continuation) this.fade = { from: 1, to: 0, start: this.time, duration: 0.25 };
      this.event("map", { name: this.map.name, entrance });
      if (!init) this.runAfterInit();
    } catch (error) {
      this.loading = false;
      this.warn(null, `Map ${mapId} load failed: ${error.message}`);
      throw error;
    }
  }
  runAfterInit() {
    const next = this.afterInit;
    this.afterInit = "";
    if (next) this.startScript(next);
  }
  refreshActors({ preserveMissing = false } = {}) {
    const previous = new Set((this.actorEntitySource || []).map((e) => String(e.id)));
    const entities = [...this.map.entities.filter((e) => !e.group || e.group === "entity_default")];
    for (const g of this.groups)
      if (g !== "entity_default") entities.push(...(this.map.groups?.[g]?.entities || []));
    this.entities = entities;
    for (const e of entities) {
      const actor = this.actors.get(String(e.id));
      // A puppet may mention an unpublished entity (Vector's crate trigger60).
      // Its missing-entity placeholder is not the later PR group's real body.
      if (
        ([6, 7, 10, 14, 17].includes(e.kind) && !actor && !preserveMissing) ||
        (!preserveMissing && e.kind === 2 && actor && !previous.has(String(e.id))) ||
        (Number(e.id) > 0 && actor && actor.kind == null)
      )
        this.actors.set(String(e.id), {
          ...e,
          visible: e.kind === 2 ? true : actor?.visible !== false,
          animation: "Default",
          motion: null,
        });
      else if (actor && actor.kind === e.kind && actor.asset == null && e.asset)
        actor.asset = e.asset;
    }
    this.actorEntitySource = entities;
  }
  actor(selector) {
    if (selector === null || selector === undefined || selector === -1001) return this.player;
    if (selector === 0) return this.camera;
    if (selector === -1010) return this.player;
    if (selector <= -1030 && selector >= -1032) {
      const n = -1030 - selector;
      return this.partyPositions?.[n] || this.player;
    }
    if (selector <= -1002 && selector >= -1005)
      selector = -(this.partySlots[this.partyIndex][-selector - 1001] || 1);
    const key = String(selector);
    if (!this.actors.has(key)) {
      // Initializers can Hide/SetPos objects before enabling their group.
      // Resolve the actual source row so those operations retain its type and
      // geometry, rather than creating an untyped object at the player cell.
      const entity =
        selector > 0 || (typeof selector === "string" && !Number.isFinite(Number(selector)))
          ? this.entities?.find((entry) => String(entry.id) === key) ||
            Object.values(this.map?.groups || {})
              .flatMap((group) => group.entities)
              .find((entry) => String(entry.id) === key)
          : null;
      if (entity) {
        this.actors.set(key, {
          ...entity,
          visible: entity.visible !== false,
          animation: "Default",
          motion: null,
        });
        return this.actors.get(key);
      }
      const id = selector < 0 ? -selector : null,
        asset = id ? puppetFieldAsset(this.data, id, this.roster?.[id]) : undefined;
      this.actors.set(key, {
        id: selector,
        x: this.player.x,
        y: this.player.y,
        layer: this.player.layer,
        direction: "down",
        visible: false,
        asset,
        animation: "Default",
      });
    }
    return this.actors.get(key);
  }

  bank(category, task) {
    if (category === "ScriptLocalVariable") return task.locals;
    return (this.banks[category] ??= {});
  }
  read(category, index, task) {
    return Number(this.bank(category || "ScriptLocalVariable", task)[index] ?? 0);
  }
  write(category, index, value, task) {
    this.bank(category || "ScriptLocalVariable", task)[index] = value | 0;
    // The PR deployment/return scripts set/reset the party-switch flag.
    // In particular, Phoenix's return must stop retaining inactive parties
    // on cave plates after the source has returned to an ordinary town.
    if (category === "ScenarioFlag3" && index === 45 && this.rts)
      this.rts.active = (value | 0) !== 0;
  }
  compare(a, op, b) {
    switch (op) {
      case "＝":
      case "=":
      case "==":
        return a === b;
      case "≠":
      case "!=":
        return a !== b;
      case "＞":
      case ">":
        return a > b;
      case "＜":
      case "<":
        return a < b;
      case "≧":
      case ">=":
        return a >= b;
      case "≦":
      case "<=":
        return a <= b;
      case "＆":
      case "&":
        return !!(a & b);
      default:
        return a === b;
    }
  }
  calculate(a, op, b) {
    switch (op) {
      case "＋":
      case "+":
        return a + b;
      case "－":
      case "-":
        return a - b;
      case "×":
      case "*":
        return a * b;
      case "÷":
      case "/":
        return b ? Math.trunc(a / b) : 0;
      case "%":
        return b ? a % b : 0;
      case "＆":
      case "&":
        return a & b;
      case "｜":
      case "|":
        return a | b;
      default:
        return b;
    }
  }
  text(key, fallback = key) {
    return (this.data.messages[key] ?? fallback ?? "")
      .replace(/\\n/g, "\n")
      .replace(
        /\((TINA|LOCK|ROCK|EDGAR|MASH|CELES|MOG)\)/g,
        (_, n) =>
          this.unit({ TINA: 1, LOCK: 2, ROCK: 2, EDGAR: 5, MASH: 6, CELES: 7, MOG: 11 }[n]).name,
      )
      .replace(/<C(\d+)>/g, (_, id) => this.unit(+id).name)
      .replace(/<P>/g, "\n")
      .replace(/<[^>]*>/g, "");
  }
  confirm(choice = 0) {
    if (this.dialogue) {
      const d = this.dialogue;
      this.dialogue = null;
      if (d.task) {
        d.task.waitFor = null;
        d.task.locals[0] = choice;
        d.task.result = choice;
        (this.banks.MessageSelection ??= {})[0] = choice;
      }
      d.onConfirm?.();
      this.event("confirm", { key: d.key, choice });
      return true;
    }
    if (this.busy) return false;
    return this.interact();
  }
  tick(dt = 1 / 60, { auto = false } = {}) {
    if (this.loading || this.over) return;
    this.autoInput = auto;
    if (this.nameInput) {
      if (!auto) return;
      this.submitName(this.nameInput.original);
    }
    updateVehicleInput(this);
    if (auto && this.partySelection)
      autoPartyInput(this, this.preparationTraining?.partyPreference || this.storyObjective?.party);
    if (auto && this.shop) autoShopInput(this, this.storyObjective?.buy);
    this.time += dt;
    updateSyscallSystems(this, dt);
    for (const a of [this.player, this.camera, ...this.actors.values()])
      if (a.motion) {
        const m = a.motion;
        m.elapsed += dt;
        const p = Math.min(1, m.elapsed / m.duration);
        a.x = m.x + (m.tx - m.x) * p;
        a.y = m.y + (m.ty - m.y) * p;
        if (p === 1) a.motion = null;
      }
    if (this.battle) {
      this.battle.tick(dt, auto);
      return;
    }
    if (auto && this.dialogue) {
      this.dialogue.elapsed += dt;
      if (this.dialogue.elapsed > 0.15) this.confirm(this.autoChoice?.(this) ?? 0);
    } else if (this.dialogue?.auto) {
      this.dialogue.elapsed += dt;
      if (this.dialogue.elapsed > this.dialogue.duration) this.confirm();
    }
    this.checkTriggers({ armedOnly: true });
    for (const task of [...this.tasks]) {
      if (task.done) continue;
      if (task.wait > 0) {
        task.wait -= dt;
        continue;
      }
      if (task.waitFor === "message") {
        if (this.dialogue) continue;
        task.waitFor = null;
      }
      if (task.waitFor === "children") {
        if (task.children.some((t) => !t.done)) continue;
        task.waitFor = null;
      }
      if (task.waitFor === "motion") {
        if (this.actor(task.actor).motion) continue;
        task.waitFor = null;
      }
      if (task.waitFor === "battle") continue;
      let steps = 0;
      while (!task.done && !task.waitFor && task.wait <= 0 && !this.loading && steps++ < 300) {
        this.step(task);
      }
      if (steps >= 300) {
        task.wait = dt;
        this.warn(task, "Loop yielded after 300 instructions");
      }
      if (this.loading) break;
    }
    const init = this.tasks.find((t) => t.init && !t.done);
    if (!init && this.afterInit) this.runAfterInit();
    this.tasks = this.tasks.filter(
      (t) => !t.done || this.tasks.some((o) => o.children.includes(t)),
    );
    this.checkTriggers({ armedOnly: true });
    updateCooperativeInput(this);
    updateNpcMovement(this, dt);
    if (!this.busy) this.tickNpc(dt);
  }
  finishTask(t) {
    const caller = t.scriptFrames?.pop();
    if (caller) {
      Object.assign(t, caller, { done: false, wait: 0, waitFor: null });
    } else t.done = true;
  }
  step(t) {
    const p = this.data.programs[t.program],
      op = p?.ops[t.pc++];
    if (!op) {
      this.finishTask(t);
      return;
    }
    const [name, i, r, s] = op,
      a = this.actor(t.actor);
    this.lastInstruction = { script: p.name, index: t.pc - 1, name };
    if (
      executeVehicleInstruction(this, t, name, i, r, s) ||
      executeInstruction(this, t, name, i, r, s, a)
    )
      return;
    switch (name) {
      case "Nop":
        return;
      case "Blank":
        t.wait = 0.001;
        return;
      case "Exit":
        this.finishTask(t);
        return;
      case "Return":
        if (t.stack.length) {
          const f = t.stack.pop();
          Object.assign(t, f);
        } else this.finishTask(t);
        return;
      case "Call":
        t.stack.push({ program: t.program, pc: t.pc, locals: t.locals });
        t.pc = i[0];
        return;
      case "Jump":
      case "JumpBattleAI":
        t.pc = i[0];
        return;
      case "ChangeScript": {
        const target = this.resolve(s[0]);
        if (target === undefined) {
          this.warn(t, `Missing script ${s[0]}`);
          return;
        }
        if (i[0]) {
          t.scriptFrames ??= [];
          if (t.scriptFrames.length >= 16) {
            this.warn(t, "Script call depth exceeded 16; ignored recursive call");
            return;
          }
          t.scriptFrames.push({ program: t.program, pc: t.pc, locals: t.locals, stack: t.stack });
        }
        t.stack = [];
        if (s[0] === this.map.initializer) {
          this.groups = new Set(["entity_default"]);
          this.actors = new Map();
          this.refreshActors();
        } else if (t.actor === null && /^sc_e_/.test(s[0])) {
          this.furthest = {
            script: s[0],
            scene: this.data.programs[target].title || s[0],
            mapId: this.mapId,
          };
          this.history.push({ ...this.furthest, time: this.time });
          this.event("script", this.furthest);
        }
        t.program = target;
        t.pc = 0;
        t.locals = [...(this.data.programs[target].locals || [])];
        return;
      }
      case "Branch": {
        const b = s[2] === "imm" ? i[1] : this.read(s[2], i[1], t);
        if (this.compare(this.read(s[0], i[0], t), s[1], b)) t.pc = i[2];
        return;
      }
      case "Calc":
        this.write(
          s[0],
          i[0],
          this.calculate(
            this.read(s[0], i[0], t),
            s[1],
            s[2] === "imm" ? i[1] : this.read(s[2], i[1], t),
          ),
          t,
        );
        return;
      case "SetFlag":
      case "ResetFlag":
      case "FlipFlag":
        this.write(
          s[0],
          i[0],
          name === "SetFlag" ? 1 : name === "ResetFlag" ? 0 : 1 - this.read(s[0], i[0], t),
          t,
        );
        return;
      case "SetRandomValue":
        // PR Misc.SetRandomValue uses Random.Range(1, iValues[1] + 1).
        // The following zero-filled parameter is not a second range bound.
        this.write(s[0], i[0], 1 + Math.floor(this.random() * Math.max(1, i[1])), t);
        return;
      case "Wait":
        t.wait = Math.max(0, r[0] || 0);
        return;
      case "SetPuppet": {
        const partyPosition = i[1] <= -1002 && i[1] >= -1005 ? -i[1] - 1001 : null;
        if (
          (i[1] < 0 && i[1] > -1000) ||
          (partyPosition !== null && this.partySlots[this.partyIndex][partyPosition])
        ) {
          const puppet = this.actor(i[1]);
          puppet.visible = true;
          if (partyPosition === null && -i[1] === this.partySlots[this.partyIndex][0])
            this.player.visible = false;
        }
        t.bindings[i[0]] = { actor: i[1], target: i[2] };
        return;
      }
      case "ExecPuppet": {
        t.children = Object.values(t.bindings)
          .map((b) =>
            this.startScript(p.name, { actor: b.actor, pc: b.target, background: !!i[0] }),
          )
          .filter(Boolean);
        t.bindings = {};
        if (!i[0]) t.waitFor = "children";
        return;
      }
      case "FinishPuppet":
        for (const child of this.tasks) if (child.actor !== null) child.done = true;
        return;
      case "SetEntities":
        this.groups.add(s[0]);
        this.refreshActors();
        return;
      case "SetPos":
        a.x = i[0];
        a.y = i[1];
        a.layer = i[2] || 0;
        a.motion = null;
        if (s[0]) a.animation = s[0];
        if (a === this.camera) a.manual = true;
        return;
      case "LookAt":
        a.direction = dirs[i[0]] || "down";
        return;
      case "Hide":
        a.visible = false;
        // PR EventTriggerEntity.Hide (RVA8788f0) calls Reset (RVA878500),
        // which sets TriggerPower=1 and TriggerOverlap=0. Its logical trigger
        // is independent of sprite visibility; source609 relies on this.
        if (a.kind === 2) {
          a.triggerEnabled = Boolean(
            this.triggerChangesScript &&
            this.triggerActor === -1001 &&
            this.triggerScriptProgram === t.program,
          );
        }
        if (a.triggerEnabled) {
          this.triggered.delete(`${this.mapId}:${[...this.groups].join(",")}:${a.id}`);
          this.warn(
            t,
            "PR Hide resets a source-armed touch trigger, including existing overlap. Overlap callbacks run before the parent event resumes; Unity callback ordering is approximated without cancelling the source parent.",
          );
        }
        return;
      case "Show":
        a.visible = true;
        return;
      case "HidePlayer":
        this.player.visible = false;
        return;
      case "ShowPlayer":
        this.player.visible = true;
        return;
      case "Move": {
        const d = delta[i[0]] || [0, 0];
        this.motion(
          t,
          a,
          a.x + d[0] * i[1],
          a.y + d[1] * i[1],
          (i[1] || 1) * ([0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16][i[2]] || 0.24),
          s[0],
        );
        return;
      }
      case "Lerp":
        this.motion(t, a, i[0], i[1], Math.abs(r[0]) || 0.01, s[0]);
        a.layer = i[2] || a.layer;
        return;
      case "MoveTo": {
        const v = i[1] === 1 ? this.actor(i[2])[i[0] ? "y" : "x"] + i[3] : i[2];
        this.motion(
          t,
          a,
          i[0] ? a.x : v,
          i[0] ? v : a.y,
          0.24 * Math.max(1, Math.abs(v - (i[0] ? a.y : a.x))),
          s[0],
        );
        return;
      }
      case "CueAnim":
      case "PlayAnim":
        a.animation = s[0] || "Default";
        applyTileAnimation(this, a, i, r, s);
        if (name === "PlayAnim" && i[1] > 1) t.wait = 0.2 * i[1];
        return;
      case "AssignMoveRoute":
      case "Route":
        this.warn(t, `${name}: route scheduling deferred`);
        return;
      case "Msg": {
        const key = s[0] || "",
          text = this.text(key);
        if (!text) return;
        if (this.dialogue) {
          t.pc--;
          t.waitFor = "message";
          return;
        }
        const timed = i[0] === 3;
        this.dialogue = {
          key,
          text,
          speaker: this.data.speakers[key] || "",
          task: timed ? null : t,
          auto: timed,
          duration: r[0] > 0 ? r[0] : 2,
          elapsed: 0,
        };
        if (!timed) t.waitFor = "message";
        this.event("dialogue", { key, text });
        return;
      }
      case "MsgClose":
        this.dialogue = null;
        return;
      case "MsgFinishWait":
      case "MsgFinishWaitAll":
        if (this.dialogue) t.waitFor = "message";
        return;
      case "Select": {
        const keys = s.filter(Boolean);
        this.dialogue = {
          key: keys[0],
          text: "请选择：",
          speaker: "",
          choices: keys.length ? keys.map((k) => this.text(k)) : ["是", "否"],
          task: t,
          elapsed: 0,
        };
        t.waitFor = "message";
        return;
      }
      case "ChangeMap":
        t.done = true;
        this.pending = this.enter(i[0], i[1], s[0] || "");
        return;
      case "Encount":
      case "EncountBoss":
        this.encounter(i[0], s[0], t);
        return;
      case "OrganizePartySlot": {
        const slot = Math.max(0, i[0] - 1);
        this.partySlots[slot] = i.slice(1, 5).filter((n) => n > 0);
        const id = this.partySlots[this.partyIndex]?.[0];
        if (slot === this.partyIndex && id)
          setPartyAppearance(this, this.player, this.roster[id] || { id });
        return;
      }
      case "ChangePartySlot": {
        this.partyIndex = Math.max(0, i[0] - 1);
        const id = this.partySlots[this.partyIndex]?.[0];
        if (id) setPartyAppearance(this, this.player, this.roster[id] || { id });
        return;
      }
      case "GetItem":
        changeInventory(this, i[0], i[1] || 1);
        return;
      case "RemoveItem":
        changeInventory(this, i[0], -(i[1] || 1));
        return;
      case "RemoveGil": {
        const fees = (this.data.systemTables?.product || []).filter(
          (row) => Number(row.group_id) === i[0] && Number(row.content_id) === 0,
        );
        const amount = fees.length ? Math.max(0, Number(fees[0].coefficient)) : Math.max(0, i[0]);
        if (fees.length !== 1)
          this.warn(t, `Payment group ${i[0]} has ${fees.length} fee rows; using ${amount} Gil.`);
        const paid = this.gil >= amount;
        if (paid) this.gil -= amount;
        this.write("MapLocalVariable", 0, Number(paid), t);
        return;
      }
      case "RecoveryHP":
      case "RecoveryMP":
        for (const u of this.party)
          if (name === "RecoveryHP") u.hp = u.maxHp;
          else u.mp = u.maxMp;
        return;
      case "SubtractionHP":
        for (const u of this.party) u.hp = Math.max(1, u.hp - i[0]);
        return;
      case "AddCondition":
      case "RemoveCondition":
        for (const u of this.party) {
          u.conditions ??= [];
          if (i[0] === 607) u.magitek = name === "AddCondition";
          if (name === "AddCondition") u.conditions.push(i[0]);
          else {
            u.conditions = i[0] === 0 ? [] : u.conditions.filter((n) => n !== i[0]);
            if (i[0] === 5 && u.hp <= 0) u.hp = 1;
          }
          refreshCostume(this, u);
        }
        return;
      case "RideVehicleNPC":
        this.actor(i[1]).vehicle = i[0];
        return;
      case "LoseVehicle":
      case "OnTheVehicle":
      case "SetVehicle":
      case "SwitchVehicleActive":
        this.player.vehicle = name === "LoseVehicle" ? null : i[0];
        return;
      case "PlayBGM":
      case "ReplayBgm":
        this.event("bgm", { id: i[0] });
        return;
      case "StopBGM":
        this.event("bgm", { id: 0 });
        return;
      case "PlaySE":
      case "PlayEnvSe":
        this.event("se", { id: i[0] });
        return;
      case "StopEnvSe":
        return;
      case "FadeIn":
      case "FadeOut":
        this.fade = {
          from: name === "FadeIn" ? 1 : 0,
          to: name === "FadeIn" ? 0 : 1,
          start: this.time,
          duration: Math.abs(r[0]) || 0.35,
        };
        if (r[0] > 0) t.wait = r[0];
        return;
      case "ShowMapTitle":
        this.event("title", { text: this.text(s[0] || this.data.mapTitles[this.mapId]) });
        return;
      case "AutoSave":
        this.event("autosave");
        return;
      case "RemoveTelepoCache":
        this.telepo = [];
        return;
      case "AddTelepoCache":
        this.telepo.push([i[0], i[1]]);
        return;
      case "CastTelepo": {
        const dest = i[0] ? this.telepo.pop() : this.telepo.shift();
        if (dest) {
          if (!i[0]) this.telepo = [];
          t.done = true;
          this.pending = this.enter(...dest);
        }
        return;
      }
      case "BranchByNumOfMember":
        t.pc = this.party.length === i[0] ? i[1] : i[2];
        return;
      case "BranchByCharacter":
      case "BranchByLeader":
        t.pc = (
          name === "BranchByLeader"
            ? this.partySlots[this.partyIndex][0] === i[0]
            : this.partySlots[this.partyIndex].includes(i[0])
        )
          ? i[1]
          : i[2];
        return;
      case "BranchByPlayerDirection":
        t.pc = i[dirs.indexOf(this.player.direction)] || 0;
        return;
      case "HideMob":
        for (const e of this.actors.values()) e.visible = false;
        return;
      case "RestoreMob":
        for (const e of this.actors.values()) e.visible = true;
        return;
      case "SysCall":
        this.syscall(t, s[0] || "", i, r);
        return;
      case "TreasureBox": {
        const entity = this.entities.find((e) => e.kind === 7 && Number(e.id) === i[0]);
        if (entity) openTreasure(this, entity, { after: true, message: i[2] !== 1, task: t });
        else this.warn(t, `Missing source treasure entity ${i[0]}; skipped.`);
        return;
      }
      case "GoToTitle":
        this.titleScreen = true;
        this.event("title-screen");
        return;
      case "OpenSaveWindow":
        this.event("save-menu");
        return;
      case "SetTimer":
        configureSyscallTimer(this, t, i, r, s);
        return;
      case "FinishTimer":
        finishSyscallTimer(this);
        return;
      default:
        if (presentation.has(name)) return;
        this.warn(t, `${name}: provisional skip`);
        return;
    }
  }
  motion(t, a, x, y, duration, animation) {
    if (a === this.camera) {
      if (!a.manual) Object.assign(a, { x: this.player.x, y: this.player.y });
      a.manual = true;
    }
    const dx = x - a.x,
      dy = y - a.y;
    if (dx || dy)
      a.direction =
        Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    a.animation = animation || "Walk" + { up: "B", down: "", left: "L", right: "R" }[a.direction];
    a.motion = { x: a.x, y: a.y, tx: x, ty: y, duration: Math.max(0.01, duration), elapsed: 0 };
    t.waitFor = "motion";
  }
  syscall(t, name, i, r) {
    if (executeVehicleSyscall(this, t, name, i, r)) return;
    if (executePartyInput(this, t, name, this.storyObjective?.party)) return;
    if (executeSyscall(this, t, name, i, r)) return;
    if (/データ初期化|DataInitialize/.test(name)) return;
    if (/戦闘結果取得/.test(name)) {
      const result = this.battles.at(-1);
      t.locals[0] =
        result?.code ?? (result?.outcome === "victory" ? 0 : result?.outcome === "escape" ? 1 : 2);
      return;
    }
    if (/カメラ.*(追従|プレイヤー)|Camera.*(Reset|Follow)/i.test(name)) {
      this.camera.manual = false;
      return;
    }
    if (/名前.*(入力|変更)|ネーム|NameChange/i.test(name)) {
      this.event("name", { id: i[0] || this.party[0]?.id });
      this.requestName(t, i[0] || this.party[0]?.id);
      return;
    }
    if (/パーティ|コープス|Corps|Party/i.test(name)) {
      this.warn(t, `SysCall ${name}: provisional party selection`);
      t.locals[0] = 1;
      return;
    }
    if (/フラグ.*取得|チェック|Check|Is[A-Z]/.test(name)) {
      t.locals[0] = 0;
      this.warn(t, `SysCall ${name}: default false`);
      return;
    }
    if (/復活|回復|Recovery/.test(name)) {
      for (const u of this.party) {
        u.hp = u.maxHp;
        u.mp = u.maxMp;
      }
      return;
    }
    this.warn(t, `SysCall ${name}: skipped`);
  }
  requestName(task, id) {
    // Headless/frozen regression keeps the source default without adding policy.
    if (!this.interactiveNames || this.autoInput || !id) return;
    this.nameInput = { id, original: this.unit(id).name, task };
    if (task) task.waitFor = "name";
  }
  submitName(value, maxLength = 6) {
    const input = this.nameInput;
    if (!input) return false;
    const name = Array.from(String(value).normalize("NFC").trim()).slice(0, maxLength).join("");
    if (!name) return false;
    this.unit(input.id).name = name;
    if (input.task?.waitFor === "name") input.task.waitFor = null;
    this.nameInput = null;
    return true;
  }
  handlesBattleDefeat(name, seen = new Set()) {
    if (!name || seen.has(name)) return false;
    seen.add(name);
    const program = this.data.programs[this.resolve(name)];
    return (program?.ops || []).some(
      ([op, , , strings = []]) =>
        (op === "SysCall" && strings[0] === "戦闘結果取得") ||
        (op === "ChangeScript" && this.handlesBattleDefeat(strings[0], seen)),
    );
  }
  encounter(id, continuation, t, context = {}) {
    if (!this.Battle) {
      this.warn(t, `Battle ${id}: implementation pending`);
      return;
    }
    t.waitFor = "battle";
    this.battle = new this.Battle({
      data: this.battleData,
      party: this.party,
      encounterId: id,
      finalParty: this.finalBattleOrder || [],
      ...context,
      context: { ...context, gil: this.gil, steps: this.stepCount, settings: this.settings },
      random: this.random,
      inventory: this.inventory,
      banks: this.banks,
      character: (id) => this.unit(id),
      eventCallbacks: Object.fromEntries(
        ["メンバー加入：ガウ", "バトル加入：ガウ"].map((name) => [
          name,
          () => {
            executeSyscall(this, t, "メンバー加入：ガウ", [], []);
            return false;
          },
        ]),
      ),
      event: (kind, payload) => {
        if (kind === "gil-spend") this.gil = Math.max(0, this.gil - (payload.amount || 0));
        this.event(kind, payload);
      },
      warn: (msg) => this.warn(t, String(msg)),
      onEnd: (result) => {
        this.battle?.events?.releaseFieldTimer?.(result.outcome);
        for (const unit of this.party) refreshCostume(this, unit);
        const book = this.banks.PlaySystems;
        if (book?.monsterRecords && book.monsterRecordsLegacyCount == null)
          book.monsterRecordsLegacyCount = this.battles.length;
        this.battles.push({ encounterId: id, ...result });
        this.gil = Math.min(
          this.battleData.limits?.MAX_GIL ?? 9999999,
          this.gil + (result.gil || 0),
        );
        for (const drop of result.drops || []) changeInventory(this, drop.id, drop.count || 1);
        this.battle = null;
        t.waitFor = null;
        if (context.colosseum) {
          context.onColosseumEnd?.(result);
          this.event("battle-end", { encounterId: id, ...result });
          return;
        }
        if (result.fieldReturn === "engulf" && this.map?.worldTerrain) {
          // The serialized PR callback sc_e_0832 (script860) alone owns the
          // telepo cache, area variable and ChangeMap500/entrance1. SNES world
          // return flag $1dd1.7 confirms that a full Engulf starts a world
          // callback, not a defeat. Its numeric PR callback selector is not
          // serialized, so this association is an explicit host inference.
          const source = this.data.scriptIds?.[860] || "sc_e_0832";
          this.warn(
            t,
            `PR all-party condition71/type657: world Engulf return uses source callback ${source} (script860); native PR callback association is inferred.`,
          );
          t.done = true;
          this.startScript(source);
          this.event("battle-end", { encounterId: id, ...result });
          return;
        }
        if (
          result.outcome === "defeat" &&
          (context.randomEncounter || !this.handlesBattleDefeat(continuation))
        ) {
          t.done = true;
          this.over = { reason: "队伍在战斗中倒下了。请读取存档重试。" };
          this.event("game-over", this.over);
          this.event("battle-end", { encounterId: id, ...result });
          return;
        }
        if (continuation) {
          t.done = true;
          this.startScript(continuation);
        } else if (this.banks.PlaySystems?.reservedScript) {
          const reserved = this.banks.PlaySystems.reservedScript;
          delete this.banks.PlaySystems.reservedScript;
          t.done = true;
          this.startScript(reserved);
        }
        this.event("battle-end", { encounterId: id, ...result });
      },
    });
    this.event("battle", { encounterId: id });
  }
  tickNpc(dt) {
    if (!this.rts?.active) return;
    this.npcClock = (this.npcClock || 0) + dt;
    if (this.npcClock < 0.65) return;
    this.npcClock = 0;
    const definition = this.data.fieldAssets?.[this.rts.protectedId],
      asset =
        (typeof definition === "string" ? definition : definition?.asset_name) ||
        `mo_ff6_p${String(this.rts.protectedId).padStart(3, "0")}`;
    const goal = [...this.actors.values()].find(
      (n) => n.visible !== false && n.asset?.toLowerCase() === asset.toLowerCase() && n.id > 0,
    ) || { x: 14, y: 12, layer: this.player.layer };
    for (const e of this.entities) {
      const a = this.actors.get(String(e.id));
      if (e.kind !== 6 || e.npc?.moveType !== 3 || !a || a.visible === false || a.motion) continue;
      const dx = goal.x - a.x,
        dy = goal.y - a.y;
      const choices =
        Math.abs(dx) > Math.abs(dy)
          ? [
              [Math.sign(dx), 0],
              [0, Math.sign(dy)],
            ]
          : [
              [0, Math.sign(dy)],
              [Math.sign(dx), 0],
            ];
      for (const [x, y] of choices)
        if ((x || y) && this.canMove(a.x + x, a.y + y, a.layer, a)) {
          a.x += x;
          a.y += y;
          a.layer = walkingLayerAt(this, a.x, a.y, a.layer);
          a.direction = x > 0 ? "right" : x < 0 ? "left" : y > 0 ? "down" : "up";
          break;
        }
    }
    this.checkTriggers();
    if (
      !this.busy &&
      this.entities.some((e) => {
        const a = this.actors.get(String(e.id));
        return (
          e.npc?.moveType === 3 &&
          a?.visible !== false &&
          a &&
          (a.layer === goal.layer || e.npc?.allLayers) &&
          Math.abs(a.x - goal.x) + Math.abs(a.y - goal.y) <= 1.01
        );
      })
    ) {
      this.over = { reason: "守卫抓住了蒂娜。请读取存档重试。" };
      this.event("game-over", this.over);
    }
  }
  equip(memberId, slot, contentId) {
    return equip(this, memberId, slot, contentId);
  }
  optimizeEquipment(memberId) {
    return optimizeEquipment(this, memberId);
  }
  equipMagicite(memberId, contentId) {
    return equipMagicite(this, memberId, contentId);
  }
  useItem(contentId, memberId) {
    return useFieldItem(this, contentId, memberId);
  }
  useAbility(abilityId, memberId, targetMemberId = memberId) {
    return useFieldAbility(this, abilityId, memberId, targetMemberId);
  }
  canCamp() {
    return canUseTent(this);
  }
  buy(contentId, count = 1) {
    return buyFromShop(this, contentId, count);
  }
  sell(contentId, count = 1) {
    return sellToShop(this, contentId, count);
  }
  switchParty() {
    if (this.busy || !this.rts?.active) return false;
    executeSyscall(this, { locals: [], pc: 0 }, "RTS：操作パーティ切替", [], []);
    return true;
  }
  canWalk(x, y, layer = this.player.layer) {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
    const terrain = worldCollisionAt(this.map, x, y);
    if (terrain !== undefined) return terrain !== 1;
    const grid = this.map.collisions?.[layer] || this.map.collisions?.[0],
      v = grid?.[Math.floor(y) * this.map.width + Math.floor(x)];
    return v === undefined || v !== 1 || openedDoorTerrainAt(this, x, y, layer);
  }
  canMove(x, y, layer = this.player.layer, mover = this.player) {
    return mover === this.player && this.player.vehicle > 1 && this.map?.worldTerrain
      ? canVehicleMove(this, x, y)
      : this.canWalk(x, y, layer) && !fieldBlockerAt(this, x, y, layer, mover);
  }
  canTraverse(x, y, layer = this.player.layer, direction = null) {
    if (this.canMove(x, y, layer)) return true;
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
    const blocker = fieldBlockerAt(this, x, y, layer);
    // Touch encounters resolve the blocking body through an ordinary bump.
    // Route queries may plan beyond it; canMove still prevents walking through.
    if (
      this.rts?.active &&
      this.canWalk(x, y, layer) &&
      blocker?.entity.kind === 6 &&
      blocker.entity.npc?.moveType === 3 &&
      blocker.entity.script &&
      !fieldBlockerAt(this, x, y, layer, this.player, blocker.entity)
    )
      return true;
    const door = openableDoorAt(this, x, y, layer, direction);
    return Boolean(door && !fieldBlockerAt(this, x, y, layer, this.player, door));
  }
  move(direction) {
    if (this.player.vehicle > 1 && this.map?.worldTerrain) return moveVehicle(this, direction);
    if (this.busy || !this.control || this.player.motion) return false;
    const n = dirs.indexOf(direction);
    if (n < 0) return false;
    this.player.direction = direction;
    this.player.animation = "Walk" + { up: "B", down: "", left: "L", right: "R" }[direction];
    const d = delta[n];
    let x = this.player.x + d[0],
      y = this.player.y + d[1];
    if (this.map.worldTerrain?.loopType & 1) x = (x + this.map.width) % this.map.width;
    if (this.map.worldTerrain?.loopType & 2) y = (y + this.map.height) % this.map.height;
    if (!this.canMove(x, y)) {
      const door = openableDoorAt(this, x, y, this.player.layer, direction);
      if (door) openFieldDoor(this, door);
      if (!this.canMove(x, y)) {
        const blocked = fieldBlockerAt(this, x, y, this.player.layer);
        if (blocked && tryNpcContact(this, blocked.entity)) return false;
        this.walkCache = null;
        if (this.rts?.active) this.checkTriggers();
        return false;
      }
    }
    this.player.x = x;
    this.player.y = y;
    this.stepCount++;
    this.camera.manual = false;
    updateCooperativeInput(this);
    this.checkTriggers();
    if (!this.busy) walkEncounter(this);
    return true;
  }
  checkTriggers({ armedOnly = false } = {}) {
    if (
      this.loading ||
      this.over ||
      this.battle ||
      (armedOnly ? !this.triggerChangesScript : this.busy) ||
      (this.map?.worldTerrain && this.player.vehicle > 1)
    )
      return;
    for (const e of this.entities) {
      const actual = this.actors.get(String(e.id)) || e;
      // Ordinary contacts/portals remain disabled during events. A source
      // explicitly rearming its touch entities also receives callbacks for a
      // stationary player, before its waiting parent evaluates the result.
      if (armedOnly && !(e.kind === 2 && actual.triggerEnabled)) continue;
      if (!fieldEntityVisible(this, e) && !(e.kind === 2 && actual.triggerEnabled)) continue;
      if (
        e.transportationIds?.length &&
        !e.transportationIds.includes(Number(this.player.vehicle || 1))
      )
        continue;
      if (actual.layer != null && actual.layer !== this.player.layer && !e.npc?.allLayers) continue;
      const touchNpc = e.kind === 6 && e.npc?.moveType === 3 && this.rts?.active;
      if (
        Math.abs(actual.x - this.player.x) > (touchNpc ? 1 : 0.6) ||
        Math.abs(actual.y - this.player.y) > (touchNpc ? 1 : 0.6)
      )
        continue;
      const key = `${this.mapId}:${[...this.groups].join(",")}:${e.id}`;
      if (this.triggered.has(key)) continue;
      if ((e.kind === 2 || touchNpc) && e.script) {
        this.triggered.add(key);
        if (touchNpc) (this.banks.MapLocalVariable ??= {})[0] = this.partyIndex;
        const callback = this.startScript(e.script);
        if (armedOnly && callback) {
          this.tasks.splice(this.tasks.indexOf(callback), 1);
          this.tasks.unshift(callback);
        }
        break;
      }
      if (e.kind === 3 && e.destination) {
        this.pending = this.enter(e.destination.mapId, e.destination.entrance);
        break;
      }
      if (e.kind === 4 && e.destinationLayer !== null) {
        this.player.layer = e.destinationLayer;
        break;
      }
    }
  }

  interactionDistance(target, x = this.player.x, y = this.player.y, layer = this.player.layer) {
    if (target.layer != null && target.layer !== layer && !target.npc?.allLayers) return 0;
    if (!acceptsFieldInteraction(target, x, y)) return 0;
    const dx = Math.abs(target.x - x),
      dy = Math.abs(target.y - y);
    if (dx + dy < 0.6 && sameCellFieldInteraction(target)) return 1;
    if (dx + dy === 1) return 1;
    if (
      [5, 6, 7, 8, 10, 17].includes(target.kind) &&
      dx + dy === 2 &&
      (!dx || !dy) &&
      !this.canWalk((x + target.x) / 2, (y + target.y) / 2, layer)
    )
      return 2;
    return 0;
  }
  interact() {
    if (this.busy) return false;
    const n = dirs.indexOf(this.player.direction),
      d = delta[n] || [0, 1];
    // PR kind21 is an explicit same-cell transportation action, such as
    // entering a site from the air. Its source vehicle list owns eligibility.
    const vehicleAction = this.entities.find(
      (e) =>
        e.kind === 21 &&
        e.script &&
        e.layer === this.player.layer &&
        Math.abs(e.x - this.player.x) < 0.6 &&
        Math.abs(e.y - this.player.y) < 0.6 &&
        e.transportationIds?.includes(Number(this.player.vehicle)),
    );
    if (vehicleAction) {
      this.startScript(vehicleAction.script);
      return true;
    }
    for (const distance of [0, 1, 2])
      for (const e of this.entities) {
        if (e.kind === 21 || e.kind === 2) continue;
        const actual = { ...e, ...this.actors.get(String(e.id)) };
        if (!fieldEntityVisible(this, e) || !this.interactionDistance(actual)) continue;
        if (distance === 0 && !sameCellFieldInteraction(actual)) continue;
        if (
          Math.abs(actual.x - this.player.x - d[0] * distance) >= 0.6 ||
          Math.abs(actual.y - this.player.y - d[1] * distance) >= 0.6
        )
          continue;
        if (distance === 2 && this.interactionDistance(actual) !== 2) continue;
        if (e.kind === 7 && e.treasure) return openTreasure(this, e);
        if (dispatchFieldInteraction(this, e, actual, distance)) return true;
        if (e.kind === 8 && openFieldDoor(this, e)) return true;
        if (e.destination && e.kind !== 3) {
          this.pending = this.enter(e.destination.mapId, e.destination.entrance);
          return true;
        }
      }
    if (activeSavePoint(this)) {
      this.event("save-menu");
      return true;
    }
    return false;
  }

  snapshot() {
    return {
      settings: this.settings,
      stepCount: this.stepCount,
      titleScreen: this.titleScreen,
      cooperativeState: this.cooperativeState,
      partyPositions: this.partyPositions,
      rts: this.rts,
      time: this.time,
      visited: this.visited,
      actors: [...this.actors],
      assignedRoutes: [...(this.assignedRouteTasks || [])]
        .filter(([, t]) => !t.done)
        .map(([actor, t]) => ({
          actor,
          route: this.actor(actor).routeId,
          loop: this.actor(actor).routeLoop,
          pc: t.pc,
          wait: t.wait,
          waitFor: t.waitFor,
          locals: t.locals,
        })),
      walkEncounterState: this.walkEncounterState,
      finalBattleOrder: this.finalBattleOrder,
      completedStoryObjectives: this.completedStoryObjectives || [],
      testBoost: this.testBoost,
      mapId: this.mapId,
      player: { ...this.player, motion: null },
      banks: this.banks,
      partySlots: this.partySlots,
      partyIndex: this.partyIndex,
      roster: this.roster,
      inventory: this.inventory,
      gil: this.gil,
      groups: [...this.groups],
      history: this.history,
      battles: this.battles,
    };
  }
  async restore(saved, { testBoost = false } = {}) {
    if (testBoost) saved = structuredClone(saved);
    this.testBoost = !!saved.testBoost;
    await this.enter(saved.mapId, 0);
    this.tasks = [];
    this.afterInit = "";
    Object.assign(this, {
      settings: { ...this.settings, ...saved.settings },
      stepCount: saved.stepCount || 0,
      titleScreen: saved.titleScreen,
      cooperativeState: saved.cooperativeState,
      partyPositions: saved.partyPositions,
      rts: saved.rts,
      time: saved.time ?? this.time,
      visited: saved.visited ?? this.visited,
      walkEncounterState: saved.walkEncounterState,
      finalBattleOrder: saved.finalBattleOrder,
      completedStoryObjectives: saved.completedStoryObjectives || [],
      banks: saved.banks,
      partySlots: saved.partySlots,
      partyIndex: saved.partyIndex,
      roster: saved.roster,
      inventory: saved.inventory,
      gil: saved.gil,
      history: saved.history,
      battles: saved.battles,
    });
    Object.assign(this.player, saved.player);
    this.groups = new Set(saved.groups);
    if (saved.actors)
      this.actors = new Map(
        saved.actors.map(([key, original]) => {
          const actor = { ...original };
          const id = -Number(key),
            canonical = id > 0 && fieldCharacterAsset(this.data, id);
          if (id > 0 && actor.kind === 10 && actor.asset !== canonical) {
            const candidates = Object.entries(this.map.groups || {})
              .filter(([group]) => this.groups.has(group))
              .flatMap(([, group]) => group.entities || [])
              .filter(
                (entity) =>
                  !Number.isFinite(Number(entity.id)) &&
                  entity.kind === actor.kind &&
                  entity.asset === actor.asset,
              );
            const exact = candidates.filter(
              (entity) => entity.x === actor.x && entity.y === actor.y,
            );
            const source =
              exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
            if (source) return [String(source.id), { ...actor, id: source.id }];
          }
          // Repair only the old nonexistent numeric fallback, preserving authored
          // costumes/vehicles and without rewriting the caller's saved object.
          return [
            key,
            canonical && actor.asset === `mo_ff6_p${String(id).padStart(3, "0")}`
              ? { ...actor, asset: canonical }
              : actor,
          ];
        }),
      );
    this.refreshActors({ preserveMissing: !!saved.actors });
    if (!saved.actors) this.startScript(this.map.initializer, { init: true });
    for (const cursor of saved.assignedRoutes || []) {
      executeInstruction(this, { pc: 0 }, "AssignMoveRoute", [
        cursor.actor,
        cursor.route,
        Number(cursor.loop),
      ]);
      const task = this.assignedRouteTasks.get(cursor.actor);
      if (task)
        Object.assign(task, {
          pc: cursor.pc,
          wait: cursor.wait,
          waitFor: cursor.waitFor,
          locals: cursor.locals,
        });
    }
    if (testBoost) {
      this.testBoost = true;
      for (const unit of Object.values(this.roster)) applyTestBoost(unit);
      this.event("test-mode", { mode: "story-test" });
    }
  }
}
