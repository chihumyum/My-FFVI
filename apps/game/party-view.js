const cleanName = (name) => name.replace(/<IC_[A-Z0-9_]+>/g, "");
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
const button = (label, key, callback, disabled = false) => {
  const element = node("button", label);
  element.type = "button";
  element.disabled = disabled;
  element.dataset.partyFocus = key;
  element.onclick = callback;
  return element;
};
const partyError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/stale/i.test(message)) return "编队已变化，请重新选择。";
  if (/battle definition|战斗动作|战斗能力/i.test(message))
    return "所选成员的战斗能力尚未迁移，原编队已保留。";
  if (/appearance|bitmap|media|character asset/i.test(message))
    return "所选成员的地图外观尚未接入，原编队已保留。";
  if (/unavailable|disabled|unowned/i.test(message))
    return "请选择已持有且可用的角色，原编队已保留。";
  if (/empty|last member|retain a member|nonempty|non-empty/i.test(message))
    return "当前队伍至少保留一名可用成员，原编队已保留。";
  return "当前无法调整编队，原编队已保留。";
};
const slotBlocker = (message) => {
  if (!message) return null;
  if (/empty|nonempty|non-empty|没有成员/i.test(message)) return "该编组为空，请先选入至少一名可用角色。";
  if (/unavailable|disabled|不可编组/i.test(message)) return "该编组含不可用角色，请先换出。";
  return message;
};

/** Only UI selection lives here. All roster, row and progression data is read
 * from the current session; even a retained button submits its old baseline. */
export class PartyView {
  constructor(root, onChange = () => {}, { commands, owner } = {}) {
    if (commands !== undefined && (!owner || commands.owner !== owner || typeof commands.changeParty !== "function"))
      throw new Error("Invalid party command owner");
    this.root = root;
    this.onChange = onChange;
    this.commands = commands;
    this.owner = owner;
    this.reset();
  }
  reset() {
    this.playerId = null;
    this.slot = null;
    this.message = "";
    this.key = "";
    this.session = null;
    this.disabled = true;
  }
  render(session, { disabled = false } = {}) {
    const commands = this.commands;
    const current = () => this.session === session && this.commands === commands &&
      (!commands || this.owner === session && commands.menuReady);
    disabled ||= !!commands && (this.owner !== session || !commands.menuReady);
    if (session !== this.session) {
      this.key = "";
      this.playerId = null;
      this.slot = null;
      this.message = "";
    }
    this.session = session;
    this.disabled = disabled;
    const model = session.partyMenu();
    if (!model.roster.some((member) => member.id === this.playerId))
      this.playerId = model.cells.find((cell) => cell.id !== null)?.id ?? model.roster[0]?.id ?? null;
    const character = this.playerId === null ? null : session.characterMenu(this.playerId);
    this.slot ??= model.selectedSlot;
    const key = JSON.stringify([model, character, disabled, this.message, this.slot]);
    if (key === this.key) return;
    this.key = key;
    const focused = this.root.contains(document.activeElement)
      ? document.activeElement.dataset.partyFocus : null;
    this.root.replaceChildren(node("h3", "保存编组"));
    const canEdit = !disabled && model.editable;
    const change = (request) => {
      // Recheck the current owner and host gate even when invoked through a
      // callback retained across another render or an asynchronous operation.
      if (!current() || this.disabled || !session.menuReady) return;
      let changed = false;
      try {
        changed = commands ? commands.changeParty(request) : session.changeParty(request);
        this.message = changed ? "编队已更新。" : "编队没有变化。";
      } catch (error) { this.message = partyError(error); }
      // A rejected select change must revert its DOM value to the owned model,
      // even when the same error was already displayed on the previous attempt.
      this.key = "";
      this.render(session, { disabled: this.disabled });
      if (changed) this.onChange();
    };
    const groups = node("div", undefined, "party-menu-groups");
    for (const slot of model.slots) {
      const browse = button(`编组 ${slot.index + 1}${slot.index === model.selectedSlot ? " · 当前队伍" : ""}`,
        `browse-slot-${slot.index}`, () => {
          if (!current() || this.disabled) return;
          this.slot = slot.index;
          this.message = "";
          this.render(session, { disabled: this.disabled });
        }, disabled);
      browse.setAttribute("aria-pressed", String(slot.index === this.slot));
      groups.append(browse);
    }
    this.root.append(groups);
    const viewed = model.slots[this.slot], active = this.slot === model.selectedSlot;
    const members = viewed.cells.filter((cell) => cell.id !== null).length;
    this.root.append(node("p", `正在编辑编组 ${this.slot + 1}${active ? "（当前队伍）" : ""}。`, "party-menu-note"));
    this.root.append(button(active ? "已是当前队伍" : "设为当前队伍", `select-slot-${this.slot}`,
      () => change({ expected: model.expected, change: { kind: "select-slot", slot: viewed.index } }),
      !canEdit || active || !!viewed.blocker));
    const cells = node("div", undefined, "party-menu-cells");
    for (const cell of viewed.cells) {
      const card = node("article", undefined, "party-menu-cell");
      card.append(node("h4", `位置 ${cell.position + 1}`));
      const label = node("label", "成员", "party-menu-member-choice");
      const selection = node("select");
      selection.setAttribute("aria-label", `编组 ${this.slot + 1} 位置 ${cell.position + 1} 成员`);
      selection.dataset.partyFocus = `assign-${this.slot}-${cell.position}`;
      selection.disabled = !canEdit;
      const empty = node("option", "空位（移出成员）");
      empty.value = "";
      empty.disabled = active && members === 1 && cell.id !== null;
      selection.append(empty);
      for (const member of model.roster.filter((member) => member.enabled)) {
        const option = node("option", member.name);
        option.value = member.id;
        option.disabled = viewed.cells.some((other) => other.position !== cell.position && other.id === member.id);
        selection.append(option);
      }
      selection.value = cell.member?.enabled ? cell.id : "";
      const slot = this.slot;
      selection.onchange = () => change({ expected: model.expected, change: { kind: "set-member",
        slot, position: cell.position, ownedId: selection.value || null, row: cell.row } });
      label.append(selection);
      card.append(label);
      if (!cell.member) {
        card.append(node("p", "空位"));
      } else {
        const select = button(cell.member.name, `member-${cell.member.id}`, () => {
          if (!current() || this.disabled) return;
          this.playerId = cell.member.id;
          this.render(session, { disabled: this.disabled });
        }, disabled);
        select.setAttribute("aria-pressed", String(cell.member.id === this.playerId));
        card.append(select, node("p", `Lv ${cell.member.level} · ${cell.row === "front" ? "前排" : "后排"}`),
          node("p", `HP ${cell.member.hp}/${cell.member.maxHp} · MP ${cell.member.mp}/${cell.member.maxMp}`));
        const actions = node("div", undefined, "party-menu-actions");
        if (active) {
          for (const [label, direction] of [["上移", -1], ["下移", 1]]) {
            const to = cell.position + direction;
            actions.append(button(label, `swap-${cell.position}-${to}`, () => change({
              expected: model.expected, change: { kind: "swap", from: cell.position, to },
            }), !canEdit || to < 0 || to > 3));
          }
        }
        actions.append(button(cell.row === "front" ? "改为后排" : "改为前排", `row-${cell.position}`, () => change({
          expected: model.expected, change: active ? { kind: "set-row", position: cell.position,
            row: cell.row === "front" ? "back" : "front" } : { kind: "set-member", slot,
            position: cell.position, ownedId: cell.id, row: cell.row === "front" ? "back" : "front" },
        }), !canEdit));
        card.append(actions);
      }
      cells.append(card);
    }
    this.root.append(cells);
    if (model.blocker) this.root.append(node("p", model.blocker, "party-menu-note"));
    if (!active && viewed.blocker) this.root.append(node("p", slotBlocker(viewed.blocker), "party-menu-note"));
    this.root.append(node("p", "这里调整 Web 菜单编组；探索和战斗使用当前队伍。", "party-menu-note"));
    const status = node("p", this.message, "party-menu-status");
    status.setAttribute("role", "status");
    this.root.append(status);

    const selection = node("div", undefined, "party-menu-members");
    selection.append(node("h3", "角色与能力"));
    for (const member of model.roster) {
      const choose = button(member.name, `inspect-${member.id}`, () => {
        if (!current() || this.disabled) return;
        this.playerId = member.id;
        this.render(session, { disabled: this.disabled });
      }, disabled);
      choose.setAttribute("aria-pressed", String(member.id === this.playerId));
      selection.append(choose);
    }
    this.root.append(selection);
    if (character) {
      const detail = node("section", undefined, "party-menu-character");
      detail.setAttribute("aria-label", `${character.name}的成长与能力`);
      detail.append(node("h4", character.name), node("p", `等级 ${character.level} · 经验 ${character.exp}`));
      if (character.magicLearningValue != null)
        detail.append(node("p", `魔法学习值 ${character.magicLearningValue} / 128`));
      detail.append(node("p", character.atMaxLevel ? "已达到等级上限。" : character.experienceToNextLevel === null
        ? "下一级经验尚未确定。" : `距离下一级还需 ${character.experienceToNextLevel} 经验。`));
      if (character.additional) {
        const labels = { hp: "HP", mp: "MP", strength: "力量", vitality: "耐力", agility: "速度", magic: "魔力" };
        detail.append(node("p", "累计成长：" + Object.entries(labels)
          .map(([key, label]) => `${label} +${character.additional[key]}`).join(" · ")));
      }
      if (character.commands)
        detail.append(node("p", "持有指令：" + character.commands.map((command) => cleanName(command.name)).join("、")));
      if (character.abilities === null) detail.append(node("p", "当前角色的能力资料尚未接入。"));
      else {
        detail.append(node("p", "以下为持有与学习记录；实际可选能力由战斗中的条件决定。", "party-menu-note"));
        const list = node("ul", undefined, "party-menu-abilities");
        for (const ability of character.abilities) {
          const learned = ability.equipment ? "装备赋予" : ability.skillLevel === 100 ? "已习得" : `学习 ${ability.skillLevel}%`;
          const availability = ability.effectSupport === "implemented" ? "" : ability.effectSupport === "blocked" ? " · 暂不支持施放" : " · 说明待接入";
          const row = node("li", `${cleanName(ability.name)} · ${learned}${availability}`);
          row.dataset.partyAbility = String(ability.id);
          list.append(row);
        }
        if (!character.abilities.length) list.append(node("li", "暂无持有能力。"));
        detail.append(list);
      }
      this.root.append(detail);
    }
    if (focused) [...this.root.querySelectorAll("[data-party-focus]")]
      .find((element) => element.dataset.partyFocus === focused)?.focus();
  }
}
