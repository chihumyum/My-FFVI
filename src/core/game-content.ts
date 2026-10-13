import type { FieldContent } from "../field/types.js";
import type { WorldCatalog, WorldMapContent } from "../field/world.js";
import type { BattleCatalog, BattleContent, CombatantDefinition } from "./battle-content.js";
import { verifyContent } from "./content-integrity.js";
import type { GameCheckpoint, GameRestoreWorld } from "./game-session.js";
import type { SourceNewGameContent } from "./source-new-game.js";
import { assertSourceGameCatalog } from "./source-catalog.js";
import { parseGameContentRefs, type GameContentProfile, type GameContentRefs } from "./game-content-refs.js";
import { parseGameDevelopmentEntry, assertGameDevelopmentEntry } from "./game-development-entry.js";

export type { GameContentProfile } from "./game-content-refs.js";

type HashedContent = { contentHash: string };
type ContentReference = { url: string; contentHash?: string };
type EntryReferences = { entry: ContentReference; battle: ContentReference };
type ContentReader = <T extends HashedContent>(
  url: string,
  parse: (value: unknown) => T,
  expected?: string,
) => Promise<T>;
type OpeningContent = { field: FieldContent; battle: BattleCatalog;
  development?: { catalog: WorldCatalog; map: WorldMapContent } };
export type SourceEntryContent = {
  content: SourceNewGameContent;
  catalog: WorldCatalog;
  map: WorldMapContent;
  battle: BattleCatalog;
};
export type RestoreSessionContent = {
  initial?: FieldContent;
  battle: BattleCatalog;
  world?: GameRestoreWorld;
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
  private readonly worldUrl: string;
  private readonly newGameUrl: string;
  private readonly references: GameContentRefs | undefined;

  constructor(private readonly loadJson: (url: string) => Promise<unknown>,
    private readonly profile: GameContentProfile = "source", refs?: GameContentRefs) {
    if (profile !== "source" && profile !== "framework") throw new Error("Unknown game content profile");
    this.references = refs === undefined ? undefined : parseGameContentRefs(refs);
    if (this.references && this.references.profile !== profile) throw new Error("Game content references profile mismatch");
    this.worldUrl = profile === "framework" ? "/framework/world/catalog.json" : "/world/catalog.json";
    this.newGameUrl = profile === "framework" ? "/framework/new-game.json" : "/game/new-game.json";
  }

  get hasSourceEntry(): boolean { return this.references?.source !== null; }
  get hasDevelopmentEntry(): boolean { return this.references?.development !== null; }

  private worldReference(): ContentReference {
    return this.references === undefined ? { url: this.worldUrl } : this.references.world;
  }

  private entryReferences(kind: "source" | "development"): EntryReferences {
    if (this.references === undefined) return kind === "source"
      ? { entry: { url: this.newGameUrl }, battle: { url: "/game/source-catalog.json" } }
      : { entry: { url: "/game/content.json" }, battle: { url: "/game/battle.json" } };
    const references = this.references[kind];
    if (references === null) throw new Error("Game content " + kind + " entry is unavailable");
    return references;
  }

  private pinnedExpected(reference: ContentReference, expected?: string): string | undefined {
    if (reference.contentHash !== undefined && expected !== undefined && reference.contentHash !== expected)
      throw new Error("Game content host pin identity mismatch");
    return reference.contentHash ?? expected;
  }

  private readWorld(read: ContentReader): Promise<WorldCatalog> {
    const reference = this.worldReference();
    return read(reference.url, (value) => this.profileContent(worldContent(value)), reference.contentHash);
  }

  private profileContent<T extends { developmentProfile?: { kind: string; policy: string; sourceContentHash: string }; walkEncounters?: unknown }>(value: T): T {
    const policy = value.developmentProfile;
    if (this.profile === "source" ? policy !== undefined || value.walkEncounters !== undefined :
      policy?.kind !== "framework-development-v1" || policy.policy !== "omit-anonymous-environment-particles-v1")
      throw new Error("Game content development profile mismatch");
    if (policy) hash(policy.sourceContentHash);
    return value;
  }

  clear(): void {
    this.cache.clear();
  }

  opening(): Promise<OpeningContent> {
    return this.operation((read) => this.readOpening(read));
  }

  world(): Promise<WorldCatalog> {
    return this.operation((read) => this.readWorld(read));
  }

  map(mapId: number, catalog?: WorldCatalog): Promise<WorldMapContent> {
    // Capture supplied dependencies before the first await. A caller changing
    // an index while a fetch is pending cannot redirect the completed read.
    const supplied = catalog === undefined ? undefined : structuredClone(catalog);
    return this.operation(async (read) => {
      integer(mapId, 1);
      const world = supplied === undefined
        ? await this.readWorld(read)
        : this.profileContent(worldContent(await verifyContent(supplied, this.worldReference().contentHash)));
      return this.readMap(read, mapId, world);
    });
  }

  sourceNewGame(): Promise<SourceEntryContent> {
    return this.operation((read) => this.readSourceEntry(read));
  }

  async restoreWorld(checkpoint: GameCheckpoint): Promise<GameRestoreWorld | undefined> {
    return (await this.restoreSessionContent(checkpoint)).world;
  }

  restoreSessionContent(checkpoint: GameCheckpoint): Promise<RestoreSessionContent> {
    const saved = structuredClone(checkpoint);
    return this.operation(async (read) => {
      header(saved, "game-checkpoint");
      if (saved.formatVersion !== 4 && saved.formatVersion !== 5) throw new Error("Game checkpoint version mismatch");
      header(saved.world, saved.world?.kind === "event-world-v1" ? "event-world-v1" : "idle-world-v10");
      text(saved.sourceSetHash); hash(saved.battleCatalogHash); hash(saved.world.initialHash);
      object(saved.origin);
      if (this.references !== undefined && saved.world.location !== null) {
        object(saved.world.location); hash(saved.world.location.catalogHash);
        this.pinnedExpected(this.worldReference(), saved.world.location.catalogHash);
      }
      let result: RestoreSessionContent;
      if (saved.origin.kind === "source-new-game") {
        hash(saved.origin.sourceContentHash);
        const references = this.entryReferences("source");
        this.pinnedExpected(references.entry, saved.origin.sourceContentHash);
        this.pinnedExpected(references.entry, saved.world.initialHash);
        this.pinnedExpected(references.battle, saved.battleCatalogHash);
        const initial = await this.readSourceEntry(read, saved.origin.sourceContentHash);
        if (saved.sourceSetHash !== initial.content.parentSourceSetHash ||
            saved.battleCatalogHash !== initial.content.battleCatalogHash ||
            saved.world.initialHash !== initial.content.contentHash)
          throw new Error("Game checkpoint source identity mismatch");
        result = { battle: initial.battle, world: { catalog: initial.catalog, map: initial.map,
          source: { content: initial.content, initialMap: initial.map } } };
      } else if (saved.origin.kind === "development-checkpoint") {
        const references = this.entryReferences("development");
        this.pinnedExpected(references.entry, saved.world.initialHash);
        this.pinnedExpected(references.battle, saved.battleCatalogHash);
        const initial = await this.readOpening(read);
        if (saved.sourceSetHash !== initial.field.parentSourceSetHash ||
            saved.battleCatalogHash !== initial.battle.contentHash ||
            saved.world.initialHash !== initial.field.contentHash)
          throw new Error("Game checkpoint source identity mismatch");
        if (initial.development && saved.world.location === null)
          throw new Error("Development map checkpoint requires a published map");
        result = { initial: initial.field, battle: initial.battle };
      } else {
        throw new Error("Unknown game checkpoint origin");
      }
      if (saved.world.location === null) return result;
      const location = saved.world.location;
      object(location); integer(location.mapId, 1); integer(location.entrance); hash(location.catalogHash);
      const catalog = result.world?.catalog ?? await this.readWorld(read);
      if (location.catalogHash !== catalog.contentHash || catalog.parentSourceSetHash !== saved.sourceSetHash)
        throw new Error("Saved map catalog/source identity mismatch");
      const map = await this.readMap(read, location.mapId, catalog);
      return { ...result, world: { ...result.world, catalog, map } };
    });
  }

  private async readOpening(read: ContentReader): Promise<OpeningContent> {
    const references = this.entryReferences("development");
    const [field, battle] = await Promise.all([
      read(references.entry.url, fieldContent, references.entry.contentHash),
      read(references.battle.url, battleContent, references.battle.contentHash),
    ]);
    if (field.sourceSetHash !== battle.common.fieldSourceSetHash)
      throw new Error("Field/battle source mismatch");
    if (field.developmentEntry !== undefined) {
      if (this.profile !== "framework") throw new Error("Development map entry requires the framework profile");
      const entry = parseGameDevelopmentEntry(field.developmentEntry), catalog = await this.readWorld(read);
      const map = await this.readMap(read, entry.startMap, catalog);
      await assertGameDevelopmentEntry(field, battle, catalog, map);
      return { field, battle, development: { catalog, map } };
    }
    return { field, battle };
  }

  private async readMap(read: ContentReader, mapId: number, catalog: WorldCatalog): Promise<WorldMapContent> {
    integer(mapId, 1);
    const index = catalog.maps[String(mapId)];
    if (!index) throw new Error(`Missing map content dependency: ${mapId}`);
    object(index); text(index.url); hash(index.contentHash); integer(index.areaId);
    const map = await read(index.url, (value) => this.profileContent(mapContent(value)), index.contentHash);
    if (map.mapId !== mapId || map.areaId !== index.areaId ||
        map.sourceSetHash !== catalog.sourceSetHash || map.parentSourceSetHash !== catalog.parentSourceSetHash ||
        map.mediaSourceSetHash !== catalog.mediaSourceSetHash ||
        (map.map !== null && (map.map.identity?.mapId !== mapId || map.map.identity.areaId !== map.areaId)))
      throw new Error("Map package/source identity mismatch");
    return map;
  }

  private async readSourceEntry(read: ContentReader, expected?: string): Promise<SourceEntryContent> {
    const references = this.entryReferences("source");
    const entryExpected = this.pinnedExpected(references.entry, expected);
    const [content, catalog, battle] = await Promise.all([
      read(references.entry.url, (value) => this.profileContent(sourceContent(value)), entryExpected),
      this.readWorld(read), read(references.battle.url, battleContent, references.battle.contentHash),
    ]);
    // Source-origin restore uses this same entry path, so a matching saved
    // hash cannot turn a development battle policy into source admission.
    assertSourceGameCatalog(battle, this.profile);
    this.pinnedExpected(references.battle, content.battleCatalogHash);
    this.pinnedExpected(this.worldReference(), content.worldCatalogHash);
    if (content.battleCatalogHash !== battle.contentHash || content.worldCatalogHash !== catalog.contentHash ||
        content.sourceSetHash !== catalog.sourceSetHash || content.parentSourceSetHash !== catalog.parentSourceSetHash ||
        catalog.maps[String(content.entry.mapId)]?.contentHash !== content.mapContentHash)
      throw new Error("Fresh game source/content binding mismatch");
    const map = await this.readMap(read, content.entry.mapId, catalog);
    const script = content.entry.reservedScript;
    if (map.map === null || !Array.isArray(map.scripts[script.name]) ||
        map.scriptPuppetContexts?.[script.name]?.scriptHash !== script.contentHash)
      throw new Error("Fresh game entry/script dependency mismatch");
    return { content, catalog, map, battle };
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

function fieldImageUrls(map: FieldContent["map"], characters: FieldContent["characters"],
  minimap: FieldContent["minimap"]): string[] {
  return [...new Set([
    ...Object.values(map.textures),
    ...(map.backgrounds ?? []).map((background) => background.texture.url),
    ...Object.values(characters).flatMap((character) => Object.values(character.sprites).map((sprite) => sprite.file)),
    ...Object.values(minimap?.icons ?? {}).map((sprite) => sprite.file),
  ])];
}

export function fieldMediaUrls(field: FieldContent): string[] {
  return fieldImageUrls(field.map, field.characters, field.minimap);
}

function battleUnitMediaKeys(content: Pick<BattleContent, "sprites" | "battleAppearance">,
  units: readonly Pick<CombatantDefinition, "sprites" | "appearance">[]): Set<string> {
  const keys = new Set<string>();
  let appearance = false;
  for (const unit of units) {
    text(unit.sprites.idle); keys.add(unit.sprites.idle);
    if (unit.sprites.mount !== null) { text(unit.sprites.mount); keys.add(unit.sprites.mount); }
    if (unit.appearance) {
      appearance = true;
      for (const key of Object.values(unit.appearance.bodySprites)) { text(key); keys.add(key); }
    }
  }
  if (appearance) {
    if (!content.battleAppearance) throw new Error("Battle appearance media provider is unavailable");
    for (const key of Object.values(content.battleAppearance.armorSprites)) { text(key); keys.add(key); }
  }
  return keys;
}
function battleSpriteFiles(sprites: BattleContent["sprites"], keys: Iterable<string>): string[] {
  const files = new Set<string>();
  for (const key of keys) {
    if (!Object.hasOwn(sprites, key)) throw new Error("Missing battle media reference: " + key);
    const sprite = sprites[key]!;
    text(sprite.file);
    if (!Number.isInteger(sprite.width) || sprite.width <= 0 || !Number.isInteger(sprite.height) || sprite.height <= 0)
      throw new Error("Invalid battle media dimensions: " + key);
    files.add(sprite.file);
  }
  return [...files];
}

/** The same required unit poses serve roster preparation and actual battles.
 * A menu has no encounter/background; it cannot invent one to check members. */
export function battleUnitMediaUrls(content: Pick<BattleContent, "sprites" | "battleAppearance">,
  units: readonly Pick<CombatantDefinition, "sprites" | "appearance">[]): string[] {
  return battleSpriteFiles(content.sprites, battleUnitMediaKeys(content, units));
}

/** One encounter's media closure, including registered late enemies and frozen
 * borrowed players. Unused shared templates create no dependency. */
export function battleMediaUrls(content: BattleContent,
  players: readonly Pick<CombatantDefinition, "sprites" | "appearance">[] = content.players): string[] {
  return battleSpriteFiles(content.sprites, [content.background, ...battleUnitMediaKeys(content,
    [...players, ...content.enemies, ...Object.values(content.participants?.enemyDefinitions ?? {})])]);
}

export function sessionMediaUrls(field: FieldContent, battle: BattleCatalog): string[] {
  return [...new Set([
    ...fieldMediaUrls(field), ...Object.values(battle.common.sprites).map((sprite) => sprite.file),
  ])];
}

/** Compatibility name for callers that still load the development opening. */
export function openingMediaUrls(field: FieldContent, battle: BattleCatalog): string[] {
  return sessionMediaUrls(field, battle);
}

export function sourceEntryMediaUrls(entry: SourceEntryContent, { includeBattle = true }: { includeBattle?: boolean } = {}): string[] {
  if (entry.map.map === null) throw new Error("Fresh game entry map media is unavailable");
  return [...new Set([
    ...fieldImageUrls(entry.map.map, entry.catalog.characters, entry.catalog.minimap),
    ...(includeBattle ? Object.values(entry.battle.common.sprites).map((sprite) => sprite.file) : []),
  ])];
}
