export const itemName = (item) =>
  item.name.replace(/<(?:IC_DRAG|IC_BAG|IC_TENTO|IC_SCR|IC_MCN|IC_IOBJ)>/g, "");

/** Presentation reads the same owned state as battle/save; it never edits stock. */
export class InventoryView {
  constructor(root, definitions, onUse) {
    this.root = root;
    this.definitions = definitions;
    this.onUse = onUse;
    this.selected = null;
    this.message = "";
  }
  render(session) {
    this.session = session;
    const find = (id) => this.root.querySelector(`#${id}`);
    const state = session.state.snapshot(),
      players = session.battle?.players ?? session.players;
    const status = (p) =>
      p.conditionIds
        .map(
          (id) =>
            session.battleCatalog.common.conditions.behaviors.find(
              (b) => b.id === id,
            ).name,
        )
        .join("、");
    find("owned-party").textContent = players
      .map(
        (p) =>
          `${p.name} · Lv ${p.level}\nHP ${p.hp} / ${p.maxHp}　MP ${p.mp} / ${p.maxMp}${status(p) ? `\n${status(p)}` : ""}`,
      )
      .join("\n\n");
    find("owned-gil").textContent = `${state.gil} Gil`;
    const stacks = session.battle?.inventory ?? state.items;
    find("owned-key-items").textContent =
      stacks
        .filter((i) => i.count > 0 && this.definitions[i.id].important)
        .map((i) => `${itemName(this.definitions[i.id])} × ${i.count}`)
        .join("\n") || "无";
    const list = find("owned-items");
    list.replaceChildren();
    const button = (parent, label, disabled, handler) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.disabled = disabled;
      b.onclick = handler;
      parent.append(b);
      return b;
    };
    for (const stack of stacks.filter(
      (i) => i.count > 0 && !this.definitions[i.id].important,
    )) {
      const item = this.definitions[stack.id],
        targets = session.checkpointReady
          ? session.state.menuItemTargets(item.id)
          : [];
      const b = button(
        list,
        `${itemName(item)} × ${stack.count}`,
        !targets.length,
        () => {
          this.selected = item.id;
          this.message = "";
          this.render(this.session);
          find("item-targets").querySelector("button:not(:disabled)")?.focus();
        },
      );
      if (!item.uses.menu.plan) b.title = "此道具的菜单使用尚未接入";
      else if (!session.checkpointReady) b.title = "请回到地图空闲时使用";
      else if (!targets.length) b.title = "没有需要恢复的队员";
    }
    if (!list.childNodes.length) list.textContent = "无";
    const targetList = find("item-targets");
    targetList.replaceChildren();
    targetList.hidden = this.selected === null;
    if (this.selected !== null) {
      const item = this.definitions[this.selected];
      const title = document.createElement("p");
      title.textContent = `${itemName(item)} · 选择队员`;
      targetList.append(title);
      const targets = session.checkpointReady
        ? session.state.menuItemTargets(item.id)
        : [];
      for (const p of players)
        button(
          targetList,
          `${p.name} · HP ${p.hp}/${p.maxHp} · MP ${p.mp}/${p.maxMp}${status(p) ? ` · ${status(p)}` : ""}`,
          !targets.includes(p.id),
          () => {
            try {
              this.message = this.session.useMenuItem(item.id, p.id)
                ? `${p.name} 使用了${itemName(item)}。`
                : "当前无法使用。";
            } catch (error) {
              this.message = "道具使用失败，库存未改变。";
              console.error(error);
            }
            this.render(this.session);
            this.onUse();
            targetList.querySelector("button:not(:disabled)")?.focus();
          },
        );
      button(targetList, "取消选择", false, () => {
        this.selected = null;
        this.render(this.session);
      });
    }
    find("item-status").textContent = this.message;
  }
  reset() {
    this.selected = null;
    this.message = "";
  }
}
