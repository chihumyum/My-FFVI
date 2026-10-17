import { Container, Rectangle, Sprite, Texture } from "pixi.js";

// All clocks, poses and queues here belong to the renderer, never the combat engine.
export class BattlePresentation {
  constructor({ actors, effects, getTexture, warn, onEffect, diagnostics }) {
    Object.assign(this, { actors, effects, getTexture, warn, onEffect, diagnostics });
    this.units = new Map();
    this.events = [];
    this.numbers = [];
    this.catalog = null;
    this.clock = 0;
  }
  setCatalog(catalog) {
    this.catalog = catalog;
    for (const warning of catalog.warnings) this.warn(warning);
  }
  event(event) {
    // BattleEvents also emits a script summary after perform(). Per-hit events
    // carry indices and results; rendering the summary would duplicate the hit.
    if (event.kind === "battle-action" && !event.result) {
      this.warn(
        "Script action summaries are not damage events; per-hit events drive visuals. Function19 pose-only choreography remains approximate.",
      );
      return;
    }
    if (["battle-action", "battle-party"].includes(event.kind))
      this.events.push({ ...event, at: performance.now() / 1000 });
  }
  clear() {
    for (const row of this.units.values()) {
      row.riderCrop?.texture.destroy(false);
      row.container.destroy({ children: true });
    }
    for (const n of this.numbers) n.container.destroy({ children: true });
    this.units.clear();
    this.numbers = [];
    this.events = [];
    this.battle = null;
    this.formation = null;
  }
  attach(battle, data) {
    if (this.battle !== battle) {
      const pending = this.events;
      this.clear();
      this.events = pending;
      this.battle = battle;
    }
    this.data = data;
  }
  position(side, index) {
    const battle = this.battle;
    const unit = (side === "enemy" ? battle.enemies : battle.players)[index];
    const width = this.catalog?.camera.width || 384,
      height = this.catalog?.camera.height || 216;
    if (side === "enemy") {
      // CSV coordinates adjust PR's unique-slot lattice; they are not the
      // complete position. The source group selects the pincer side.
      const member = (this.formation || battle.formation).members.find(
        (m) => m.slot === unit?.slot,
      );
      const slot = this.catalog?.enemySlots?.[unit?.slot ?? member?.slot] ?? { x: 0, y: 0 },
        localX = slot.x + Number(unit?.x ?? member?.x ?? 0),
        localY = slot.y + Number(unit?.y ?? member?.y ?? 0),
        group = unit?.group ?? member?.group ?? 1;
      let x = width / 2 + (this.catalog?.enemyOrigin.x ?? -75) + localX;
      const y = height / 2 - (this.catalog?.enemyOrigin.y || 0) - localY;
      if (battle.pattern === 2) x = width - x;
      if (battle.pattern === 4 && group % 2 === 1)
        // SetEnemySideAttack moves the right group by (0.6-0.5)*camera height.
        x = width / 2 + height * 0.1 + localX;
      if (battle.pattern === 5)
        x = width / 2 + localX + ((this.formation || battle.formation).sideAttackOffset || 0);
      return {
        x,
        y,
        mirror:
          battle.pattern === 2 ||
          (battle.pattern === 4 && group % 2 === 1) ||
          (battle.pattern === 5 && group % 2 === 0),
      };
    }
    const limits = this.data?.limits || {},
      xStep = limits.X_COORDINATE_INTERVAL ?? 10,
      yStep = limits.Y_COORDINATE__INTERVAL ?? 19,
      baseY = limits.AS_BASE_Y_COORDINATE ?? 16,
      sideY = battle.pattern === 5 ? (limits.AS_BASE_Y_COORDINATE_SIDE_ATTACK_PLUS ?? 28) : 0,
      leftWing = (n) =>
        battle.pattern === 5 && (n >= 2 || (battle.players.length === 2 && n === 1)),
      indices = battle.players.flatMap((_, n) => (leftWing(n) === leftWing(index) ? [n] : []));
    let x =
        width / 2 +
        (unit?.row === "back"
          ? (limits.REAR_GUARD_X_COORDINATE ?? 93)
          : (limits.FORWARD_X_COORDINATE ?? 82)) +
        index * xStep,
      y = height / 2 - baseY + index * yStep - sideY;
    if (indices.some((n) => battle.players[n].magitek)) {
      const source = this.catalog.animationAliases?.default?.magic_armor_table,
        armor = this.catalog.groups[this.catalog.magitek?.asset]?.WalkL_01,
        rider = Math.max(
          ...indices.map((n) => this.data.characters?.[battle.players[n].id]?.sprite?.height || 32),
        ),
        extent = Math.max(
          armor?.height || 40,
          rider * (1 - (source?.chara_offsets[0]?.y || 0)) + (source?.chara_position[0]?.y || 24),
        ),
        bottom = height - 56,
        top = extent + 4,
        spacing = indices.length > 1 ? Math.min(extent, (bottom - top) / (indices.length - 1)) : 0,
        span = (indices.length - 1) * spacing,
        center =
          indices.reduce((sum, n) => sum + height / 2 - baseY + n * yStep - sideY, 0) /
          indices.length;
      y =
        Math.max(top, Math.min(center - span / 2, bottom - span)) +
        indices.indexOf(index) * spacing;
    }
    if (battle.pattern === 2 || leftWing(index)) x = width - x;
    if (battle.pattern === 4) x = width / 2;
    return {
      x,
      y,
      mirror: battle.pattern === 2 || leftWing(index) || (battle.pattern === 4 && index % 2 === 1),
    };
  }
  row(side, index) {
    const key = `${side}:${index}`;
    if (!this.units.has(key)) {
      const container = new Container(),
        sprite = new Sprite(Texture.EMPTY),
        armor = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5, 1);
      armor.anchor.set(0.5, 1);
      armor.visible = false;
      container.addChild(armor, sprite);
      const weapons = [new Sprite(Texture.EMPTY), new Sprite(Texture.EMPTY)];
      for (const w of weapons) {
        w.anchor.set(0.5);
        container.addChild(w);
      }
      this.actors.addChild(container);
      this.units.set(key, { container, sprite, armor, weapons, action: null, hurtAt: -100 });
    }
    return this.units.get(key);
  }
  group(unit) {
    const canonical = this.data.characters?.[unit.id];
    const source = canonical?.sprite || unit.normalSprite;
    const url = unit.side === "player" ? source?.url || unit.sprite?.url : unit.sprite?.url;
    const asset = url?.match(/\/(bc_ff6_[^/]+?)_assets_all_/i)?.[1]?.toLowerCase();
    const transformed = unit.trance && this.catalog?.groups[asset + "_tr"];
    if (unit.trance && !transformed)
      this.diagnostics?.record("battle-transformation-fallback", {
        entityId: unit.id,
        asset,
        resource: asset + "_tr",
        fallback: asset,
      });
    if (!transformed && !this.catalog?.groups[asset])
      this.diagnostics?.record("battle-animation-group-missing", {
        entityId: unit.id,
        asset,
        resource: url || asset || null,
      });
    return transformed || this.catalog?.groups[asset];
  }
  mountedPose(group, alias, now, mirror) {
    const armorGroup = this.catalog.groups[this.catalog.magitek?.asset];
    if (!armorGroup || !alias?.magic_armor_table) return null;
    const frame = Math.floor(now * 6),
      source = alias.magic_armor_table,
      riderIndex = frame % alias.names.length,
      riderName = alias.names[riderIndex],
      armorName = source.anim_names[frame % source.anim_names.length],
      rightName = (name) =>
        name.startsWith("WalkL_")
          ? name.replace("WalkL_", "WalkR_")
          : name.replace(/(_\d+)$/, "R$1");
    // Only use an authored right pose when both parts have one. Otherwise
    // mirror the whole assembly together, including its attachment offset.
    const explicitRight = mirror && group[rightName(riderName)] && armorGroup[rightName(armorName)],
      rider = group[explicitRight ? rightName(riderName) : riderName],
      armor = armorGroup[explicitRight ? rightName(armorName) : armorName];
    if (!rider || !armor) return null;
    return {
      info: rider,
      explicitRight: Boolean(explicitRight),
      armor,
      riderPosition: source.chara_position[riderIndex % source.chara_position.length],
      riderOffset: source.chara_offsets[riderIndex % source.chara_offsets.length],
    };
  }
  riderTexture(row, texture, offset) {
    const x = offset?.x || 0,
      y = offset?.y || 0;
    if (!x && !y) {
      row.riderCrop?.texture.destroy(false);
      row.riderCrop = null;
      return texture;
    }
    if (row.riderCrop?.base !== texture || row.riderCrop.x !== x || row.riderCrop.y !== y) {
      row.riderCrop?.texture.destroy(false);
      // PR UpdateCharacterAnimation (158d2cb) passes chara_offsets to
      // SpriteAnimBattle.ChangeTextureOffset. Its clamped, transparent-edged
      // 32px texture samples y+.25: the lower 8px disappear and the remaining
      // pixels move DOWN 8px inside the same mesh. A top-24px frame anchored
      // at the source chara_position reproduces that sampling in the atlas.
      const width = texture.frame.width,
        height = texture.frame.height;
      row.riderCrop = {
        base: texture,
        x,
        y,
        texture: new Texture({
          source: texture.source,
          frame: new Rectangle(
            texture.frame.x + Math.max(0, width * x),
            texture.frame.y + Math.max(0, -height * y),
            width * (1 - Math.abs(x)),
            height * (1 - Math.abs(y)),
          ),
        }),
      };
    }
    return row.riderCrop.texture;
  }
  pose(unit, row, now, mirror) {
    const group = this.group(unit);
    if (!group) return null;
    const age = now - (row.action?.at ?? -100),
      hurt = now - row.hurtAt;
    let state = "Default";
    if (unit.hp <= 0) state = "Down";
    else if (hurt >= 0 && hurt < 0.28) state = "Damage";
    else if (age >= 0 && age < 0.85) {
      const a = this.data.abilities[row.action.abilityId];
      state = a?.kind === "physical" ? (age < 0.15 ? "Ready" : "RightAttack") : "SkillReady";
    } else if (this.battle.outcome === "victory") state = "Win";
    else if (unit.chargedAbility) state = "SkillReady";
    else if (unit.hp / unit.maxHp < 0.25) state = "Dying";
    else if (unit.defending || unit.ready) state = "Ready";
    else if ((unit.conditions || []).some((id) => this.data.conditions[id]?.condition_type === 7))
      state = "CloseEyes";
    if (unit.magitek) {
      const aliases = this.catalog.animationAliases,
        key =
          state === "SkillReady" &&
          age >= 0.15 &&
          age < 0.85 &&
          this.data.abilities[row.action?.abilityId]?.typeId === 604
            ? "MagicArmorAttack"
            : {
                Default: "default",
                Down: "down",
                Damage: "damage",
                RightAttack: "rightAttack",
                SkillReady: "skillReady",
                Win: "win",
                Dying: "dying",
                Ready: unit.defending ? "defend" : "ready",
                CloseEyes: "CloseEyes00",
              }[state];
      const mounted = this.mountedPose(group, aliases?.[key], now, mirror);
      if (mounted) return mounted;
      this.diagnostics?.record("battle-mounted-pose-fallback", {
        entityId: unit.id,
        animation: key,
        resource: this.catalog.magitek?.asset,
        fallback: state,
        reason: "Missing rider/armor frame or magic_armor_table alias",
      });
    }
    const facing = mirror && group[state + "R_00"] ? state + "R" : state;
    const frames = Object.keys(group)
      .filter((n) => n.startsWith(facing + "_"))
      .sort();
    const key = frames.length
      ? frames[Math.floor(now * 6) % frames.length]
      : group.Default_00
        ? "Default_00"
        : Object.keys(group)[0];
    if (!frames.length)
      this.diagnostics?.record("battle-pose-fallback", {
        entityId: unit.id,
        resource: group[key]?.url || null,
        animation: facing,
        fallback: key || null,
      });
    return { info: group[key], explicitRight: facing.endsWith("R") };
  }
  consume(now) {
    for (const e of this.events.splice(0)) {
      if (e.kind === "battle-party") {
        this.formation = this.data.parties[e.partyId] || this.battle.formation;
        continue;
      }
      const actor = this.row(e.actorSide, e.actorIndex),
        target = this.row(e.targetSide, e.targetIndex);
      actor.action = e;
      if (e.result.hit && e.result.amount > 0) target.hurtAt = e.at;
      const position = this.position(e.targetSide, e.targetIndex);
      const container = new Container();
      this.effects.addChild(container);
      const text = !e.result.hit ? null : String(Math.abs(e.result.amount || e.result.mp || 0));
      this.numbers.push({
        container,
        text,
        position,
        at: e.at + 0.12,
        tint: e.result.amount < 0 ? 0x80ff90 : e.result.mp ? 0x80cfff : 0xffffff,
        entityId: `${e.targetSide}:${e.targetIndex}`,
      });
      this.onEffect?.(e, this.position(e.actorSide, e.actorIndex), position);
    }
  }
  drawWeapons(unit, row, now) {
    for (const w of row.weapons) w.visible = false;
    const action = row.action;
    const age = now - (action?.at ?? -100);
    if (
      unit.side !== "player" ||
      unit.magitek ||
      action?.abilityId !== 1 ||
      age < 0.12 ||
      age > 0.65
    )
      return;
    for (let hand = 0; hand < 2; hand++) {
      const content = this.data.contents[unit.equipment?.[hand]];
      const weapon = content?.type_id === 2 ? this.data.weapons[content.type_value] : null;
      if (hand && !weapon) continue;
      const asset = this.catalog.equipment[weapon?.battle_equipment_asset_id || 72];
      const group = this.catalog.groups[asset?.asset];
      if (!group) {
        this.diagnostics?.record("battle-weapon-group-missing", {
          entityId: unit.id,
          resource: asset?.asset || `equipment:${weapon?.battle_equipment_asset_id || 72}`,
        });
        continue;
      }
      const frames = Object.keys(group).sort();
      const info = group[frames[Math.min(frames.length - 1, Math.floor((age - 0.12) * 12))]];
      const texture = this.getTexture(info?.url, {
        required: true,
        entityId: unit.id,
        asset: asset.asset,
        animation: "weapon-attack",
      });
      if (!texture) continue;
      const w = row.weapons[hand];
      w.texture = texture;
      w.position.set(-12 + (hand ? 4 : 0), -16);
      w.rotation = -Math.PI / 4 + (((age - 0.12) / 0.53) * Math.PI) / 2;
      w.visible = true;
    }
  }
  draw(battle, data, now = performance.now() / 1000) {
    if (!this.catalog) {
      this.diagnostics?.record("battle-catalog-missing", {
        entityId: "battle",
        resource: "battle-presentation",
      });
      return 0;
    }
    this.attach(battle, data);
    this.consume(now);
    let count = 0;
    for (const row of this.units.values()) row.container.visible = false;
    for (const [side, units] of [
      ["enemy", battle.enemies],
      ["player", battle.players],
    ]) {
      for (const [index, unit] of units.entries()) {
        const row = this.row(side, index),
          position = this.position(side, index);
        if (unit.hidden || unit.removed || unit.escaped) continue;
        const pose = side === "player" ? this.pose(unit, row, now, position.mirror) : null;
        const info = pose?.info || unit.sprite;
        row.renderInfo = {
          resource: info?.url,
          asset: info?.url?.match(/\/(bc_ff6_[^/]+?)_assets_all_/i)?.[1],
          animation: info?.url
            ?.split("/")
            .at(-1)
            ?.replace(/\.png$/i, ""),
          armorResource: pose?.armor?.url,
          magitek: unit.magitek,
          riderOffset: pose?.riderOffset,
          riderPosition: pose?.riderPosition,
        };
        const texture = this.getTexture(info?.url, {
          required: true,
          entityId: unit.id,
          side,
          animation: row.renderInfo.animation,
          asset: row.renderInfo.asset,
        });
        if (!texture) continue;
        const dead = unit.hp <= 0;
        if (side === "enemy" && dead && now - row.hurtAt > 0.7) continue;
        const age = now - (row.action?.at ?? -100);
        const step =
          side === "player" && age >= 0 && age < 0.75 ? Math.sin((age / 0.75) * Math.PI) * -8 : 0;
        const shake = now - row.hurtAt < 0.28 ? Math.round(Math.sin(now * 70) * 2) : 0;
        row.container.visible = true;
        row.container.zIndex = side === "enemy" ? 1000 - (unit.slot ?? index) : 2000 + index;
        row.container.position.set(Math.round(position.x + step + shake), Math.round(position.y));
        row.container.scale.x = position.mirror && !pose?.explicitRight ? -1 : 1;
        row.sprite.texture = this.riderTexture(row, texture, pose?.riderOffset);
        row.sprite.position.set(
          (pose?.riderPosition?.x || 0) - ((pose?.riderOffset?.x || 0) * texture.width) / 2,
          -(pose?.riderPosition?.y || 0) +
            Math.min(0, (pose?.riderOffset?.y || 0) * texture.height) || 0,
        );
        row.sprite.alpha = side === "enemy" && dead ? Math.max(0, 1 - (now - row.hurtAt) / 0.7) : 1;
        row.sprite.tint = unit.trance ? 0xffc5ff : 0xffffff;
        const armor =
          pose?.armor &&
          this.getTexture(pose.armor.url, {
            required: true,
            entityId: unit.id,
            asset: this.catalog.magitek?.asset,
            animation: "magitek-armor",
          });
        row.armor.visible = Boolean(armor);
        if (armor) row.armor.texture = armor;
        this.drawWeapons(unit, row, now);
        count++;
      }
    }
    this.drawNumbers(now);
    this.clock = now;
    return count;
  }
  drawNumbers(now) {
    this.numbers = this.numbers.filter((n) => {
      const age = now - n.at;
      if (age > 1.2) {
        n.container.destroy({ children: true });
        return false;
      }
      n.container.visible = age >= 0;
      if (age < 0) return true;
      const infos =
        n.text === null ? [this.catalog.miss] : [...n.text].map((c) => this.catalog.digits[c]);
      let width = 0;
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i],
          texture = this.getTexture(info?.url, {
            required: true,
            entityId: n.entityId,
            animation: "damage-number",
            resource: info?.url || (n.text === null ? "MISS" : `digit:${n.text[i]}`),
          });
        let s = n.container.children[i];
        if (!s) {
          s = new Sprite(Texture.EMPTY);
          n.container.addChild(s);
        }
        s.visible = !!texture;
        if (texture) {
          s.texture = texture;
          s.tint = n.tint;
          s.x = width;
        }
        width += info?.width || 0;
      }
      n.container.position.set(
        Math.round(n.position.x - width / 2),
        Math.round(n.position.y - 34 - Math.sin(Math.min(1, age / 0.7) * Math.PI) * 12),
      );
      n.container.alpha = Math.min(1, (1.2 - age) * 4);
      return true;
    });
  }
}
