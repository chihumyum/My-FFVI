const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const displayName = (name) => name.replace(/<IC_[A-Z0-9_]+>/g, "");

/** Presentation selection only. Quotes and transactions always use GameSession. */
export class ShopView {
  constructor(root, onChange = () => {}, { commands, owner } = {}) {
    if (commands !== undefined && (!owner || commands.owner !== owner || typeof commands.tradeShop !== "function" ||
      typeof commands.closeShop !== "function")) throw new Error("Invalid shop command owner");
    this.root = root;
    this.onChange = onChange;
    this.commands = commands;
    this.owner = owner;
    this.reset();
  }
  reset() {
    this.session = null;
    this.selection = null;
    this.mode = "buy";
    this.quantity = 1;
    this.message = "";
    this.key = "";
    this.identity = null;
    this.field = null;
    this.active = false;
    this.root.hidden = true;
  }
  button(label, callback, disabled = false, focusKey = label) {
    const button = node("button", label);
    const session = this.session,
      field = this.field,
      identity = this.identity,
      commands = this.commands;
    button.type = "button";
    button.setAttribute("data-shop-focus", focusKey);
    button.disabled = disabled || !this.active;
    button.onclick = () => {
      if (
        !this.active ||
        button.disabled ||
        !this.root.contains(button) ||
        this.session !== session ||
        this.field !== field ||
        this.identity !== identity ||
        this.commands !== commands ||
        (commands && (this.owner !== session || !commands.shopReady)) ||
        session.field !== field ||
        field.currentShop?.id !== identity
      )
        return;
      callback();
    };
    return button;
  }
  back() {
    const session = this.session, commands = this.commands;
    if (
      !this.active ||
      !this.session ||
      (commands && (this.owner !== session || !commands.shopReady)) ||
      this.session.field !== this.field ||
      this.field.currentShop?.id !== this.identity
    )
      return false;
    if (this.selection) {
      this.selection = null;
      this.message = "";
      this.render(session);
    } else {
      if (commands ? !commands.closeShop(this.identity) : session.closeShop(this.identity) === false) return false;
      this.onChange();
    }
    return true;
  }
  render(session, active = true) {
    const commands = this.commands;
    active &&= !commands || this.owner === session && commands.shopReady;
    const shop = session.field.currentShop;
    if (!shop) {
      this.reset();
      return;
    }
    const ownedFocus = this.root.contains(document.activeElement);
    const focusKey = ownedFocus
      ? document.activeElement.getAttribute("data-shop-focus")
      : null;
    const wasActive = this.active;
    const entering = this.session !== session || this.field !== session.field || this.identity !== shop.id;
    if (entering) {
      this.reset();
      this.field = session.field;
      this.identity = shop.id;
    }
    this.session = session;
    this.active = active;
    this.root.hidden = !active;
    let options;
    try {
      options = session.shopOptions();
    } catch (error) {
      this.key = "";
      const panel = node("div", undefined, "panel shop-panel");
      panel.append(
        node("h2", "商店"),
        node("p", error.message),
        this.button("离开商店", () => {
          if (commands ? !commands.closeShop(shop.id) : session.closeShop(shop.id) === false) return;
          this.onChange();
        }),
      );
      this.root.replaceChildren(panel);
      if (active && (entering || !wasActive || ownedFocus))
        this.root.querySelector("button:not(:disabled)")?.focus();
      return;
    }
    const list = options[this.mode];
    const selected =
      this.selection &&
      list.find((row) =>
        this.mode === "buy"
          ? row.productId === this.selection.id
          : row.contentId === this.selection.id,
      );
    if (!selected || selected.maxCount === 0) this.selection = null;
    this.quantity = Math.max(
      1,
      Math.min(this.quantity, selected?.maxCount ?? 1),
    );
    const key = JSON.stringify([
      shop,
      options,
      this.mode,
      this.selection,
      this.quantity,
      this.message,
      active,
    ]);
    if (key === this.key) return;
    this.key = key;
    const panel = node("div", undefined, "panel shop-panel");
    panel.append(
      node("h2", displayName(options.name)),
      node("p", `${options.gil} Gil`, "shop-gil"),
    );
    const tabs = node("div", undefined, "shop-tabs");
    for (const [mode, label] of [
      ["buy", "购买"],
      ["sell", "出售"],
    ]) {
      const tab = this.button(
        label,
        () => {
          this.mode = mode;
          this.selection = null;
          this.message = "";
          this.render(session);
        },
        false,
        "tab:" + mode,
      );
      tab.setAttribute("aria-pressed", String(this.mode === mode));
      tabs.append(tab);
    }
    tabs.append(
      this.button("离开商店", () => {
        if (commands ? !commands.closeShop(shop.id) : session.closeShop(shop.id) === false) return;
        this.onChange();
      }),
    );
    panel.append(tabs);
    if (this.selection) {
      const selection = this.selection;
      const confirmation = node("section", undefined, "shop-confirmation");
      confirmation.setAttribute("aria-label", "确认交易");
      confirmation.append(
        node("h3", displayName(selected.name)),
        node(
          "p",
          `单价 ${selected.unitPrice} Gil · 持有 ${selected.count}${selected.equipped ? ` · 装备中 ${selected.equipped}` : ""}`,
        ),
      );
      const quantity = node("div", undefined, "shop-quantity");
      quantity.append(
        this.button(
          "−",
          () => {
            this.quantity--;
            this.render(session);
          },
          this.quantity <= 1,
        ),
        node("span", `数量 ${this.quantity} / ${selected.maxCount}`),
        this.button(
          "+",
          () => {
            this.quantity++;
            this.render(session);
          },
          this.quantity >= selected.maxCount,
        ),
      );
      confirmation.append(
        quantity,
        node("p", `合计 ${selected.unitPrice * this.quantity} Gil`),
      );
      const confirm = this.button(
        this.mode === "buy" ? "确认购买" : "确认出售",
        () => {
          if (this.selection !== selection) return;
          confirm.disabled = true;
          try {
            const request =
              this.mode === "buy"
                ? {
                    kind: "buy",
                    productId: selected.productId,
                    count: this.quantity,
                  }
                : {
                    kind: "sell",
                    contentId: selected.contentId,
                    count: this.quantity,
                  };
            const result = commands ? commands.tradeShop(request) : session.tradeShop(request);
            if (!result) {
              this.message = "当前无法交易。";
              this.render(session);
              return;
            }
            this.message = `${this.mode === "buy" ? "购入" : "售出"} ${displayName(selected.name)} × ${result.count}`;
            this.selection = null;
          } catch (error) {
            this.message = error.message;
          }
          this.render(session);
          this.onChange();
        },
      );
      confirmation.append(
        confirm,
        this.button("取消", () => {
          this.selection = null;
          this.render(session);
        }),
      );
      panel.append(confirmation);
    } else {
      const products = node("div", undefined, "shop-products");
      products.setAttribute(
        "aria-label",
        this.mode === "buy" ? "可购买商品" : "持有物品",
      );
      for (const row of list) {
        const button = this.button(
          "",
          () => {
            this.selection = {
              id: this.mode === "buy" ? row.productId : row.contentId,
            };
            this.quantity = 1;
            this.message = "";
            this.render(session);
          },
          row.maxCount === 0,
          this.mode + ":" + (row.productId ?? row.contentId),
        );
        button.className = "shop-product";
        button.append(
          node("strong", displayName(row.name)),
          node("span", `${row.unitPrice} Gil`),
          node(
            "small",
            `持有 ${row.count}${row.equipped ? ` · 装备中 ${row.equipped}` : ""}`,
          ),
        );
        products.append(button);
      }
      if (!list.length) products.append(node("p", "没有可出售的物品。"));
      panel.append(products);
    }
    const message = node("p", this.message, "shop-status");
    message.setAttribute("role", "status");
    panel.append(message);
    this.root.replaceChildren(panel);
    if (active && (entering || !wasActive || ownedFocus)) {
      const buttons = [...this.root.querySelectorAll("button:not(:disabled)")];
      const previous = buttons.find(
        (button) => button.getAttribute("data-shop-focus") === focusKey,
      );
      const confirm = buttons.find(
        (button) =>
          button.textContent ===
          (this.mode === "buy" ? "确认购买" : "确认出售"),
      );
      (previous ?? confirm ?? buttons[0])?.focus();
    }
  }
}
