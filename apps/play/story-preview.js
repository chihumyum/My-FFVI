import { PlayGame } from "../../src/play/game.js";
import { Battle } from "../../src/play/battle.js";
import { withStoryProject, storyBank } from "../../src/play/story-authoring.js";
import { createStoryProject } from "../../src/play/story-demo.js";
import { GameRenderer } from "./renderer.js";
import { withPresentation } from "./presentation-events.js";
import { WebAudioPlayer } from "./audio.js";
const $ = (id) => document.getElementById(id),
  pauseSignal = Symbol("preview-step");
const cached = new Map();
async function get(url) {
  if (!cached.has(url))
    cached.set(
      url,
      fetch(url).then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw Error(v.error || r.status);
        return v;
      }),
    );
  return cached.get(url);
}
const pictures = new Map();
function image(url) {
  if (!pictures.has(url))
    pictures.set(
      url,
      new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(Error(`地图图像加载失败：${url}`));
        im.src = url;
      }),
    );
  return pictures.get(url);
}
export class StoryPreview {
  constructor({ notify, onTrace, onMapPick, getBreakpoints }) {
    Object.assign(this, { notify, onTrace, onMapPick, getBreakpoints });
    this.keys = new Set();
    this.trace = [];
    this.events = [];
    this.paused = false;
    this.choice = 0;
    this.base = null;
    this.audio = new WebAudioPlayer({ onDiagnostic: notify });
    $("pause").onclick = () => {
      this.paused = !this.paused;
      $("pause").textContent = this.paused ? "继续" : "暂停";
      this.skipBreakpoint = true;
    };
    $("step").onclick = () => {
      if (!this.game) return;
      this.paused = false;
      this.budget = 1;
      this.skipBreakpoint = true;
    };
    $("confirm").onclick = () => this.game?.confirm(this.choice);
    $("audio").onclick = async () => {
      try {
        await this.audio.unlock();
        this.audioEnabled = !this.audioEnabled;
        $("audio").textContent = this.audioEnabled ? "关闭声音" : "开启声音";
        this.audio.setVolume(this.audioEnabled ? 0.6 : 0);
      } catch (e) {
        notify(e.message);
      }
    };
    $("preview-save").onclick = () => this.save();
    $("preview-load").onclick = () => this.load();
    $("checkpoint-file").onchange = async (e) => {
      try {
        const saved = JSON.parse(await e.target.files[0].text());
        if (!this.game || saved.mapId == null || !saved.banks || !saved.player)
          throw Error("请选择普通存档 JSON；冻结渲染帧不能作为可玩存档");
        await this.game.restore(saved);
        this.paused = false;
        await this.drawMap();
        notify("已将普通存档载入隔离试玩");
      } catch (e) {
        notify(e.message);
      }
      e.target.value = "";
    };
    $("run-source").onclick = () => {
      if (!this.game || !this.source) return;
      const name = `preview-source:${this.source.id}`;
      this.game.data.programs[name] = structuredClone(this.source.program);
      this.game.data.global[name] = name;
      this.game.startScript(name);
      this.paused = false;
    };
    $("map-picker").onclick = (e) => {
      if (!this.game) return;
      const r = e.currentTarget.getBoundingClientRect(),
        m = this.game.map,
        x = Math.floor(((e.clientX - r.left) / r.width) * m.width),
        y = Math.floor(((e.clientY - r.top) / r.height) * m.height);
      const actor = this.game.entities.find(
        (a) => Math.abs(a.x - x) <= 1 && Math.abs(a.y - y) <= 1 && a.kind !== 0,
      );
      onMapPick({ mapId: m.id, x, y, layer: actor?.layer || 0, entity: actor });
    };
    window.addEventListener("keydown", (e) => {
      if ($("preview-panel").hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const key = e.key.toLowerCase(),
        direction = {
          arrowup: "up",
          w: "up",
          arrowdown: "down",
          s: "down",
          arrowleft: "left",
          a: "left",
          arrowright: "right",
          d: "right",
        }[key];
      if (direction) {
        this.keys.add(direction);
        e.preventDefault();
      }
      if (["enter", " "].includes(key)) {
        if (!e.repeat) this.game?.confirm(this.choice);
        e.preventDefault();
      }
      if (this.game?.dialogue?.choices && ["arrowup", "arrowdown"].includes(key)) {
        this.keys.clear();
        this.choice =
          (this.choice + (key === "arrowup" ? -1 : 1) + this.game.dialogue.choices.length) %
          this.game.dialogue.choices.length;
        this.showDialogue(true);
      }
    });
    window.addEventListener("keyup", () => this.keys.clear());
    window.addEventListener("blur", () => this.keys.clear());
    let previous = performance.now(),
      nextMove = 0,
      nextStatus = 0;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      if (this.game && !$("preview-panel").hidden) {
        try {
          if (!this.paused) {
            this.game.tick(dt);
            if (this.keys.size && now > nextMove) {
              this.game.move([...this.keys].at(-1));
              nextMove = now + 135;
            }
          }
          if (!this.game.loading) {
            const r = $("stage").getBoundingClientRect();
            this.renderer.resize(r.width, r.height);
            this.renderer.render(this.game, this.game.data, this.game.battleData);
            this.showDialogue();
          }
          if (now > nextStatus) {
            nextStatus = now + 250;
            this.status();
          }
        } catch (e) {
          this.paused = true;
          notify(e.message);
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  async start(document, options) {
    $("preview-loading").hidden = false;
    $("preview-loading").textContent = "正在应用草稿并准备独立试玩…";
    try {
      if (!this.renderer) {
        this.renderer = await new GameRenderer($("game")).init();
        this.renderer.setAssets({});
      }
      const world = options.world,
        base = await get(`/__story/base?world=${world}`);
      this.base = base;
      this.world = world;
      this.documentId = document.id;
      this.source = document.mode === "source" ? document : null;
      const project = this.source
          ? createStoryProject("source-preview")
          : structuredClone(document),
        host = this;
      class PreviewGame extends withStoryProject(withPresentation(PlayGame)) {
        tick(...args) {
          try {
            return super.tick(...args);
          } catch (e) {
            if (e !== pauseSignal) throw e;
          }
        }
        step(task) {
          const program = this.data.programs[task.program],
            pc = task.pc,
            node = this.storyCompiled.sourceNodes[program?.name]?.[pc];
          const key = node ? `${program.name}:${node}` : `${program?.name}:${pc}`;
          if (host.getBreakpoints().has(key) && !host.skipBreakpoint) {
            host.paused = true;
            throw pauseSignal;
          }
          host.skipBreakpoint = false;
          const result = super.step(task);
          host.record({
            script: program?.name,
            pc,
            name: program?.ops[pc]?.[0],
            node,
            actor: task.actor,
          });
          if (host.budget && --host.budget === 0) {
            host.paused = true;
            throw pauseSignal;
          }
          return result;
        }
      }
      this.trace = [];
      this.events = [];
      this.paused = false;
      this.budget = 0;
      this.lastDialogue = null;
      const sourceData = structuredClone(base.data);
      sourceData.entry = {
        mapId: Number(options.mapId),
        entrance: Number(options.entrance) || 1,
        script: "",
      };
      this.audio.setCatalog(sourceData.audio);
      this.game = new PreviewGame({
        project,
        data: sourceData,
        battleData: base.battleData,
        Battle,
        overrides: this.source ? [this.source] : [],
        loadMap: async (id) =>
          base.maps?.[id]
            ? structuredClone(base.maps[id])
            : structuredClone(await get(`/__story/map/${id}`)),
        onEvent: (event) => {
          this.events.push(event);
          if (this.events.length > 100) this.events.shift();
          if (["map", "story-world"].includes(event.kind))
            setTimeout(() => this.drawMap().catch((e) => this.notify(e.message)), 0);
        },
        onPresentation: (event) => {
          if (this.audioEnabled && event.kind === "audio-command")
            Promise.resolve(this.audio.command(event)).catch((e) => this.notify(e.message));
        },
      });
      await this.game.start();
      if (world === "akto") this.game.unit(1).magitek = false;
      if (world === "akto")
        this.game.data.audio = (await get("/__story/base?world=original")).data.audio;
      this.audio.setCatalog(this.game.data.audio);
      $("run-source").hidden = !this.source;
      $("pause").textContent = "暂停";
      await this.drawMap();
      $("preview-loading").hidden = true;
      window.storyPreview = this;
      this.status();
      return this.game;
    } catch (e) {
      $("preview-loading").textContent = e.message;
      throw e;
    }
  }
  record(row) {
    this.trace.push(row);
    if (this.trace.length > 60) this.trace.shift();
    this.onTrace(row);
  }
  showDialogue(force = false) {
    const d = this.game.dialogue;
    $("dialogue").hidden = !d;
    if (!d) {
      this.lastDialogue = null;
      return;
    }
    if (d === this.lastDialogue && !force) return;
    if (d !== this.lastDialogue) this.choice = 0;
    this.lastDialogue = d;
    $("speaker").textContent = d.speaker || "";
    $("message").textContent = d.text;
    $("confirm").hidden = !!d.choices?.length;
    $("choices").replaceChildren();
    d.choices?.forEach((text, index) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.setAttribute("aria-pressed", String(index === this.choice));
      b.onclick = () => this.game.confirm(index);
      $("choices").append(b);
    });
  }
  status() {
    if (!this.game) return;
    $("pause").textContent = this.paused ? "继续" : "暂停";
    const g = this.game;
    $("preview-status").textContent =
      `${this.paused ? "已暂停 · " : ""}地图 ${g.mapId} · (${Math.round(g.player.x)}, ${Math.round(g.player.y)}) · ${g.busy ? "演出中" : "可自由探索"} · 普通属性 / 隔离试玩`;
    $("world-values").replaceChildren();
    for (const variable of g.storyProject.variables) {
      const line = document.createElement("div");
      line.textContent = `${variable.label || variable.key}：${g.banks[storyBank(g.storyProject)]?.[variable.slot] ?? 0}`;
      $("world-values").append(line);
    }
    $("trace").replaceChildren(
      ...this.trace
        .slice(-18)
        .reverse()
        .map((row) => {
          const line = document.createElement("div");
          line.textContent = `${row.script} · ${row.node || row.pc} · ${row.name} · ${row.actor == null ? "主流程" : `角色 ${row.actor}`}`;
          return line;
        }),
    );
  }
  async save() {
    if (!this.game) return;
    if (this.game.busy || this.game.player.motion)
      return this.notify("请在演出结束、角色站稳后保存试玩进度");
    localStorage.setItem(
      `ffvi-story-preview:${this.documentId}:${this.world}`,
      JSON.stringify(this.game.snapshot()),
    );
    this.notify("试玩进度已保存到工作台专用存储");
  }
  async load() {
    if (!this.game) return;
    const saved = localStorage.getItem(`ffvi-story-preview:${this.documentId}:${this.world}`);
    if (!saved) return this.notify("这个项目尚无试玩存档");
    await this.game.restore(JSON.parse(saved));
    this.paused = false;
    this.showDialogue(true);
    await this.drawMap();
    this.notify("已读取工作台试玩进度");
  }
  async drawMap() {
    if (!this.game?.map) return;
    const game = this.game,
      map = game.map,
      canvas = $("map-picker"),
      context = canvas.getContext("2d");
    const scale = Math.min(512 / (map.width * 16), 512 / (map.height * 16));
    canvas.width = Math.max(1, Math.round(map.width * 16 * scale));
    canvas.height = Math.max(1, Math.round(map.height * 16 * scale));
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#17201d";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const textures = Object.fromEntries(
      await Promise.all(
        Object.entries(map.textures || {}).map(async ([key, url]) => [key, await image(url)]),
      ),
    );
    if (this.game !== game || this.game.mapId !== map.id) return;
    for (const layer of map.layers || [])
      for (let index = 0; index < (layer.data?.length || 0); index++) {
        const raw = layer.data[index] >>> 0,
          gid = raw & 0x1fffffff;
        if (!gid) continue;
        const set = map.tilesets.findLast((s) => s.firstgid <= gid);
        if (!set || !textures[set.image]) continue;
        const tile = gid - set.firstgid,
          x = index % map.width,
          y = Math.floor(index / map.width);
        context.save();
        context.translate((x + 0.5) * 16 * scale, (y + 0.5) * 16 * scale);
        context.scale(raw & 0x80000000 ? -1 : 1, raw & 0x40000000 ? -1 : 1);
        context.drawImage(
          textures[set.image],
          (tile % set.columns) * 16,
          Math.floor(tile / set.columns) * 16,
          16,
          16,
          -8 * scale,
          -8 * scale,
          16 * scale,
          16 * scale,
        );
        context.restore();
      }
    for (const entity of game.entities) {
      if (entity.kind !== 6) continue;
      const actor = game.actors.get(String(entity.id)) || entity;
      context.fillStyle = game.storyProject.bindings.some((b) => b.entityId === String(entity.id))
        ? "#e3c88b"
        : "#a1c9c0";
      context.fillRect(actor.x * 16 * scale - 2, actor.y * 16 * scale - 2, 4, 4);
    }
    context.strokeStyle = "#ffdf92";
    context.strokeRect(game.player.x * 16 * scale - 3, game.player.y * 16 * scale - 3, 6, 6);
  }
}
