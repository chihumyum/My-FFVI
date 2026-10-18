const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const walking = /^(?:Default(?:-S)?|Walk(?:B|L|R)?(?:-S)?)$/;
const facing = { up: "WalkB", right: "WalkR", down: "Default", left: "WalkL" };
const metadata = new WeakMap();

export function fieldActorParts(actor) {
  if (actor.vehicle !== 6) return actor.asset ? [{ asset: actor.asset }] : [];
  // PR Serial.FF6.Map.TransportationEvent's ride structure for vehicle 6:
  // hideFeetUnitNum=8, floatingUnitNum=14 (constructor RVA40b47a).
  return [
    ...(actor.walkAsset ? [{ asset: actor.walkAsset, hideFeet: 8, offsetY: 14 }] : []),
    { asset: "mo_ff6_v006_c00" },
  ];
}

function clipsFor(character) {
  let clips = metadata.get(character);
  if (!clips) {
    clips = new Map((character.animation?.data?.animation || []).map((clip) => [clip.name, clip]));
    metadata.set(character, clips);
  }
  return clips;
}

/** PR play_speed is the duration of the entire authored frame sequence, in seconds. */
export function sampleFieldClip(
  character,
  name,
  elapsed,
  normalized,
  warn = () => {},
  resolvedClips = null,
) {
  const clips = resolvedClips || clipsFor(character);
  let clip = clips.get(name) || clips.get(name === "Walk" ? "Default" : name);
  if (!clip) {
    clip = clips.get("Default") || clips.values().next().value;
    warn(`clip:${name}`, `Missing PR field animation ${name}; holding its Default pose.`, {
      category: "animation-missing",
      animation: name,
      fallback: clip?.name || null,
    });
    warn(
      `pose-fallback:${name}`,
      `Field pose falls back from ${name} to ${clip?.name || "no clip"}.`,
      {
        category: "pose-fallback",
        animation: name,
        fallback: clip?.name || null,
      },
    );
  }
  if (!clip?.frames?.length) {
    const key = Object.keys(character.sprites || {}).sort()[0];
    warn(
      `empty-clip:${name}`,
      `Field animation ${name} has no frames; selecting ${key || "no sprite"}.`,
      {
        category: "frame-fallback",
        animation: name,
        fallback: key || null,
      },
    );
    return key ? { info: character.sprites[key], name: key, flip: false } : null;
  }
  let at = Math.max(0, elapsed || 0);
  const visited = new Map();
  // Mode 3 chains the two walking halves. Skip complete cycles without an
  // unbounded loop, including saves restored hours into a map.
  while (normalized == null && clip.play_mode === 3 && clip.play_speed > 0) {
    if (at < clip.play_speed) break;
    // PR UpdateLinkToMove wraps the phase; SwitchNextAnimation is a no-op
    // when next_anim_name is empty. Keep cycling this clip, rather than
    // treating the three opening armor clips (and vehicle loops) as broken.
    if (!clip.next_anim_name) {
      at %= clip.play_speed;
      break;
    }
    if (visited.has(clip.name)) {
      const cycle = visited.get(clip.name) - at;
      if (cycle > 0) at %= cycle;
      visited.clear();
      if (at < clip.play_speed) break;
    }
    visited.set(clip.name, at);
    const next = clips.get(clip.next_anim_name);
    if (!next?.frames?.length) {
      warn(
        `chain:${clip.name}`,
        `PR chained field clip ${clip.name} has no next clip; holding its final frame.`,
        {
          category: "animation-chain-missing",
          animation: clip.name,
          requestedNext: clip.next_anim_name || null,
        },
      );
      break;
    }
    at -= clip.play_speed;
    clip = next;
  }
  let progress =
    normalized == null ? (clip.play_speed > 0 ? at / clip.play_speed : 0) : clamp(normalized);
  if (normalized == null && clip.play_mode === 1) progress %= 1;
  if (normalized == null && clip.play_mode === 2) {
    warn("field-mode2", "PR field animation mode2 is approximated as ping-pong playback.", {
      category: "animation-playback-approximate",
      animation: clip.name,
    });
    progress = 1 - Math.abs((progress % 2) - 1);
  }
  const index = Math.min(clip.frames.length - 1, Math.floor(clamp(progress) * clip.frames.length));
  let frame = clip.frames[index];
  let info = character.sprites?.[frame.sprite_name];
  if (!info) {
    warn(
      `frame:${frame.sprite_name}`,
      `Missing PR field sprite ${frame.sprite_name}; holding an available pose.`,
      { category: "sprite-frame-missing", frame: frame.sprite_name },
    );
    frame = clip.frames.find((frame) => character.sprites?.[frame.sprite_name]) ||
      clips.get("Default")?.frames.findLast((frame) => character.sprites?.[frame.sprite_name]) || {
        sprite_name: Object.keys(character.sprites || {}).sort()[0],
      };
    info = character.sprites?.[frame.sprite_name];
    warn(
      `frame-fallback:${name}`,
      `Field frame falls back to ${frame.sprite_name || "no sprite"}.`,
      { category: "frame-fallback", fallback: frame.sprite_name || null },
    );
    if (!info) return null;
  }
  const rgb = frame.rgb || { r: 1, g: 1, b: 1 };
  return {
    info,
    name: frame.sprite_name,
    clip: clip.name,
    flip: Boolean(clip.is_reverse) !== Boolean(frame.flip),
    offsetx: Number(frame.offsetx) || 0,
    offsety: Number(frame.offsety) || 0,
    alpha: frame.alpha == null ? 1 : clamp(frame.alpha),
    tint:
      (Math.round(clamp(rgb.r) * 255) << 16) |
      (Math.round(clamp(rgb.g) * 255) << 8) |
      Math.round(clamp(rgb.b) * 255),
  };
}

/** Host-owned clocks: rendering never writes playback state into the game/save. */
export class FieldAnimations {
  constructor(warn = () => {}) {
    this.warn = warn;
    this.reset();
  }
  reset() {
    this.actors = new WeakMap();
    this.cues = new WeakMap();
    this.custom = new WeakMap();
  }
  // Host-owned playback is included only in diagnostic still frames. A normal
  // game save remains independent of rendering and contains none of this.
  capture(actors) {
    return [...new Set(actors)].filter(Boolean).map((actor) => {
      const custom = this.custom.get(actor);
      return {
        actor,
        states: this.actors.get(actor),
        cue: this.cues.get(actor),
        custom: custom && { source: custom.source, script: custom.script, cache: custom.cache },
      };
    });
  }
  restore(rows) {
    this.reset();
    for (const { actor, states, cue, custom } of rows || []) {
      if (states) this.actors.set(actor, states);
      if (cue) this.cues.set(actor, cue);
      if (custom) this.custom.set(actor, { ...custom, catalogs: new WeakMap() });
    }
  }
  event(event) {
    if (!event?.animationActor) return;
    const cue = ["CueAnim", "PlayAnim"].includes(event.name);
    if (!cue && !event.s?.[0]) return;
    if (event.customAnimations) {
      let binding = this.custom.get(event.animationActor);
      if (!binding)
        this.custom.set(
          event.animationActor,
          (binding = { cache: new Map(), catalogs: new WeakMap() }),
        );
      binding.source = event.customAnimations;
      binding.script = event.script;
    }
    if (!cue) return;
    this.cues.set(event.animationActor, {
      time: event.time,
      animation: event.animationActor.animation,
      x: event.animationActor.x,
      y: event.animationActor.y,
      // FieldSpriteEntity.CueAnimation RVAaead30: a negative normalized time
      // selects 1.0 (last pose), rather than clamping to the first frame.
      normalized: event.name === "CueAnim" ? (event.r?.[0] < 0 ? 1 : clamp(event.r?.[0])) : null,
    });
  }
  clips(actor, character) {
    const base = clipsFor(character),
      binding = this.custom.get(actor);
    if (!binding) return base;
    let row = binding.catalogs.get(character);
    if (row?.source !== binding.source) {
      // Native SetupAnimCommon looks up the character's own anim_info first,
      // then cached script definitions, then the executing script's Animations.
      const clips = new Map((binding.source || []).map((clip) => [clip.name, clip]));
      for (const [name, clip] of binding.cache) clips.set(name, clip);
      for (const [name, clip] of base) clips.set(name, clip);
      row = { source: binding.source, clips };
      binding.catalogs.set(character, row);
    }
    return row.clips;
  }
  sample(actor, character, time, asset = actor.asset) {
    let states = this.actors.get(actor);
    if (!states) this.actors.set(actor, (states = new Map()));
    let state = states.get(asset);
    let cue = this.cues.get(actor);
    if (
      cue &&
      (actor.motion || actor.animation !== cue.animation || actor.x !== cue.x || actor.y !== cue.y)
    ) {
      this.cues.delete(actor);
      cue = null;
    }
    const clips = this.clips(actor, character);
    const locomotion = walking.test(actor.animation || "Default") && clips.has("WalkB");
    const name = locomotion ? facing[actor.direction] || "Default" : actor.animation || "Default";
    if (!state || state.name !== name || state.cue !== cue || time < state.lastTime) {
      state = { name, cue, start: cue?.time ?? time, x: actor.x, y: actor.y, movedAt: -Infinity };
      states.set(asset, state);
    }
    const moved = state.x !== actor.x || state.y !== actor.y;
    if (moved) {
      if (time - state.movedAt > 0.2) state.start = time;
      state.movedAt = time;
    }
    state.x = actor.x;
    state.y = actor.y;
    state.lastTime = time;
    const moving = !!actor.motion || time - state.movedAt < 0.18;
    const idle = locomotion && !moving && !cue;
    // Walking clips end on the neutral pose; standing does not keep marching.
    const normalized = idle ? 1 : cue?.normalized;
    const binding = this.custom.get(actor);
    if (binding && !clipsFor(character).has(name) && clips.has(name))
      binding.cache.set(name, clips.get(name));
    const result = sampleFieldClip(
      character,
      name,
      time - state.start,
      normalized,
      (key, message, details) =>
        this.warn(key, message, {
          entityId: actor.id,
          asset,
          resource: asset,
          animation: name,
          ...details,
          animationSource: binding?.script || null,
        }),
      clips,
    );
    if (binding && result?.clip && !clipsFor(character).has(result.clip))
      binding.cache.set(result.clip, clips.get(result.clip));
    return result;
  }
}

function openedTreasure(game, entity) {
  const actor = game.actors?.get(String(entity.id));
  if (actor?.opened) return true;
  const flag = Number(entity.treasure?.flagId);
  if (Number.isInteger(flag) && flag >= 0 && flag < 1024)
    return Boolean(game.banks?.[`TreasureFlag${1 + Math.floor(flag / 256)}`]?.[flag % 256]);
  return Boolean(game.banks?.PlaySystems?.openedTreasure?.[`${game.mapId}:${entity.id}`]);
}

/** Prepare only the small stateful regions; ordinary water/fire stays clock-driven. */
export function fieldTileRegions(game) {
  const entities = game.entities || game.map?.entities || [];
  const treasure = entities.filter((entity) => entity.kind === 7 && entity.treasure);
  return entities
    .filter((entity) => entity.kind === 1)
    .map((entity) => {
      const actor = game.actors?.get(String(entity.id));
      const chest = treasure.find(
        (item) =>
          entity.objectId > 0 && item.treasure.presentation?.linkObjectId === entity.objectId,
      );
      const reverse = !!entity.tileAnimation?.reverse;
      const hiddenDoor = entities.some((door) => {
        if (entity.objectId <= 0 || door.kind !== 8 || door.door?.linkObjectId !== entity.objectId)
          return false;
        const body = game.actors?.get(String(door.id));
        return body?.opened === true || (body?.visible === false && body.opened !== false);
      });
      const normalized = chest ? Number(openedTreasure(game, chest)) : Number(hiddenDoor);
      return {
        ...entity,
        frame: chest
          ? reverse
            ? 1 - normalized
            : normalized
          : (actor?.tileFrame ?? (reverse ? 1 - normalized : normalized)),
      };
    });
}

export function sampleFieldTile(animation, time, x, y, layer, regions) {
  const region = regions.find(
    (region) =>
      (region.tileAnimation?.allLayers || region.layer === layer) &&
      x >= region.x &&
      y >= region.y &&
      x < region.x + region.width &&
      y < region.y + region.height,
  );
  // Duration=1 entries are PR state alternatives, not a 500 Hz animation.
  if (region || animation.every((frame) => frame.duration <= 1))
    return animation[
      Math.min(animation.length - 1, Math.floor(clamp(region?.frame) * animation.length))
    ].tileid;
  const duration = animation.reduce((sum, frame) => sum + (frame.duration || 200), 0);
  let at = (((time * 1000) % duration) + duration) % duration;
  for (const frame of animation) {
    at -= frame.duration || 200;
    if (at < 0) return frame.tileid;
  }
  return animation.at(-1).tileid;
}
