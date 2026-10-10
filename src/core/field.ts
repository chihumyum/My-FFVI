import type {
  Direction,
  FieldContent,
  FieldEntity,
  Op,
  Point,
  Site,
  MapRequest,
} from "../field/types.js";
import { EventState, executeEventControl } from "./event-state.js";
import { requireMinimapMedia } from "./minimap.js";
import { BgmState } from "./bgm.js";
import {
  buildCollisionMapping,
  collisionMask,
  diagonalBit,
  fieldCollisionRange,
  inCollisionRange,
  redirectAtSlope,
  type CollisionRange,
} from "./collision.js";
export const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};
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
export type MapTransitionStop = {
  kind: "map-transition";
  message: string;
  site: Site | null;
  request: MapRequest;
};
export type Stop =
  | MapTransitionStop
  | {
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
  readonly collisionRange: CollisionRange;
  private readonly collisionMappings = new Map<number, number[]>();
  readonly actors: Record<string, Actor> = {};
  readonly hiddenEntities = new Set<string>();
  readonly activeGroups = new Set<string>();
  private readonly entityList: FieldEntity[];
  private readonly defaultProperties: readonly FieldEntity[];
  private currentProperties: readonly FieldEntity[];
  get entities(): readonly FieldEntity[] {
    return this.entityList;
  }
  /** Source minimap queries current properties (default + latest event group), not all spawned bodies. */
  get minimapEntities(): readonly FieldEntity[] {
    return this.currentProperties;
  }
  get flags(): Record<string, Record<string, boolean>> {
    return this.eventState.flagView();
  }
  readonly presentationOmissions: {
    site: Site;
    kind: "sound" | "sound-sync";
    soundId: number | null;
  }[] = [];
  fade: { elapsed: number; duration: number } | null = null;
  dialogue: Dialogue | null = null;
  stop: Stop | null = null;
  time = 0;
  private tasks: Task[] = [];
  private remainder = 0;
  private nextTask = 1;
  constructor(
    readonly content: FieldContent,
    readonly eventState: EventState = new EventState(),
    readonly bgm: BgmState = new BgmState(),
  ) {
    this.entityList = [...content.map.entities];
    const groups = content.map.groups,
      initial = content.map.initialGroups;
    this.defaultProperties =
      groups && initial
        ? initial.includes("entity_default")
          ? groups.entity_default!.entities
          : []
        : [...this.entityList];
    const latest = initial?.filter((name) => name !== "entity_default").at(-1);
    this.currentProperties =
      groups && latest
        ? [...this.defaultProperties, ...groups[latest]!.entities]
        : this.defaultProperties;
    if (this.entityList.some((e) => e.kind === 18))
      requireMinimapMedia(this.entityList, content.minimap);
    this.collisionRange = fieldCollisionRange(
      content.map.width,
      content.map.height,
      this.entityList,
    );
    for (const name of content.map.initialGroups ?? [])
      this.activeGroups.add(name);
    const p = content.entry.player;
    this.actors["-1001"] = { ...p, id: "-1001", motion: null, steps: 0 };
    this.registerActors(this.entityList);
  }
  private registerActors(entities: readonly FieldEntity[]): void {
    for (const e of entities)
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
  /** Source SetEventEntityGroup appends entities; it does not replace existing groups. */
  private activateGroup(name: string): void {
    const group = this.content.map.groups?.[name];
    if (!group) throw new Error(`缺少实体组 ${name}`);
    if (this.activeGroups.has(name))
      throw new Error(`重复实体组激活尚未恢复：${name}`);
    if (group.blockers.length)
      throw new Error(`${name}：${group.blockers[0]!.reason}`);
    if (group.entities.some((e) => e.kind === 18))
      requireMinimapMedia(group.entities, this.content.minimap);
    const ids = new Set(this.entityList.map((e) => e.id));
    ids.add("-1001");
    for (const e of group.entities) {
      if (ids.has(e.id)) throw new Error(`实体身份冲突 ${e.id}`);
      ids.add(e.id);
    }
    // Validate the entire group before any actor, collision, or trigger becomes visible.
    this.entityList.push(...group.entities);
    this.registerActors(group.entities);
    this.activeGroups.add(name);
    this.currentProperties = [...this.defaultProperties, ...group.entities];
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
  private dynamicCollision(p: Point, layer: number): number | null {
    let mask = 15;
    for (const e of this.entityList)
      if (
        !this.hiddenEntities.has(e.id) &&
        e.kind === 19 &&
        e.layer === layer &&
        contains(e, p)
      ) {
        if (
          e.collision === null ||
          !Number.isInteger(e.collision) ||
          e.collision < 0 ||
          e.collision > 7
        ) {
          this.block("尚未支持的动态碰撞", {
            script: "collision",
            index: 0,
            source: e.source,
          });
          return null;
        }
        mask &= collisionMask(e.collision);
      }
    return mask;
  }
  private collision(p: Point, layer: number): number | null {
    if (!inCollisionRange(p, this.collisionRange)) return 0;
    const cell =
      this.content.map.collisions[layer]?.[p.y * this.content.map.width + p.x];
    try {
      const mask = collisionMask(cell as number),
        dynamic = this.dynamicCollision(p, layer);
      return dynamic === null ? null : mask & dynamic;
    } catch (error) {
      this.block(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
  private occupied(points: Point[], layer: number): boolean {
    return Object.values(this.actors).some(
      (a) =>
        a.id !== this.player.id &&
        !this.hiddenEntities.has(a.id) &&
        a.layer === layer &&
        points.some((p) => a.x === p.x && a.y === p.y),
    );
  }
  private slopeDestination(
    direction: Direction,
    straight: Point,
  ): Point | null {
    const p = this.player,
      map = this.content.map,
      grid = map.collisions[p.layer];
    if (!grid || !inCollisionRange(straight, this.collisionRange)) return null;
    const delta = redirectAtSlope(
      grid[straight.y * map.width + straight.x]!,
      direction,
    );
    if (!delta) return null;
    const to = { x: p.x + delta.x, y: p.y + delta.y };
    if (!inCollisionRange(to, this.collisionRange)) return null;
    let mapping = this.collisionMappings.get(p.layer);
    if (!mapping) {
      mapping = buildCollisionMapping(
        grid,
        map.width,
        map.height,
        this.collisionRange,
      );
      this.collisionMappings.set(p.layer, mapping);
    }
    if (
      !(mapping[p.y * map.width + p.x]! & diagonalBit(delta.x, delta.y)) ||
      !(mapping[to.y * map.width + to.x]! & diagonalBit(-delta.x, -delta.y))
    )
      return null;
    const horizontal = { x: to.x, y: p.y },
      vertical = { x: p.x, y: to.y };
    // The native path graph is static. Dynamic colliders and actors must still block its swept corners.
    const cells = [p, horizontal, vertical, to];
    for (const cell of cells) {
      const mask = this.dynamicCollision(cell, p.layer);
      if (mask === null) return null;
      const xBit = cell.x === p.x ? (delta.x > 0 ? 4 : 2) : delta.x > 0 ? 2 : 4;
      const yBit = cell.y === p.y ? (delta.y > 0 ? 8 : 1) : delta.y > 0 ? 1 : 8;
      if (!(mask & xBit) || !(mask & yBit)) return null;
    }
    return this.occupied([horizontal, vertical, to], p.layer) ? null : to;
  }
  move(direction: Direction): boolean {
    const p = this.player;
    if (this.busy || p.motion) return false;
    p.direction = direction;
    const d = DELTA[direction];
    let to = { x: p.x + d.x, y: p.y + d.y };
    const fromMask = this.collision(p, p.layer),
      toMask = this.collision(to, p.layer);
    if (fromMask === null || toMask === null || !(fromMask & BIT[direction]))
      return false;
    if (!(toMask & BIT[OPPOSITE[direction]])) {
      try {
        const redirected = this.slopeDestination(direction, to);
        if (!redirected) return false;
        to = redirected;
      } catch (error) {
        this.block(error instanceof Error ? error.message : String(error));
        return false;
      }
    }
    if (this.occupied([to], p.layer)) return false;
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
    const e = this.entityList.find(
      (e) =>
        !this.hiddenEntities.has(e.id) &&
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
      this.bgm.advance(10, this.content.bgm);
      this.time += 10;
      if (this.fade) {
        this.fade.elapsed += 10;
        if (this.fade.elapsed >= this.fade.duration) this.fade = null;
      }
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
      hits = this.entityList.filter(
        (e) =>
          !this.hiddenEntities.has(e.id) &&
          e.layer === p.layer &&
          contains(e, p),
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
      const site = {
        script: e.script ?? "map-transition",
        index: 0,
        source: e.source,
      };
      if (!e.destination) {
        this.block("缺少跨地图目标", site);
        return;
      }
      this.stop = {
        kind: "map-transition",
        message: "正在载入地图…",
        site,
        request: {
          ...e.destination,
          continuation: null,
          birdview: false,
          skipFade: false,
          skipBgm: false,
          origin: "trigger",
        },
      };
      return;
    }
    if (!e.script || !this.content.scripts[e.script]) {
      this.block("缺少事件脚本");
      return;
    }
    this.beginRoot(e.script);
  }
  /** Runs a package-provided event through the same VM as map triggers. */
  startEvent(script: string): boolean {
    if (this.busy || this.player.motion) return false;
    if (!this.content.scripts[script])
      throw new Error("Missing event script: " + script);
    this.beginRoot(script);
    return true;
  }
  /** Explicit diagnostic entry, never counted as a story transition or a new-game state. */
  previewMap(mapId: number, entrance: number): void {
    if (this.busy || this.player.motion)
      throw new Error("Cannot preview a map during an event");
    this.stop = {
      kind: "map-transition",
      message: "正在载入地图预览…",
      site: null,
      request: {
        mapId,
        entrance,
        continuation: null,
        birdview: false,
        skipFade: true,
        skipBgm: true,
        origin: "development",
      },
    };
  }
  private beginRoot(script: string): void {
    this.eventState.beginScript(this.content.scriptLocals?.[script] ?? null);
    this.tasks = [this.task(script, 0, "-1001")];
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
  private hasEntity(id: string): boolean {
    return (
      !!this.actors[id] ||
      this.entityList.some((e) => e.id === id) ||
      !!this.content.entry.absentHideTargets?.includes(id)
    );
  }
  /** Only the session owner calls this after consuming a real battle victory. */
  finishEncounter(party: number): void {
    if (
      this.stop?.kind !== "encounter" ||
      this.stop.party !== party ||
      !this.stop.continuation
    )
      throw new Error("No matching field encounter to resume");
    const continuation = this.stop.continuation;
    if (!this.content.scripts[continuation])
      throw new Error("Missing battle continuation");
    this.stop = null;
    this.remainder = 0;
    this.beginRoot(continuation);
  }
  private pump(): void {
    if (this.stop || this.dialogue) return;
    for (let budget = 0; budget < 512; budget++) {
      let changed = false;
      for (const t of [...this.tasks]) {
        if (t.done || t.wait > 0) continue;
        const actor = this.actors[t.actor];
        if (!actor && !this.hasEntity(t.actor)) {
          this.block(`缺少角色 ${t.actor}`);
          return;
        }
        if (actor?.motion) continue;
        if (t.children.some((id) => !this.tasks.find((c) => c.id === id)?.done))
          continue;
        t.children = [];
        if (t.move && t.remaining > 0) {
          if (!actor) {
            this.block("非角色实体不能移动");
            return;
          }
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
        try {
          if (
            executeEventControl(
              op,
              this.eventState,
              t,
              this.content.scripts[t.script]!.length,
            )
          )
            continue;
        } catch (error) {
          this.block(
            error instanceof Error ? error.message : String(error),
            op,
          );
          return;
        }
        switch (op.kind) {
          case "bgm-play":
          case "bgm-stop":
            try {
              if (op.kind === "bgm-play")
                this.bgm.play(
                  op.track,
                  op.channel,
                  op.fade,
                  op.seek,
                  this.content.bgm,
                );
              else this.bgm.stop(op.channel, op.fade);
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
          case "change-map":
            this.stop = {
              kind: "map-transition",
              message: "正在载入地图…",
              site: op,
              request: op.request,
            };
            return;
          case "entities":
            try {
              this.activateGroup(op.group);
            } catch (error) {
              this.block(
                error instanceof Error ? error.message : String(error),
                op,
              );
              return;
            }
            break;
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
                !this.hasEntity(p.actor) ||
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
            if (!actor) {
              this.block("非角色实体不能定位", op);
              return;
            }
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
            this.hiddenEntities.delete(actor.id);
            if (op.animation === "WalkL") actor.direction = "left";
            break;
          case "move":
            t.move = op;
            t.remaining = op.steps;
            break;
          case "look":
            if (!actor) {
              this.block("非角色实体不能转向", op);
              return;
            }
            actor.direction = op.direction;
            break;
          case "hide":
            this.hiddenEntities.add(t.actor);
            break;
          case "ride": {
            const rider = this.actors[op.actor];
            if (
              !rider ||
              op.vehicle !== 6 ||
              !this.content.entry.player.mount
            ) {
              this.block("未知骑乘对象", op);
              return;
            }
            rider.mount = this.content.entry.player.mount;
            break;
          }
          case "sound":
          case "sound-sync":
            // Explicit muted-development presentation lane, retained for later audio migration.
            this.presentationOmissions.push({
              site: op,
              kind: op.kind,
              soundId: op.kind === "sound" ? op.soundId : null,
            });
            break;
          case "fade-in":
            this.fade = { elapsed: 0, duration: Math.round(op.seconds * 1000) };
            t.wait = this.fade.duration;
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
              message: "此战斗尚未接入当前可玩片段。",
              site: op,
              party: op.party,
              continuation: op.continuation,
            };
            return;
          case "blocked":
            this.block(`${op.mnemonic}：${op.reason}`, op);
            return;
          default:
            this.block(`未知编译指令 ${op.kind}，需要重新编译内容`, op);
            return;
        }
      }
      if (!changed) return;
    }
    this.block("脚本在一个逻辑步中未让出执行权");
  }
}
