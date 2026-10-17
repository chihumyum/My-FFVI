import { projectBeastField, projectFieldInvalidContents, type BattleEntryCatalog } from "./battle-entry.js";
import { movingContentInvalidationIds } from "./field-content-invalidations.js";

/** Inputs belong to the current field, never a cached opening-map context. */
export type BattleFieldState = {
  mapId: number | null;
  transportationId: number | null;
  isSavePoint: boolean | null;
  beastFieldController: boolean | null;
  footAttributeType: number | null;
};

/** The field host has not implemented every controller yet. A missing live
 * identity is unknown, distinct from a proven absent native controller. Source
 * short-circuits may make another unknown provider irrelevant (e.g. mounted
 * transport does not consult save-point eligibility). */
export function projectBattleFieldState(
  catalog: BattleEntryCatalog,
  field: BattleFieldState,
  transportations: readonly { id: number; type: number }[],
  movingInvalidations: readonly (0 | 2)[] = [],
): { invalidContentIds: number[] | null; blockers: string[] } {
  if (field.mapId === null)
    return { invalidContentIds: null, blockers: ["Unknown battle field map identity"] };
  if (field.transportationId === null)
    return { invalidContentIds: null, blockers: ["Unknown battle field transportation identity"] };
  const rows = transportations.filter((t) => t.id === field.transportationId);
  if (rows.length !== 1)
    throw new Error("Missing or ambiguous battle field transportation");
  const projected = projectFieldInvalidContents(catalog, {
    mapId: field.mapId,
    transportation: rows[0]!,
    isSavePoint: field.isSavePoint,
    beastField: projectBeastField({ controllerPresent: field.beastFieldController,
      footAttributeType: field.footAttributeType, transportationId: field.transportationId }),
  });
  const additions = movingInvalidations.flatMap(type => movingContentInvalidationIds(catalog, type));
  // The native mutation touches normal/savepoint lists only. It does not
  // rewrite source map availability or change the transportation list.
  if (rows[0]!.type === 1 && projected.invalidContentIds !== null)
    for (const id of additions)
      if (!projected.invalidContentIds.includes(id)) projected.invalidContentIds.push(id);
  return projected;
}
