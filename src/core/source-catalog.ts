import type { BattleCatalog } from "./battle-content.js";
import { canonical } from "./canonical.js";
import type { DevelopmentProfile } from "./development-profile.js";
import { createNewGame } from "./new-game.js";

export type SourceCatalogProfile = "source" | "framework";

/** The entry's explicit profile selects a deliberate variant. A missing or
 * malformed declaration cannot silently authorize development battle policy. */
export function sourceCatalogProfile(profile: DevelopmentProfile | undefined): SourceCatalogProfile {
  if (profile === undefined) return "source";
  if (!profile || profile.kind !== "framework-development-v1" ||
      profile.policy !== "omit-anonymous-environment-particles-v1" ||
      typeof profile.sourceContentHash !== "string" || !/^[a-f0-9]{64}$/.test(profile.sourceContentHash) ||
      !Array.isArray(profile.omissions) ||
      profile.transportation !== undefined && profile.transportation !== "walking-magitek-framework-v1" ||
      profile.worldMap !== undefined && profile.worldMap !== "framework-world-map-flat-v1" ||
      profile.fieldPresentation !== undefined && profile.fieldPresentation !== "framework-ordinary-field-flat-v1")
    throw new Error("Source game catalog development profile mismatch");
  return "framework";
}

export type SourceEntryProfileDependency = {
  developmentProfile?: DevelopmentProfile;
  walkEncounters?: unknown;
};

/** Direct session calls require the same profile lane as repository reads.
 * Each document names its own strict source hash, so those hashes need not be
 * equal. The gameplay variant must remain consistent through every map. */
export function assertSourceEntryProfiles(
  entry: SourceEntryProfileDependency,
  world: SourceEntryProfileDependency,
  initialMap: SourceEntryProfileDependency,
  destinationMap?: SourceEntryProfileDependency,
): SourceCatalogProfile {
  const dependencies: [string, SourceEntryProfileDependency][] = [
    ["entry", entry], ["world", world], ["initial map", initialMap],
    ...(destinationMap === undefined ? [] : [["destination map", destinationMap] as [string, SourceEntryProfileDependency]]),
  ];
  for (const [name, dependency] of dependencies)
    if (!dependency || typeof dependency !== "object" || Array.isArray(dependency))
      throw new Error("Source entry profile mismatch: " + name);
  const profile = sourceCatalogProfile(entry.developmentProfile);
  for (const [name, dependency] of dependencies) {
    const declared = sourceCatalogProfile(dependency.developmentProfile);
    if (declared !== profile || profile === "source" && dependency.walkEncounters !== undefined ||
        profile === "framework" &&
        (dependency.developmentProfile!.transportation !== entry.developmentProfile!.transportation ||
          dependency.developmentProfile!.worldMap !== entry.developmentProfile!.worldMap ||
          dependency.developmentProfile!.fieldPresentation !== entry.developmentProfile!.fieldPresentation))
      throw new Error("Source entry profile mismatch: " + name);
  }
  return profile;
}

/** Source initialization is independently derived, not an opening checkpoint
 * with its conditions cleared by the loader. This assertion mutates nothing
 * and admits no battle formulas, active conditions or unvisited story paths. */
export function assertSourceGameCatalog(catalog: BattleCatalog, profile: SourceCatalogProfile = "source"): void {
  if (profile !== "source" && profile !== "framework") throw new Error("Unknown source game catalog profile");
  if (!catalog || catalog.kind !== "narshe-battle-catalog" || !catalog.common || !catalog.gameState || !catalog.encounters)
    throw new Error("Invalid source game catalog");
  if (Object.hasOwn(catalog.gameState, "initialOwnedConditions"))
    throw new Error("Source game catalog cannot contain a development owned-condition seed");
  const initializer = catalog.gameState.sourceNewGame;
  if (!initializer) throw new Error("Source game catalog requires the source new-game initializer");
  const plan = createNewGame(initializer), players = catalog.common.players;
  if (!Array.isArray(players) || players.length !== plan.owned.roster.length)
    throw new Error("Source game catalog initial player identity mismatch");
  for (let index = 0; index < players.length; index++) {
    const player = players[index], member = plan.owned.roster[index]!;
    if (!player || player.id !== member.id || player.sourceId !== member.sourceId || player.side !== "player")
      throw new Error("Source game catalog initial player identity mismatch");
    if (canonical({ name: player.name, level: player.level, exp: player.exp, hp: player.hp, mp: player.mp,
      conditionIds: player.conditionIds }) !== canonical({ name: member.name, level: member.level, exp: member.exp,
      hp: member.hp, mp: member.mp, conditionIds: member.conditionIds }))
      throw new Error("Source game catalog initial player seed differs from the source initializer");
  }
  // These are encounter declarations in every profile, never shared defaults.
  for (const key of ["escapePolicy", "lifecycle", "rewardPolicy", "participants", "playerParticipants", "formationPlan"])
    if (Object.hasOwn(catalog.common, key)) throw new Error("Source new game cannot use misplaced " + key + " policy");
  if (profile === "framework") return;
  const encounters = Object.values(catalog.encounters);
  if (encounters.some(encounter => encounter.formationPlan?.kind === "development"))
    throw new Error("Source new game cannot use development formation selection");
  if (encounters.some(encounter => Object.hasOwn(encounter, "escapePolicy")))
    throw new Error("Source new game cannot use development escape policy");
  if (encounters.some(encounter => encounter.lifecycle?.mode === "development-omission"))
    throw new Error("Source new game cannot use an omitted battle lifecycle");
  if (catalog.encounterDiagnostics?.some(diagnostic => diagnostic.kind === "development-omission") ||
      (catalog.encounterReport?.withDevelopmentOmissions ?? 0) > 0)
    throw new Error("Source new game cannot use development omission diagnostics");
}
