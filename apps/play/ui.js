import { Container, Graphics, Rectangle, Text } from "pixi.js";

// Retained game controls. These nodes hold labels and input callbacks; Pixi draws
// every visible window. DOM is used only for initial markup and accessibility.
let revision = 0;
class Widget {
  constructor(tag) {
    this.tag = tag.toLowerCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this._text = "";
    this._hidden = false;
    this._disabled = false;
    this._value = "";
  }
  get textContent() {
    return this._text + this.children.map((n) => n.textContent).join("");
  }
  set textContent(value) {
    value = String(value ?? "");
    if (this._text === value && !this.children.length) return;
    this._text = value;
    this.children = [];
    revision++;
  }
  get hidden() {
    return this._hidden;
  }
  set hidden(value) {
    if (this._hidden !== !!value) {
      this._hidden = !!value;
      revision++;
    }
  }
  get disabled() {
    return this._disabled;
  }
  set disabled(value) {
    if (this._disabled !== !!value) {
      this._disabled = !!value;
      revision++;
    }
  }
  get value() {
    return this._value;
  }
  set value(value) {
    if (this._value !== value) {
      this._value = value;
      revision++;
    }
  }
  append(...nodes) {
    this.children.push(...nodes);
    revision++;
  }
  prepend(...nodes) {
    this.children.unshift(...nodes);
    revision++;
  }
  replaceChildren(...nodes) {
    this._text = "";
    this.children = nodes;
    revision++;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    revision++;
  }
  click() {
    if (!this.disabled) this.onclick?.();
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const key = selector.startsWith("[data-")
      ? selector.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      : null;
    const result = [];
    for (const node of this.children) {
      if (key ? key in node.dataset : node.tag === selector) result.push(node);
      result.push(...node.querySelectorAll(selector));
    }
    return result;
  }
}
export const createWidget = (tag) => new Widget(tag);

export class GameUI {
  constructor(layer) {
    this.layer = layer;
    this.ids = new Map();
    this.views = new Map();
    this.scrolls = new Map();
    this.windows = [];
    for (const element of document.querySelectorAll("main > section, main > aside")) {
      const root = this.read(element);
      this.windows.push(root);
      element.remove();
    }
    this.pages = new Map();
    for (const root of this.windows) {
      const previous = createWidget("button"),
        next = createWidget("button");
      previous.textContent = "↑ 上页";
      next.textContent = "↓ 下页";
      previous.onclick = () => this.page(root, -1);
      next.onclick = () => this.page(root, 1);
      this.pages.set(root, [previous, next]);
    }
    this.popupLayer = new Container();
    layer.addChild(this.popupLayer);
    addEventListener(
      "wheel",
      (e) => {
        const root = [...this.windows].reverse().find((w) => !w.hidden);
        if (root) {
          this.scroll(root, Math.sign(e.deltaY) * 180);
          e.preventDefault();
        }
      },
      { passive: false },
    );
  }
  read(element) {
    const node = createWidget(element.tagName);
    node.id = element.id;
    if (node.id) this.ids.set(node.id, node);
    node.hidden = element.hidden;
    node.disabled = element.disabled;
    for (const child of element.childNodes) {
      if (child.nodeType === 3) node._text += child.textContent.trim() ? child.textContent : "";
      else if (child.nodeType === 1) node.children.push(this.read(child));
    }
    return node;
  }
  get(id) {
    return this.ids.get(id);
  }
  page(root, direction) {
    const height = this.bounds(root)[3];
    const viewport =
      height - 102 - (root.id === "dialogue" && this.get("choices").children.length > 2 ? 66 : 0);
    this.scroll(root, direction * Math.max(42, Math.floor(viewport / 12) * 6));
  }
  scroll(root, delta) {
    const range = this.ranges?.get(root) || 0;
    this.scrolls.set(root, Math.max(0, Math.min(range, (this.scrolls.get(root) || 0) + delta)));
    revision++;
  }
  view(node) {
    if (!this.views.has(node)) {
      const container = new Container(),
        box = new Graphics(),
        text = new Text({
          text: "",
          style: {
            fontFamily: "system-ui",
            fontSize: 30,
            fill: 0xf4f1e8,
            lineHeight: 42,
            wordWrap: true,
          },
        });
      container.addChild(box, text);
      container.on("pointertap", () => {
        if (node.disabled) return;
        if (node.tag === "select") this.openSelect(node);
        else node.click();
      });
      this.views.set(node, { container, box, text });
    }
    return this.views.get(node);
  }
  label(node) {
    if (node.tag === "select")
      return `${node.attributes["aria-label"] || ""}：${node.children.find((o) => String(o.value) === String(node.value))?.textContent || "未选择"} ▾`;
    return node._text;
  }
  item(node, parent, x, y, width, clip) {
    const v = this.view(node),
      interactive = ["button", "select"].includes(node.tag);
    const label = this.label(node);
    if (v.text.text !== label) v.text.text = label;
    v.text.style.wordWrapWidth = Math.max(60, width - 30);
    v.text.style.fontSize = ["h1", "h2"].includes(node.tag) ? 42 : 30;
    v.text.style.fill = node.disabled ? 0x8391ac : 0xf4f1e8;
    let height = Math.max(42, Math.ceil(v.text.height / 6) * 6);
    if (interactive) height += 18;
    if (node.tag === "progress") height = 30;
    const c = v.container;
    if (c.parent !== parent) parent.addChild(c);
    c.position.set(x, y);
    c.visible =
      !node.hidden &&
      (!clip ||
        (interactive
          ? y >= clip[0] && y + height <= clip[1]
          : y + height > clip[0] && y < clip[1]));
    c.eventMode = interactive && !node.disabled ? "static" : "none";
    c.cursor = interactive ? "pointer" : "default";
    c.hitArea = new Rectangle(0, 0, width, height);
    c.accessible = c.visible && interactive && !node.disabled;
    c.accessibleTitle = label;
    c.accessibleHint = label;
    c.accessibleText = label;
    v.text.position.set(interactive ? 12 : 0, interactive ? 6 : 0);
    v.text.visible = node.tag !== "progress";
    v.box.clear();
    if (interactive)
      v.box
        .rect(0, 0, width, height)
        .fill({ color: 0x14284c, alpha: 0.95 })
        .stroke({ width: 3, color: node.disabled ? 0x53617c : 0xb6c7e6 });
    if (node.tag === "progress") {
      v.box.rect(0, 0, width, height).fill(0x1a263c);
      v.box
        .rect(0, 0, width * Math.min(1, Number(node.value) / (node.max || 1)), height)
        .fill(0xc8b974);
    }
    this.used.add(node);
    return height;
  }
  flow(nodes, parent, x, y, width, clip) {
    let left = 0,
      rowHeight = 0;
    const newline = () => {
      if (rowHeight) y += rowHeight + 12;
      left = 0;
      rowHeight = 0;
    };
    for (const node of nodes) {
      if (node.hidden || node.tag === "option") continue;
      const inline = ["button", "select"].includes(node.tag);
      if (!inline) newline();
      if (node._text || inline || node.tag === "progress") {
        const w = inline
          ? Math.min(width, Math.max(132, Math.ceil((this.label(node).length * 30 + 36) / 6) * 6))
          : width;
        if (left + w > width) newline();
        const height = this.item(node, parent, x + left, y, w, clip);
        if (inline) {
          left += w + 12;
          rowHeight = Math.max(rowHeight, height);
        } else y += height + 12;
      }
      if (node.children.length && node.tag !== "select") {
        newline();
        y = this.flow(
          node.children,
          parent,
          x + (node.tag === "fieldset" ? 18 : 0),
          y,
          width - (node.tag === "fieldset" ? 36 : 0),
          clip,
        );
        if (node.tag === "fieldset") y += 24;
      }
    }
    newline();
    return y;
  }
  bounds(root) {
    if (root.id === "title") return [300, 210, 1320, 648];
    if (root.id === "dialogue") return [60, 672, 1800, 360];
    if (root.id === "battle") return [36, 666, 1848, 378];
    if (root.id === "vehicle") return [300, 300, 1320, 480];
    return [90, 42, 1740, 990];
  }
  render() {
    if (this.popup || this.lastRevision === revision) return;
    this.lastRevision = revision;
    this.used = new Set();
    this.ranges = new Map();
    for (const root of this.windows) {
      const v = this.view(root),
        [x, y, width, height] = this.bounds(root);
      if (v.container.parent !== this.layer) this.layer.addChild(v.container);
      v.container.visible = !root.hidden;
      v.container.position.set(x, y);
      v.text.visible = false;
      v.box
        .clear()
        .rect(0, 0, width, height)
        .fill({ color: 0x101b38, alpha: 0.96 })
        .stroke({ color: 0xb7c7df, width: 6 });
      this.used.add(root);
      if (root.hidden) continue;
      if (!v.content) {
        v.content = new Container();
        v.mask = new Graphics();
        v.container.addChild(v.content, v.mask);
        v.content.mask = v.mask;
      }
      const scroll = this.scrolls.get(root) || 0;
      let body = root.children;
      let pinned = root.id === "title" ? [] : root.children.filter((node) => node.tag === "button");
      if (root.id !== "title") body = body.filter((node) => !pinned.includes(node));
      if (root.id === "battle") {
        const targets = this.get("targets");
        body = [
          this.get("battle-status"),
          targets.children.length ? targets : this.get("commands"),
        ];
      }
      if (root.id === "dialogue") {
        const choices = this.get("choices");
        body = [this.get("speaker"), this.get("message")];
        pinned = choices.children.length ? choices.children : [this.get("confirm")];
      }
      const pinY = height - (root.id === "dialogue" && pinned.length > 2 ? 132 : 66);
      v.mask
        .clear()
        .rect(24, 24, width - 48, pinY - 36)
        .fill(0xffffff);
      const end = this.flow(body, v.content, 24, 24 - scroll, width - 48, [24, pinY - 12]);
      this.flow(pinned, v.container, 24, pinY, width - (root.id === "dialogue" ? 48 : 480));
      const range = Math.max(0, end + scroll - pinY + 24);
      this.ranges.set(root, range);
      if (scroll > range) {
        this.scrolls.set(root, range);
        revision++;
      }
      if (range) {
        const [previous, next] = this.pages.get(root);
        previous.disabled = !scroll;
        next.disabled = scroll >= range;
        this.item(previous, v.container, width - 396, height - 66, 174);
        this.item(next, v.container, width - 204, height - 66, 174);
      }
    }
    for (const [node, view] of this.views)
      if (!this.used.has(node)) {
        view.container.visible = false;
        view.container.accessible = false;
        // Dynamic menus can be rebuilt; release detached controls rather than retain
        // every historical inventory and target list for the whole playthrough.
        if (!this.ids.has(node.id) && ![...this.pages.values()].some((p) => p.includes(node))) {
          view.container.destroy({ children: true });
          this.views.delete(node);
        }
      }
    this.layer.setChildIndex(this.popupLayer, this.layer.children.length - 1);
  }
  openSelect(node, page = 0) {
    this.closeSelect();
    const backdrop = new Graphics().rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: 0.3 });
    backdrop.eventMode = "static";
    backdrop.on("pointertap", () => this.closeSelect());
    this.popupLayer.addChild(backdrop);
    const panel = new Graphics()
      .rect(180, 90, 1560, 900)
      .fill(0x101b38)
      .stroke({ color: 0xd0dcf3, width: 6 });
    this.popupLayer.addChild(panel);
    const rows = node.children.slice(page * 12, (page + 1) * 12).map((option) => {
      const choice = createWidget("button");
      choice.textContent = option.textContent;
      choice.onclick = () => {
        node.value = option.value;
        node.onchange?.();
        this.closeSelect();
      };
      return choice;
    });
    const previous = createWidget("button"),
      next = createWidget("button"),
      close = createWidget("button");
    previous.textContent = "上一页";
    previous.disabled = page === 0;
    next.textContent = "下一页";
    next.disabled = (page + 1) * 12 >= node.children.length;
    close.textContent = "返回";
    previous.onclick = () => this.openSelect(node, page - 1);
    next.onclick = () => this.openSelect(node, page + 1);
    close.onclick = () => this.closeSelect();
    // Popup controls use their own retained lifetime; suppress the underlying page.
    for (const root of this.windows) this.view(root).container.accessibleChildren = false;
    this.used = new Set(this.views.keys());
    this.flow(rows, this.popupLayer, 210, 120, 1500);
    this.flow([previous, next, close], this.popupLayer, 210, 900, 1500);
    this.popup = true;
  }
  closeSelect() {
    for (const root of this.windows) this.view(root).container.accessibleChildren = true;
    for (const [node, view] of this.views)
      if (view.container.parent === this.popupLayer) {
        view.container.destroy({ children: true });
        this.views.delete(node);
      }
    this.popupLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.popup = false;
    revision++;
  }
  handleKey(event) {
    if (!this.popup) return false;
    if (event.key === "Escape") {
      this.closeSelect();
      event.preventDefault();
    }
    return true;
  }
}
