const cleanName = (name) => name.replace(/<IC_[A-Z0-9_]+>/g, "");
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
const bonusLabel = ({ parameter, value }) => {
  const labels = { 4: "力量", 5: "耐力", 6: "速度", 14: "魔力" };
  if (parameter === 0) return "升级奖励：无";
  if (parameter === 2 || parameter === 3)
    return `升级奖励：${parameter === 2 ? "HP" : "MP"} 成长 +${value}%`;
  return labels[parameter] ? `升级奖励：${labels[parameter]} +${value}` : "升级奖励尚未接入。";
};
const changeError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/stale|changed/i.test(message)) return "魔石或角色状态已变化，请重新选择。";
  if (/unheld|unowned|ownership/i.test(message)) return "魔石持有状态已变化，请重新选择。";
  return "当前无法更换魔石，请重新选择。";
};

/** UI selection only. Held stones, associations and learning remain in the
 * session. Every action retains the complete displayed model and exact owner. */
export class MagicStoneView {
  constructor(root, onChange = () => {}, { commands, owner } = {}) {
    if (commands !== undefined && (!owner || commands.owner !== owner || typeof commands.menu !== "function"))
      throw new Error("Invalid magic stone command owner");
    this.root = root;
    this.onChange = onChange;
    this.commands = commands;
    this.owner = owner;
    this.reset();
  }
  reset() {
    this.session = null;
    this.playerId = null;
    this.disabled = true;
    this.message = "";
    this.key = "";
    this.generation = (this.generation ?? 0) + 1;
    this.root.replaceChildren();
    this.root.hidden = true;
  }
  render(session, playerId, { disabled = false } = {}) {
    if (session !== this.session || playerId !== this.playerId) {
      this.message = "";
      this.key = "";
      this.generation++;
    }
    this.session = session;
    this.playerId = playerId;
    const commands = this.commands, owner = this.owner;
    const bound = () => this.session === session && this.playerId === playerId && this.commands === commands &&
      this.owner === owner && (!owner || owner === session) &&
      (!commands || commands.owner === session && commands.menuReady);
    this.disabled = disabled || !bound() || session?.menuReady !== true;
    if (!session || playerId === null || playerId === undefined || typeof session.magicStoneMenu !== "function") {
      this.root.hidden = true;
      this.root.replaceChildren();
      this.key = "";
      this.generation++;
      return;
    }
    const model = session.magicStoneMenu(playerId);
    const baseline = JSON.stringify(model);
    const key = JSON.stringify([baseline, this.disabled, this.message]);
    if (key === this.key) return;
    this.key = key;
    const generation = ++this.generation;
    const focused = this.root.contains(document.activeElement) ? document.activeElement.dataset.magicStoneFocus : null;
    this.root.replaceChildren();
    this.root.hidden = model.available !== true;
    if (this.root.hidden) return;

    this.root.append(node("h3", "魔石"), node("p", `当前装备：${model.currentContentId > 0
      ? typeof model.currentName === "string" ? cleanName(model.currentName) : "资料尚未就绪"
      : "未装备"}`));
    const canChange = !this.disabled && model.canEquip === true;
    let submitted = false;
    const change = (contentId) => {
      if (!canChange || submitted || generation !== this.generation || !bound() || this.disabled || !session.menuReady) return;
      let changed = false;
      try {
        const fresh = session.magicStoneMenu(playerId);
        if (JSON.stringify(fresh) !== baseline || fresh.available !== true || fresh.canEquip !== true) {
          this.message = "魔石或角色状态已变化，请重新选择。";
        } else {
          submitted = true;
          const removing = contentId === 0 || contentId === model.currentContentId;
          changed = commands ? commands.menu({ kind: "change-magic-stone", playerId, contentId })
            : session.changeMagicStone(playerId, contentId);
          this.message = changed ? removing ? "魔石已卸下。" : "魔石已装备。" : "当前无法更换魔石，请重新选择。";
        }
      } catch (error) { this.message = changeError(error); }
      // Rebuild even on refusal, revoking the captured action before exposing
      // another attempt. This cannot turn a repeated click into an unequip.
      this.key = "";
      this.render(session, playerId, { disabled: this.disabled });
      if (changed) this.onChange();
    };
    const action = (label, key, contentId, disabled) => {
      const element = node("button", label);
      element.type = "button";
      element.dataset.magicStoneFocus = key;
      element.disabled = disabled;
      element.onclick = () => { if (!disabled) change(contentId); };
      return element;
    };
    this.root.append(action("卸下魔石", "remove", 0, !canChange || model.currentContentId === 0));
    if (!model.canEquip) this.root.append(node("p", "当前角色无法装备魔石。", "party-menu-note"));
    const list = node("div", undefined, "party-menu-cells");
    for (const stone of model.stones) {
      const card = node("article", undefined, "party-menu-cell");
      card.dataset.magicStone = String(stone.contentId);
      const equipped = stone.contentId === model.currentContentId;
      const equip = action(`${cleanName(stone.name)}${equipped ? " · 点击卸下" : " · 装备"}`,
        `stone-${stone.contentId}`, stone.contentId, !canChange);
      equip.setAttribute("aria-pressed", String(equipped));
      card.append(equip, node("p", stone.equippedBy ? `装备者：${cleanName(stone.equippedBy.name)}` : "尚未装备"),
        node("p", bonusLabel(stone.bonus)));
      const learning = node("ul", undefined, "party-menu-abilities");
      for (const skill of stone.learning) {
        const progress = skill.skillLevel === 100 ? "已习得" : `学习 ${skill.skillLevel}%`;
        const row = node("li", `${cleanName(skill.name)} · ${progress} · 每魔法点 +${skill.rate}%`);
        row.dataset.magicStoneAbility = String(skill.abilityId);
        learning.append(row);
      }
      if (!stone.learning.length) learning.append(node("li", "没有可学习的魔法。"));
      card.append(learning);
      list.append(card);
    }
    this.root.append(list);
    if (!model.stones.length) this.root.append(node("p", "尚未取得魔石。", "party-menu-note"));
    this.root.append(node("p", "通过战斗获得魔法点学习；升级奖励在升级时生效。战斗召唤尚未开放。", "party-menu-note"));
    const status = node("p", this.message, "party-menu-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    this.root.append(status);
    if (focused) [...this.root.querySelectorAll("[data-magic-stone-focus]")]
      .find((element) => element.dataset.magicStoneFocus === focused)?.focus();
  }
}
