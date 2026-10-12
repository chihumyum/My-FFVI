import type { FieldContent } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { BattleCatalog } from "./battle-content.js";
import { verifyContent } from "./content-integrity.js";
import type { GameCheckpoint, GameRestoreWorld } from "./game-session.js";
import type { SourceNewGameContent } from "./source-new-game.js";

type HashedContent = { contentHash: string };
type ContentReader = <T extends HashedContent>(
  url: string,
  parse: (value: unknown) => T,
  expected?: string,
) => Promise<T>;
type OpeningContent = { field: FieldContent; battle: BattleCatalog };
type SourceEntryContent = {
  content: SourceNewGameContent;
  catalog: WorldCatalog;
  map: WorldMapContent;
};

function object(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid game content object");
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("Missing game content identity");
}
function hash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Content identity mismatch");
}
function integer(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > 0x7fffffff)
    throw new Error("Invalid game content map/entrance identity");
}
function header(value: unknown, kind: string, formatVersion?: number): asserts value is Record<string, unknown> {
  object(value);
  if (value.kind !== kind || (formatVersion !== undefined && value.formatVersion !== formatVersion))
    throw new Error("Game content kind/version mismatch");
}
function source(value: Record<string, unknown>, media = false): void {
  text(value.sourceSetHash);
  text(value.parentSourceSetHash);
  if (media) text(value.mediaSourceSetHash);
}

// These checks establish package identity and dependency containers. Detailed
// gameplay capability checks remain with the state owners that consume them.
function fieldContent(value: unknown): FieldContent {
  header(value, "field-development", 1);
  source(value);
  object(value.map); object(value.characters); object(value.scripts); object(value.entry);
  return value as FieldContent;
}
function battleContent(value: unknown): BattleCatalog {
  header(value, "narshe-battle-catalog");
  object(value.common); object(value.gameState); object(value.encounters);
  text(value.common.fieldSourceSetHash);
  return value as BattleCatalog;
}
function worldContent(value: unknown): WorldCatalog {
  header(value, "world-development", 1);
  source(value, true);
  object(value.maps); object(value.characters); object(value.characterIssues);
  return value as WorldCatalog;
}
function mapContent(value: unknown): WorldMapContent {
  header(value, "world-map-development", 1);
  source(value, true);
  integer(value.mapId, 1); integer(value.areaId);
  object(value.scripts); object(value.scriptLocals);
  if (value.map !== null) object(value.map);
  return value as WorldMapContent;
}
function sourceContent(value: unknown): SourceNewGameContent {
  header(value, "source-new-game-content-v1");
  source(value);
  hash(value.battleCatalogHash); hash(value.worldCatalogHash); hash(value.mapContentHash);
  header(value.entry, "source-new-game-field-entry-v1");
  integer(value.entry.mapId, 1); integer(value.entry.entrance);
  object(value.entry.reservedScript); object(value.entry.fallbackScript);
  integer(value.entry.reservedScript.id, 1); text(value.entry.reservedScript.name);
  hash(value.entry.reservedScript.contentHash);
  integer(value.entry.fallbackScript.id, 1); text(value.entry.fallbackScript.name);
  return value as SourceNewGameContent;
}

/** Fetches and verifies content only. It never creates sessions, runs scripts,
 * publishes a map, or decodes media. Returned objects are detached from caches. */
export class GameContentRepository {
  private readonly cache = new Map<string, Promise<HashedContent>>();

  constructor(private readonly loadJson: (url: string) => Promise<unknown>) {}

  clear(): void {
    this.cache.clear();
  }

  opening(): Promise<OpeningContent> {
    return this.operation((read) => this.readOpening(read));
  }

  world(): Promise<WorldCatalog> {
    return this.operation((read) => read("/world/catalog.json", worldContent));
  }

  map(mapId: number, catalog?: WorldCatalog): Promise<WorldMapContent> {
    // Capture supplied dependencies before the first await. A caller changing
    // an index while a fetch is pending cannot redirect the completed read.
    const supplied = catalog === undefined ? undefined : structuredClone(catalog);
    return this.operation(async (read) => {
      integer(mapId, 1);
      const world = supplied === undefined
        ? await read("/world/catalog.json", worldContent)
        : worldContent(await verifyContent(supplied));
      return this.readMap(read, mapId, world);
    });
  }

  sourceNewGame(): Promise<SourceEntryContent> {
    return this.operation((read) => this.readSourceEntry(read));
  }

  restoreWorld(checkpoint: GameCheckpoint): Promise<GameRestoreWorld | undefined> {
    const saved = structuredClone(checkpoint);
    return this.operation(async (read) => {
      header(saved, "game-checkpoint", 4);
      header(saved.world, "idle-world-v9");
      text(saved.sourceSetHash); hash(saved.battleCatalogHash); hash(saved.world.initialHash);
      object(saved.origin);
      let result: GameRestoreWorld | undefined;
      if (saved.origin.kind === "source-new-game") {
        hash(saved.origin.sourceContentHash);
        const initial = await this.readSourceEntry(read, saved.origin.sourceContentHash);
        if (saved.sourceSetHash !== initial.content.parentSourceSetHash ||
            saved.battleCatalogHash !== initial.content.battleCatalogHash ||
            saved.world.initialHash !== initial.content.contentHash)
          throw new Error("Game checkpoint source identity mismatch");
        result = { catalog: initial.catalog, map: initial.map,
          source: { content: initial.content, initialMap: initial.map } };
      } else if (saved.origin.kind === "development-checkpoint") {
        const initial = await this.readOpening(read);
        if (saved.sourceSetHash !== initial.field.parentSourceSetHash ||
            saved.battleCatalogHash !== initial.battle.contentHash ||
            saved.world.initialHash !== initial.field.contentHash)
          throw new Error("Game checkpoint source identity mismatch");
      } else {
        throw new Error("Unknown game checkpoint origin");
      }
      if (saved.world.location === null) return result;
      const location = saved.world.location;
      object(location); integer(location.mapId, 1); integer(location.entrance); hash(location.catalogHash);
      const catalog = result?.catalog ?? await read("/world/catalog.json", worldContent);
      if (location.catalogHash !== catalog.contentHash || catalog.parentSourceSetHash !== saved.sourceSetHash)
        throw new Error("Saved map catalog/source identity mismatch");
      const map = await this.readMap(read, location.mapId, catalog);
      return { ...result, catalog, map };
    });
  }

  private async readOpening(read: ContentReader): Promise<OpeningContent> {
    const [field, battle] = await Promise.all([
      read("/game/content.json", fieldContent), read("/game/battle.json", battleContent),
    ]);
    if (field.sourceSetHash !== battle.common.fieldSourceSetHash)
      throw new Error("Field/battle source mismatch");
    return { field, battle };
  }

  private async readMap(read: ContentReader, mapId: number, catalog: WorldCatalog): Promise<WorldMapContent> {
    integer(mapId, 1);
    const index = catalog.maps[String(mapId)];
    if (!index) throw new Error(`Missing map content dependency: ${mapId}`);
    object(index); text(index.url); hash(index.contentHash); integer(index.areaId);
    const map = await read(index.url, mapContent, index.contentHash);
    if (map.mapId !== mapId || map.areaId !== index.areaId ||
        map.sourceSetHash !== catalog.sourceSetHash || map.parentSourceSetHash !== catalog.parentSourceSetHash ||
        map.mediaSourceSetHash !== catalog.mediaSourceSetHash ||
        (map.map !== null && (map.map.identity?.mapId !== mapId || map.map.identity.areaId !== map.areaId)))
      throw new Error("Map package/source identity mismatch");
    return map;
  }

  private async readSourceEntry(read: ContentReader, expected?: string): Promise<SourceEntryContent> {
    const [content, catalog, battle] = await Promise.all([
      read("/game/new-game.json", sourceContent, expected),
      read("/world/catalog.json", worldContent), read("/game/battle.json", battleContent),
    ]);
    if (content.battleCatalogHash !== battle.contentHash || content.worldCatalogHash !== catalog.contentHash ||
        content.sourceSetHash !== catalog.sourceSetHash || content.parentSourceSetHash !== catalog.parentSourceSetHash ||
        catalog.maps[String(content.entry.mapId)]?.contentHash !== content.mapContentHash)
      throw new Error("Fresh game source/content binding mismatch");
    const map = await this.readMap(read, content.entry.mapId, catalog);
    const script = content.entry.reservedScript;
    if (map.map === null || !Array.isArray(map.scripts[script.name]) ||
        map.scriptPuppetContexts?.[script.name]?.scriptHash !== script.contentHash)
      throw new Error("Fresh game entry/script dependency mismatch");
    return { content, catalog, map };
  }

  private async operation<T>(work: (read: ContentReader) => Promise<T>): Promise<T> {
    const dependencies = new Set<Promise<HashedContent>>();
    const read: ContentReader = async <C extends HashedContent>(url: string, parse: (value: unknown) => C, expected?: string) => {
      text(url);
      if (expected !== undefined) hash(expected);
      const key = JSON.stringify([url, expected ?? null]);
      let pending = this.cache.get(key);
      if (!pending) {
        pending = Promise.resolve().then(async () => {
          const value = structuredClone(await this.loadJson(url));
          object(value); hash(value.contentHash);
          const verified = await verifyContent(value as HashedContent, expected);
          // Unversioned entry reads can subsequently satisfy a hash-bound save.
          // An old in-flight load must never refill a cleared/replaced cache.
          if (this.cache.get(key) === pending) {
            const versionedKey = JSON.stringify([url, verified.contentHash]);
            if (!this.cache.has(versionedKey)) this.cache.set(versionedKey, pending!);
          }
          return verified;
        });
        this.cache.set(key, pending);
      }
      dependencies.add(pending);
      return parse(structuredClone(await pending));
    };
    try {
      return await work(read);
    } catch (error) {
      // Relation/shape failures are retryable too, not only failed fetches. Do
      // not evict a newer request installed after clear() or a competing retry.
      for (const [key, pending] of this.cache)
        if (dependencies.has(pending)) this.cache.delete(key);
      throw error;
    }
  }
}

export function fieldMediaUrls(field: FieldContent): string[] {
  return [...new Set([
    ...Object.values(field.map.textures),
    ...(field.map.backgrounds ?? []).map((background) => background.texture.url),
    ...Object.values(field.characters).flatMap((character) => Object.values(character.sprites).map((sprite) => sprite.file)),
    ...Object.values(field.minimap?.icons ?? {}).map((sprite) => sprite.file),
  ])];
}

export function openingMediaUrls(field: FieldContent, battle: BattleCatalog): string[] {
  return [...new Set([
    ...fieldMediaUrls(field), ...Object.values(battle.common.sprites).map((sprite) => sprite.file),
  ])];
}
