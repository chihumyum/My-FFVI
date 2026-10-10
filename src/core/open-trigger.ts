import type { Direction, FieldEntity, Point } from "../field/types.js";
import type { TileAnimationState } from "./tile-animation.js";

const DIRECTION_BIT: Record<Direction, number> = {
  up: 1,
  right: 2,
  down: 4,
  left: 8,
};

/** Map-local contact doors. The shared tile state owns their visual progress. */
export class OpenTriggerState {
  private hit = new Set<string>();
  private inactive = new Set<string>();
  private pending: { trigger: string; region: string } | null = null;
  constructor(private readonly tiles: TileAnimationState) {}
  get busy(): boolean {
    return this.pending !== null;
  }
  blocks(id: string): boolean {
    return !this.inactive.has(id);
  }

  /** FootEvent opens only triggers coinciding with the entering player, then cues all linked regions. */
  initialize(
    entities: readonly FieldEntity[],
    player: Point & { layer: number },
  ): void {
    const triggers = entities.filter(
      (e) =>
        e.kind === 8 &&
        e.x === player.x &&
        e.y === player.y &&
        e.layer === player.layer,
    );
    const regions = triggers.flatMap((trigger) => {
      const link = this.properties(trigger).linkObject;
      return entities.filter((e) => e.kind === 1 && (e.objectId ?? 0) === link);
    });
    for (const e of regions) this.requireRegion(e);
    for (const e of triggers) this.finish(e.id);
    for (const e of regions) this.tiles.forceLastFrame(e.id);
  }

  start(
    entity: FieldEntity,
    entities: readonly FieldEntity[],
    direction: Direction,
  ): boolean {
    const p = this.properties(entity);
    if (
      this.busy ||
      this.hit.has(entity.id) ||
      this.inactive.has(entity.id) ||
      !(p.direction & DIRECTION_BIT[direction])
    )
      return false;
    // Native walks the registered entity list and returns after the first matching region.
    const region = entities.find(
      (e) => e.kind === 1 && (e.objectId ?? 0) === p.linkObject,
    );
    if (!region)
      throw new Error(`Missing open trigger animation ${p.linkObject}`);
    this.requireRegion(region);
    const peers = entities.filter(
      (e) =>
        e.kind === 8 &&
        e.id !== entity.id &&
        this.properties(e).linkObject === p.linkObject,
    );
    // Resolve every dependency before changing collision or animation state.
    this.tiles.playDefault(region.id);
    for (const e of peers) this.finish(e.id);
    this.hit.add(entity.id);
    this.pending = { trigger: entity.id, region: region.id };
    return true;
  }
  advance(): void {
    if (this.pending && !this.tiles.isPlaying(this.pending.region)) {
      this.finish(this.pending.trigger);
      this.pending = null;
    }
  }
  private finish(id: string): void {
    this.hit.add(id);
    this.inactive.add(id);
  }
  private properties(e: FieldEntity) {
    const p = e.openTrigger;
    if (
      !p ||
      !Number.isInteger(p.direction) ||
      p.direction < 0 ||
      p.direction > 15 ||
      !Number.isInteger(p.linkObject) ||
      !Number.isInteger(p.soundId)
    )
      throw new Error(`Uncompiled open trigger ${e.id}`);
    return p;
  }
  private requireRegion(e: FieldEntity): void {
    if (!this.tiles.has(e.id))
      throw new Error(`Unbound open trigger animation ${e.id}`);
  }
  snapshot() {
    return {
      hit: [...this.hit],
      inactive: [...this.inactive],
      pending: this.pending ? { ...this.pending } : null,
    };
  }
}
