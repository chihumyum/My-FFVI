import type { Asset, Context, Fact, Registry } from "../contracts.js";

export type Match = "yes" | "no" | "unknown";
export function applies(conditions: Context, context: Context): Match {
  let unknown = false;
  for (const [key, expected] of Object.entries(conditions)) {
    if (!Object.hasOwn(context, key)) unknown = true;
    else if (context[key] !== expected) return "no";
  }
  return unknown ? "unknown" : "yes";
}

export type AssetRequest = { semanticId: string; role: string; region: string; styleVersion: string; interfaceVersion: string; context: Context };
export function resolveAsset(assets: Asset[], request: AssetRequest) {
  const candidates = assets.filter(a => a.semanticId === request.semanticId && a.role === request.role
    && a.regions.includes(request.region) && a.styleVersion === request.styleVersion && a.interfaceVersion === request.interfaceVersion)
    .map(asset => ({ asset, match: applies(asset.when, request.context) }))
    .filter(c => c.match !== "no").sort((a, b) => `${a.asset.id}@${a.asset.version}`.localeCompare(`${b.asset.id}@${b.asset.version}`, "en"));
  if (candidates.some(c => c.match === "unknown" || c.asset.status !== "approved"))
    return { status: "unresolved" as const, candidates };
  if (candidates.length > 1) return { status: "ambiguous" as const, candidates };
  if (candidates.length === 0) return { status: "missing" as const, candidates };
  return { status: "resolved" as const, asset: candidates[0]!.asset, candidates };
}

export function knowledgeContext(registry: Registry, region: string, sourceSetHash: string, context: Context) {
  const place = registry.regions.find(r => r.id === region);
  if (!place) throw new Error(`Unknown region: ${region}`);
  const facts = registry.facts.filter(f => f.subject === region && f.sourceSetHash === sourceSetHash)
    .map(fact => ({ fact, applicability: applies(fact.when, context) })).filter(f => f.applicability !== "no")
    .sort((a, b) => a.fact.id.localeCompare(b.fact.id, "en"));
  const conflicts: string[][] = [];
  const active = facts.filter(f => f.applicability === "yes" && ["observed", "verified"].includes(f.fact.status));
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i]!.fact; const b = active[j]!.fact;
    if (a.predicate === b.predicate && a.value !== b.value) conflicts.push([a.id, b.id]);
  }
  return { region: place, context, facts, conflicts, questions: place.questions,
    status: conflicts.length ? "conflicted" : "partial" };
}

export function validateRegistry(registry: Registry): void {
  for (const [label, ids] of [
    ["region", registry.regions.map(r => r.id)],
    ["fact", registry.facts.map(f => f.id)],
    ["asset-version", registry.assets.map(a => `${a.id}@${a.version}`)],
  ] as const) {
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} identity`);
  }
  const regions = new Set(registry.regions.map(r => r.id));
  for (const a of registry.assets) for (const region of a.regions)
    if (!regions.has(region)) throw new Error(`Asset ${a.id} references unknown region ${region}`);
}

export function sourceBindingFacts(sourceSetHash: string, region: string, areaId: string, nameKey: string): Fact[] {
  return [{ id: `${region}:source-area`, subject: region, predicate: "source.areaId", value: areaId,
    when: {}, status: "observed", sourceSetHash, evidence: [`area.csv:${areaId}`, `system_en.txt:${nameKey}`, "map.csv:area_id"] }];
}
