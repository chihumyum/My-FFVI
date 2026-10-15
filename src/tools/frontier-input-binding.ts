import { canonical } from "../core/canonical.js";
import { contentDigest, verifyContent } from "../core/content-integrity.js";
import { parseGameContentReleaseIndex, selectGameContentRelease,
  type SelectedGameContentRelease } from "../core/game-content-release.js";
import { parseGameContentRefs } from "../core/game-content-refs.js";

/** A publication runtime tag alone cannot authenticate arbitrary current refs.
 * Bind the completed publisher's framework archive to its exact immutable release. */
export async function bindPublishedFrontierRelease(publication: unknown, rawIndex: unknown,
  rawRefs: unknown): Promise<{ runtime: string; selected: SelectedGameContentRelease }> {
  const report = publication as { result?: unknown; published?: unknown; sourceInputLock?: { runtimeSha256?: unknown };
    after?: { reports?: { kind?: unknown; packageId?: unknown; profile?: unknown; indexHash?: unknown; releaseId?: unknown;
      originalJSONBytesPreserved?: unknown }[] } };
  const runtime = report?.sourceInputLock?.runtimeSha256;
  if (report?.result !== "passed" || report?.published !== true || typeof runtime !== "string" || !/^[a-f0-9]{64}$/.test(runtime))
    throw new Error("Unavailable completed publication receipt");
  const rows = report.after?.reports;
  if (!Array.isArray(rows)) throw new Error("Missing published framework archive receipt");
  const matches = rows.filter(row => row.packageId === "framework");
  if (matches.length !== 1 || matches[0]!.kind !== "content-release-archive-v1" || matches[0]!.profile !== "framework" ||
      matches[0]!.originalJSONBytesPreserved !== true)
    throw new Error("Ambiguous or unavailable published framework archive receipt");
  const row = matches[0]!, index = parseGameContentReleaseIndex(rawIndex);
  await verifyContent(index, typeof row.indexHash === "string" ? row.indexHash : "invalid");
  if (index.packageId !== "framework" || index.profile !== "framework" || index.currentReleaseId !== row.releaseId)
    throw new Error("Published framework release identity changed");
  const selected = selectGameContentRelease(index, { kind: "current" });
  const { id, ...body } = selected.release;
  if (await contentDigest(body) !== id) throw new Error("Published framework release body changed");
  const refs = parseGameContentRefs(rawRefs);
  if (canonical(selected.release.refs) !== canonical(refs)) throw new Error("Published framework references changed");
  return { runtime, selected };
}
