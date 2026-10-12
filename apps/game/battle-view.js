import { itemName } from "./inventory-view.js";
const $ = (id) => document.getElementById(id);
const label = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};
// Preserve source markup in content and event records; the text-only battle
// controls currently display names without the source magic-school icons.
const battleLabel = (text) => text.replace(/<IC_(?:WMGC|BMGC|IMGC|LMGC|SCR|NIF|SRK|NSRD|KTN|DRAG|BAG)>/g, "");
/** Web interaction states, deliberately independent of the native UI enum.
 * Their timing roles match the recovered KeyInput waiting/force-wait rules. */
export function battleMenuWaiting(state) {
  switch (state) {
    case "none":
    case "command":
      return { uiWaiting: false, forceWaiting: false };
    case "ability":
    case "ability-target":
    case "item":
    case "item-target":
      return { uiWaiting: true, forceWaiting: false };
    case "special-input":
    case "slot":
      return { uiWaiting: false, forceWaiting: true };
    default:
      throw new Error("Unknown Web battle menu state");
  }
}
export class BattleView {
  constructor(canvas, content, images, onReturn, onRetry, appearanceQuads) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.content = content;
    this.images = images;
    this.appearanceQuads = appearanceQuads;
    this.selected = null;
    this.actionSource = null;
    this.commandId = null;
    this.key = "";
    this.instance = null;
    this.paused = false;
    this.specialInput = null;
    this.revision = 0;
    $("battle-return").onclick = onReturn;
    $("battle-retry").onclick = onRetry;
    this.rows = new Map();
    $("party").replaceChildren();
  }
  hide() {
    this.resetMenu();
    this.selected = null;
    this.publishClock();
    this.instance = null;
    $("battle-ui").hidden = true;
    $("battle-result").hidden = true;
  }
  resetMenu() {
    this.actionSource = null;
    this.commandId = null;
    this.specialInput = null;
    this.key = "";
    this.revision++;
  }
  get menuState() {
    if (!this.instance || this.instance.phase !== "active" || this.selected === null)
      return "none";
    if (this.specialInput !== null) return this.specialInput;
    if (this.actionSource !== null)
      return this.actionSource.kind === "item" ? "item-target" : "ability-target";
    if (this.commandId !== null)
      return this.instance.commandMenu(this.selected).find((c) => c.id === this.commandId)?.kind === "item" ? "item" : "ability";
    return "command";
  }
  publishClock() {
    if (!this.instance) return;
    this.instance.setClockInput({
      ...this.instance.timingState.input,
      paused: this.paused,
      ...battleMenuWaiting(this.menuState),
    });
    $("battle-menu").setAttribute("data-menu-state", this.menuState);
    $("battle-menu").setAttribute("data-battle-mode", this.instance.preferences.mode);
  }
  /** Explicit hook for a future supported input provider. No special command
   * is enabled by this hook; its owner must complete/cancel and release it. */
  setSpecialInput(state) {
    if (state !== null && state !== "special-input" && state !== "slot")
      throw new Error("Unknown Web special input state");
    if (!this.instance || this.instance.phase !== "active" || this.selected === null)
      return false;
    if (state !== null && this.paused) return false;
    this.specialInput = state;
    this.key = "";
    this.sync(this.instance, this.paused);
    return true;
  }
  commandUsesList(actor, commandId) {
    return this.instance?.commandMenu(actor.id).find((c) => c.id === commandId)?.usesList ?? true;
  }
  back() {
    if (this.paused || this.specialInput !== null) return false;
    if (this.actionSource !== null) {
      this.actionSource = null;
      const actor = this.instance?.ready.find((p) => p.id === this.selected);
      if (!actor || !this.commandUsesList(actor, this.commandId)) this.commandId = null;
      this.key = "";
      if (this.instance) this.sync(this.instance, this.paused);
      return true;
    }
    if (this.commandId !== null) {
      this.commandId = null;
      this.key = "";
      if (this.instance) this.sync(this.instance, this.paused);
      return true;
    }
    return false;
  }
  keyboard(e) {
    if (this.paused || !this.instance || this.instance.phase !== "active") return;
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
    if (typeof paused !== "boolean") throw new Error("Missing battle pause state");
    this.paused = paused;
    if (this.instance !== battle) {
      this.content = battle.content;
      this.instance = battle;
      this.selected = null;
      this.resetMenu();
    }
    const party = $("party"),
      memberIds = new Set(battle.players.map((p) => p.id)),
      readyIds = new Set(
        battle.phase === "active" ? battle.ready.map((p) => p.id) : [],
      ),
      ready = battle.players.filter((p) => readyIds.has(p.id));
    if (!ready.some((p) => p.id === this.selected)) {
      this.selected = ready[0]?.id ?? null;
      this.resetMenu();
    }
    for (const [id, row] of this.rows) {
      if (memberIds.has(id)) continue;
      row.button.disabled = true;
      row.button.remove();
      this.rows.delete(id);
    }
    for (const [index, p] of battle.players.entries()) {
      let row = this.rows.get(p.id);
      if (!row) {
        const button = document.createElement("button"),
          name = document.createElement("span"),
          hp = document.createElement("span"),
          meter = document.createElement("progress");
        button.className = "party-row";
        hp.className = "battle-vitals";
        meter.max = 100;
        button.append(name, hp, meter);
        button.onclick = () => {
          if (this.paused || this.specialInput !== null || this.instance?.phase !== "active" ||
            !this.instance?.ready.some((member) => member.id === p.id)) return;
          this.selected = p.id;
          this.resetMenu();
          this.sync(this.instance, this.paused);
        };
        row = { button, name, hp, meter };
        this.rows.set(p.id, row);
      }
      if (party.children[index] !== row.button)
        party.insertBefore(row.button, party.children[index] ?? null);
      const conditionNames = p.conditionIds.map((id) => battle.conditions.name(id)).filter(Boolean);
      label(
        row.name,
        p.name + ` · ${p.row === "back" ? "后排" : "前排"}` +
          (conditionNames.length
            ? ` · ${conditionNames.join("、")}`
            : ""),
      );
      label(row.hp, `HP ${p.hp} / ${p.maxHp}\nMP ${p.mp} / ${p.maxMp}`);
      row.meter.value = p.atb;
      row.meter.setAttribute("aria-label", p.name + " 行动条");
      row.button.disabled = paused || this.specialInput !== null || !readyIds.has(p.id);
      row.button.classList.toggle("selected", p.id === this.selected);
      row.button.classList.toggle("fallen", p.hp === 0);
    }
    $("battle-ui").hidden = paused || battle.phase !== "active";
    $("battle-result").hidden = paused || battle.phase === "active";
    if (battle.phase !== "active") {
      this.publishClock();
      label(
        $("battle-result-title"),
        battle.phase === "victory" ? "战斗胜利" : "队伍倒下了",
      );
      const r = battle.reward;
      label(
        $("battle-result-text"),
        r
          ? `${r.exp} EXP · ${r.gil} Gil\n存活队员各获得 ${r.each} EXP` +
            (Array.isArray(r.drops) && r.drops.length ? "\n" + r.drops.map((drop) =>
              `${itemName({ name: battle.rewardItemName(drop.id) })} × ${drop.count}`).join(" · ") : "")
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
    const actor = ready.find((p) => p.id === this.selected);
    const commands = actor ? battle.commandMenu(actor.id) : [];
    if (this.commandId !== null && !commands.some((c) => c.id === this.commandId && c.available)) this.resetMenu();
    const canUse = (source, commandId) =>
      source.kind === "ability"
        ? battle.canUse(actor.id, source.id, commandId)
        : battle.canUseItem(actor.id, source.id, commandId);
    const options = actor
      ? commands.flatMap((command) => {
          const commandId = command.id;
          return command.kind === "item"
            ? battle.inventory
                .filter((i) => i.count > 0 && !battle.items[i.id].important)
                .map((i) => {
                  const source = { kind: "item", id: i.id };
                  return {
                    commandId,
                    source,
                    usable: canUse(source, commandId),
                    name: `${itemName(battle.items[i.id])} × ${i.available}`,
                  };
                })
            : command.abilityIds
                .map((id) => {
                  const source = { kind: "ability", id };
                  const ability = this.content.abilities[id];
                  const cost = battle.abilityCost(actor.id, id);
                  const displayName = battleLabel(ability?.name || (command.abilityIds.length === 1 ? command.name : "行动"));
                  return {
                    commandId,
                    source,
                    usable: canUse(source, commandId),
                    name: displayName + (cost ? cost.mp ? ` · MP ${cost.mp}` : "" : ability?.cost ? " · MP ?" : ""),
                  };
                });
        })
      : [];
    if (
      actor &&
      this.actionSource !== null &&
      !canUse(this.actionSource, this.commandId)
    ) {
      this.actionSource = null;
      this.commandId = null;
    }
    const targets =
      actor && this.actionSource !== null
        ? this.actionSource.kind === "item"
          ? battle.itemTargetChoices(actor.id, this.actionSource.id)
          : battle.targetChoices(actor.id, this.actionSource.id)
        : [];
    const key = JSON.stringify([
      this.selected,
      this.actionSource,
      this.commandId,
      options,
      commands,
      ready.map((p) => p.id),
      targets,
      paused,
      this.specialInput,
    ]);
    this.publishClock();
    label($("battle-action"), battleLabel(battle.events.at(-1)?.text ?? ""));
    if (key === this.key) return;
    this.key = key;
    const revision = ++this.revision;
    const menu = $("battle-menu"),
      focused = menu.contains(document.activeElement);
    menu.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = actor
      ? `${actor.name} · ${this.specialInput !== null ? "特殊输入中…" : this.actionSource !== null ? "选择目标" : this.commandId !== null ? commands.find((c) => c.id === this.commandId)?.name ?? "选择能力" : "选择指令"}`
      : "等待行动条…";
    menu.append(title);
    if (!actor || this.specialInput !== null) return;
    const choices = document.createElement("div");
    choices.className = "battle-choices";
    menu.append(choices);
    const add = (text, disabled, click) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.disabled = disabled || paused;
      b.onclick = () => {
        if (this.instance !== battle || this.paused || revision !== this.revision ||
          battle.phase !== "active" || !battle.ready.some((p) => p.id === actor.id)) return;
        click();
      };
      choices.append(b);
      return b;
    };
    if (this.commandId === null) {
      for (const command of commands) {
        const commandId = command.id;
        const commandOptions = options.filter((option) => option.commandId === commandId);
        const usesList = this.commandUsesList(actor, commandId);
        const button = add(command.name + (command.blockers.length ? " · 暂不可用" : ""), !command.available || (!usesList && !commandOptions[0]?.usable), () => {
          this.commandId = commandId;
          this.actionSource = usesList ? null : commandOptions[0].source;
          this.key = "";
          this.sync(battle, this.paused);
        });
        if (command.blockers.length) button.title = command.blockers.join("；");
      }
    } else if (this.actionSource === null) {
      for (const { source, commandId, usable, name } of options.filter((option) => option.commandId === this.commandId)) {
        add(
          name,
          !usable,
          () => {
            this.actionSource = source;
            this.commandId = commandId;
            this.key = "";
            this.sync(battle, this.paused);
          },
        );
      }
      add("返回", false, () => this.back());
    } else {
      for (const choice of targets) {
        const selection = choice.selection;
        const t = battle.combatants.find((c) => c.id === choice.targetIds[0]);
        const text =
          selection.kind === "all"
            ? `敌我全体（${choice.targetIds.length}）`
            : selection.kind === "side"
              ? `${selection.side === "player" ? "我方" : "敌方"}全体（${choice.targetIds.length}）`
              : t.name +
                (t.side === "enemy"
                  ? ` ${battle.enemies.indexOf(t) + 1}`
                  : "") +
                (t.hp === 0 ? " · 战斗不能" : "");
        add(text, false, () => {
          if (
            this.actionSource.kind === "item"
              ? battle.commandItem(
                  actor.id,
                  this.actionSource.id,
                  selection,
                  this.commandId,
                )
              : battle.command(
                  actor.id,
                  this.actionSource.id,
                  selection,
                  this.commandId,
                )
          ) {
            this.resetMenu();
            this.selected = null;
            this.canvas.focus();
          }
          this.sync(battle, this.paused);
        });
      }
      add("返回", false, () => this.back());
    }
    if (focused) menu.querySelector("button:not(:disabled)")?.focus();
  }
  position(combatant, battle) {
    const index = (
      combatant.side === "player" ? battle.players : battle.enemies
    ).indexOf(combatant);
    // Development presentation only: row ownership and its combat effects
    // remain in BattleGame. This offset is not a native animation measurement.
    const rowOffset = combatant.side === "player" && combatant.row === "back" ? 20 : 0;
    if (battle.content.formation === "opposed") {
      if (combatant.side === "player")
        return { x: 235 + index * 15 + rowOffset, y: 108 + index * 40 };
      return combatant.placement.group === 2
        ? { x: 408, y: 158 }
        : { x: 90 + index * 65, y: 148 + index * 25 };
    }
    return combatant.side === "player"
      ? { x: 350 + index * 15 + rowOffset, y: 108 + index * 40 }
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
    const rowAction = a && battle.actionDefinition(a).presentation === "row";
    for (const actor of [...battle.enemies, ...battle.players]) {
      const p = this.position(actor, battle);
      let x = p.x,
        y = p.y;
      if (a?.actor === actor.id && !rowAction)
        x -= Math.sin(Math.min(1, a.elapsed / 900) * Math.PI) * 9;
      if (actor.hp === 0 && actor.side === "enemy") continue;
      c.save();
      const rightSide = actor.side === "enemy" && actor.placement?.group === 2;
      const aimingRight =
        actor.side === "player" &&
        a?.actor === actor.id &&
        a.targetIds.length > 0 &&
        this.position(
          battle.combatants.find((t) => t.id === a.targetIds[0]),
          battle,
        ).x > x;
      const dying = battle.content.conditions.dying &&
        actor.conditionIds.includes(battle.content.conditions.dying.conditionId);
      const defending = battle.content.conditions.behaviors.some((behavior) =>
        behavior.kind === "defend" && actor.conditionIds.includes(behavior.id));
      const appearance = battle.appearanceFrame(actor.id, {
        key: actor.hp === 0 ? "down" : defending ? "ready" : dying ? aimingRight ? "dyingR00" : "dying" :
          aimingRight ? "IdleR00" : "default",
        bodyFrame: 0, armorFrame: 0,
      });
      if (actor.hp === 0 && !appearance) c.globalAlpha = 0.3;
      if (!appearance && (rightSide || aimingRight)) {
        c.translate(x * 2, 0);
        c.scale(-1, 1);
      }
      const draw = (key) => {
        const s = this.content.sprites[key],
          img = this.images.get(s.file);
        c.drawImage(
          img,
          0,
          0,
          s.width,
          s.height,
          x - s.width / 2,
          y - s.height,
          s.width,
          s.height,
        );
      };
      if (appearance) {
        for (const layer of [appearance.armor, appearance.body]) {
          if (!layer) continue;
          const sprite = this.content.sprites[layer.sprite], img = this.images.get(sprite.file);
          for (const { source, destination } of this.appearanceQuads(layer))
            c.drawImage(img, source.x, source.y, source.width, source.height,
              x + destination.x, y + destination.y, destination.width, destination.height);
        }
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
      );
      const ability = battle.actionDefinition(a);
      for (const id of a.targetIds) {
        const to = this.position(
          battle.combatants.find((p) => p.id === id),
          battle,
        );
        if (a.elapsed > 150 && a.elapsed < 500 && !rowAction) {
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
          const effects =
            a.results.find((result) => result.target === id)?.effects ?? [];
          for (const [index, effect] of effects.entries()) {
            c.fillStyle = effect.recovery ? "#80ffa7" : "white";
            const text = effect.resource === "row"
                ? effect.after === "back" ? "后排" : "前排"
                : effect.missed
                ? "MISS"
                : effect.nullified
                  ? "无效"
                  : effect.resource === "condition"
                    ? effect.recovery
                      ? "状态解除"
                      : effect.added
                          .map((id) => battle.conditions.name(id))
                          .join("、")
                    : `${effect.amount}${effect.resource === "mp" ? " MP" : ""}`,
              y = to.y - 48 - (a.elapsed - 400) / 35 - index * 18;
            c.strokeText(text, to.x, y);
            c.fillText(text, to.x, y);
          }
        }
      }
    }
  }
}
