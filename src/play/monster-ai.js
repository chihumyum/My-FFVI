// Executes the PR MonsterAI instruction stream. SNES supplies command meaning, never AI data.
export const MONSTER_AI_OPS = new Set(
  `Act ActForTarget AttackAfterMes Blank CounterAct CounterActAll CounterActAttribute CounterActAttributeMultiAbility CounterActByAbility CounterActByForAiTypeId CounterActByHit CounterActRandom CounterActReceiveCommand CounterPlayerAct DamagedCounterAct DamagedJump DeleteExecMsg EndTable ExecMsg Exit FinalAttackAct FinalLoopAttackAct FirstAttackAct FirstLoopAttackAct IsCheckEnemyConditionAllReflex IsCheckHp IsCheckMonsterPTId IsCheckMp IsCheckPlayerConditionAll IsCheckPlayerId IsCheckReceiveCommand IsCheckUnitStatus IsCondition IsConditionAct IsCounterTypeId IsEnemyAttackJump IsEnemyUnitIndex IsGroupAlive IsLevelCheck IsMyCondition IsNotCondition IsOnlyAlive IsReceiveCommand IsRecevieAbility IsRecevieAbilitySystem IsRecevieAttackByHit IsRecevieItem IsReverseAttribute IsReverseUnit IsTimerJump IsUnitAddCondition IsUnitAlive IsUnitAliveCount IsUsedConditionTargetAct IsVariableComparison IsWeakCheck JumpBattleAI LoopAct ModeCount ModeSet MonsterActRemove MsgClose Nop StartTable SyncAI TimerAddValiable TimerAttackAct ValueCalc VariableAssign`.split(
    " ",
  ),
);
export function aiCompare(a, op, b) {
  switch (op) {
    case "≠":
    case "!=":
      return a !== b;
    case "＜":
    case "<":
      return a < b;
    case "＞":
    case ">":
      return a > b;
    case "≦":
    case "<=":
      return a <= b;
    case "≧":
    case ">=":
      return a >= b;
    case "＆":
    case "&":
      return !!(a & b);
    default:
      return a === b;
  }
}
function calc(a, op, b) {
  switch (op) {
    case "＋":
    case "+":
      return (a + b) | 0;
    case "－":
    case "-":
      return (a - b) | 0;
    case "×":
    case "*":
      return Math.imul(a, b);
    case "÷":
    case "/":
      return b ? Math.trunc(a / b) : 0;
    case "｜":
    case "|":
      return a | b;
    case "＆":
    case "&":
      return a & b;
    default:
      return b | 0;
  }
}
export class MonsterAI {
  constructor(battle, unit, program) {
    this.battle = battle;
    this.unit = unit;
    this.program = program || {
      name: unit.aiName || "missing",
      ops: [["SyncAI"], ["Act", [1], [100]], ["JumpBattleAI", [0]]],
    };
    this.pc = 0;
    this.vars = Array(15).fill(0);
    this.mode = 0;
    this.table = -1;
    this.row = 0;
    this.rowCount = 0;
    this.firstDone = false;
    this.finalDone = false;
    this.waiting = false;
    this.pending = [];
    this.timerBase = battle.elapsed;
    this.timerWake = battle.elapsed;
    this.clockAt = battle.elapsed;
    this.timerDelay = Math.min(
      Infinity,
      ...this.program.ops
        .filter((o) => o[0] === "IsTimerJump")
        .map((o) => o[2][0])
        .filter((n) => n > 0),
    );
    this.visits = new Set();
    this.wakes = 0;
    this.actions = 0;
    unit.aiState = this;
    if (!program) this.warn("PR AI program is missing; using Fight each turn.", 0);
    this.begin("initial", {});
  }
  warn(message, pc = this.pc - 1) {
    this.battle.warning(`AI ${this.program.name}:${pc}: ${message}`);
  }
  get normal() {
    return ["normal", "timer"].includes(this.kind);
  }
  get received() {
    return ["reaction", "observer", "final"].includes(this.kind);
  }
  get hit() {
    return (
      this.received &&
      this.incoming?.target === this.unit &&
      this.incoming.hit !== false
    );
  }
  get damaged() {
    return this.hit && this.incoming.amount > 0;
  }
  get counter() {
    return this.hit && this.kind !== "final" && this.unit.hp > 0;
  }
  condition(unit, id) {
    return (
      (unit.conditions || []).includes(id) ||
      (id === 5 && unit.hp <= 0) ||
      (id === 67 && unit.hidden)
    );
  }
  units(side = 2, mask = 0) {
    const list = side === 1 ? this.battle.players : this.battle.enemies;
    return list.filter(
      (u, n) =>
        !mask || Boolean(mask & (1 << (side === 1 ? n : (u.slot ?? n)))),
    );
  }
  branch(condition, pc) {
    if (condition) this.pc = Number(pc) || 0;
  }
  messages(keys) {
    for (const key of keys || [])
      if (key)
        this.battle.addLog(
          this.battle.data.messages?.[key]
            ?.replaceAll("\\n", "\n")
            .replace(/<[^>]+>/g, "") || key,
        );
  }
  choose(ids, weights) {
    const choices = ids
      .map((id, n) => ({ id, weight: Math.max(0, Number(weights?.[n] ?? 1)) }))
      .filter((c) => c.id > 0 && c.weight > 0);
    if (!choices.length) return null;
    let roll = this.battle.random() * choices.reduce((n, c) => n + c.weight, 0);
    return (choices.find((c) => (roll -= c.weight) < 0) || choices.at(-1)).id;
  }
  emit(
    ids,
    weights,
    {
      kind = "normal",
      target = null,
      all = false,
      loop = false,
      messages = [],
    } = {},
  ) {
    if (
      (kind === "normal" && !this.normal) ||
      (kind === "counter" && !this.counter) ||
      (kind === "final" && this.kind !== "final") ||
      (kind === "first" && (!this.normal || this.firstDone))
    )
      return;
    const list = loop
      ? ids.flatMap((id, n) =>
          Array(Math.min(32, Math.max(0, Math.trunc(weights?.[n] ?? 1)))).fill(
            id,
          ),
        )
      : [this.choose(ids, weights)];
    for (const id of list)
      if (id > 0)
        this.output.push({
          actor: this.unit,
          abilityId: id,
          target,
          all,
          script: this.program.name,
          index: this.pc - 1,
          messages,
          final: kind === "final",
          first: kind === "first",
        });
  }
  rowAction(ids, r, options = {}) {
    const selected = this.row === this.rowCount++;
    if (this.normal && selected) this.emit(ids, r, options);
  }
  wake(kind = "normal", event = {}) {
    if (kind === "final") {
      if (this.finalDone) return;
      this.finalDone = true;
    }
    if (this.running) {
      if (this.pending.length < 16) this.pending.push([kind, event]);
      else this.warn("Reaction queue limit reached; repeated chain discarded.");
      return;
    }
    this.begin(kind, event);
  }
  begin(kind, event) {
    this.kind = kind;
    this.incoming = event;
    this.output = [];
    this.rowCount = 0;
    this.wakes++;
    this.running = true;
    if (this.waiting) {
      this.pc++;
      this.waiting = false;
    }
    this.run();
  }
  tick() {
    const paused = this.battle.events?.paused || this.battle.events?.enemySleeping ||
      this.unit.hidden || this.unit.removed || this.unit.escaped;
    const elapsed = Math.max(0, this.battle.elapsed - this.clockAt);
    this.clockAt = this.battle.elapsed;
    if (paused) { this.timerBase += elapsed; this.timerWake += elapsed; }
    if (this.running && this.resumeAt <= this.battle.elapsed) {
      this.resumeAt = 0;
      this.run();
    }
    if (!this.running && this.pending.length) {
      const [k, e] = this.pending.shift();
      this.begin(k, e);
    }
    const delay = this.timerDelay;
    if (
      !this.running &&
      !paused &&
      this.unit.hp > 0 &&
      this.battle.elapsed - this.timerWake >= delay
    ) {
      this.timerWake = this.battle.elapsed;
      this.wake("timer");
    }
  }
  flush() {
    let actions = this.output;
    const first = actions.filter((a) => a.first);
    if (first.length) {
      actions = first.concat(actions.filter((a) => a.final));
      this.firstDone = true;
    } else if (this.normal) this.firstDone = true;
    for (const action of actions.slice(0, 64)) {
      if (this.received) action.depth = (this.incoming?.depth || 0) + 1;
      this.actions++;
      this.battle.queueAIAction(action);
    }
    if (actions.length > 64)
      this.warn("Action sequence capped at 64 to keep the battle responsive.");
    this.output = [];
    this.running = false;
  }
  run() {
    let steps = 0;
    while (this.running && steps++ < 1024) {
      const pc = this.pc++,
        op = this.program.ops[pc];
      if (!op) {
        this.flush();
        this.pc = 0;
        this.waiting = false;
        return;
      }
      const [name, i = [], r = [], s = []] = op;
      this.visits.add(name);
      const u = this.unit,
        b = this.battle,
        a = this.incoming?.ability || {},
        evt = this.incoming || {},
        own = this.units(2).filter((x) => x.hp > 0 && !x.removed),
        players = this.units(1).filter((x) => x.hp > 0 && !x.removed);
      switch (name) {
        case "Nop":
          break;
        case "Blank":
          this.resumeAt = b.elapsed + 1 / 60;
          return;
        case "SyncAI":
          this.pc = pc;
          this.waiting = true;
          this.flush();
          return;
        case "Exit":
          this.flush();
          this.pc = 0;
          this.waiting = false;
          return;
        case "JumpBattleAI":
          this.pc = i[0];
          break;
        case "StartTable":
          if (this.table !== i[0]) {
            this.table = i[0];
            this.row = 0;
          }
          this.rowCount = 0;
          break;
        case "EndTable":
          if (this.normal && this.rowCount)
            this.row = (this.row + 1) % this.rowCount;
          break;
        case "VariableAssign":
          this.vars[Math.max(0, i[0])] = i[1] | 0;
          break;
        case "ValueCalc":
          this.vars[Math.max(0, i[0])] = calc(
            this.vars[Math.max(0, i[0])] || 0,
            s[0],
            i[1],
          );
          break;
        case "ModeSet":
          this.mode = i[0] | 0;
          break;
        case "ModeCount":
          this.mode++;
          break;
        case "IsVariableComparison":
          this.branch(
            aiCompare(this.vars[Math.max(0, i[0])] || 0, s[0], i[1]),
            i[2],
          );
          break;
        case "IsCheckHp":
        case "IsCheckMp":
          this.branch(
            aiCompare(name === "IsCheckHp" ? u.hp : u.mp, s[0], i[0]),
            i[1],
          );
          break;
        case "IsMyCondition":
          this.branch(this.condition(u, i[0]), i[1]);
          break;
        case "IsNotCondition":
          this.branch(!this.condition(u, i[0]), i[1]);
          break;
        case "IsOnlyAlive":
          this.branch(own.length === 1 && own[0] === u, i[0]);
          break;
        case "IsGroupAlive":
          this.branch(
            new Set(own.map((x) => x.monsterId ?? x.id)).size === 1,
            i[0],
          );
          break;
        case "IsUnitAliveCount":
          this.branch(
            aiCompare(i[0] === 1 ? players.length : own.length, s[0], i[1]),
            i[2],
          );
          break;
        case "IsUnitAlive": {
          const pool = this.units(i[0], i[1]);
          this.branch(
            pool.length > 0 &&
              pool.every((x) => (i[3] === 2 ? x.hp <= 0 : x.hp > 0)),
            i[2],
          );
          this.warn(
            "IsUnitAlive mode 2 means selected units are fallen; other modes mean alive.",
            pc,
          );
          break;
        }
        case "IsEnemyUnitIndex":
          this.branch((u.slot ?? u.index) + 1 === i[0], i[1]);
          this.warn(
            "Enemy unit index uses the PR one-based formation slot.",
            pc,
          );
          break;
        case "IsCheckMonsterPTId":
          this.branch(b.encounterId === i[0], i[1]);
          break;
        case "IsCheckPlayerId":
          this.branch(
            b.players.some((x) => x.id === i[0]),
            i[1],
          );
          break;
        case "IsLevelCheck":
          this.branch(
            this.normal && this.units(i[0]).some((x) => x.level >= i[1]),
            i[2],
          );
          break;
        case "IsTimerJump":
          if (b.elapsed - this.timerBase >= Math.max(0, r[0] || 0)) {
            this.pc = i[0];
            this.timerBase = b.elapsed;
          }
          break;
        case "TimerAddValiable": {
          const elapsed = Math.floor(b.elapsed - this.timerBase);
          this.vars[i[1]] = (this.vars[i[1]] || 0) + elapsed * (i[0] || 1);
          this.timerBase = b.elapsed;
          this.warn(
            "TimerAddValiable adds elapsed whole seconds times i0 to variable i1.",
            pc,
          );
          break;
        }
        case "IsRecevieAbility":
          this.branch(this.received && a.id === i[0], i[1]);
          break;
        case "IsRecevieAbilitySystem":
          this.branch(this.received && a.systemId === i[0], i[1]);
          break;
        case "IsReceiveCommand":
        case "IsCheckReceiveCommand":
          if (i.length <= 2 && r.some((x) => x > 0)) {
            if (this.received && a.typeId === i[0])
              this.emit(i.slice(1), r.slice(1), {
                kind: "counter",
                target: evt.actor,
              });
          } else this.branch(this.received && a.typeId === i[0], i[1]);
          break;
        case "IsCounterTypeId":
          this.branch(this.counter && a.typeId === i[0], i[1]);
          break;
        case "IsRecevieAttackByHit":
          this.branch(this.hit, i[0]);
          break;
        case "DamagedJump":
          this.branch(this.damaged, i[0]);
          break;
        case "IsRecevieItem":
          this.branch(
            this.hit && evt.item?.itemId === i[0],
            i[1],
          );
          break;
        case "IsReverseAttribute":
          this.branch(this.received && (a.elements || []).includes(i[0]), i[1]);
          break;
        case "IsEnemyAttackJump":
          // These PR branches sit after the monster's Act rows and update
          // its own turn counter (Guardian, Ultros and Chadarnook), rather
          // than testing whether another monster attacked this combatant.
          this.branch(this.normal, i[0]);
          this.warn('IsEnemyAttackJump tests the acting monster normal/timer phase; inferred from PR post-Act counters and SNES turn counters.', pc);
          break;
        case "IsReverseUnit":
          this.branch(
            this.received && this.units(i[0], i[1]).includes(evt.actor),
            i[2],
          );
          break;
        case "IsWeakCheck":
          this.branch(u.elementResistances?.[i[0]] === 1, i[1]);
          break;
        case "IsCheckEnemyConditionAllReflex":
          this.branch(
            own.length > 0 && own.every((x) => this.condition(x, 24)),
            i[0],
          );
          break;
        case "IsCheckPlayerConditionAll":
          this.branch(
            players.length > 0 && players.every((x) => this.condition(x, i[0])),
            i[1],
          );
          break;
        case "IsCondition": {
          const pool = this.units(i[0], i[1]);
          this.branch(
            pool.some((x) => this.condition(x, i[2])) === (i[4] !== 2),
            i[3],
          );
          this.warn(
            "IsCondition tests the selected PR slot mask; mode 2 negates.",
            pc,
          );
          break;
        }
        case "IsCheckUnitStatus":
          this.branch(
            this.units(i[0]).some((x) => this.condition(x, i[1])) ===
              (i[2] !== 2),
            i[3],
          );
          this.warn(
            "IsCheckUnitStatus tests any unit on the selected side.",
            pc,
          );
          break;
        case "Act":
          this.rowAction(i, r, { messages: s });
          break;
        case "LoopAct":
          this.rowAction(i, r, { loop: true, messages: s });
          break;
        case "ActForTarget":
          this.rowAction([i[2]], [100], {
            target: this.units(i[0], i[1]),
            messages: s,
          });
          break;
        case "FirstAttackAct":
          this.emit(i, r, { kind: "first", messages: s });
          break;
        case "FirstLoopAttackAct":
          this.emit(i, r, { kind: "first", loop: true, messages: s });
          break;
        case "FinalAttackAct":
          this.emit(i, r, { kind: "final", messages: s });
          break;
        case "FinalLoopAttackAct":
          this.emit(i, r, { kind: "final", loop: true, messages: s });
          break;
        case "CounterAct":
          this.emit(i, r, { kind: "counter", target: evt.actor, messages: s });
          break;
        case "CounterActRandom":
          this.emit(i, r, { kind: "counter", messages: s });
          break;
        case "CounterActAll":
          this.emit(i, r, { kind: "counter", all: true, messages: s });
          break;
        case "CounterActReceiveCommand":
          if (a.typeId === i[0])
            this.emit(i.slice(1), r.slice(1), { kind: "counter", messages: s });
          break;
        case "CounterActByAbility":
          if (a.id === i[0])
            this.emit(i.slice(1), r.slice(1), {
              kind: "counter",
              target: evt.actor,
              messages: s,
            });
          break;
        case "CounterActByForAiTypeId":
          if (a.typeId === i[0])
            this.emit([i[1]], [100], {
              kind: "counter",
              target: evt.actor,
              messages: s,
            });
          break;
        case "CounterActAttribute":
          if ((a.elements || []).includes(i[0]))
            this.emit([i[1]], [100], {
              kind: "counter",
              target: evt.actor,
              messages: s,
            });
          break;
        case "CounterActAttributeMultiAbility":
          if ((a.elements || []).includes(i[0]))
            this.emit(i.slice(1), r.slice(1), {
              kind: "counter",
              target: evt.actor,
              messages: s,
            });
          break;
        case "CounterActByHit":
          if (this.hit)
            this.emit(i, r, {
              kind: "counter",
              target: evt.actor,
              messages: s,
            });
          break;
        case "DamagedCounterAct":
          if (this.damaged)
            this.emit(i, r, {
              kind: "counter",
              target: evt.actor,
              messages: s,
            });
          break;
        case "CounterPlayerAct":
          if (this.kind === "observer" && evt.actor?.side === "player") {
            const id = this.choose(i, r);
            if (id)
              this.output.push({
                actor: u,
                abilityId: id,
                target: evt.actor,
                script: this.program.name,
                index: pc,
                messages: s,
              });
          }
          break;
        case "TimerAttackAct":
          if (this.normal && b.elapsed - this.timerBase >= (i[0] || 0)) {
            this.emit(i.slice(1), r.slice(1), { messages: s });
            this.timerBase = b.elapsed;
          }
          break;
        case "IsConditionAct": {
          const target = this.units(i[0]).find((x) => this.condition(x, i[1]));
          if (target) this.rowAction([i[2]], [100], { target, messages: s });
          break;
        }
        case "IsUnitAddCondition": {
          const target = this.units(i[0]).find((x) => this.condition(x, i[1]));
          if (target && this.received)
            this.emit([i[2]], [100], { kind: "counter", target, messages: s });
          this.warn(
            "IsUnitAddCondition targets the first matching status on its PR side.",
            pc,
          );
          break;
        }
        case "IsUsedConditionTargetAct": {
          const target = players.find((x) => (x.conditions || []).length);
          if (target) this.rowAction([i[0]], [100], { target, messages: s });
          else this.rowAction([i[1]], [100], { messages: s });
          this.warn(
            "Condition-target action chooses a currently afflicted player.",
            pc,
          );
          break;
        }
        case "MonsterActRemove":
          this.battle.aiQueue = this.battle.aiQueue.filter(
            (x) => x.actor !== u,
          );
          this.warn(
            "MonsterActRemove clears this monster queued actions; selector-specific cancellation is approximated.",
            pc,
          );
          break;
        case "AttackAfterMes":
          this.afterMessages = s.filter(Boolean);
          break;
        case "ExecMsg":
          if (this.normal || this.kind === "final")
            this.messages(this.afterMessages);
          this.messageSettings = { i: [...i], r: [...r] };
          break;
        case "DeleteExecMsg":
          this.afterMessages = [];
          break;
        case "MsgClose":
          this.battle.event?.("battle-message-close", {});
          break;
        default:
          this.warn(`Unknown instruction ${name}; continued.`, pc);
          break;
      }
    }
    if (this.running) {
      this.warn(
        "Instruction loop yielded after 1024 steps; using Fight and resuming at SyncAI.",
      );
      this.output.push({
        actor: this.unit,
        abilityId: 1,
        script: this.program.name,
        index: this.pc - 1,
      });
      this.pc = Math.max(
        0,
        this.program.ops.findIndex((o) => o[0] === "SyncAI"),
      );
      this.waiting = true;
      this.flush();
    }
  }
}
