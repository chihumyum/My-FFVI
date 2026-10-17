import { z } from "zod";
import { Conditions, Hash, type Asset } from "../contracts.js";
import { resolveAsset } from "../knowledge/context.js";
import { hash } from "../compiler/content.js";

export const Recipe = z.object({
  schemaVersion: z.literal(1), id: z.string(), version: z.string(), region: z.string(),
  sourceSetHash: Hash, sourceMap: z.string(), context: Conditions,
  annotations: z.enum(["unreviewed", "approved"]), styleVersion: z.string().nullable(),
  requests: z.array(z.object({ id: z.string(), semanticId: z.string(), role: z.string(), interfaceVersion: z.string() }).strict()),
  notes: z.array(z.string()),
}).strict();
export type Recipe = z.infer<typeof Recipe>;
export function compileRecipe(recipe: Recipe, assets: Asset[], sourceSetHash: string) {
  const blockers: string[] = [];
  if (recipe.sourceSetHash !== sourceSetHash) blockers.push("SOURCE_PROFILE_MISMATCH");
  if (recipe.annotations !== "approved") blockers.push("SPATIAL_ANNOTATIONS_UNREVIEWED");
  if (!recipe.styleVersion) blockers.push("STYLE_PROFILE_UNDEFINED");
  if (recipe.requests.length === 0) blockers.push("ASSET_REQUIREMENTS_UNDEFINED");
  if (new Set(recipe.requests.map(r => r.id)).size !== recipe.requests.length) throw new Error("Duplicate recipe request identity");
  const resolutions = recipe.requests.map(r => ({ request: r.id, result: resolveAsset(assets, {
    semanticId: r.semanticId, role: r.role, region: recipe.region, styleVersion: recipe.styleVersion ?? "<undefined>",
    interfaceVersion: r.interfaceVersion, context: recipe.context,
  }) }));
  const locks: { request: string; asset: string; contentHash: string }[] = [];
  for (const { request, result } of resolutions) {
    if (result.status === "resolved") locks.push({ request, asset: `${result.asset.id}@${result.asset.version}`, contentHash: result.asset.contentHash });
    else blockers.push(`ASSET_${result.status.toUpperCase()}:${request}`);
  }
  const payload = { recipe, locks, blockers };
  return { recipeId: recipe.id, buildHash: hash(payload), readyForSceneGeneration: blockers.length === 0, locks, blockers };
}

/** Dependency graph keys are versioned artifact identities; reverse closure catches indirect users. */
export function affectedBy(dependencies: Record<string, string[]>, changed: string[]): string[] {
  const reverse = new Map<string, Set<string>>();
  for (const [owner, deps] of Object.entries(dependencies)) for (const dep of deps) {
    const users = reverse.get(dep) ?? new Set<string>(); users.add(owner); reverse.set(dep, users);
  }
  const visited = new Set(changed), queue = [...changed];
  while (queue.length) for (const user of reverse.get(queue.shift()!) ?? []) {
    if (!visited.has(user)) { visited.add(user); queue.push(user); }
  }
  return [...visited].filter(x => !changed.includes(x)).sort();
}
