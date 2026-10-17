export const loopSeconds = (track, key) =>
  track.loop?.[key] !== undefined
    ? track.loop[key] / (track.loop.sampleRate || track.sampleRate)
    : track.loop?.[key + "Seconds"];
// Audio is a presentation consumer. No reference to a game VM is needed here.
export class WebAudioPlayer {
  constructor({ onDiagnostic = () => {}, volume = 0.6 } = {}) {
    this.catalog = {};
    this.transitionUntil = 0;
    this.onDiagnostic = onDiagnostic;
    this.volume = volume;
    this.musicBuffers = new Map();
    this.effectBuffers = new Map();
    this.effectBytes = 0;
    this.effectSequence = 0;
    this.effects = new Map();
    this.environments = new Map();
    this.sequence = 0;
    this.serial = Promise.resolve();
    this.warned = new Set();
    this.status = "locked";
  }
  setAssets(files, baseURL) {
    this.files = files;
    this.baseURL = baseURL;
  }
  setCatalog(catalog) {
    this.catalog = catalog || {};
  }
  warn(message) {
    if (!this.warned.has(message)) {
      this.warned.add(message);
      this.onDiagnostic(message);
      console.warn("[audio]", message);
    }
  }
  async unlock() {
    if (!this.context) {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.context = new AudioContext({ sampleRate: 48000 });
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
    this.status = this.context.state;
    return this.context;
  }
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value)));
    if (this.master) this.master.gain.setValueAtTime(this.volume, this.context.currentTime);
  }
  track(kind, id) {
    return this.catalog[kind]?.tracks?.[id];
  }
  async decode(track, signal) {
    let last;
    for (const candidate of [track, track.fallback].filter(Boolean)) {
      try {
        const file = this.files?.[candidate.file];
        const response = await fetch(file ? new URL(file, this.baseURL) : candidate.file, {
          signal,
        });
        if (!response.ok) throw Error(`${response.status} ${candidate.file}`);
        let buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        // Discard the unused post-loop tail. Using the exact buffer boundary as
        // loopEnd avoids a one-frame float-to-integer error in native engines.
        const end = Math.round((loopSeconds(track, "end") || buffer.duration) * buffer.sampleRate);
        if (track.loop && end > 0 && end < buffer.length) {
          const clipped = this.context.createBuffer(
            buffer.numberOfChannels,
            end,
            buffer.sampleRate,
          );
          for (let channel = 0; channel < buffer.numberOfChannels; channel++)
            clipped.copyToChannel(buffer.getChannelData(channel).subarray(0, end), channel);
          buffer = clipped;
        }
        this.lastCodec = candidate.codec || "opus";
        return buffer;
      } catch (error) {
        if (error.name === "AbortError") throw error;
        last = error;
      }
    }
    throw last;
  }
  async musicBuffer(id) {
    const track = this.track("bgm", id);
    if (!track) throw Error(`Missing PR BGM ${id}`);
    if (this.musicBuffers.has(String(id))) return this.musicBuffers.get(String(id));
    // Loads are serialized, and the previous prefetch is released before decode.
    for (const key of this.musicBuffers.keys())
      if (key !== String(this.current?.id)) this.musicBuffers.delete(key);
    const buffer = await this.decode(track);
    this.musicBuffers.set(String(id), buffer);
    return buffer;
  }
  source(
    track,
    buffer,
    { loop = Boolean(track.loop || track.looping), gain = 1, offset = 0, fade = 0 } = {},
  ) {
    const ctx = this.context,
      node = ctx.createBufferSource(),
      level = ctx.createGain();
    node.buffer = buffer;
    node.loop = loop;
    node.loopStart = loopSeconds(track, "start") || 0;
    const end = loopSeconds(track, "end") || buffer.duration;
    node.loopEnd =
      Math.round(end * buffer.sampleRate) >= buffer.length
        ? buffer.duration + 1 / buffer.sampleRate
        : end;
    node.connect(level);
    level.connect(this.master);
    const now = ctx.currentTime;
    level.gain.setValueAtTime(fade > 0 ? 0 : gain, now);
    if (fade > 0) level.gain.linearRampToValueAtTime(gain, now + fade);
    node.start(now, Math.max(0, Math.min(offset, buffer.duration - 1 / buffer.sampleRate)));
    return { node, level, track, buffer, started: now, offset, gain, rate: 1 };
  }
  position(voice = this.current, after = 0) {
    if (!voice) return 0;
    let value = voice.offset + (this.context.currentTime - voice.started + after) * voice.rate;
    const start = voice.node.loopStart,
      end = Math.min(voice.node.loopEnd || voice.buffer.duration, voice.buffer.duration);
    if (voice.node.loop && value >= end && end > start)
      value = start + ((value - start) % (end - start));
    return Math.min(value, voice.buffer.duration);
  }
  end(voice, fade = 0) {
    if (!voice?.node) return;
    const { node, level } = voice;
    const now = this.context.currentTime;
    voice.level.gain.cancelScheduledValues(now);
    voice.level.gain.setValueAtTime(voice.level.gain.value, now);
    if (fade > 0) voice.level.gain.linearRampToValueAtTime(0, now + fade);
    voice.node.stop(now + Math.max(0, fade));
    node.onended = () => {
      node.disconnect();
      level.disconnect();
      if (this.outgoing === voice) this.outgoing = null;
      if (voice.music && this.current?.id !== voice.id) this.musicBuffers.delete(String(voice.id));
    };
  }
  playMusic(id, { fade = 0, offset = 0, restart = false } = {}) {
    id = Number(id) || 0;
    const ticket = ++this.sequence;
    this.serial = this.serial
      .catch(() => {})
      .then(async () => {
        if (ticket !== this.sequence) return;
        await this.unlock();
        if (!id) {
          this.end(this.outgoing);
          this.outgoing = null;
          this.end(this.current, fade);
          this.current = null;
          this.musicBuffers.clear();
          return;
        }
        if (this.current?.id === id && !restart) return;
        // At most two music buffers may be live, including an outgoing crossfade.
        this.end(this.outgoing);
        this.outgoing = null;
        const buffer = await this.musicBuffer(id);
        if (ticket !== this.sequence) {
          if (id !== this.current?.id) this.musicBuffers.delete(String(id));
          return;
        }
        this.outgoing = this.current;
        this.end(this.outgoing, fade);
        const track = this.track("bgm", id);
        this.current = {
          music: true,
          ...this.source(track, buffer, { gain: 0.5 * (track.gain ?? 1), offset, fade }),
          id,
        };
        for (const key of this.musicBuffers.keys())
          if (![String(id), String(this.outgoing?.id)].includes(key)) this.musicBuffers.delete(key);
        this.status = `BGM ${id}`;
      })
      .catch((error) => this.warn(error.message));
    return this.serial;
  }
  prefetch(id) {
    if (!id || Number(id) === this.current?.id || this.outgoing) return this.serial;
    this.serial = this.serial
      .catch(() => {})
      .then(async () => {
        if (this.context && !this.outgoing) await this.musicBuffer(id);
      })
      .catch((error) => this.warn(error.message));
    return this.serial;
  }
  pauseMusic(fade = 0) {
    ++this.sequence;
    if (!this.current) return;
    this.savedMusic = { id: this.current.id, offset: this.position(this.current, fade) };
    this.end(this.outgoing);
    this.outgoing = this.current;
    this.end(this.outgoing, fade);
    this.current = null;
    this.status = "paused";
  }
  resumeMusic(fade = 0) {
    const saved = this.savedMusic;
    return saved
      ? this.playMusic(saved.id, { offset: saved.offset, fade, restart: true })
      : Promise.resolve();
  }
  async effectBuffer(track) {
    if (this.effectBuffers.has(track.file)) return this.effectBuffers.get(track.file);
    const buffer = await this.decode(track),
      bytes = buffer.length * buffer.numberOfChannels * 4;
    while (this.effectBytes + bytes > 12 * 1024 * 1024 && this.effectBuffers.size) {
      const [key, old] = this.effectBuffers.entries().next().value;
      this.effectBytes -= old.length * old.numberOfChannels * 4;
      this.effectBuffers.delete(key);
    }
    if (bytes <= 12 * 1024 * 1024) {
      this.effectBuffers.set(track.file, buffer);
      this.effectBytes += bytes;
    }
    return buffer;
  }
  async playEffect(kind, id, { slot = null, fade = 0 } = {}) {
    const track = this.track(kind, id);
    if (!track) {
      this.warn(`Missing PR ${kind} ${id}`);
      return;
    }
    await this.unlock();
    const registry = kind === "environment" ? this.environments : this.effects;
    const key = slot ?? `one-shot-${++this.effectSequence}`;
    this.end(registry.get(key), fade);
    const pending = {};
    registry.set(key, pending);
    const buffer = await this.effectBuffer(track);
    if (registry.get(key) !== pending) return;
    if (pending.paused) {
      registry.set(key, {
        id,
        track,
        buffer,
        gain: 0.6 * (track.gain ?? 1),
        paused: true,
        savedOffset: 0,
      });
      return;
    }
    const voice = this.source(track, buffer, {
      gain: 0.6 * (track.gain ?? 1),
      fade,
      loop: Boolean(track.loop || track.looping),
    });
    voice.id = id;
    registry.set(key, voice);
    if (track.gainRamp) {
      const ramp = track.gainRamp,
        now = this.context.currentTime;
      voice.level.gain.setValueAtTime(0.6 * ramp.from, now);
      voice.level.gain.linearRampToValueAtTime(0.6 * ramp.to, now + ramp.durationMs / 1000);
    }
    voice.node.onended = () => {
      voice.node.disconnect();
      voice.level.disconnect();
      if (registry.get(key) === voice) registry.delete(key);
    };
  }
  stopEffects(kind, slot = null, fade = 0) {
    const registry = kind === "environment" ? this.environments : this.effects;
    for (const [key, voice] of registry)
      if (slot === null || Number(key) === Number(slot)) {
        if (voice.node) this.end(voice, fade);
        registry.delete(key);
      }
  }
  command({ name, i = [], r = [] }) {
    const fade = Math.max(0, Number(r[0]) || 0);
    if (["PlayBGM", "StopBGM", "PauseBGM", "ReplayBgm", "SetVolume"].includes(name))
      this.transitionUntil = (this.context?.currentTime || 0) + fade;
    if (["PauseBGM", "PlaySE", "PlayEnvSe", "SyncBGM"].includes(name))
      this.warn(
        "PR audio bus/slot operands and SyncBGM fade barriers use a presentation-only mapping; VM timing is unchanged.",
      );
    switch (name) {
      case "PlayBGM":
        return this.playMusic(i[0], { fade, restart: Boolean(i[2]) });
      case "ReplayBgm":
        return i[0] ? this.playMusic(i[0], { fade }) : this.resumeMusic(fade);
      case "StopBGM":
        return this.playMusic(0, { fade });
      case "PauseBGM":
        return i[1] === 0 ? this.resumeMusic(fade) : this.pauseMusic(fade);
      case "ReadyBGM":
        return this.prefetch(i[0]);
      case "PlaySE":
        return this.playEffect("se", i[0], { slot: i[2] ?? null, fade: 0 });
      case "PlayEnvSe":
        return this.playEffect("environment", i[0], { slot: i[2] ?? 0, fade });
      case "StopSE":
        return this.stopEffects("se", i[0] ?? null, fade);
      case "StopEnvSe":
        return this.stopEffects("environment", i[0] ?? null, fade);
      case "PauseEnvSe":
        for (const [slot, voice] of this.environments) {
          if (Number(slot) !== Number(i[0])) continue;
          if (!voice.node && !voice.buffer) {
            voice.paused = Boolean(i[1]);
            continue;
          }
          if (i[1] && voice.node) {
            voice.savedOffset = this.position(voice, fade);
            this.end(voice, fade);
            voice.paused = true;
          } else if (voice.paused) {
            const resumed = this.source(voice.track, voice.buffer, {
              offset: voice.savedOffset,
              gain: voice.gain,
              fade,
            });
            Object.assign(voice, resumed, { paused: false });
            const { node, level } = resumed;
            node.onended = () => {
              node.disconnect();
              level.disconnect();
              if (this.environments.get(slot) === voice && voice.node === node)
                this.environments.delete(slot);
            };
          }
        }
        return;
      case "PitchEnvSe":
        for (const [slot, voice] of this.environments)
          if (Number(slot) === Number(i[0]) && voice.node) {
            voice.offset = this.position(voice);
            voice.started = this.context.currentTime;
            voice.rate = Number(r[0]) || 1;
            voice.node.playbackRate.setValueAtTime(voice.rate, this.context.currentTime);
          }
        return;
      case "SetVolume":
        if (this.current) {
          const now = this.context.currentTime;
          this.current.level.gain.cancelScheduledValues(now);
          this.current.level.gain.setValueAtTime(this.current.level.gain.value, now);
          this.current.level.gain.linearRampToValueAtTime(0.5 * (Number(r[1]) || 0), now + fade);
        }
        return;
      case "SyncBGM":
        this.serial = this.serial
          .catch(() => {})
          .then(
            () =>
              new Promise((resolve) =>
                setTimeout(
                  resolve,
                  Math.max(0, this.transitionUntil - (this.context?.currentTime || 0)) * 1000,
                ),
              ),
          );
        return this.serial; // Presentation barriers never alter VM timing.
      case "SyncSE":
        return Promise.resolve();
      case "LoadSE":
        return;
    }
  }
  event(event) {
    if (event.kind === "bgm") return this.playMusic(event.id, { fade: event.fade || 0 });
    if (event.kind === "se") return this.playEffect("se", event.id);
  }
  snapshot() {
    return {
      status: this.status,
      context: this.context?.state,
      sampleRate: this.context?.sampleRate,
      codec: this.lastCodec,
      currentId: this.current?.id ?? null,
      pausedMusic: this.savedMusic || null,
      position: this.position(),
      loop: this.current?.track.loop ?? null,
      musicBuffers: this.musicBuffers.size,
      effectBuffers: this.effectBuffers.size,
      environments: this.environments.size,
      warnings: [...this.warned],
    };
  }
}
