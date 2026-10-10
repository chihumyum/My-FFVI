import type { FieldEntity, TileLayer, Tileset } from "../field/types.js";

type Cell = {
  tile: number;
  frames: { tile: number; duration: number }[];
  total: number;
  elapsed: number;
  count: number;
  loop: boolean;
  originalLoop: boolean;
  scale: number;
  permitted: boolean;
};
type Region = { cells: string[]; playing: boolean };
const key = (layer: number, index: number) => `${layer}:${index}`;
const f = Math.fround;

/** Source trigger-controlled tile UV state. Rendering only reads resolved tile IDs. */
export class TileAnimationState {
  private cells = new Map<string, Cell>();
  private regions = new Map<string, Region>();
  constructor(
    private readonly map: { layers: TileLayer[]; tilesets: Tileset[] },
  ) {}

  has(id: string): boolean {
    return this.regions.has(id);
  }
  isPlaying(id: string): boolean {
    return this.region(id).playing;
  }
  private region(id: string): Region {
    const r = this.regions.get(id);
    if (!r) throw new Error("Unsupported animation target " + id);
    return r;
  }

  /** Stage all bindings before committing; overlapping regions share actual cell state. */
  register(entities: readonly FieldEntity[]): void {
    const additions = entities.filter((e) => e.kind === 1);
    if (!additions.length) return;
    const cells = new Map(
      [...this.cells].map(([k, c]) => [k, { ...c, frames: [...c.frames] }]),
    );
    const regions = new Map(this.regions);
    const sets = [...this.map.tilesets].sort((a, b) => b.firstgid - a.firstgid);
    for (const e of additions) {
      const r = e.tileAnimation;
      if (!r?.cells) throw new Error("Unbound tile animation region " + e.id);
      if (regions.has(e.id))
        throw new Error("Duplicate tile animation region " + e.id);
      const bound: string[] = [];
      const seen = new Set<string>();
      for (const { layer, index } of r.cells) {
        if (
          !Number.isInteger(layer) ||
          !Number.isInteger(index) ||
          layer < 0 ||
          index < 0
        )
          throw new Error("Invalid tile animation cell");
        const raw = this.map.layers[layer]?.data[index];
        if (raw === undefined || !raw || raw !== (raw & 0x0fffffff))
          throw new Error("Invalid tile animation source cell");
        const k = key(layer, index);
        if (seen.has(k)) throw new Error("Duplicate tile animation cell");
        seen.add(k);
        bound.push(k);
        let cell = cells.get(k);
        if (!cell) {
          const set = sets.find((s) => s.firstgid <= raw);
          const animation = set?.tiles?.find(
            (t) => t.id === raw - set.firstgid,
          )?.animation;
          if (
            !set ||
            !animation?.length ||
            animation.some(
              (a) =>
                !Number.isInteger(a.duration) ||
                a.duration <= 0 ||
                !Number.isInteger(a.tileid) ||
                a.tileid < 0,
            )
          )
            throw new Error("Missing or invalid tile animation frames");
          const total = animation.reduce((n, a) => n + a.duration, 0);
          if (total > 2147483647)
            throw new Error("Tile animation duration overflow");
          cell = {
            tile: raw,
            frames: animation.map((a) => ({
              tile: a.tileid + set.firstgid,
              duration: a.duration,
            })),
            total,
            elapsed: 0,
            count: 0,
            originalLoop: r.loop,
            loop: r.loop,
            scale: 1,
            permitted: false,
          };
          cells.set(k, cell);
        }
        // InitTrigger does not reset elapsed/count. A second region may bind the same UV.
        cell.originalLoop = cell.loop = r.loop;
        cell.permitted = false;
        if (r.reverse) {
          cell.frames.reverse();
          cell.tile = cell.frames[0]!.tile;
        }
      }
      regions.set(e.id, { cells: bound, playing: false });
    }
    this.cells = cells;
    this.regions = regions;
  }

  private settings(c: Cell, loop: boolean | null, scale = 1): void {
    c.loop = loop ?? c.originalLoop;
    c.scale = f(scale);
    c.permitted = true;
  }
  private add(c: Cell, ms: number): void {
    if (!c.permitted) return;
    c.elapsed = f(c.elapsed + f(ms / c.scale));
    // Native uses >, not >=; one wrap per update, including long updates.
    if (c.elapsed > c.total) {
      if (c.loop) {
        c.elapsed = f(c.elapsed - c.total);
        c.count++;
      } else {
        c.elapsed = c.total;
        c.count = 1;
      }
    }
  }
  cue(id: string, frame: number): void {
    if (!Number.isFinite(frame)) throw new Error("Invalid animation cue");
    const r = this.region(id),
      position = Math.max(0, Math.min(1, f(frame)));
    for (const k of r.cells) {
      const c = this.cells.get(k)!;
      if (!position) {
        c.loop = c.originalLoop;
        c.count = 0;
        c.elapsed = 0;
        c.permitted = false;
      } else {
        this.settings(c, null);
        if (position === 1) this.add(c, c.total);
        else {
          c.elapsed = 0;
          this.add(c, f(c.total * position));
        }
      }
    }
    r.playing = false;
  }
  play(id: string, loop: boolean, speed: number): void {
    if (
      !Number.isFinite(speed) ||
      speed <= 0 ||
      !Number.isFinite(f(1 / f(speed))) ||
      f(1 / f(speed)) <= 0
    )
      throw new Error("Invalid tile animation speed");
    const r = this.region(id);
    // Puppet.PlayAnim first CueAnimation(key,-1), then invokes PlayAnimation(mode,1/speed).
    this.cue(id, 0);
    for (const k of r.cells)
      this.settings(this.cells.get(k)!, loop, f(1 / f(speed)));
    r.playing = true;
  }
  /** OpenTrigger calls the nullable overload directly: no cue/reset, source loop, scale 1. */
  playDefault(id: string): void {
    const r = this.region(id);
    for (const k of r.cells) this.settings(this.cells.get(k)!, null);
    r.playing = true;
  }
  /** Entry-on-door setup adds a whole duration without resetting elapsed/count. */
  forceLastFrame(id: string): void {
    const r = this.region(id);
    for (const k of r.cells) {
      const c = this.cells.get(k)!;
      this.settings(c, null);
      this.add(c, c.total);
      r.playing = false;
    }
  }
  advance(ms: number): void {
    for (const r of this.regions.values())
      if (r.playing) {
        let finished = true;
        for (const k of r.cells) {
          const c = this.cells.get(k)!;
          this.add(c, ms);
          if (c.loop || !c.count) finished = false;
        }
        r.playing = !finished;
      }
  }
  /** Undefined leaves ambient tile animation to the ordinary renderer. */
  tile(layer: number, index: number): number | undefined {
    const c = this.cells.get(key(layer, index));
    if (!c) return undefined;
    if (!c.permitted) return c.tile;
    let elapsed = c.elapsed;
    for (const a of c.frames) {
      elapsed = f(elapsed - a.duration);
      if (elapsed <= 0) return a.tile;
    }
    return c.frames.at(-1)!.tile;
  }
  snapshot() {
    return {
      regions: Object.fromEntries(
        [...this.regions].map(([id, r]) => [id, { ...r, cells: [...r.cells] }]),
      ),
      cells: Object.fromEntries(
        [...this.cells].map(([k, c]) => [
          k,
          { ...c, frames: c.frames.map((f) => ({ ...f })) },
        ]),
      ),
    };
  }
}
