import type {
  Direction,
  FieldContent,
  FieldEntity,
  Op,
  Point,
  Site,
} from "../field/types.js";
export const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
// MapConstants.CollisionFilter, source-bound by the compiler. Collision bits differ from facing bits.
const FILTER = [15, 0, 14, 11, 7, 13, 6, 9];
const BIT: Record<Direction, number> = { up: 1, left: 2, right: 4, down: 8 };
const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  left: "right",
  right: "left",
  down: "up",
};
export type Motion = {
  from: Point;
  to: Point;
  elapsed: number;
  duration: number;
  manual: boolean;
};
export type Actor = Point & {
  id: string;
  layer: number;
  direction: Direction;
  asset: string;
  mount: string | null;
  motion: Motion | null;
  steps: number;
};
type Task = {
  id: number;
  script: string;
  pc: number;
  stack: number[];
  actor: string;
  wait: number;
  children: number[];
  pending: { slot: number; actor: string; target: number }[];
  remaining: number;
  move: Extract<Op, { kind: "move" }> | null;
  done: boolean;
};
export type Stop = {
  kind: "unsupported" | "encounter";
  message: string;
  site: Site | null;
  party?: number;
  continuation?: string;
};
export type Dialogue = {
  speaker: string;
  text: string;
  key: string;
  task: number;
};
const contains = (e: FieldEntity, p: Point) =>
  p.x >= e.x && p.x < e.x + e.width && p.y >= e.y && p.y < e.y + e.height;
export class FieldGame {
  readonly actors: Record<string, Actor> = {};
  dialogue: Dialogue | null = null;
  stop: Stop | null = null;
  time = 0;
  private tasks: Task[] = [];
  private remainder = 0;
  private nextTask = 1;
  constructor(readonly content: FieldContent) {
    const p = content.entry.player;
    this.actors["-1001"] = { ...p, id: "-1001", motion: null, steps: 0 };
    for (const e of content.map.entities)
      if (e.kind === 6 && e.asset)
        this.actors[e.id] = {
          id: e.id,
          x: e.x,
          y: e.y,
          layer: e.layer,
          direction: e.direction,
          asset: e.asset,
          mount: null,
          motion: null,
          steps: 0,
        };
  }
  get player(): Actor {
    return this.actors["-1001"]!;
  }
  get busy(): boolean {
    return this.tasks.some((t) => !t.done) || !!this.dialogue || !!this.stop;
  }
  private block(message: string, site: Site | null = null) {
    this.stop = { kind: "unsupported", message, site };
  }
  private collision(p: Point, layer: number): number | null {
    const m = this.content.map;
    if (p.x < 0 || p.y < 0 || p.x >= m.width || p.y >= m.height) return 0;
    const grid = m.collisions[layer],
      cell = grid?.[p.y * m.width + p.x];
    if (cell === undefined || FILTER[cell] === undefined) {
      this.block(`尚未支持碰撞类型 ${String(cell)}`);
      return null;
    }
    let mask = FILTER[cell]!;
    for (const e of m.entities)
      if (e.kind === 19 && e.layer === layer && contains(e, p)) {
        if (e.collision === null || FILTER[e.collision] === undefined) {
          this.block("尚未支持的动态碰撞", {
            script: "collision",
            index: 0,
            source: e.source,
          });
          return null;
        }
        mask &= FILTER[e.collision]!;
      }
    return mask;
  }
  move(direction: Direction): boolean {
    const p = this.player;
    if (this.busy || p.motion) return false;
    p.direction = direction;
    const d = DELTA[direction],
      to = { x: p.x + d.x, y: p.y + d.y };
    const fromMask = this.collision(p, p.layer),
      toMask = this.collision(to, p.layer);
    if (
      fromMask === null ||
      toMask === null ||
      !(fromMask & BIT[direction]) ||
      !(toMask & BIT[OPPOSITE[direction]])
    )
      return false;
    if (
      Object.values(this.actors).some(
        (a) =>
          a.id !== p.id && a.layer === p.layer && a.x === to.x && a.y === to.y,
      )
    )
      return false;
    p.motion = {
      from: { x: p.x, y: p.y },
      to,
      elapsed: 0,
      duration: 240,
      manual: true,
    };
    return true;
  }
  confirm(): void {
    if (this.stop) return;
    if (this.dialogue) {
      this.dialogue = null;
      this.pump();
      return;
    }
    if (this.busy || this.player.motion) return;
    const p = this.player,
      d = DELTA[p.direction],
      target = { x: p.x + d.x, y: p.y + d.y };
    const e = this.content.map.entities.find(
      (e) =>
        e.layer === p.layer &&
        e.script &&
        contains(e, target) &&
        [6, 8].includes(e.kind),
    );
    if (e)
      this.block("此交互尚未迁移", {
        script: e.script!,
        index: 0,
        source: e.source,
      });
  }
  /** Integer 10 ms simulation steps make render-frame partitioning irrelevant. */
  advance(milliseconds: number): void {
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds < 0 ||
      milliseconds > 60000
    )
      throw new Error("Invalid elapsed time");
    this.remainder += milliseconds;
    while (this.remainder >= 10) {
      this.remainder -= 10;
      if (this.stop) continue;
      this.time += 10;
      let entered = false;
      for (const a of Object.values(this.actors)) {
        const m = a.motion;
        if (!m) continue;
        m.elapsed += 10;
        if (m.elapsed >= m.duration) {
          a.x = m.to.x;
          a.y = m.to.y;
          a.motion = null;
          a.steps++;
          if (m.manual) entered = true;
        }
      }
      for (const t of this.tasks) t.wait = Math.max(0, t.wait - 10);
      if (entered) this.enter();
      this.pump();
    }
  }
  private enter(): void {
    const p = this.player,
      hits = this.content.map.entities.filter(
        (e) => e.layer === p.layer && contains(e, p),
      );
    const transitions = hits.filter((e) => e.kind === 4);
    if (transitions.length > 1) {
      this.block("层切换目标不明确");
      return;
    }
    if (transitions[0]) {
      const next = transitions[0].destinationLayer;
      if (next === null || !this.content.map.collisions[next]) {
        this.block("未支持的地图层");
        return;
      }
      p.layer = next;
    }
    const events = hits.filter((e) => e.kind === 2 || e.kind === 3);
    if (events.length > 1) {
      this.block("同格触发器顺序尚未验证");
      return;
    }
    const e = events[0];
    if (!e) return;
    if (e.kind === 3) {
      this.block("跨地图尚未迁移", {
        script: e.script ?? "map-transition",
        index: 0,
        source: e.source,
      });
      return;
    }
    if (!e.script || !this.content.scripts[e.script]) {
      this.block("缺少事件脚本");
      return;
    }
    this.tasks = [this.task(e.script, 0, "-1001")];
    this.pump();
  }
  private task(script: string, pc: number, actor: string): Task {
    return {
      id: this.nextTask++,
      script,
      pc,
      actor,
      stack: [],
      wait: 0,
      children: [],
      pending: [],
      remaining: 0,
      move: null,
      done: false,
    };
  }
  private pump(): void {
    if (this.stop || this.dialogue) return;
    for (let budget = 0; budget < 512; budget++) {
      let changed = false;
      for (const t of [...this.tasks]) {
        if (t.done || t.wait > 0) continue;
        const actor = this.actors[t.actor];
        if (!actor) {
          this.block(`缺少角色 ${t.actor}`);
          return;
        }
        if (actor.motion) continue;
        if (t.children.some((id) => !this.tasks.find((c) => c.id === id)?.done))
          continue;
        t.children = [];
        if (t.move && t.remaining > 0) {
          const d = DELTA[t.move.direction];
          actor.direction = t.move.direction;
          actor.motion = {
            from: { x: actor.x, y: actor.y },
            to: { x: actor.x + d.x, y: actor.y + d.y },
            duration: Math.round(t.move.secondsPerCell * 1000),
            elapsed: 0,
            manual: false,
          };
          t.remaining--;
          changed = true;
          continue;
        }
        t.move = null;
        const op = this.content.scripts[t.script]?.[t.pc];
        if (!op) {
          this.block(`无效脚本位置 ${t.script}:${t.pc}`);
          return;
        }
        t.pc++;
        changed = true;
        switch (op.kind) {
          case "nop":
            break;
          case "exit":
            t.done = true;
            break;
          case "return": {
            const pc = t.stack.pop();
            if (pc === undefined) {
              this.block("空调用栈", op);
              return;
            }
            t.pc = pc;
            break;
          }
          case "call":
            if (t.stack.length >= 64) {
              this.block("脚本递归超过限制", op);
              return;
            }
            t.stack.push(t.pc);
            t.pc = op.target;
            break;
          case "wait":
            t.wait = Math.ceil(op.seconds * 100);
            t.wait *= 10;
            break;
          case "puppet":
            if (t.pending.some((p) => p.slot === op.slot)) {
              this.block("重复的角色演出槽", op);
              return;
            }
            t.pending.push(op);
            break;
          case "join":
            for (const p of t.pending.sort((a, b) => a.slot - b.slot)) {
              const c = this.task(t.script, p.target, p.actor);
              if (
                !this.actors[p.actor] ||
                this.tasks.some(
                  (other) =>
                    !other.done && other.id !== t.id && other.actor === p.actor,
                )
              ) {
                this.block("角色演出归属冲突", op);
                return;
              }
              this.tasks.push(c);
              t.children.push(c.id);
            }
            t.pending = [];
            break;
          case "position":
            if (
              op.animation !== "" &&
              op.animation !== "Default" &&
              !this.content.characters[actor.asset]?.animations[op.animation]
            ) {
              this.block("尚未支持角色动画 " + op.animation, op);
              return;
            }
            actor.x = op.x;
            actor.y = op.y;
            break;
          case "move":
            t.move = op;
            t.remaining = op.steps;
            break;
          case "look":
            actor.direction = op.direction;
            break;
          case "message":
            this.dialogue = {
              speaker: op.speaker,
              text: op.text,
              key: op.key,
              task: t.id,
            };
            return;
          case "encounter":
            this.stop = {
              kind: "encounter",
              message: "已到达战斗入口。战斗系统尚未迁移。",
              site: op,
              party: op.party,
              continuation: op.continuation,
            };
            return;
          case "blocked":
            this.block(`${op.mnemonic}：${op.reason}`, op);
            return;
        }
      }
      if (!changed) return;
    }
    this.block("脚本在一个逻辑步中未让出执行权");
  }
}
