import { bgmGain, bgmPosition } from "/runtime/core/bgm.js";

/** Web Audio projects the current session. Decode completion cannot mutate game state. */
export class BgmOutput {
  constructor() {
    this.buffers = new Map();
    this.pending = new Map();
    this.errors = new Map();
    this.nodes = new Map();
    this.muted = false;
    this.running = false;
  }
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.45;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.wave = new Float32Array(256);
      this.master.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    await this.context.resume();
    this.running = true;
  }
  reset() {
    for (const node of this.nodes.values()) {
      node.source.stop();
      node.source.disconnect();
      node.gain.disconnect();
    }
    this.nodes.clear();
  }
  mute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.45;
  }
  load(track) {
    const key = track.sha256;
    if (this.buffers.has(key)) return Promise.resolve();
    if (!this.pending.has(key)) {
      const task = (async () => {
        const response = await fetch(track.file);
        if (!response.ok) throw new Error("音乐资源载入失败");
        const raw = await response.arrayBuffer();
        const digest = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", raw)),
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (digest !== track.sha256) throw new Error("音乐资源摘要不匹配");
        if (!this.context) throw new Error("音频尚未通过开始按钮启用");
        const buffer = await this.context.decodeAudioData(raw);
        if (
          buffer.numberOfChannels !== track.channels ||
          Math.abs(buffer.duration - track.frames / track.sampleRate) >
            2 / buffer.sampleRate
        )
          throw new Error("浏览器解码后的音乐长度不匹配");
        this.buffers.set(key, buffer);
      })();
      // A failed stale request is recorded by asset identity and cannot stop an unrelated session.
      this.pending.set(
        key,
        task.catch((error) => {
          this.errors.set(key, error);
        }),
      );
    }
    return this.pending.get(key);
  }
  ready(state, media) {
    let ready = true;
    for (const voice of state.voices) {
      const track = media?.tracks[voice.track];
      if (!track) throw new Error("缺少音乐资源 " + voice.track);
      if (this.errors.has(track.sha256)) throw this.errors.get(track.sha256);
      if (!this.buffers.has(track.sha256)) {
        this.load(track);
        ready = false;
      }
    }
    return ready;
  }
  async prepare(state, media) {
    await Promise.all(
      state.voices.map((voice) => {
        const track = media?.tracks[voice.track];
        if (!track) throw new Error("缺少音乐资源 " + voice.track);
        return this.load(track);
      }),
    );
    if (!this.ready(state, media)) throw new Error("音乐资源尚未就绪");
  }
  project(state, media, running) {
    if (!this.context) return;
    if (this.failure) throw this.failure;
    if (running !== this.running) {
      this.running = running;
      (running ? this.context.resume() : this.context.suspend()).catch(
        (error) => {
          this.failure = error;
        },
      );
    }
    const wanted = new Set(state.voices.map((voice) => voice.id));
    for (const [id, node] of this.nodes)
      if (!wanted.has(id)) {
        node.source.stop();
        node.source.disconnect();
        node.gain.disconnect();
        this.nodes.delete(id);
      }
    if (!running) return;
    const keep = new Set();
    for (const voice of state.voices) {
      const track = media.tracks[voice.track];
      keep.add(track.sha256);
      let node = this.nodes.get(voice.id);
      // The simulation intentionally caps long render frames. Correct audible drift after a stall.
      if (
        node &&
        Math.abs(
          state.time -
            node.clock -
            1000 * (this.context.currentTime - node.audioClock),
        ) > 125
      ) {
        node.source.stop();
        node.source.disconnect();
        node.gain.disconnect();
        this.nodes.delete(voice.id);
        node = null;
      }
      if (!node) {
        const source = this.context.createBufferSource(),
          gain = this.context.createGain();
        source.buffer = this.buffers.get(track.sha256);
        if (!source.buffer) throw new Error("音乐尚未完成解码");
        source.loop = track.loop !== null;
        if (track.loop) {
          source.loopStart = track.loop.start / track.sampleRate;
          source.loopEnd = track.loop.end / track.sampleRate;
        }
        source.connect(gain);
        gain.connect(this.master);
        gain.gain.value = bgmGain(voice, state.time);
        source.start(0, bgmPosition(voice, state.time, track));
        node = {
          source,
          gain,
          clock: state.time,
          audioClock: this.context.currentTime,
        };
        this.nodes.set(voice.id, node);
      }
      // Linear gain is an explicit Web presentation curve, not a claim about the native mixer.
      node.gain.gain.cancelScheduledValues(this.context.currentTime);
      node.gain.gain.setValueAtTime(
        bgmGain(voice, state.time),
        this.context.currentTime,
      );
      node.gain.gain.linearRampToValueAtTime(
        bgmGain(voice, state.time + 16),
        this.context.currentTime + 0.016,
      );
    }
    // Keep active streams plus two recent inactive decodes, rather than all 105 PCM buffers.
    const inactive = [...this.buffers.keys()].filter((key) => !keep.has(key));
    for (const key of inactive.slice(0, -2)) {
      this.buffers.delete(key);
      this.pending.delete(key);
    }
  }
  status(ready, active) {
    if (!ready) return "正在载入音乐…";
    if (this.muted) return "已静音";
    if (!this.running || !active) return "";
    this.analyser.getFloatTimeDomainData(this.wave);
    if (this.wave.some((value) => Math.abs(value) > 0.00001))
      this.lastSignal = performance.now();
    return performance.now() - (this.lastSignal ?? -1000) < 500
      ? "音乐播放中"
      : "";
  }
}
