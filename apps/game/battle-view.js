const $ = (id) => document.getElementById(id);
const label = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};
export class BattleView {
  constructor(canvas, content, images, onReturn, onRetry) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.content = content;
    this.images = images;
    this.selected = null;
    this.ability = null;
    this.key = "";
    this.instance = null;
    $("battle-return").onclick = onReturn;
    $("battle-retry").onclick = onRetry;
    this.rows = new Map();
    for (const p of content.players) {
      const button = document.createElement("button");
      button.className = "party-row";
      const name = document.createElement("span");
      name.textContent = p.name;
      const hp = document.createElement("span");
      const meter = document.createElement("progress");
      meter.max = 100;
      meter.setAttribute("aria-label", p.name + " 行动条");
      button.append(name, hp, meter);
      button.onclick = () => {
        this.selected = p.id;
        this.ability = null;
        this.key = "";
      };
      $("party").append(button);
      this.rows.set(p.id, { button, hp, meter });
    }
  }
  hide() {
    $("battle-ui").hidden = true;
    $("battle-result").hidden = true;
  }
  back() {
    if (this.ability !== null) {
      this.ability = null;
      this.key = "";
      return true;
    }
    return false;
  }
  keyboard(e) {
    if (
      ![
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter",
        "Space",
      ].includes(e.code)
    )
      return;
    const buttons = [
      ...$("battle-menu").querySelectorAll("button:not(:disabled)"),
    ];
    if (!buttons.length) return;
    if (
      ["Enter", "Space"].includes(e.code) &&
      document.activeElement !== this.canvas
    )
      return;
    e.preventDefault();
    if (e.repeat) return;
    if (["Enter", "Space"].includes(e.code)) buttons[0].click();
    else {
      const index = buttons.indexOf(document.activeElement);
      buttons[
        (index +
          (e.code === "ArrowUp" || e.code === "ArrowLeft" ? -1 : 1) +
          buttons.length) %
          buttons.length
      ].focus();
    }
  }
  sync(battle, paused) {
    if (this.instance !== battle) {
      this.content = battle.content;
      this.instance = battle;
      this.selected = null;
      this.ability = null;
      this.key = "";
    }
    $("battle-ui").hidden = paused || battle.phase !== "active";
    $("battle-result").hidden = paused || battle.phase === "active";
    if (battle.phase !== "active") {
      label(
        $("battle-result-title"),
        battle.phase === "victory" ? "战斗胜利" : "队伍倒下了",
      );
      const r = battle.reward;
      label(
        $("battle-result-text"),
        r
          ? `${r.exp} EXP · ${r.gil} Gil\n存活队员各获得 ${r.each} EXP`
          : "重新挑战这场战斗。",
      );
      label(
        $("battle-levels"),
        r
          ? r.levels
              .map(
                (l) =>
                  `${battle.players.find((p) => p.id === l.id).name}  Lv ${l.from} → ${l.to}`,
              )
              .join(" · ")
          : "",
      );
      $("battle-return").hidden = battle.phase !== "victory";
      $("battle-retry").hidden = battle.phase !== "defeat";
      return;
    }
    for (const p of battle.players) {
      const row = this.rows.get(p.id);
      label(row.hp, `${p.hp} / ${p.maxHp}`);
      row.meter.value = p.atb;
      row.button.disabled = !battle.ready.some((c) => c.id === p.id);
      row.button.classList.toggle("selected", p.id === this.selected);
      row.button.classList.toggle("fallen", p.hp === 0);
    }
    if (!battle.ready.some((p) => p.id === this.selected)) {
      this.selected = battle.ready[0]?.id ?? null;
      this.ability = null;
    }
    const actor = battle.ready.find((p) => p.id === this.selected);
    const targets =
      actor && this.ability !== null
        ? battle.targets(actor.id, this.ability)
        : [];
    const key = JSON.stringify([
      this.selected,
      this.ability,
      battle.ready.map((p) => p.id),
      targets.map((t) => t.id),
    ]);
    label($("battle-action"), battle.events.at(-1)?.text ?? "");
    if (key === this.key) return;
    this.key = key;
    const menu = $("battle-menu"),
      focused = menu.contains(document.activeElement);
    menu.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = actor
      ? `${actor.name} · ${this.ability === null ? "魔导" : "选择目标"}`
      : "等待行动条…";
    menu.append(title);
    if (!actor) return;
    const choices = document.createElement("div");
    choices.className = "battle-choices";
    menu.append(choices);
    const add = (text, disabled, click) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.disabled = disabled;
      b.onclick = click;
      choices.append(b);
      return b;
    };
    if (this.ability === null)
      for (const id of actor.abilities) {
        const a = this.content.abilities[id];
        const disabled = !a.plan || actor.mp < a.cost;
        const button = add(a.name, disabled, () => {
          this.ability = id;
          this.key = "";
          this.sync(battle, false);
        });
        if (!a.plan) button.title = "此能力尚未接入";
      }
    else {
      for (const t of targets) {
        const ordinal =
          t.side === "enemy" ? ` ${battle.enemies.indexOf(t) + 1}` : "";
        add(t.name + ordinal, false, () => {
          if (battle.command(actor.id, this.ability, t.id)) {
            this.ability = null;
            this.selected = null;
            this.key = "";
            this.canvas.focus();
            this.sync(battle, false);
          }
        });
      }
      add("返回", false, () => {
        this.back();
        this.sync(battle, false);
      });
    }
    if (focused) menu.querySelector("button:not(:disabled)")?.focus();
  }
  position(combatant, battle) {
    const index = (
      combatant.side === "player" ? battle.players : battle.enemies
    ).indexOf(combatant);
    if (battle.content.formation === "opposed") {
      if (combatant.side === "player")
        return { x: 235 + index * 15, y: 108 + index * 40 };
      return combatant.placement.group === 2
        ? { x: 408, y: 158 }
        : { x: 90 + index * 65, y: 148 + index * 25 };
    }
    return combatant.side === "player"
      ? { x: 350 + index * 15, y: 108 + index * 40 }
      : { x: 125 + index * 88, y: 178 - index * 30 };
  }
  draw(battle) {
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 512, 288);
    const background = this.images.get(
      this.content.sprites[this.content.background].file,
    );
    c.drawImage(background, 0, 0, 512, 288);
    const a = battle.action;
    for (const actor of [...battle.enemies, ...battle.players]) {
      const p = this.position(actor, battle);
      let x = p.x,
        y = p.y;
      if (a?.actor === actor.id)
        x -= Math.sin(Math.min(1, a.elapsed / 900) * Math.PI) * 9;
      if (actor.hp === 0 && actor.side === "enemy") continue;
      c.save();
      if (actor.hp === 0) c.globalAlpha = 0.3;
      const rightSide = actor.side === "enemy" && actor.placement?.group === 2;
      const aimingRight =
        actor.side === "player" &&
        a?.actor === actor.id &&
        this.position(
          battle.combatants.find((t) => t.id === a.target),
          battle,
        ).x > x;
      if (rightSide || aimingRight) {
        c.translate(x * 2, 0);
        c.scale(-1, 1);
      }
      const draw = (key, offsetY = 0, crop = 0) => {
        const s = this.content.sprites[key],
          img = this.images.get(s.file);
        c.drawImage(
          img,
          0,
          0,
          s.width,
          s.height - crop,
          x - s.width / 2,
          y - s.height - offsetY,
          s.width,
          s.height - crop,
        );
      };
      if (actor.sprites.mount) {
        draw(actor.sprites.mount);
        draw(actor.sprites.idle, 22, 8);
      } else draw(actor.sprites.idle);
      if (actor.id === this.selected && actor.hp > 0) {
        c.fillStyle = "#f1d87f";
        c.beginPath();
        c.moveTo(x + 24, y - 26);
        c.lineTo(x + 31, y - 30);
        c.lineTo(x + 31, y - 22);
        c.fill();
      }
      c.restore();
    }
    if (a) {
      const from = this.position(
          battle.combatants.find((p) => p.id === a.actor),
          battle,
        ),
        to = this.position(
          battle.combatants.find((p) => p.id === a.target),
          battle,
        );
      const ability = this.content.abilities[a.ability];
      if (a.elapsed > 150 && a.elapsed < 500) {
        c.save();
        c.globalAlpha = Math.sin(((a.elapsed - 150) / 350) * Math.PI);
        c.strokeStyle =
          ability.presentation === "heal"
            ? "#6cf2a6"
            : ({ 1: "#ff884b", 2: "#89dcff", 3: "#ffff8c" }[
                ability.attribute
              ] ?? "#fff");
        c.lineWidth = ability.presentation === "physical" ? 1 : 5;
        c.beginPath();
        if (ability.presentation === "heal")
          c.arc(to.x, to.y - 24, 22, 0, Math.PI * 2);
        else {
          c.moveTo(from.x - 14, from.y - 24);
          c.lineTo(to.x, to.y - 24);
        }
        c.stroke();
        c.restore();
      }
      if (a.resolved) {
        c.font = "bold 15px monospace";
        c.textAlign = "center";
        c.lineWidth = 3;
        c.strokeStyle = "#101426";
        for (const [index, effect] of a.effects.entries()) {
          c.fillStyle = effect.recovery ? "#80ffa7" : "white";
          const text = effect.missed
              ? "MISS"
              : `${effect.amount}${effect.resource === "mp" ? " MP" : ""}`,
            y = to.y - 48 - (a.elapsed - 400) / 35 - index * 18;
          c.strokeText(text, to.x, y);
          c.fillText(text, to.x, y);
        }
      }
    }
  }
}
