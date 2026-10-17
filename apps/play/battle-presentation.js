import { Container, Sprite, Texture } from "pixi.js";

// All clocks, poses and queues here belong to the renderer, never the combat engine.
export class BattlePresentation {
  constructor({ actors, effects, getTexture, warn, onEffect }) {
    Object.assign(this, { actors, effects, getTexture, warn, onEffect });
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
    for (const row of this.units.values()) row.container.destroy({ children: true });
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
      // The CSV offsets are Unity coordinates: positive y points upward.
      const member = (this.formation || battle.formation).members.find(
        (m) => m.slot === unit?.slot,
      );
      let x = width / 2 + (this.catalog?.enemyOrigin.x ?? -75) + Number(unit?.x ?? member?.x ?? 0);
      const y = height / 2 - (this.catalog?.enemyOrigin.y || 0) - Number(unit?.y ?? member?.y ?? 0);
      if (battle.pattern === 2) x = width - x;
      if (battle.pattern === 4 && index % 2) x = width - x;
      if (battle.pattern === 5) x = width / 2 + Number(unit?.x ?? 0);
      return { x, y, mirror: battle.pattern === 2 || (battle.pattern === 4 && index % 2 === 1) };
    }
    let x = width / 2 + 92 + (index % 2) * 8 + (unit?.row === "back" ? 14 : 0);
    const y = 68 + index * 24;
    if (battle.pattern === 2 || (battle.pattern === 5 && index % 2 === 1)) x = width - x;
    if (battle.pattern === 4) x = width / 2 + (index % 2 ? 12 : -12);
    return { x, y, mirror: battle.pattern === 2 || (battle.pattern === 5 && index % 2 === 1) };
  }
  row(side, index) {
    const key = `${side}:${index}`;
    if (!this.units.has(key)) {
      const container = new Container(),
        sprite = new Sprite(Texture.EMPTY);
      sprite.anchor.set(0.5, 1);
      container.addChild(sprite);
      const weapons = [new Sprite(Texture.EMPTY), new Sprite(Texture.EMPTY)];
      for (const w of weapons) {
        w.anchor.set(0.5);
        container.addChild(w);
      }
      this.actors.addChild(container);
      this.units.set(key, { container, sprite, weapons, action: null, hurtAt: -100 });
    }
    return this.units.get(key);
  }
  group(unit) {
    const canonical = this.data.characters?.[unit.id];
    const source = unit.magitek ? canonical?.magitekSprite : canonical?.sprite;
    const url = unit.side === "player" ? source?.url || unit.sprite?.url : unit.sprite?.url;
    const asset = url?.match(/\/(bc_ff6_[^/]+?)_assets_all_/i)?.[1]?.toLowerCase();
    const transformed = unit.trance && this.catalog?.groups[asset + "_tr"];
    return transformed || this.catalog?.groups[asset];
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
    const facing = mirror && group[state + "R_00"] ? state + "R" : state;
    const frames = Object.keys(group)
      .filter((n) => n.startsWith(facing + "_"))
      .sort();
    const key = frames.length
      ? frames[Math.floor(now * 6) % frames.length]
      : group.Default_00
        ? "Default_00"
        : Object.keys(group)[0];
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
      });
      this.onEffect?.(e, this.position(e.actorSide, e.actorIndex), position);
    }
  }
  drawWeapons(unit, row, now) {
    for (const w of row.weapons) w.visible = false;
    const action = row.action;
    const age = now - (action?.at ?? -100);
    if (unit.side !== "player" || action?.abilityId !== 1 || age < 0.12 || age > 0.65) return;
    for (let hand = 0; hand < 2; hand++) {
      const content = this.data.contents[unit.equipment?.[hand]];
      const weapon = content?.type_id === 2 ? this.data.weapons[content.type_value] : null;
      if (hand && !weapon) continue;
      const asset = this.catalog.equipment[weapon?.battle_equipment_asset_id || 72];
      const group = this.catalog.groups[asset?.asset];
      if (!group) continue;
      const frames = Object.keys(group).sort();
      const info = group[frames[Math.min(frames.length - 1, Math.floor((age - 0.12) * 12))]];
      const texture = this.getTexture(info.url);
      if (!texture) continue;
      const w = row.weapons[hand];
      w.texture = texture;
      w.position.set(-12 + (hand ? 4 : 0), -16);
      w.rotation = -Math.PI / 4 + (((age - 0.12) / 0.53) * Math.PI) / 2;
      w.visible = true;
    }
  }
  draw(battle, data, now = performance.now() / 1000) {
    if (!this.catalog) return 0;
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
        const texture = this.getTexture(info?.url);
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
        row.sprite.texture = texture;
        row.sprite.alpha = side === "enemy" && dead ? Math.max(0, 1 - (now - row.hurtAt) / 0.7) : 1;
        row.sprite.tint = unit.trance ? 0xffc5ff : 0xffffff;
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
          texture = this.getTexture(info.url);
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
        width += info.width;
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
