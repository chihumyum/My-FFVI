import type { GameContentProfile } from "./game-content-refs.js";

export type GamePackageSelection = {
  packageId: string | null;
  /** Initial repository profile; a package's verified references supply its profile. */
  profile: GameContentProfile;
  explicitProfile: boolean;
  defaulted: boolean;
};

/** Host navigation only. This chooses no session, saved state or content capability.
 * Empty titles open the systems package. Every explicit query retains the
 * existing package/profile/preview route, including unrecognized query keys. */
export function selectGamePackage(search: string): GamePackageSelection {
  if (typeof search !== "string") throw new Error("Invalid game location query");
  const query = new URLSearchParams(search);
  const defaulted = query.size === 0;
  const packageId = defaulted ? "systems-initialized" : query.get("package");
  if (packageId !== null && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(packageId))
    throw new Error("Invalid content package identity");
  return {
    packageId,
    profile: defaulted || query.get("profile") === "framework" ? "framework" : "source",
    explicitProfile: query.has("profile"),
    defaulted,
  };
}
