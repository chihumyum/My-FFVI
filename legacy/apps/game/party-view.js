import { MagicStoneView } from "./magic-stones-view.js";

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
const abilityError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/stale|changed/i.test(message)) return "技能或目标已变化，请重新选择。";
  if (/appearance|bitmap|media|character asset/i.test(message)) return "地图角色状态尚未就绪，请稍后重新选择技能。";
  return `当前无法施放：${message}`;
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
    this.magicStoneRoot = node("section", undefined, "party-menu-magic-stones");
    this.magicStoneView = new MagicStoneView(this.magicStoneRoot, () => {
      this.key = "";
      if (this.session) this.render(this.session, { disabled: this.disabled });
      this.onChange();
    }, { commands, owner });
    this.reset();
  }
  reset() {
    this.magicStoneView?.reset();
    this.playerId = null;
    this.slot = null;
    this.abilityDraft = null;
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
      this.abilityDraft = null;
      this.message = "";
    }
    this.session = session;
    this.disabled = disabled;
    const model = session.partyMenu();
    if (!model.roster.some((member) => member.id === this.playerId))
      this.playerId = model.cells.find((cell) => cell.id !== null)?.id ?? model.roster[0]?.id ?? null;
    const character = this.playerId === null ? null : session.characterMenu(this.playerId);
    const magicStones = this.playerId === null || typeof session.magicStoneMenu !== "function"
      ? null : session.magicStoneMenu(this.playerId);
    const activeMember = model.cells.some((cell) => cell.id === this.playerId && cell.member?.enabled);
    let fieldAbilities = [], abilityChoices = [], fieldAbilityError = "";
    try {
      if (activeMember && typeof session.menuAbilities === "function") fieldAbilities = session.menuAbilities(this.playerId);
      if (this.abilityDraft?.actorId === this.playerId && activeMember)
        abilityChoices = session.menuAbilityTargets(this.playerId, this.abilityDraft.abilityId);
    } catch (error) { fieldAbilityError = abilityError(error); }
    this.slot ??= model.selectedSlot;
    const key = JSON.stringify([model, character, disabled, this.message, this.slot,
      fieldAbilities, fieldAbilityError, this.abilityDraft, abilityChoices, magicStones]);
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
        if (changed) this.abilityDraft = null;
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
          this.abilityDraft = null;
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
        this.abilityDraft = null;
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
        detail.append(node("p", "以下为持有与学习记录；地图技能和战斗分别检查当前资格。", "party-menu-note"));
        const list = node("ul", undefined, "party-menu-abilities");
        for (const ability of character.abilities) {
          const learned = ability.equipment ? "装备赋予" : ability.skillLevel === 100 ? "已习得" : `学习 ${ability.skillLevel}%`;
          const availability = ability.effectSupport === "implemented" ? "" : ability.effectSupport === "blocked" ? " · 战斗效果尚未接入" : " · 战斗说明待接入";
          const row = node("li", `${cleanName(ability.name)} · ${learned}${availability}`);
          row.dataset.partyAbility = String(ability.id);
          list.append(row);
        }
        if (!character.abilities.length) list.append(node("li", "暂无持有能力。"));
        detail.append(list);
      }
      this.root.append(detail);
    }
    if (character && typeof session.menuAbilities === "function") {
      const casting = node("section", undefined, "party-menu-character");
      casting.setAttribute("aria-label", `${character.name}的字段技能`);
      casting.append(node("h3", "地图技能"));
      if (!activeMember) casting.append(node("p", "请从当前队伍选择施法角色。", "party-menu-note"));
      else if (fieldAbilityError) casting.append(node("p", fieldAbilityError, "party-menu-note"));
      else if (!fieldAbilities.length) casting.append(node("p", "暂无可在地图菜单施放的已持有技能。", "party-menu-note"));
      const actorId = this.playerId;
      const reRender = () => { this.key = ""; this.render(session, { disabled: this.disabled }); };
      for (const ability of fieldAbilities) {
        const row = node("div", undefined, "party-menu-actions");
        const cost = ability.cost ? `MP ${ability.cost.mp}` : "MP 待确定";
        row.append(button(`${cleanName(ability.name)} · ${cost}`, `field-ability-${ability.abilityId}`, () => {
          if (!current() || this.disabled || !session.menuReady || this.playerId !== actorId) return;
          try {
            const fresh = session.menuAbilities(actorId).find((entry) => entry.abilityId === ability.abilityId);
            if (!fresh || fresh.available !== true ||
                JSON.stringify(session.partyMenu().expected) !== JSON.stringify(model.expected)) {
              this.message = "技能或目标已变化，请重新选择。";
            } else {
              this.abilityDraft = { actorId, abilityId: ability.abilityId, selection: null, targetIds: null,
                expected: JSON.stringify(model.expected), cost: JSON.stringify(fresh.cost) };
              this.message = "请选择目标，然后确认施放。";
            }
          } catch (error) { this.message = abilityError(error); }
          reRender();
        }, disabled || ability.available !== true));
        if (ability.blockers.length) row.append(node("span", ability.blockers.join("；"), "party-menu-note"));
        else if (ability.available === false) row.append(node("span", "当前状态或 MP 不允许施放。", "party-menu-note"));
        casting.append(row);
      }
      const draft = this.abilityDraft;
      if (draft?.actorId === actorId) {
        const selected = fieldAbilities.find((entry) => entry.abilityId === draft.abilityId);
        casting.append(node("h4", selected ? cleanName(selected.name) : "选择施法目标"));
        const targets = node("div", undefined, "party-menu-actions");
        for (const choice of abilityChoices) {
          const names = choice.targetIds.map((id) => model.roster.find((member) => member.id === id)?.name ?? id);
          const label = choice.selection.kind === "all" ? `全队（${names.join("、")}）` : names[0];
          const targetKey = choice.selection.kind === "all" ? "all" : choice.selection.id;
          const target = button(label, `field-target-${targetKey}`, () => {
            if (!current() || this.disabled || this.abilityDraft !== draft) return;
            draft.selection = { ...choice.selection }; draft.targetIds = [...choice.targetIds];
            reRender();
          }, disabled);
          target.setAttribute("aria-pressed", String(JSON.stringify(draft.selection) === JSON.stringify(choice.selection)));
          targets.append(target);
        }
        casting.append(targets);
        if (!abilityChoices.length) casting.append(node("p", "当前没有合格目标，请重新选择。", "party-menu-note"));
        const actions = node("div", undefined, "party-menu-actions");
        actions.append(button(selected?.cost ? `确认施放 · MP ${selected.cost.mp}` : "确认施放", "field-cast-confirm", () => {
          if (!current() || this.disabled || !session.menuReady || this.abilityDraft !== draft || !draft.selection) return;
          // Read qualification again, retaining the rendered target identities
          // and all three saved groups. A stale all-target choice never grows.
          let changed = false;
          this.abilityDraft = null;
          try {
            const fresh = session.menuAbilities(actorId).find((entry) => entry.abilityId === draft.abilityId);
            const choice = session.menuAbilityTargets(actorId, draft.abilityId).find((entry) =>
              JSON.stringify(entry.selection) === JSON.stringify(draft.selection));
            if (!fresh || fresh.available !== true || !choice ||
                JSON.stringify(fresh.cost) !== draft.cost ||
                JSON.stringify(choice.targetIds) !== JSON.stringify(draft.targetIds) ||
                JSON.stringify(session.partyMenu().expected) !== draft.expected) {
              this.message = "技能或目标已变化，请重新选择。";
            } else {
              const request = { kind: "use-ability", actorId, abilityId: draft.abilityId,
                selection: { ...draft.selection } };
              changed = commands ? commands.menu(request) : session.useMenuAbility({ actorId, abilityId: draft.abilityId,
                selection: { ...draft.selection } });
              this.message = changed ? "技能已施放。" : "当前状态、MP 或目标不允许施放，请重新选择。";
            }
          } catch (error) { this.message = abilityError(error); }
          reRender();
          if (changed) this.onChange();
        }, disabled || !draft.selection || selected?.available !== true));
        actions.append(button("取消", "field-cast-cancel", () => {
          if (!current() || this.disabled || this.abilityDraft !== draft) return;
          this.abilityDraft = null; this.message = "已取消施放。"; reRender();
        }, disabled));
        casting.append(actions);
      }
      this.root.append(casting);
    }
    if (this.playerId !== null && magicStones !== null) {
      this.magicStoneView.render(session, this.playerId, { disabled });
      this.root.append(this.magicStoneRoot);
    } else this.magicStoneView.reset();
    if (focused) [...this.root.querySelectorAll("[data-party-focus]")]
      .find((element) => element.dataset.partyFocus === focused)?.focus();
  }
}
