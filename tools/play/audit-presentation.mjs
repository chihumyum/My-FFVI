import { open, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RenderDiagnostics } from "../../apps/play/render-diagnostics.js";
import { FieldAnimations, fieldActorParts } from "../../apps/play/field-animation.js";
import { BattlePresentation } from "../../apps/play/battle-presentation.js";
import { existingPresentationActor } from "../../apps/play/presentation-events.js";

const imageURL = (value) =>
  typeof value === "string" && /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(value);
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
async function packedData(root, index) {
  const data = await json(path.join(root, index.core));
  data.programs = {};
  for (const file of new Set(Object.values(index.programFiles || {})))
    Object.assign(data.programs, await json(path.join(root, file)));
  return data;
}
const packedMap = (root, index, id) => {
  if (!index.maps?.[id]) throw Error(`Asset audit: map ${id} is absent from the static index`);
  return json(path.join(root, index.maps[id]));
};
const silentLog = () => {
  const log = new RenderDiagnostics({ acceptance: true, onIssue: () => {} });
  log.begin(null);
  return log;
};
const sorted = (values) => [...values].sort((a, b) => String(a).localeCompare(String(b)));
const animationInstructions = new Set([
  "CueAnim",
  "PlayAnim",
  "SetPos",
  "Move",
  "MoveBirdView",
  "MoveTo",
  "Lerp",
  "Route",
]);

export function presentationCoverageGaps(run) {
  const sourceEnding = run.titleScreen === true && run.finalBattleVictory === true;
  return run.stop && !sourceEnding && !["all-complete", "passed", "static-only"].includes(run.stop)
    ? [
        {
          stop: run.stop,
          caseId: run.caseId ?? null,
          reason: "Only observed sources are covered; this route was not completed",
        },
      ]
    : [];
}

// The packed renderer resolves original PR URLs through this exact index.
// A header/bounds check is not an image decode or a GPU render test.
export async function inspectImageIndex(index, assetRoot) {
  const pages = new Map();
  const inspectPage = async (file) => {
    if (!pages.has(file))
      pages.set(
        file,
        (async () => {
          const location = path.resolve(assetRoot, file);
          let handle;
          try {
            const info = await stat(location);
            if (!info.isFile()) return { reason: "file-not-regular", file };
            handle = await open(location, "r");
            const bytes = Buffer.alloc(24);
            const { bytesRead } = await handle.read(bytes, 0, 24, 0);
            if (
              bytesRead < 24 ||
              !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
              bytes.toString("ascii", 12, 16) !== "IHDR"
            )
              return { reason: "image-header-invalid", file };
            const width = bytes.readUInt32BE(16),
              height = bytes.readUInt32BE(20);
            return width > 0 && height > 0
              ? { file, width, height, bytes: info.size }
              : { reason: "image-size-invalid", file };
          } catch (error) {
            return {
              reason: error.code === "ENOENT" ? "file-missing" : "file-unreadable",
              file,
              error: error.message,
            };
          } finally {
            await handle?.close();
          }
        })(),
      );
    return pages.get(file);
  };
  const images = new Map();
  for (const [resource, entry] of Object.entries(index.assets?.images || {})) {
    let issue;
    if (typeof entry?.file !== "string") issue = { reason: "index-file-missing" };
    else {
      const page = await inspectPage(entry.file);
      const f = entry.frame;
      if (page.reason) issue = page;
      else if (
        !f ||
        ![f.x, f.y, f.w, f.h].every(Number.isInteger) ||
        f.x < 0 ||
        f.y < 0 ||
        f.w <= 0 ||
        f.h <= 0
      )
        issue = { ...page, reason: "atlas-frame-invalid", frame: f };
      else if (f.x + f.w > page.width || f.y + f.h > page.height)
        issue = { ...page, reason: "atlas-frame-out-of-bounds", frame: f };
      else issue = { ...page, frame: f };
    }
    images.set(resource, issue);
  }
  return { images, pages: pages.size };
}

function references(value, prefix = "", rows = []) {
  if (imageURL(value)) rows.push({ resource: value, source: prefix });
  else if (Array.isArray(value))
    value.forEach((child, index) => references(child, `${prefix}[${index}]`, rows));
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value)) references(child, `${prefix}.${key}`, rows);
  return rows;
}

function checkWaterLayers(log, map, scope, context) {
  for (const [index, layer] of (map.layers || []).entries())
    if (layer.sourceGroup === "WaterGroup" && layer.data?.some(Boolean) && !layer.waterMaterial)
      log.record(
        "water-material-unimplemented",
        {
          scope,
          entityId: `map-layer:${index}`,
          resource: layer.name,
          source: "PR map WaterGroup",
          reason:
            "PR WaterGroup control tiles are drawn directly; water/floor/reflection compositing is missing",
          sourcePropertyGap:
            "Parent WaterGroup custom_water_color and related composition properties are not preserved in the current map export",
        },
        context,
      );
}

function requestedBattlePose(unit, row, time, data, battle) {
  const age = time - (row.action?.at ?? -100),
    hurt = time - row.hurtAt;
  if (unit.hp <= 0) return "Down";
  if (hurt >= 0 && hurt < 0.28) return "Damage";
  if (age >= 0 && age < 0.85)
    return data.abilities[row.action.abilityId]?.kind === "physical"
      ? age < 0.15
        ? "Ready"
        : "RightAttack"
      : "SkillReady";
  if (battle.outcome === "victory") return "Win";
  if (unit.chargedAbility) return "SkillReady";
  if (unit.hp / unit.maxHp < 0.25) return "Dying";
  if (unit.defending || unit.ready) return "Ready";
  if ((unit.conditions || []).some((id) => data.conditions[id]?.condition_type === 7))
    return "CloseEyes";
  return "Default";
}

export class PresentationAudit {
  static async open({ dataRoot = "build/web-data", assetRoot = null, data, battleData } = {}) {
    dataRoot = path.resolve(dataRoot);
    assetRoot = path.resolve(assetRoot || path.join(dataRoot, "web"));
    const index = await json(path.join(assetRoot, "data/index.json"));
    const catalogs = {};
    const catalogFiles = {
      presentation: "presentation",
      "battle-presentation": "battlePresentation",
      "field-presentation": "fieldPresentation",
      particles: "effects",
      shaders: "shaders",
      opera: "opera",
      extras: "extras",
    };
    for (const [name, key] of Object.entries(catalogFiles))
      catalogs[name] = await json(path.join(assetRoot, index[key]));
    if (index.extrasPreviews)
      catalogs["extras-previews"] = await json(path.join(assetRoot, index.extrasPreviews));
    catalogs.particles.effects ||= {};
    for (const [asset, file] of Object.entries(catalogs.particles.files || {}))
      catalogs.particles.effects[asset] = await json(path.join(assetRoot, file));
    data ||= await packedData(assetRoot, index);
    battleData ||= await json(path.join(assetRoot, index.battle));
    const inspected = await inspectImageIndex(index, assetRoot);
    const shared = {
      dataRoot,
      assetRoot,
      index,
      catalogs,
      data,
      battleData,
      inspected,
      staticLog: silentLog(),
      staticReferences: 0,
      staticSources: {},
      staticEntities: { declaredAssets: 0, withoutSprite: [] },
      staticAnimations: { programs: 0, clips: 0, frames: 0 },
    };
    const audit = new PresentationAudit(shared);
    const scan = (value, source, context = {}) => {
      const base = {
        mapId: null,
        mapName: null,
        script: null,
        instructionIndex: null,
        time: null,
        ...context,
      };
      for (const ref of references(value, source)) {
        shared.staticReferences++;
        shared.staticSources[source] = (shared.staticSources[source] || 0) + 1;
        audit.check(ref.resource, { source: ref.source }, shared.staticLog, base);
      }
    };
    for (const type of ["audio", "fonts"])
      for (const [resource, file] of Object.entries(index.assets?.[type] || {})) {
        let reason;
        try {
          const info = await stat(path.resolve(assetRoot, file));
          if (!info.isFile()) reason = "file-not-regular";
          else if (!info.size) reason = "file-empty";
        } catch (error) {
          reason = error.code === "ENOENT" ? "file-missing" : "file-unreadable";
        }
        if (reason)
          shared.staticLog.record("mapped-file-invalid", {
            scope: "static",
            resource,
            file,
            reason,
            source: `web/data/index.json.assets.${type}`,
          });
      }
    for (const [resource, result] of inspected.images)
      if (result.reason)
        shared.staticLog.record("image-reference-invalid", {
          scope: "static",
          resource,
          ...result,
          source: "web/data/index.json",
        });
    scan(data.characters, "data.characters");
    scan(battleData, "battle");
    for (const [name, catalog] of Object.entries(catalogs)) scan(catalog, name);
    for (const [id, program] of Object.entries(data.programs || {})) {
      if (!program.animations?.length) continue;
      shared.staticAnimations.programs++;
      shared.staticAnimations.clips += program.animations.length;
      shared.staticAnimations.frames += program.animations.reduce(
        (count, clip) => count + (clip.frames?.length || 0),
        0,
      );
      scan(program.animations, `data.programs.${id}.animations`, { script: program.name });
    }
    for (const [asset, character] of Object.entries(data.characters || {}))
      for (const clip of character.animation?.data?.animation || [])
        for (const frame of clip.frames || [])
          if (!character.sprites?.[frame.sprite_name])
            shared.staticLog.record("field-frame-missing", {
              scope: "static",
              asset,
              animation: clip.name,
              resource: frame.sprite_name,
              source: "data.characters",
              reason: "PR clip names a sprite absent from its exported character",
            });
    for (const id of Object.keys(data.maps || {})) {
      const map = await packedMap(assetRoot, index, id);
      for (const [group, value] of Object.entries(
        map.groups || { entity_default: { entities: map.entities } },
      ))
        for (const entity of value.entities || []) {
          const context = {
            mapId: Number(id),
            mapName: map.name,
            script: map.initializer,
            instructionIndex: null,
            time: null,
          };
          if (entity.asset) {
            shared.staticEntities.declaredAssets++;
            if (!data.characters[entity.asset.toLowerCase()])
              shared.staticLog.record(
                "field-character-missing",
                {
                  scope: "static",
                  entityId: entity.id,
                  asset: entity.asset,
                  resource: entity.asset,
                  group,
                  reason: "PR map entity names an asset absent from the exported character catalog",
                },
                context,
              );
          } else if ([6, 10, 14, 17].includes(entity.kind))
            shared.staticEntities.withoutSprite.push({
              ...context,
              entityId: entity.id,
              resource: null,
              group,
              kind: entity.kind,
              sourceCause: entity.polyline
                ? "authored-polyline-has-no-sprite"
                : "authored-entity-asset-empty",
            });
        }
      scan(map.textures, `maps/${id}.textures`, {
        mapId: Number(id),
        mapName: map.name,
        script: map.initializer,
      });
      checkWaterLayers(shared.staticLog, map, "static", {
        mapId: Number(id),
        mapName: map.name,
        script: map.initializer,
        instructionIndex: null,
        time: null,
      });
    }
    return audit;
  }
  constructor(shared) {
    this.shared = shared;
    this.runtime = silentLog();
    this.runtime.mapNames = shared.catalogs.presentation.mapNames || {};
    this.coverage = {
      maps: new Set(),
      scripts: new Set(),
      actors: new Map(),
      effects: new Map(),
      instructions: new Set(),
      battles: new Set(),
    };
    this.sampleCount = 0;
    this.referenceCount = 0;
    this.field = new FieldAnimations((key, reason, details = {}) =>
      this.runtime.record(details.category || "field-animation-fallback", {
        ...this.actorContext,
        ...details,
        reason,
        fallback:
          details.fallback ??
          (details.category === "animation-chain-missing" ? "hold-final-frame" : null),
        warningKey: key,
      }),
    );
    // Only the existing selector methods are used. No Pixi containers,
    // textures, renderers or WebGL contexts are constructed here.
    this.view = Object.create(BattlePresentation.prototype);
    Object.assign(this.view, {
      catalog: shared.catalogs["battle-presentation"],
      data: shared.battleData,
      diagnostics: {
        record: (category, details) =>
          this.runtime.record(category, {
            scope: "runtime",
            source: "BattlePresentation source selector",
            ...details,
          }),
      },
      getTexture: (resource, details = {}) => {
        this.check(resource, {
          ...this.weaponContext,
          ...details,
          source: "BattlePresentation.drawWeapons (selection only)",
        });
        if (resource) this.coverage.actors.set(`weapon:${resource}`, { side: "weapon", resource });
        return null;
      },
    });
    this.battleRows = new WeakMap();
    this.effectReferences = new Map();
    this.mapReferences = new Map();
  }
  fork() {
    return new PresentationAudit(this.shared);
  }
  check(resource, details = {}, log = this.runtime, context) {
    if (log === this.runtime) this.referenceCount++;
    const result = this.shared.inspected.images.get(resource);
    let row;
    if (!result)
      row = log.record(
        resource?.startsWith("../") || resource?.includes(",")
          ? "source-image-declaration-unresolved"
          : "image-reference-unmapped",
        {
          scope: log === this.runtime ? "runtime" : "static",
          ...details,
          resource: resource ?? null,
          reason:
            resource?.startsWith("../") || resource?.includes(",")
              ? "Authored relative image declaration has no direct packed URL; resolved images are checked separately when present in export metadata"
              : resource
                ? "Original PR URL is absent from the packed image index; renderer attempts its direct source URL"
                : "Image reference is empty",
          fallback:
            resource && !resource.startsWith("../") && !resource.includes(",")
              ? "direct-source-url"
              : null,
        },
        context,
      );
    else if (result.reason)
      row = log.record(
        "image-reference-invalid",
        { scope: log === this.runtime ? "runtime" : "static", ...details, resource, ...result },
        context,
      );
    if (row && details.source) {
      row.sources ??= [];
      if (!row.sources.includes(details.source)) row.sources.push(details.source);
    }
  }
  source(game) {
    this.runtime.begin(game);
    if (game.mapId != null) this.coverage.maps.add(game.mapId);
    if (game.lastInstruction?.script) this.coverage.scripts.add(game.lastInstruction.script);
  }
  instruction(game, { name, i = [], r = [], s = [], script, index, actor, program }) {
    this.source(game);
    this.coverage.instructions.add(name);
    this.coverage.scripts.add(script);
    if (animationInstructions.has(name))
      this.field.event({
        name,
        i,
        r,
        s,
        script,
        time: game.time,
        animationActor: existingPresentationActor(game, actor),
        customAnimations: program?.animations || [],
      });
    if (name === "PlayBattleEffect") {
      this.runtime.record(
        "field-effect-host-unavailable",
        {
          scope: "runtime",
          resource: String(i[0] ?? s[0] ?? ""),
          reason:
            "PlayBattleEffect is an executed field instruction; no field effect-id renderer is implemented",
          source: "executed PR instruction",
        },
        { ...this.runtime.context, script, instructionIndex: index },
      );
    }
  }
  event(game, event) {
    this.source(game);
    const battle = game.battle;
    if (event.kind === "battle-action" && event.result && battle) {
      const unit = (event.actorSide === "enemy" ? battle.enemies : battle.players)[
        event.actorIndex
      ];
      if (unit) this.row(unit).action = { ...event, at: game.time };
      const target = (event.targetSide === "enemy" ? battle.enemies : battle.players)[
        event.targetIndex
      ];
      if (target && event.result.hit && event.result.amount > 0)
        this.row(target).hurtAt = game.time;
      if (event.abilityId === 1 && !event.result.hit) return;
      const catalog = this.shared.catalogs.particles;
      let id = catalog.abilities[event.abilityId];
      if (String(event.abilityId).startsWith("item:")) {
        const content = battle.data.contents[String(event.abilityId).slice(5)];
        id = catalog.items[content?.type_value];
      } else if (event.abilityId === 1) {
        const content = battle.data.contents[unit?.equipment?.[0]];
        id = catalog.weapons[content?.type_id === 2 ? content.type_value : 1];
      }
      const details = {
        entityId: `${event.actorSide}:${unit?.id ?? event.actorIndex}`,
        abilityId: event.abilityId,
        source: "actual battle-action effect mapping",
      };
      if (id == null || id === 0) {
        this.runtime.record("effect-mapping-absent", {
          ...details,
          scope: "runtime",
          resource: String(event.abilityId),
          reason:
            "Executed action has no nonzero PR effect mapping; renderer plays no particle effect",
        });
        return;
      }
      const mapping = catalog.effectIds[id],
        asset = mapping?.asset;
      this.coverage.effects.set(`${event.abilityId}:${id}`, {
        abilityId: event.abilityId,
        effectId: id,
        asset: asset ?? null,
      });
      const effect = catalog.effects[asset];
      if (!effect) {
        this.runtime.record("effect-data-missing", {
          ...details,
          scope: "runtime",
          resource: String(id),
          asset,
          reason: "PR effect mapping has no exported particle package",
        });
        return;
      }
      if (!this.effectReferences.has(asset))
        this.effectReferences.set(asset, references(effect, `particles.effects.${asset}`));
      for (const ref of this.effectReferences.get(asset))
        this.check(ref.resource, { ...details, asset, source: ref.source });
    } else if (event.kind === "opera") {
      const stage = this.shared.catalogs.opera.stages[event.stage];
      if (!stage)
        this.runtime.record("opera-stage-missing", {
          scope: "runtime",
          resource: String(event.stage),
          reason: "Executed opera stage has no exported source timeline",
        });
      else
        this.coverage.effects.set(`opera:${event.stage}`, {
          operaStage: event.stage,
          scene: stage.scene,
          timeline: stage.timeline,
        });
    }
  }
  row(unit) {
    if (!this.battleRows.has(unit))
      this.battleRows.set(unit, { action: null, hurtAt: -100, weapons: [{}, {}] });
    return this.battleRows.get(unit);
  }
  observe(game) {
    this.source(game);
    this.sampleCount++;
    if (game.battle) return this.observeBattle(game);
    const map = game.map;
    if (map && !this.mapReferences.has(map)) {
      const refs = [
        ...references(map.textures, "map.textures"),
        ...references(
          this.shared.catalogs["field-presentation"].maps[game.mapId],
          "field-presentation.maps",
        ),
      ];
      this.mapReferences.set(map, refs);
      checkWaterLayers(this.runtime, map, "runtime");
      for (const ref of refs)
        this.check(ref.resource, { source: ref.source, referenceScope: "declared-on-visited-map" });
    }
    for (const actor of [...(game.actors?.values() || []), game.player]) {
      if (!actor || actor.visible === false || actor === game.camera) continue;
      const parts = fieldActorParts(actor);
      if (!parts.length && (actor === game.player || [6, 10, 14, 17].includes(actor.kind)))
        this.runtime.record("field-asset-missing", {
          scope: "runtime",
          entityId: actor.id,
          resource: null,
          animation: actor.animation,
          reason: "Logically visible actor has no character asset",
          source: "fieldActorParts",
        });
      for (const { asset } of parts) {
        this.actorContext = {
          scope: "runtime",
          entityId: actor.id,
          asset,
          animation: actor.animation || "Default",
          source: "FieldAnimations.sample + fieldActorParts",
        };
        const character = this.shared.data.characters[asset?.toLowerCase()];
        if (!character?.sprites) {
          this.runtime.record("field-character-missing", {
            ...this.actorContext,
            resource: asset,
            reason: "Actor asset is absent from canonical exported PR character metadata",
          });
          continue;
        }
        const frame = this.field.sample(actor, character, game.time, asset);
        const record = {
          side: "field",
          asset,
          animation: actor.animation || "Default",
          clip: frame?.clip ?? null,
          frame: frame?.name ?? null,
        };
        this.coverage.actors.set(JSON.stringify(record), record);
        if (!frame?.info)
          this.runtime.record("field-frame-missing", {
            ...this.actorContext,
            resource: asset,
            reason: "FieldAnimations selected no available source frame",
          });
        else
          this.check(frame.info.file, {
            ...this.actorContext,
            frame: frame.name,
            clip: frame.clip,
          });
      }
    }
  }
  observeBattle(game) {
    const battle = game.battle;
    this.battleFrames = [];
    this.coverage.battles.add(battle.encounterId);
    this.view.battle = battle;
    this.view.formation = battle.formation;
    this.check(this.shared.battleData.backgrounds[battle.formation?.backgroundId]?.sprite?.url, {
      entityId: "battle-background",
      source: `battle.backgrounds.${battle.formation?.backgroundId}`,
    });
    for (const [side, units] of [
      ["enemy", battle.enemies],
      ["player", battle.players],
    ])
      for (const [index, unit] of units.entries()) {
        if (unit.hidden || unit.removed || unit.escaped) continue;
        const row = this.row(unit),
          entityId = `${side}:${unit.id ?? index}`;
        let info = unit.sprite,
          armor = null,
          animation = null;
        const pose = this.view.unitPose(
          unit,
          row,
          game.time,
          this.view.position(side, index).mirror,
        );
        info = pose?.info || info;
        armor = pose?.armor;
        if (pose)
          animation = requestedBattlePose(unit, row, game.time, this.shared.battleData, battle);
        if (side === "player") {
          animation = requestedBattlePose(unit, row, game.time, this.shared.battleData, battle);
          this.weaponContext = { entityId, animation };
          this.view.drawWeapons(unit, row, game.time);
        }
        const record = {
          side,
          asset: info?.url?.match(/\/(bc_ff6_[^/]+?)_assets_all_/i)?.[1] ?? unit.monsterId ?? null,
          animation,
          resource: info?.url ?? null,
          mounted: Boolean(armor),
        };
        this.battleFrames.push({
          ...record,
          index,
          entityId: unit.id,
          armorResource: armor?.url ?? null,
        });
        this.coverage.actors.set(JSON.stringify(record), record);
        this.check(info?.url, {
          entityId,
          animation,
          source: "BattlePresentation.pose (selection only)",
        });
        if (armor)
          this.check(armor.url, {
            entityId,
            animation,
            source: "BattlePresentation.mountedPose (selection only)",
          });
      }
  }
  report(run = {}, { includeStatic = true } = {}) {
    const staticIssues = this.shared.staticLog.summary(),
      runtimeIssues = this.runtime.summary();
    const categoryCounts = (issues) => {
      const counts = {};
      for (const row of issues) {
        const group = (counts[row.category] ||= { contexts: 0, calls: 0 });
        group.contexts++;
        group.calls += row.count;
      }
      return counts;
    };
    return {
      mode: "headless-presentation-reference-audit",
      sources: {
        metadataRoot: this.shared.assetRoot,
        gameMetadata: "Caller-supplied exported game data, or the static index core/program chunks",
        staticRoot: this.shared.assetRoot,
        imageIndex: this.shared.assetRoot
          ? path.join(this.shared.assetRoot, "data/index.json")
          : null,
      },
      validation:
        "Exported names, existing source selectors, local packed file types, PNG headers and atlas bounds only. No Pixi draw, image decode, WebGL/GPU, pixel, occlusion or browser validation. Actors are logically visible; no screen-frustum claim. Effect checks inspect references of executed mappings, not simulated particle output.",
      run,
      scope: {
        static: {
          references: this.shared.staticReferences,
          indexedImages: this.shared.inspected.images.size,
          atlasPages: this.shared.inspected.pages,
          indexedAudio: Object.keys(this.shared.index.assets?.audio || {}).length,
          indexedFonts: Object.keys(this.shared.index.assets?.fonts || {}).length,
          sources: this.shared.staticSources,
          entities: this.shared.staticEntities,
          customAnimations: this.shared.staticAnimations,
          categories: categoryCounts(staticIssues),
          contexts: staticIssues.length,
        },
        runtime: {
          samples: this.sampleCount,
          references: this.referenceCount,
          categories: categoryCounts(runtimeIssues),
          contexts: runtimeIssues.length,
        },
      },
      coverage: {
        maps: sorted(this.coverage.maps),
        scripts: sorted(this.coverage.scripts),
        instructions: sorted(this.coverage.instructions),
        battles: sorted(this.coverage.battles),
        actors: [...this.coverage.actors.values()],
        effects: [...this.coverage.effects.values()],
      },
      coverageGaps: presentationCoverageGaps(run),
      issues: [...(includeStatic ? staticIssues : []), ...runtimeIssues],
    };
  }
  async write(file, run = {}, options) {
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    const report = this.report(run, options);
    await writeFile(file, JSON.stringify(report, null, 2) + "\n");
    return report;
  }
}

// Explain the observed rows using exported PR metadata. This is a report-only
// join: no name guessing, warning removal, fallback choice or game mutation.
export async function writePresentationInventory(
  reportFile,
  { dataRoot = "build/web-data", staticRoot = null, output } = {},
) {
  const report = await json(reportFile);
  staticRoot = staticRoot && path.resolve(staticRoot);
  const index = staticRoot ? await json(path.join(staticRoot, "data/index.json")) : null,
    data = index
      ? await packedData(staticRoot, index)
      : await json(path.join(dataRoot, "data.json"));
  const animations = new Map(),
    bodies = new Map(),
    missingCharacters = new Map(),
    maps = new Map(),
    animationPrograms = new Map();
  for (const [id, program] of Object.entries(data.programs || {})) {
    if (!animationPrograms.has(program.name)) animationPrograms.set(program.name, []);
    animationPrograms.get(program.name).push({
      programId: id,
      script: program.name,
      clips: (program.animations || []).map((clip) => clip.name).sort(),
    });
  }
  const context = (row) => ({
    mapId: row.mapId,
    script: row.script,
    instructionIndex: row.instructionIndex,
    entityId: row.entityId,
  });
  for (const row of report.issues || []) {
    if (["animation-missing", "pose-fallback", "field-animation-fallback"].includes(row.category)) {
      const key = JSON.stringify([row.asset, row.animation]);
      if (!animations.has(key))
        animations.set(key, {
          asset: row.asset,
          requestedKey: row.animation,
          availableClips: (
            data.characters[row.asset?.toLowerCase()]?.animation?.data?.animation || []
          )
            .map((clip) => clip.name)
            .sort(),
          fallbacks: new Set(),
          sourceScripts: new Set(),
          customAnimationSources: new Map(),
          examples: [],
          countsByCategory: {},
          sourceCause:
            "Script/object playback key is not in the exported PR clip directory; naming mapping or special presentation semantics are not implemented. This is not a missing PNG file.",
        });
      const item = animations.get(key);
      for (const name of [row.animationSource, row.script])
        for (const program of animationPrograms.get(name) || [])
          item.customAnimationSources.set(program.programId, program);
      if (row.fallback != null) item.fallbacks.add(row.fallback);
      if (row.script) item.sourceScripts.add(row.script);
      item.countsByCategory[row.category] = (item.countsByCategory[row.category] || 0) + row.count;
      if (item.examples.length < 3) item.examples.push(context(row));
    }
    if (row.category === "field-asset-missing") {
      const key = JSON.stringify([row.mapId, row.entityId]);
      if (!bodies.has(key)) {
        if (!maps.has(row.mapId))
          maps.set(
            row.mapId,
            index
              ? await packedMap(staticRoot, index, row.mapId)
              : await json(path.join(dataRoot, "maps", `${row.mapId}.json`)),
          );
        const map = maps.get(row.mapId),
          definitions = [];
        for (const [group, value] of Object.entries(
          map.groups || { entity_default: { entities: map.entities } },
        ))
          for (const entity of value.entities || [])
            if (String(entity.id) === String(row.entityId))
              definitions.push({
                group,
                kind: entity.kind,
                asset: entity.asset,
                polyline: Boolean(entity.polyline),
                script: entity.script,
              });
        const sourceCause = definitions.some((e) => e.kind === 14 && e.polyline)
          ? "PR kind14 is an authored path/polyline with no sprite; the headless actor pass reports the absent sprite reference but this source body does not require a character image."
          : definitions.some((e) => e.asset)
            ? "PR declares a character asset, but the observed live/restored actor has none; the source image itself is not missing."
            : definitions.some((e) => e.kind === 6)
              ? "PR kind6 NPC source row has no asset declaration."
              : "No sprite declaration is available on this source body; inspect the preserved entity/script context.";
        bodies.set(key, {
          mapId: row.mapId,
          mapName: row.mapName,
          entityId: row.entityId,
          definitions,
          sourceCause,
          count: 0,
          sourceScripts: new Set(),
          examples: [],
        });
      }
      const item = bodies.get(key);
      item.count += row.count;
      if (row.script) item.sourceScripts.add(row.script);
      if (item.examples.length < 3) item.examples.push(context(row));
    }
    if (row.category === "field-character-missing") {
      const key = JSON.stringify([row.asset, row.entityId]);
      if (!missingCharacters.has(key))
        missingCharacters.set(key, {
          asset: row.asset,
          entityId: row.entityId,
          sourceCharacterRows: Object.values(data.fieldAssets || {}).filter(
            (entry) => Number(entry.character_id) === -Number(row.entityId),
          ),
          count: 0,
          sourceScripts: new Set(),
          examples: [],
        });
      const item = missingCharacters.get(key);
      item.count += row.count;
      if (row.script) item.sourceScripts.add(row.script);
      if (item.examples.length < 3) item.examples.push(context(row));
    }
  }
  const animationCause = (row) => {
    if (
      [...row.customAnimationSources.values()].some((source) =>
        source.clips.includes(row.requestedKey),
      )
    )
      return "An exported PR script Animations table contains this key, but the observed actor did not resolve it. Inspect its source binding/cache and the preserved instruction context; this is not a missing PNG file.";
    if (
      /^Walk/.test(row.requestedKey) &&
      row.availableClips.length === 1 &&
      row.availableClips[0] === "Default"
    )
      return "A generic movement request conflicts with this static object's PR clip directory, which contains only Default. Native default clip/key resolution remains unconfirmed; the observed fallback is retained without a guessed alias.";
    if (row.requestedKey === "Default" && row.availableClips.includes("Default_00"))
      return "The actor requests Default while its PR clip directory names Default_00. Native default clip resolution remains unconfirmed; the observed first-clip fallback is retained without a guessed alias.";
    return "The requested key is absent from the character's base anim_info and the observed source script Animations tables. A source binding or special presentation semantic remains unresolved; no name alias is guessed.";
  };
  const finish = (rows) =>
    [...rows.values()].map((row) => ({
      ...row,
      ...(row.fallbacks ? { fallbacks: [...row.fallbacks].sort() } : {}),
      ...(row.customAnimationSources
        ? {
            customAnimationSources: [...row.customAnimationSources.values()],
            sourceCause: animationCause(row),
          }
        : {}),
      sourceScripts: [...row.sourceScripts].sort(),
    }));
  const inventory = {
    mode: "headless-source-reference-inventory",
    sourceReport: reportFile,
    sourceMetadataRoot: staticRoot || dataRoot,
    note: "Counts are preserved per diagnostic category. animation-missing and pose-fallback can describe the same sample; they are not added as separate missing files. No GPU validation or guessed name mapping.",
    animationKeys: finish(animations).sort(
      (a, b) =>
        String(a.asset).localeCompare(String(b.asset)) ||
        String(a.requestedKey).localeCompare(String(b.requestedKey)),
    ),
    bodiesWithoutSprite: finish(bodies),
    missingCharacters: finish(missingCharacters),
  };
  if (output) {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, JSON.stringify(inventory, null, 2) + "\n");
  }
  return inventory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  if (args.includes("--inventory-from")) {
    const output = value("--out", "build/play/acceptance/presentation-inventory.json");
    const inventory = await writePresentationInventory(value("--inventory-from"), {
      dataRoot: value("--data", "build/web-data"),
      staticRoot: value("--assets", null),
      output,
    });
    console.log(
      JSON.stringify({
        output,
        animationKeys: inventory.animationKeys.length,
        bodiesWithoutSprite: inventory.bodiesWithoutSprite.length,
        missingCharacters: inventory.missingCharacters.length,
      }),
    );
  } else {
    const audit = await PresentationAudit.open({
      dataRoot: value("--data", "build/web-data"),
      assetRoot: value("--assets", null),
    });
    const output = value("--out", "build/play/acceptance/presentation-static.json");
    const report = await audit.write(output, { start: "static-catalog", stop: "static-only" });
    const {
      references,
      indexedImages,
      atlasPages,
      indexedAudio,
      indexedFonts,
      categories,
      contexts,
    } = report.scope.static;
    console.log(
      JSON.stringify({
        output,
        static: {
          references,
          indexedImages,
          atlasPages,
          indexedAudio,
          indexedFonts,
          categories,
          contexts,
        },
        gpuValidation: false,
      }),
    );
  }
}
