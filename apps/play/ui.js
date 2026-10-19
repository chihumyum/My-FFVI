import { Container, Graphics, Rectangle, Text, Sprite, NineSliceSprite } from "pixi.js";
import { SingleHover, directionalControl } from "./ui-interaction.js";

// Retained game controls. These nodes hold labels and input callbacks; Pixi draws
// every visible window. DOM is used only for initial markup and accessibility.
let revision = 0;
let layoutRevision = 0;
const layoutChanged = () => {
  revision++;
  layoutRevision++;
};
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
    layoutChanged();
  }
  get hidden() {
    return this._hidden;
  }
  set hidden(value) {
    if (this._hidden !== !!value) {
      this._hidden = !!value;
      layoutChanged();
    }
  }
  get disabled() {
    return this._disabled;
  }
  set disabled(value) {
    if (this._disabled !== !!value) {
      this._disabled = !!value;
      layoutChanged();
    }
  }
  get value() {
    return this._value;
  }
  set value(value) {
    if (this._value !== value) {
      this._value = value;
      layoutChanged();
    }
  }
  append(...nodes) {
    this.children.push(...nodes);
    layoutChanged();
  }
  prepend(...nodes) {
    this.children.unshift(...nodes);
    layoutChanged();
  }
  replaceChildren(...nodes) {
    this._text = "";
    this.children = nodes;
    layoutChanged();
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    layoutChanged();
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
  constructor(layer, texture = () => null) {
    this.layer = layer;
    this.ids = new Map();
    this.views = new Map();
    this.scrolls = new Map();
    this.windows = [];
    this.texture = texture;
    this.visibleImages = new Map();
    this.presentation = {};
    this.hover = new SingleHover(() => revision++);
    addEventListener("blur", () => this.clearHover());
    addEventListener("resize", () => {
      this.clearHover();
      layoutChanged();
    });
    document.querySelector("canvas")?.addEventListener("pointerleave", () => this.clearHover());
    for (const element of document.querySelectorAll("main > section, main > aside")) {
      const root = this.read(element);
      this.windows.push(root);
      element.remove();
    }
    if (this.get("battle")) {
      const options = createWidget("aside");
      options.id = "battle-options";
      options.hidden = true;
      this.ids.set(options.id, options);
      this.windows.push(options);
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
    if (element.hasAttribute("aria-label"))
      node.setAttribute("aria-label", element.getAttribute("aria-label"));
    return node;
  }
  get(id) {
    return this.ids.get(id);
  }
  setPresentation(presentation = {}) {
    this.presentation = presentation;
    for (const view of this.views.values())
      view.text.style.fontFamily = presentation.fontFamily || "system-ui";
    revision++;
  }
  setCharacters(characters) {
    this.speakerIds ||= {};
    for (const u of Object.values(characters || {})) this.speakerIds[u.name] = u.id;
    this.characterNames = Object.fromEntries(
      Object.values(characters || {}).map((u) => [u.id, u.name]),
    );
    revision++;
  }
  diagnostics() {
    const visible = [...this.views].filter(([, view]) => {
      for (let p = view.container; p; p = p.parent) if (!p.visible) return false;
      return true;
    });
    return {
      hovered: visible.filter(([, view]) => view.hover).map(([node]) => this.label(node)),
      keyboard: visible.filter(([, view]) => view.keyboard).map(([node]) => this.label(node)),
      keyboardControls: this.keyboardControls().map(({ node, ...bounds }) => ({
        label: this.label(node),
        current: node === this.keyboardNode,
        ...bounds,
      })),
      selected: visible.filter(([node]) => node.dataset.selected).map(([node]) => this.label(node)),
      cards: visible
        .filter(([node]) => node.dataset.card)
        .map(([node, view]) => ({
          label: this.label(node),
          url: node.attributes.src || null,
          loaded: !!view.image?.visible,
        })),
      images: visible
        .filter(([node]) => ["img", "viewer"].includes(node.tag))
        .map(([node, view]) => ({
          url: node.attributes.src || null,
          loaded: !!view.image?.visible,
        })),
    };
  }
  image(url, details) {
    if (!url) return null;
    const texture = this.texture(url, details);
    this.visibleImages.set(url, texture);
    return texture;
  }
  portrait(id) {
    const key = this.presentation.characterFaces?.[id];
    return this.presentation.portraits?.[key]?.url;
  }
  skin(view, width, height) {
    if (view.modern) {
      view.box
        .clear()
        .roundRect(0, 0, width, height, 18)
        .fill(0x111d31)
        .stroke({ color: 0x40556f, width: 2 });
      if (view.background) view.background.visible = false;
      if (view.skin) view.skin.visible = false;
      return;
    }
    view.box.clear().rect(0, 0, width, height).fill({ color: 0x0b2460, alpha: 0.97 });
    const source = this.presentation.sprites?.window,
      texture = this.image(source?.url);
    const background = this.image(this.presentation.sprites?.windowBackground?.url);
    if (background) {
      if (!view.background) {
        view.background = new Sprite();
        view.container.addChildAt(view.background, 1);
      }
      view.background.texture = background;
      view.background.width = width;
      view.background.height = height;
      view.background.visible = true;
    } else if (view.background) view.background.visible = false;
    if (texture) {
      if (!view.skin) {
        const border = source.border || [];
        view.skin = new NineSliceSprite({
          texture,
          leftWidth: border.left ?? border[0] ?? border.x ?? 8,
          rightWidth: border.right ?? border[2] ?? border.z ?? 8,
          topHeight: border.top ?? border[3] ?? border.w ?? 8,
          bottomHeight: border.bottom ?? border[1] ?? border.y ?? 8,
        });
        view.container.addChildAt(view.skin, view.background ? 2 : 1);
      }
      view.skin.texture = texture;
      view.skin.width = width;
      view.skin.height = height;
      view.skin.visible = true;
    } else {
      if (view.skin) view.skin.visible = false;
      view.box.stroke({ color: 0xcbd2e2, width: 6 });
    }
  }
  setDialogue(
    dialogue,
    speed = 3,
    instant = false,
    speaker = dialogue?.speaker,
    text = dialogue?.text,
  ) {
    if (this.dialogue?.source !== dialogue)
      this.dialogue = { source: dialogue, started: performance.now(), shown: 0 };
    this.dialogue.speed = speed;
    this.dialogue.instant = instant;
    this.dialogue.speaker = speaker;
    this.dialogue.text = text || "";
  }
  revealDialogue() {
    const d = this.dialogue;
    if (!d?.source || d.shown >= Array.from(d.text).length) return false;
    d.revealed = true;
    revision++;
    return true;
  }
  page(root, direction) {
    const height = this.bounds(root)[3];
    const viewport =
      height - 102 - (root.id === "dialogue" && this.get("choices").children.length > 2 ? 66 : 0);
    this.scroll(root, direction * Math.max(42, Math.floor(viewport / 12) * 6));
  }
  scroll(root, delta) {
    this.clearHover();
    const range = this.ranges?.get(root) || 0;
    if (root.id === "dialogue")
      delta = Math.sign(delta) * Math.max(42, Math.round(Math.abs(delta) / 42) * 42);
    this.scrolls.set(root, Math.max(0, Math.min(range, (this.scrolls.get(root) || 0) + delta)));
    revision++;
  }
  clearHover() {
    this.hover.clear();
  }
  view(node) {
    if (!this.views.has(node)) {
      const container = new Container(),
        box = new Graphics(),
        text = new Text({
          text: "",
          style: {
            fontFamily: this.presentation.fontFamily || "system-ui",
            fontSize: 30,
            fill: 0xf4f1e8,
            lineHeight: 42,
            wordWrap: true,
          },
        });
      container.addChild(box, text);
      container.on("pointertap", () => {
        if (node.disabled) return;
        this.setKeyboard(null);
        if (node.tag === "select") this.openSelect(node);
        else if (node.tag === "input") this.openTextInput(node);
        else node.click();
      });
      if (["button", "select", "input"].includes(node.tag)) {
        const enter = () => {
          if (!node.hidden && !node.disabled && container.visible) {
            this.setKeyboard(null);
            this.hover.enter(this.views.get(node));
          }
        };
        const leave = () => this.hover.leave(this.views.get(node));
        container.on("pointerover", enter);
        container.on("pointerout", leave);
        container.on("mouseover", enter);
        container.on("mouseout", leave);
      }
      this.views.set(node, { container, box, text });
    }
    return this.views.get(node);
  }
  label(node) {
    if (node.id === "message" && this.dialogue?.source)
      return Array.from(node._text).slice(0, this.dialogue.shown).join("");
    if (node.tag === "input" && !node.value && node.attributes.placeholder)
      return node.attributes.placeholder;
    if (node.tag === "input")
      return `${node.attributes["aria-label"] || "名称"}：${node.value || node.attributes.placeholder || ""}`;
    if (node.tag === "select")
      return `${node.attributes["aria-label"] || ""}：${node.children.find((o) => String(o.value) === String(node.value))?.textContent || "未选择"} ▾`;
    return node._text;
  }
  item(node, parent, x, y, width, clip) {
    const v = this.view(node),
      interactive = ["button", "select", "input"].includes(node.tag);
    const label = this.label(node);
    const captionLimit = Math.max(12, Math.floor((width - 24) / 22) * 2 - 1);
    const visibleLabel =
      node.dataset.card && Array.from(label).length > captionLimit
        ? Array.from(label).slice(0, captionLimit).join("") + "…"
        : label;
    if (v.text.text !== visibleLabel) v.text.text = visibleLabel;
    v.text.style.wordWrapWidth = Math.max(60, width - 30);
    const compact = node.dataset.compact === "1";
    v.text.style.fontSize = compact
      ? 26
      : node.dataset.card
        ? 22
        : ["h1", "h2"].includes(node.tag)
          ? 42
          : 30;
    v.text.style.lineHeight = compact ? 30 : node.dataset.card ? 28 : 42;
    v.text.style.fill = node.disabled ? 0x8391ac : 0xf4f1e8;
    let height = Math.max(compact ? 30 : 42, Math.ceil(v.text.height / 6) * 6);
    if (interactive) height += compact ? 12 : 18;
    if (node.tag === "progress") height = 30;
    if (node.tag === "img") height = Number(node.dataset.height) || 156;
    if (node.dataset.card || node.tag === "viewer") height = Number(node.dataset.height) || 150;
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
    if (!c.visible) this.hover.leave(v);
    c.accessibleTitle = label;
    c.accessibleHint = label;
    c.accessibleText = label;
    // Pixi 8.22 initializes these labels only when creating its overlay. Keep
    // existing accessibility controls in sync with the visible Pixi text.
    if (c._accessibleDiv && c._accessibleDiv.title !== label) {
      c._accessibleDiv.title = label;
      c._accessibleDiv.setAttribute("aria-label", label);
      c._accessibleDiv.textContent = label;
    }
    v.text.position.set(
      interactive ? 12 : 0,
      node.dataset.card ? height - 56 : interactive ? 6 : 0,
    );
    v.text.visible = !["progress", "img", "viewer"].includes(node.tag);
    if (node.id === "message" && clip) {
      // A scrollable dialogue may contain more lines than the window. Clip
      // only at line boundaries, rather than exposing half of the next line.
      const first = Math.max(0, Math.ceil((clip[0] - y) / 42) * 42),
        last = Math.min(height, Math.floor((clip[1] - y) / 42) * 42);
      if (!v.lineMask) {
        v.lineMask = new Graphics();
        c.addChild(v.lineMask);
        v.text.mask = v.lineMask;
      }
      v.lineMask
        .clear()
        .rect(0, first, width, Math.max(0, last - first))
        .fill(0xffffff);
    }
    if (node.dataset.card) {
      v.text.style.wordWrapWidth = width - 24;
      v.text.style.breakWords = true;
    }
    const iconKey = this.presentation.contentIcons?.[node.dataset.contentId],
      icon = c.visible && this.image(this.presentation.icons?.[iconKey]?.url);
    if (icon) {
      if (!v.icon) {
        v.icon = new Sprite();
        c.addChild(v.icon);
      }
      v.icon.texture = icon;
      v.icon.width = 48;
      v.icon.height = 48;
      v.icon.position.set(0, 0);
      v.icon.visible = true;
      v.text.x = 60;
      v.text.style.wordWrapWidth = Math.max(60, width - 90);
    } else if (v.icon) v.icon.visible = false;
    v.box.clear();
    if (interactive)
      v.box.roundRect(0, 0, width, height, node.dataset.card ? 10 : 4).fill({
        color: 0x426495,
        alpha: node.dataset.titleButton
          ? 1
          : v.hover || v.keyboard || node.dataset.selected
            ? 0.65
            : node.tag === "input"
              ? 0.4
              : 0.12,
      });
    const pointer =
      c.visible && !node.dataset.modern && this.image(this.presentation.sprites?.cursor?.url);
    if (pointer && interactive && !node.dataset.card) {
      if (!v.pointer) {
        v.pointer = new Sprite();
        c.addChild(v.pointer);
      }
      v.pointer.texture = pointer;
      v.pointer.position.set(-30, Math.floor((height - 42) / 2));
      v.pointer.width = 42;
      v.pointer.height = 42;
      v.pointer.visible = !!(v.hover || v.keyboard) && !node.disabled;
    } else if (v.pointer) v.pointer.visible = false;
    if (node.tag === "img" || node.dataset.card || node.tag === "viewer") {
      const source = node.dataset.actorId
        ? this.portrait(node.dataset.actorId)
        : node.attributes.src;
      const texture =
        c.visible &&
        this.image(
          source,
          node.dataset.required
            ? {
                required: true,
                entityId: node.dataset.entityId,
                resource: node.dataset.resource || "ui-image",
                asset: source,
              }
            : undefined,
        );
      if (!v.image) {
        v.image = new Sprite();
        c.addChild(v.image);
      }
      v.image.visible = !!texture;
      if (texture) {
        v.image.texture = texture;
        const imageHeight = node.dataset.card ? height - 60 : height;
        const fit = Math.min((width - 24) / texture.width, imageHeight / texture.height),
          scale = node.dataset.actorId ? Math.max(1, Math.floor(fit)) : fit;
        v.image.scale.set(scale);
        v.image.position.set(Math.round((width - texture.width * scale) / 2), 0);
        if (node.tag === "viewer") this.viewer(v, node, width, height, fit);
      }
    }
    if (node.tag === "progress") {
      v.box.rect(0, 0, width, height).fill(0x1a263c);
      v.box
        .rect(0, 0, width * Math.min(1, Number(node.value) / (node.max || 1)), height)
        .fill(0xc8b974);
    }
    this.used.add(node);
    return height;
  }
  viewer(view, node, width, height, fit) {
    const scale = fit * Math.max(1, Number(node.dataset.zoom) || 1),
      limitX = Math.max(0, (view.image.texture.width * scale - width) / 2),
      limitY = Math.max(0, (view.image.texture.height * scale - height) / 2),
      panX = Math.max(-limitX, Math.min(limitX, Number(node.dataset.panX) || 0)),
      panY = Math.max(-limitY, Math.min(limitY, Number(node.dataset.panY) || 0));
    view.image.anchor.set(0.5);
    view.image.scale.set(scale);
    view.image.position.set(width / 2 + panX, height / 2 + panY);
    if (!view.viewerMask) {
      view.viewerMask = new Graphics();
      view.container.addChild(view.viewerMask);
      view.image.mask = view.viewerMask;
      view.container.on("pointerdown", (event) => {
        const p = event.getLocalPosition(view.container);
        view.drag = {
          x: p.x,
          y: p.y,
          panX: Number(node.dataset.panX) || 0,
          panY: Number(node.dataset.panY) || 0,
        };
        view.container.cursor = "grabbing";
        event.stopPropagation();
      });
      view.container.on("globalpointermove", (event) => {
        if (!view.drag) return;
        const p = event.getLocalPosition(view.container);
        node.dataset.panX = String(view.drag.panX + p.x - view.drag.x);
        node.dataset.panY = String(view.drag.panY + p.y - view.drag.y);
        node.onpan?.(Number(node.dataset.panX), Number(node.dataset.panY));
        revision++;
      });
      const release = () => {
        view.drag = null;
        view.container.cursor = "grab";
      };
      view.container.on("pointerup", release);
      view.container.on("pointerupoutside", release);
    }
    view.viewerMask.clear().rect(0, 0, width, height).fill(0xffffff);
    view.container.eventMode = "static";
    view.container.cursor = view.drag ? "grabbing" : "grab";
    node.dataset.panX = String(panX);
    node.dataset.panY = String(panY);
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
      if (node.tag === "grid") {
        newline();
        const columns = Math.max(1, Number(node.dataset.columns) || 6),
          rows = Math.max(1, Number(node.dataset.rows) || 4),
          gap = 14,
          height = Number(node.dataset.height) || 600,
          cellWidth = Math.floor((width - gap * (columns - 1)) / columns),
          cellHeight = Math.floor((height - gap * (rows - 1)) / rows);
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          child.dataset.height = String(cellHeight);
          this.item(
            child,
            parent,
            x + (i % columns) * (cellWidth + gap),
            y + Math.floor(i / columns) * (cellHeight + gap),
            cellWidth,
            clip,
          );
        }
        y += height + 12;
        continue;
      }
      const inline = ["button", "select", "input", "img"].includes(node.tag) && !node.dataset.block;
      if (!inline) newline();
      if (
        node._text ||
        inline ||
        ["progress", "button", "select", "input", "img", "viewer"].includes(node.tag)
      ) {
        const w = inline
          ? Number(node.dataset.width) ||
            (node.tag === "img"
              ? 180
              : Math.min(
                  width,
                  Math.max(132, Math.ceil((this.label(node).length * 30 + 36) / 6) * 6),
                ))
          : width;
        if (left + w > width) newline();
        const height = this.item(node, parent, x + left, y, w, clip);
        if (inline) {
          left += w + 12;
          rowHeight = Math.max(rowHeight, height);
        } else y += height + (node.dataset.compact === "1" ? 6 : 12);
      }
      if (node.children.length && node.tag !== "select") {
        newline();
        if (node.tag === "fieldset" && node.children[0]?.tag === "img") {
          this.item(node.children[0], parent, x + 18, y, 180, clip);
          y =
            Math.max(
              y + 180,
              this.flow(node.children.slice(1), parent, x + 210, y, width - 228, clip),
            ) + 24;
          continue;
        }
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
    if (root.id === "battle-action") return [480, 42, 960, 108];
    if (root.id === "battle-result") return [96, 90, 1200, 900];
    if (root.id === "extras") return [24, 18, 1872, 1044];
    // The serialized message root is positioned by a runtime animation. Retain
    // its PR size and bottom margin; compose the PR touch battle window widths.
    if (root.id === "dialogue" && this.presentation.layouts?.message?.bounds) {
      const [x, , w, h] = this.presentation.layouts.message.bounds;
      return [
        Math.round(x / 6) * 6,
        Math.round((1080 - 54 - h) / 6) * 6,
        Math.round(w / 6) * 6,
        Math.round(h / 6) * 6,
      ];
    }
    if (root.id === "battle" && this.presentation.layouts?.battle) return [96, 810, 1728, 270];
    if (root.id === "battle-options") return [96, 450, 1728, 360];
    const key = {
      dialogue: "message",
      menu: "menu",
      battle: "battle",
      shop: "shop",
      title: "title",
      save: "save",
      naming: "name",
    }[root.id];
    const bounds = this.presentation.layouts?.[key]?.bounds;
    if (bounds?.length === 4) return bounds;
    if (root.id === "title") return [300, 210, 1320, 648];
    if (root.id === "dialogue") return [60, 672, 1800, 360];
    if (root.id === "battle") return [36, 666, 1848, 378];
    if (root.id === "vehicle") return [300, 300, 1320, 480];
    return [90, 42, 1740, 990];
  }
  battleStatus(view, width, height) {
    const model = this.get("battle-status"),
      battle = model?.battleModel;
    if (!battle) return;
    if (!view.hud) {
      view.hud = new Container();
      view.hudRows = [];
      view.container.addChild(view.hud);
    }
    const commandWidth = width === 1728 ? 432 : 600,
      hudX = commandWidth + 60,
      hudWidth = width - hudX - 24;
    view.hud.position.set(hudX, 12);
    const drawText = (holder, key, value, x, y, size = 30) => {
      if (!holder[key]) {
        holder[key] = new Text({
          text: "",
          style: {
            fontFamily: this.presentation.fontFamily || "system-ui",
            fontSize: size,
            fill: 0xf4f1e8,
          },
        });
        view.hud.addChild(holder[key]);
      }
      holder[key].text = value;
      holder[key].position.set(x, y);
      holder[key].visible = true;
      return holder[key];
    };
    const heads = { name: "", hp: "HP", mp: "MP", atb: "ATB" };
    const columns = {
      name: 0,
      hp: Math.round((hudWidth * 0.22) / 6) * 6,
      mp: Math.round((hudWidth * 0.57) / 6) * 6,
      atb: Math.round((hudWidth * 0.78) / 6) * 6,
    };
    for (const [key, x] of [
      ["name", 0],
      ["hp", columns.hp],
      ["mp", columns.mp],
      ["atb", columns.atb],
    ])
      drawText(view, `hud-${key}`, heads[key], x, 0, 24);
    for (let i = 0; i < 4; i++) {
      const row = (view.hudRows[i] ||= {});
      const u = battle.players[i];
      if (!u) {
        for (const v of Object.values(row)) if (v && typeof v === "object") v.visible = false;
        continue;
      }
      const y = 36 + i * Math.floor(Math.min(66, (height - 78) / 4) / 6) * 6;
      drawText(row, "name", `${i === model.activeActor ? "▶ " : ""}${u.name}`, 0, y);
      row.name.eventMode = model.playbackLocked ? "none" : "static";
      row.name.cursor = "pointer";
      row.name.accessible = !!u.ready && !model.playbackLocked;
      row.name.accessibleTitle = `操作 ${u.name}`;
      row.name.accessibleText = `操作 ${u.name}`;
      if (!row.inputBound) {
        row.name.on("pointertap", () => model.selectActor?.(i));
        row.inputBound = true;
      }
      const hp = drawText(row, "hp", `${u.hp}/${u.maxHp}`, columns.hp, y);
      hp.style.fill = u.hp <= 0 ? 0xd3b2b2 : u.hp / u.maxHp < 0.25 ? 0xffd46b : 0xffffff;
      drawText(row, "mp", `${u.mp}/${u.maxMp}`, columns.mp, y);
      if (!row.gauge) {
        row.gauge = new Graphics();
        view.hud.addChild(row.gauge);
      }
      row.gauge.visible = true;
      row.gauge
        .clear()
        .rect(columns.atb, y + 12, hudWidth - columns.atb, 18)
        .fill(0x081631)
        .stroke({ color: 0xaebbd4, width: 2 });
      row.gauge
        .rect(
          columns.atb + 2,
          y + 14,
          Math.max(0, hudWidth - columns.atb - 4) * Math.max(0, Math.min(1, (u.atb || 0) / 100)),
          14,
        )
        .fill(u.ready ? 0xe3d471 : 0xa6c2f0);
      const frame = this.image(this.presentation.sprites?.atb?.url),
        fill = this.image(this.presentation.sprites?.atbFill?.url);
      if (frame && fill) {
        if (!row.gaugeFrame) {
          row.gaugeFrame = new NineSliceSprite({
            texture: frame,
            leftWidth: 48,
            rightWidth: 48,
            topHeight: 16,
            bottomHeight: 16,
          });
          row.gaugeFill = new Sprite();
          view.hud.addChild(row.gaugeFrame, row.gaugeFill);
        }
        row.gauge.visible = false;
        row.gaugeFrame.visible = row.gaugeFill.visible = true;
        row.gaugeFrame.texture = frame;
        row.gaugeFrame.position.set(columns.atb, y + 3);
        row.gaugeFrame.width = hudWidth - columns.atb;
        row.gaugeFrame.height = 36;
        row.gaugeFill.texture = fill;
        row.gaugeFill.position.set(columns.atb + 10, y + 13);
        row.gaugeFill.width =
          Math.max(0, hudWidth - columns.atb - 20) * Math.max(0, Math.min(1, (u.atb || 0) / 100));
        row.gaugeFill.height = 16;
        row.gaugeFill.tint = u.ready ? 0xffdf80 : 0xffffff;
      }
    }
    drawText(
      view,
      "hud-log",
      this.get("targets")?.children.length ? "" : battle.log.slice(-1).join(" ").slice(0, 58),
      0,
      height - 60,
      24,
    );
  }
  render() {
    const options = this.get("battle-options");
    if (options) {
      const commands = this.get("commands"),
        targets = this.get("targets"),
        key = `${commands.dataset.submenu || ""}:${!!targets.children.length}`;
      options.hidden =
        commands.hidden ||
        this.get("battle").hidden ||
        !!targets.children.length ||
        key === ":false";
      options.children = [commands];
      if (options.dataset.selection !== key) {
        options.dataset.selection = key;
        this.scrolls.set(options, 0);
        this.scrolls.set(this.get("battle"), 0);
        revision++;
      }
    }
    for (const [url, old] of this.visibleImages) if (this.texture(url) !== old) revision++;
    if (this.dialogue?.source) {
      const d = this.dialogue,
        count = Array.from(d.text).length,
        shown =
          d.instant || d.revealed
            ? count
            : Math.min(
                count,
                Math.floor(((performance.now() - d.started) / 1000) * (16 + Number(d.speed) * 12)),
              );
      if (shown !== d.shown) {
        d.shown = shown;
        revision++;
      }
    }
    if (this.lastLayoutRevision !== layoutRevision) {
      this.clearHover();
      this.lastLayoutRevision = layoutRevision;
    }
    if (this.popup || this.lastRevision === revision) return;
    this.lastRevision = revision;
    this.visibleImages.clear();
    this.used = new Set();
    this.ranges = new Map();
    for (const root of this.windows) {
      const v = this.view(root),
        [x, y, width, height] = this.bounds(root);
      if (v.container.parent !== this.layer) this.layer.addChild(v.container);
      v.container.visible = !root.hidden;
      v.modern = root.dataset.modern === "1";
      v.container.position.set(x, y);
      v.text.visible = false;
      this.skin(v, width, height);
      this.used.add(root);
      if (root.hidden) continue;
      if (root.id === "battle-action") {
        this.item(this.get("battle-action-name"), v.container, 24, 24, width - 48);
        continue;
      }
      if (!v.content) {
        v.content = new Container();
        v.mask = new Graphics();
        v.container.addChild(v.content, v.mask);
        v.content.mask = v.mask;
      }
      const scroll = this.scrolls.get(root) || 0;
      let bodyX = 24,
        bodyWidth = width - 48,
        bodyY = 24;
      let body = root.children;
      let pinned = root.id === "title" ? [] : root.children.filter((node) => node.tag === "button");
      if (root.id !== "title") body = body.filter((node) => !pinned.includes(node));
      if (root.id === "battle") {
        const targets = this.get("targets");
        for (const node of this.get("commands").children)
          if (node.dataset.actorSwitch) node.hidden = true;
        if (targets.children.length) {
          pinned = targets.children.filter(
            (node) => node.dataset.targetCancel || node.dataset.targetScope,
          );
          body = targets.children.filter((node) => !pinned.includes(node));
        } else body = options?.hidden ? [this.get("commands")] : [];
        bodyWidth = width === 1728 ? 432 : 600;
        this.battleStatus(v, width, height);
      }
      if (root.id === "title") {
        const logoSource = this.presentation.sprites?.titleLogo,
          logo = this.image(logoSource?.url);
        // Loading an image must not move a button between pointerdown/up.
        // Reserve the PR title layout from its declaration, including on 404.
        if (logoSource) {
          if (logo) {
            if (!v.logo) {
              v.logo = new Sprite();
              v.container.addChild(v.logo);
            }
            v.logo.texture = logo;
            v.logo.position.set(Math.round((width - logo.width) / 12) * 6, 54);
            v.logo.scale.set(1);
          }
          v.box.clear().rect(0, 0, width, height).fill(0xffffff);
          if (v.background) v.background.visible = false;
          if (v.skin) v.skin.visible = false;
          body = body.filter((n) => n.tag === "button");
          bodyX = Math.round((width - 600) / 12) * 6;
          bodyWidth = 600;
          bodyY = 648;
          for (const n of body) {
            n.dataset.block = "1";
            n.dataset.titleButton = "1";
          }
        }
      }
      if (root.id === "dialogue") {
        const choices = this.get("choices");
        body = [this.get("speaker"), this.get("message")];
        pinned = choices.children.length ? choices.children : [this.get("confirm")];
        const actor = this.dialogue?.speaker;
        const id = this.presentation.speakerFaces?.[actor] || this.speakerIds?.[actor];
        const portrait = this.image(this.portrait(id));
        if (!v.portrait) {
          v.portrait = new Sprite();
          v.container.addChild(v.portrait);
        }
        v.portrait.visible = !!portrait;
        if (portrait) {
          v.portrait.texture = portrait;
          v.portrait.position.set(30, 42);
          v.portrait.width = 180;
          v.portrait.height = 180;
          bodyX = 234;
          bodyWidth -= 210;
        }
      }
      if (root.id === "menu" && this.get("menu-nav")) {
        const navigation = this.get("menu-nav");
        if (!v.navigation) {
          v.navigation = new Container();
          v.container.addChild(v.navigation);
        }
        for (const n of navigation.children) {
          n.dataset.block = "1";
          n.dataset.compact = "1";
        }
        this.flow(navigation.children, v.navigation, 24, 24, 270, [24, height - 90]);
        body = body.filter((n) => n !== navigation && n.tag !== "h2");
        bodyX = 342;
        bodyWidth = width - 366;
      }
      const pinY = height - (root.id === "dialogue" && pinned.length > 2 ? 132 : 66);
      v.mask
        .clear()
        .rect(bodyX, bodyY, bodyWidth, pinY - bodyY - 12)
        .fill(0xffffff);
      const end = this.flow(body, v.content, bodyX, bodyY - scroll, bodyWidth, [bodyY, pinY - 12]);
      this.flow(pinned, v.container, 24, pinY, width - (root.id === "dialogue" ? 48 : 480));
      let range = Math.max(0, end + scroll - pinY + 24);
      if (root.id === "dialogue") range = Math.ceil(range / 42) * 42;
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
        this.hover.leave(view);
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
    this.clearHover();
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
  openTextInput(node) {
    if (this.editor) {
      const old = this.editor;
      old.blur();
      old.remove();
    }
    const input = document.createElement("input");
    input.value = node.value;
    input.maxLength = Number(node.dataset.maxLength) || 12;
    input.type = node.attributes.type || "text";
    input.setAttribute("aria-label", node.attributes["aria-label"] || "名称");
    input.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;";
    const commit = () => {
      // Input has already committed each keystroke. Repeating onchange on blur
      // would rebuild the destination button between pointerdown and pointerup.
      if (node.value !== input.value) {
        node.value = input.value;
        node.onchange?.();
      }
      if (input.value !== node.value) input.value = node.value;
    };
    input.oninput = commit;
    input.onchange = commit;
    input.onkeydown = (e) => {
      // Reports must remain available while editing any search/name field.
      if (e.key === "F9") return;
      e.stopPropagation();
      if (e.key === "Enter" || e.key === "Escape") {
        input.blur();
        input.remove();
        this.editor = null;
      }
    };
    input.onblur = () => {
      commit();
      input.remove();
      if (this.editor === input) this.editor = null;
    };
    document.body.append(input);
    this.editor = input;
    input.focus();
    input.select();
  }
  closeSelect() {
    this.clearHover();
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
  keyboardControls() {
    const root = [...this.windows].reverse().find((window) => !window.hidden);
    const owner = this.popup ? this.popupLayer : root && this.view(root).container;
    if (!owner) return [];
    const rows = [];
    for (const [node, view] of this.views) {
      if (!["button", "select", "input"].includes(node.tag) || node.disabled || node.hidden)
        continue;
      let inside = false,
        visible = true;
      for (let parent = view.container; parent; parent = parent.parent) {
        if (!parent.visible) visible = false;
        if (parent === owner) inside = true;
      }
      if (!inside || !visible || !view.container.accessible) continue;
      // The cursor extends left of its button. Including it makes a focused
      // row's center shift and traps Right inside a vertical navigation rail.
      const box = view.box.getBounds();
      rows.push({ node, x: box.x, y: box.y, width: box.width, height: box.height });
    }
    return rows.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x));
  }
  setKeyboard(node) {
    if (this.keyboardNode === node) return;
    this.keyboardNode = node;
    for (const [candidate, view] of this.views) view.keyboard = candidate === node;
    revision++;
  }
  handleKey(event) {
    if (this.editor || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (this.popup && event.key === "Escape") {
      this.closeSelect();
      event.preventDefault();
      return true;
    }
    const dialogue = this.get("dialogue");
    const direction = { w: -1, s: 1, ArrowUp: -1, ArrowDown: 1 }[
      event.key.length === 1 ? event.key.toLowerCase() : event.key
    ];
    if (
      direction &&
      dialogue?.hidden === false &&
      !this.get("choices")?.children.length &&
      !this.popup
    ) {
      this.page(dialogue, direction);
      event.preventDefault();
      return true;
    }
    const controls = this.keyboardControls();
    const next = directionalControl(controls, this.keyboardNode, event.key);
    if (next) {
      this.clearHover();
      this.setKeyboard(next);
      event.preventDefault();
      return true;
    }
    if (["Enter", " "].includes(event.key) && controls.length) {
      if (event.repeat) return true;
      const node = controls.find((row) => row.node === this.keyboardNode)?.node || controls[0].node;
      this.setKeyboard(node);
      if (node.tag === "select") this.openSelect(node);
      else if (node.tag === "input") this.openTextInput(node);
      else node.onclick?.();
      event.preventDefault();
      return true;
    }
    return false;
  }
}
