import { rosterNativeSelectors } from "./roster-selectors.js";
import {
  validateRosterCommand,
  type RosterCommand,
  type RosterLifecycleEventOp,
  type RosterMember,
} from "../core/roster.js";
import { record } from "./content.js";
import { tableId } from "./table-id.js";

type Tables = Record<string, unknown>;
type Dependency = { table: string; id: number };
export type InitialRosterLifecycle = {
  initial: Record<
    string,
    Pick<
      RosterMember,
      "ownedId" | "jobId" | "additionalLevel" | "magicStoneId" | "ownedJobs"
    >
  >;
  releasedJobIds: number[];
  jobIds: number[];
  dependencies: Dependency[];
};
function rows(tables: Tables, table: string) {
  const value = tables[table];
  if (!Array.isArray(value)) throw new Error(`Missing roster table ${table}`);
  return value.map(record);
}
function one(
  tables: Tables,
  table: string,
  id: number,
  dependencies: Dependency[],
) {
  const found = rows(tables, table).filter((row) => tableId(row.id) === id);
  if (found.length !== 1 || id <= 0)
    throw new Error(`Missing or ambiguous roster ${table}:${id}`);
  dependencies.push({ table, id });
  return found[0]!;
}

/**
 * Lifecycle metadata for the explicitly created source initial owners. This is
 * not AddFromMaster: it does not fabricate abilities, parameters or appearance.
 */
export function compileInitialRosterLifecycle(
  tables: Tables,
  owners: readonly { id: string; sourceId: number }[],
): InitialRosterLifecycle {
  const dependencies: Dependency[] = [];
  const initial: InitialRosterLifecycle["initial"] = {};
  const settings = rows(tables, "initialize_data.csv");
  const setting = (key: string) => {
    const found = settings.filter((r) => r.key_name === key);
    if (found.length > 1)
      throw new Error(`Ambiguous roster initialization ${key}`);
    if (!found[0]) return null;
    dependencies.push({
      table: "initialize_data.csv",
      id: tableId(found[0].id),
    });
    return tableId(found[0].value1);
  };
  const jobIds = rows(tables, "job.csv").map((r) => tableId(r.id));
  if (jobIds.some((id) => id <= 0) || new Set(jobIds).size !== jobIds.length)
    throw new Error("Invalid roster job identities");
  const releasedJobIds: number[] = [];
  // CreateReleaseJobs uses the source's INT_JOB (not INIT_JOB) selectors.
  for (let i = 1; i <= 6; i++) {
    const jobId = setting(`INT_JOB_${i}`);
    if (jobId === null) continue;
    one(tables, "job.csv", jobId, dependencies);
    if (releasedJobIds.includes(jobId))
      throw new Error("Duplicate initial released job");
    releasedJobIds.push(jobId);
  }
  if (
    new Set(owners.map((r) => r.id)).size !== owners.length ||
    new Set(owners.map((r) => r.sourceId)).size !== owners.length ||
    owners.some((r) => typeof r.id !== "string" || !r.id)
  )
    throw new Error("Ambiguous initial owned identities");
  let ownedId = 0;
  const created = new Set<number>();
  for (let i = 1; i <= 5; i++) {
    const sourceId = setting(`INIT_PARTY_${i}`);
    if (sourceId === null) continue;
    const owner = owners.find((r) => r.sourceId === sourceId);
    if (!owner || created.has(sourceId))
      throw new Error(
        "Initial lifecycle owners differ from source creation order",
      );
    created.add(sourceId);
    const character = one(
      tables,
      "character_status.csv",
      sourceId,
      dependencies,
    );
    const jobId = tableId(character.job_id);
    one(tables, "job.csv", jobId, dependencies);
    const curves = rows(tables, "intermediate_growth_curve.csv").filter(
      (r) =>
        tableId(r.character_id) === sourceId && tableId(r.job_id) === jobId,
    );
    // The original takes its first record. Ambiguous input is not admitted here.
    if (curves.length !== 1)
      throw new Error("Unresolved initial experience group");
    const curve = curves[0]!;
    dependencies.push({
      table: "intermediate_growth_curve.csv",
      id: tableId(curve.id),
    });
    const groupId = tableId(curve.exp_table_group_id);
    const sourceExp = tableId(character.exp);
    if (sourceExp < 0) throw new Error("Invalid initial source experience");
    const candidates = rows(tables, "exp_table.csv").filter(
      (r) =>
        tableId(r.group_id) === groupId &&
        tableId(r.type_id) === 1 &&
        tableId(r.total_exp) <= sourceExp,
    );
    if (!candidates.length)
      throw new Error("Unresolved initial experience level");
    candidates.sort((a, b) => tableId(b.lv) - tableId(a.lv));
    if (
      candidates[1] &&
      tableId(candidates[0]!.lv) === tableId(candidates[1].lv)
    )
      throw new Error("Ambiguous initial experience level");
    const level = candidates[0]!;
    const additionalLevel = tableId(level.lv);
    if (additionalLevel < 1 || additionalLevel > 99)
      throw new Error("Invalid initial additional level");
    // Track the complete qualifying set: each row contributed to max selection.
    for (const row of candidates)
      dependencies.push({ table: "exp_table.csv", id: tableId(row.id) });
    initial[owner.id] = {
      ownedId: ++ownedId,
      jobId,
      additionalLevel,
      magicStoneId: 0,
      ownedJobs: [jobId, ...releasedJobIds.filter((id) => id !== jobId)].map(
        (id) => ({ id, level: 1, proficiency: 0 }),
      ),
    };
  }
  if (created.size !== owners.length)
    throw new Error("Initial lifecycle contains non-initial owners");
  return {
    initial,
    releasedJobIds,
    jobIds,
    dependencies: [
      ...new Map(dependencies.map((d) => [`${d.table}:${d.id}`, d])).values(),
    ],
  };
}

/** All registered selectors include explicit special-owner gates. */
export const rosterLifecycleKnownSelectors = Object.keys(rosterNativeSelectors);
/** Selectors whose complete unconditional native command has been recovered. */
export const rosterLifecycleSelectors = rosterLifecycleKnownSelectors.filter(
  (selector) => rosterNativeSelectors[selector]!.command !== undefined,
);

/** Caller validates SysCall type/shape and all unused operands. */
export function compileRosterLifecycleEvent(
  selector: string,
  tables: Tables,
): RosterLifecycleEventOp {
  const binding = Object.hasOwn(rosterNativeSelectors, selector)
    ? rosterNativeSelectors[selector] : undefined;
  const command = binding?.command;
  if (!command)
    throw new Error(`Unimplemented roster lifecycle selector ${selector}${binding?.gate ? `: ${binding.gate} (native ${binding.rva})` : ""}`);
  const dependencies: Dependency[] = [];
  const character = one(
    tables,
    "character_status.csv",
    command.sourceId,
    dependencies,
  );
  one(tables, "job.csv", tableId(character.job_id), dependencies);
  validateRosterCommand(command);
  return { kind: "roster", command: structuredClone(command), dependencies };
}
