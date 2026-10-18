// PR sc_b_2022 emits these commands inside the same Battle. The bg50 prefab
// contains a static 472x784 Sprite at y=284, not an AnimationClip. Moving its
// parent preserves all original texture/material sampling and tower artwork.
const scrollName = /^LB:背景スクロールラウンド([234])$/;
export const isFinalTowerEvent = (event) =>
  scrollName.test(event?.name || "") || /^LB:画面揺れ(再生|停止)$/.test(event?.name || "");
export const FINAL_TOWER_GUESS =
  "Final tower: PR bg50 has no animation curve. Intermediate camera stops are inferred from its three tier compositions (144/288px); the last stop is the source image's top edge (568px). Each ascent spans the source Wait 1.4 + Wait 2.1 seconds, with linear travel. Source shake start/stop is retained with an approximate 1px oscillation.";
const offsets = [0, 0, 144, 288, 568];
const duration = 1.4 + 2.1;

export class FinalBattlePresentation {
  constructor({ warn = () => {} } = {}) {
    this.warn = warn;
    this.reset();
  }
  reset() {
    this.battle = null;
    this.round = 1;
    this.offset = 0;
    this.transition = null;
    this.shaking = false;
    this.pending = [];
  }
  event(event) {
    if (!isFinalTowerEvent(event)) return false;
    this.pending.push(event);
    return true;
  }
  sample(battle) {
    const active = Number(battle?.formation?.backgroundId) === 50;
    if (!active) {
      this.reset();
      return { active: false, x: 0, y: 0, round: 1, offset: 0, progress: 1 };
    }
    const time = Number(battle.elapsed) || 0;
    if (this.battle !== battle) {
      const pending = this.pending;
      this.reset();
      this.pending = pending;
      this.battle = battle;
      const queued = pending.find((event) => scrollName.test(event.name));
      this.round = queued
        ? Number(queued.name.at(-1)) - 1
        : Number(battle.events?.state?.finalRound) || 1;
      this.offset = offsets[this.round] || 0;
    }
    for (const event of this.pending.splice(0)) {
      const match = event.name.match(scrollName);
      const at = Number.isFinite(event.time) ? event.time : time;
      if (match) {
        const from = this.at(at).offset;
        this.round = Number(match[1]);
        this.transition = { from, to: offsets[this.round], start: at, duration };
        this.warn(FINAL_TOWER_GUESS);
      } else this.shaking = event.name.endsWith("再生");
    }
    const state = this.at(time);
    this.offset = state.offset;
    return {
      active: true,
      ...state,
      round: this.round,
      time,
      shaking: this.shaking,
      x: this.shaking ? Math.sin(time * 53) : 0,
      y: state.offset + (this.shaking ? Math.sin(time * 47 + 1) : 0),
      transition: this.transition ? { ...this.transition } : null,
    };
  }
  at(time) {
    const t = this.transition;
    if (!t) return { offset: this.offset, progress: 1 };
    const progress = Math.max(0, Math.min(1, (time - t.start) / t.duration));
    return { offset: t.from + (t.to - t.from) * progress, progress };
  }
}
