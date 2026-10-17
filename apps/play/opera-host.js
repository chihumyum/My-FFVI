import { Container, Sprite, Text, Texture } from "pixi.js";

// Movie clocks, audio cues and input capture belong to the host, never the VM.
// The source VM may already have reached the next map in the tick that emitted
// `opera`; only subsequent manual-play ticks wait for this presentation.
export class OperaHost {
  constructor(renderer, audio, { fontFamily = "system-ui" } = {}) {
    Object.assign(this, { renderer, audio, fontFamily });
    this.overlay = new Container({ label: "opera-overlay" });
    renderer.app.stage.addChild(this.overlay);
    this.backdrop = new Sprite(Texture.WHITE);
    this.backdrop.tint = 0;
    this.backdrop.width = 384;
    this.backdrop.height = 216;
    this.overlay.addChild(this.backdrop);
    this.status = new Text({
      text: "",
      style: { fontFamily, fontSize: 11, fill: 0xffffff, stroke: { color: 0, width: 2 } },
    });
    this.status.position.set(10, 8);
    this.overlay.addChild(this.status);
    this.controls = new Container();
    this.overlay.addChild(this.controls);
    this.pauseButton = this.button("暂停（空格）", 10, () => this.togglePause());
    this.button("跳过（Esc）", 288, () => this.finish());
    this.overlay.visible = false;
    this.generation = 0;
    this.queue = [];
    this.pendingStages = [];
  }
  button(label, x, action) {
    const text = new Text({
      text: label,
      style: {
        fontFamily: this.fontFamily,
        fontSize: 10,
        fill: 0xffffff,
        stroke: { color: 0, width: 2 },
      },
    });
    text.position.set(x, 199);
    text.eventMode = "static";
    text.cursor = "pointer";
    text.accessible = true;
    text.accessibleType = "button";
    text.accessibleTitle = label;
    text.accessibleHint = label;
    text.on("pointertap", action);
    this.controls.addChild(text);
    return text;
  }
  get busy() {
    return !!(this.loading || this.player?.active);
  }
  setRepository(repository) {
    this.repository = repository;
  }
  warn(message) {
    this.renderer._warnOnce("opera:" + message, "[Opera] " + message);
  }
  async play(stage) {
    if (this.busy) {
      this.pendingStages.push(stage);
      return;
    }
    const repository = this.repository;
    if (!repository?.index.opera) {
      this.warn(`No exported presentation for stage ${stage}; source story continues.`);
      return;
    }
    const ticket = ++this.generation;
    this.loading = true;
    this.paused = false;
    this.overlay.visible = true;
    this.renderer.layers.ui.visible = false;
    this.previousMusic = this.audio.current
      ? { id: this.audio.current.id, offset: this.audio.position() }
      : null;
    this.status.text = "正在载入歌剧演出…";
    try {
      const [{ OperaPlayer }, catalog] = await Promise.all([
        import("./opera.js"),
        repository.json(repository.index.opera),
      ]);
      if (ticket !== this.generation) return;
      if (!this.player) {
        this.player = new OperaPlayer({
          parent: this.overlay,
          renderer: this.renderer.app.renderer,
          getTexture: (url) => this.renderer.getTexture(url),
          warn: (message) => this.warn(message),
          onAudio: (cue) => this.cue(cue),
          onEnd: () => this.finish(),
          fontFamily: this.fontFamily,
        });
        await this.player.load(catalog);
      }
      if (ticket !== this.generation) return;
      this.overlay.addChild(this.status, this.controls);
      this.loading = false;
      if (!this.player.play(stage)) this.finish();
    } catch (error) {
      if (ticket !== this.generation) return;
      this.warn(`${error.message}; source story continues.`);
      this.finish();
    }
  }
  cue(cue) {
    if (!cue.bankId) {
      this.warn(`No PR BGM bank for timeline cue ${cue.name}.`);
      return;
    }
    const ticket = this.generation;
    const pending = this.audio.playMusic(cue.bankId, { offset: cue.time, restart: true });
    this.audioPending = pending;
    pending.finally(() => {
      if (ticket === this.generation && this.audioPending === pending) this.audioPending = null;
    });
  }
  command(command) {
    if (this.busy) {
      this.queue.push(command);
      return;
    }
    return this.audio.command(command);
  }
  event(event) {
    if (event.kind === "bgm")
      return this.command({ name: "PlayBGM", i: [event.id], r: [event.fade || 0] });
    if (event.kind === "se") return this.command({ name: "PlaySE", i: [event.id] });
  }
  togglePause() {
    if (this.loading || this.audioPending || !this.player?.active) return;
    this.paused = !this.paused;
    if (this.paused) this.audio.pauseMusic();
    else this.audio.resumeMusic();
    this.pauseButton.text = this.paused ? "继续（空格）" : "暂停（空格）";
    this.pauseButton.accessibleTitle = this.pauseButton.text;
    this.pauseButton.accessibleHint = this.pauseButton.text;
  }
  handleKey(event) {
    if (!this.busy) return false;
    if (["Escape", " ", "Enter"].includes(event.key) && !event.repeat) {
      if (event.key === "Escape") this.finish();
      else this.togglePause();
    }
    event.preventDefault();
    return true;
  }
  update(dt) {
    if (!this.busy) return;
    this.overlay.scale.set(this.renderer.app.screen.width / 384);
    this.renderer.layers.ui.visible = false;
    if (!this.loading) {
      try {
        // Touch the visible atlas pages even while paused or decoding audio;
        // otherwise the shared LRU could destroy a still-visible source page.
        if (this.paused || this.audioPending) this.player.render();
        else this.player.update(dt);
      } catch (error) {
        this.warn(`${error.message}; source story continues.`);
        this.finish();
      }
    }
    if (!this.busy) return;
    this.status.text = this.loading
      ? "正在载入歌剧演出…"
      : this.audioPending
        ? "正在载入原曲…"
        : this.paused
          ? "歌剧演出已暂停"
          : "";
  }
  finish() {
    ++this.generation;
    this.loading = false;
    this.audioPending = null;
    this.paused = false;
    this.player?.stop(false);
    this.overlay.visible = false;
    this.renderer.layers.ui.visible = true;
    this.pauseButton.text = "暂停（空格）";
    this.pauseButton.accessibleTitle = this.pauseButton.text;
    this.pauseButton.accessibleHint = this.pauseButton.text;
    const commands = this.queue.splice(0);
    if (commands.length) {
      for (const command of commands)
        this.audio.command(command)?.catch?.((error) => this.audio.warn(error.message));
    } else {
      const saved = this.previousMusic;
      this.audio.playMusic(saved?.id || 0, { offset: saved?.offset || 0, restart: true });
    }
    const next = this.pendingStages.shift();
    if (next !== undefined) this.play(next);
  }
  reset() {
    ++this.generation;
    this.loading = false;
    this.audioPending = null;
    this.paused = false;
    this.player?.stop(false);
    this.overlay.visible = false;
    this.renderer.layers.ui.visible = true;
    this.pauseButton.text = "暂停（空格）";
    this.pauseButton.accessibleTitle = this.pauseButton.text;
    this.pauseButton.accessibleHint = this.pauseButton.text;
    this.queue.length = 0;
    this.pendingStages.length = 0;
  }
}
