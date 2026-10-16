/** Content-derived EnemyCharacterParameter constructor fact, not a side/sprite
 * default. Trusted source compilation owns native/table identity verification;
 * core checks its exact projection and binds it to actual Battle instances.
 * This metadata is never read from a save or a player parameter provider. */
export type SourceEnemyMpParameter = {
  kind: "source-enemy-mp-parameter-v1";
  sourceId: number;
  isUnableMP: boolean;
};
export function parseSourceEnemyMpParameter(raw: unknown, sourceId: number): SourceEnemyMpParameter {
  const value = raw as SourceEnemyMpParameter;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "isUnableMP,kind,sourceId" ||
      value.kind !== "source-enemy-mp-parameter-v1" || typeof value.isUnableMP !== "boolean" ||
      !Number.isInteger(sourceId) || sourceId < 1 || sourceId > 0x7fffffff || value.sourceId !== sourceId)
    throw new Error("Invalid source enemy MP parameter constructor binding");
  return { ...value };
}
type Unit = { sourceId: number; side: "player" | "enemy"; mpParameter?: SourceEnemyMpParameter };
/** Owner state is battle-local and transactionally captured. Same-slot or
 * source-ID replacements cannot inherit another object's parameter authority. */
export class BattleEnemyMpParameters<U extends Unit> {
  #units = new Map<U, SourceEnemyMpParameter>();
  bind(unit: U) {
    if (unit.mpParameter === undefined) return;
    if (unit.side !== "enemy") throw new Error("Source enemy MP parameter cannot authorize a player override");
    this.#units.set(unit, Object.freeze(parseSourceEnemyMpParameter(unit.mpParameter, unit.sourceId)));
  }
  query(unit: U, required = false): boolean | undefined {
    const captured = this.#units.get(unit);
    if (!captured) {
      if (required || unit.mpParameter !== undefined)
        throw new Error("Source Final MP-zero lifecycle requires actual IsUnableMP parameter owner");
      return undefined;
    }
    const current = parseSourceEnemyMpParameter(unit.mpParameter, unit.sourceId);
    if (unit.side !== "enemy" || current.isUnableMP !== captured.isUnableMP || current.sourceId !== captured.sourceId)
      throw new Error("Changed actual source enemy MP parameter instance");
    return captured.isUnableMP;
  }
  retire(unit: U) { this.#units.delete(unit); }
  retireAll() { this.#units.clear(); }
  snapshot() { return new Map(this.#units); }
  restore(state: ReturnType<BattleEnemyMpParameters<U>["snapshot"]>) { this.#units = new Map(state); }
}
