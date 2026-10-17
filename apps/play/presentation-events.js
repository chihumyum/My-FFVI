// Observe executed PR presentation instructions without changing the game VM,
// its program counters, waits, random stream, state, or existing events.
const listening = new WeakMap();
const audioInstructions = new Set([
  "PlayBGM",
  "ReplayBgm",
  "StopBGM",
  "PauseBGM",
  "ReadyBGM",
  "SyncBGM",
  "PlaySE",
  "StopSE",
  "SyncSE",
  "PlayEnvSe",
  "StopEnvSe",
  "PauseEnvSe",
  "PitchEnvSe",
  "SetVolume",
  "LoadSE",
]);
const visualInstructions = new Set([
  "Shake",
  "Flash",
  "ScreenEffect",
  "ColorFade",
  "Water",
  "ChangeView",
  "BackdropColor",
  "CueAnim",
  "PlayAnim",
  "SetPos",
  "Move",
  "MoveBirdView",
  "MoveTo",
  "Lerp",
  "Route",
]);
export function existingPresentationActor(game, selector) {
  if (selector == null || selector === -1001 || selector === -1010) return game.player;
  if (selector === 0) return game.camera;
  if (selector <= -1030 && selector >= -1032)
    return game.partyPositions?.[-1030 - selector] || game.player;
  if (selector <= -1002 && selector >= -1005)
    selector = -(game.partySlots?.[game.partyIndex || 0]?.[-selector - 1001] || 1);
  return game.actors?.get(String(selector)) || null;
}
const visualSelector = /モノクロフィルター|幻獣界フィルター|近景|遠景|背景変更|スクロール/;
export const observingAudioInstruction = (game) => Boolean(listening.get(game));
export const isAudioInstruction = (name) => audioInstructions.has(name);
export function withPresentation(Base) {
  return class PresentationGame extends Base {
    constructor({ onPresentation, ...options }) {
      super(options);
      // The observer belongs to the host. It is never serialized into a save.
      Object.defineProperty(this, "onPresentation", { value: onPresentation });
    }
    step(task) {
      const program = this.data.programs[task.program],
        index = task.pc,
        op = program?.ops[index];
      const audio = audioInstructions.has(op?.[0]);
      if (
        !audio &&
        !visualInstructions.has(op?.[0]) &&
        !(op?.[0] === "SysCall" && visualSelector.test(op[3]?.[0] || ""))
      )
        return super.step(task);
      listening.set(this, (listening.get(this) || 0) + 1);
      try {
        const result = super.step(task);
        try {
          this.onPresentation?.({
            kind: audio ? "audio-command" : "presentation-command",
            name: op[0],
            i: op[1],
            r: op[2],
            s: op[3],
            script: program.name,
            index,
            time: this.time,
            mapId: this.mapId,
            ...([
              "CueAnim",
              "PlayAnim",
              "SetPos",
              "Move",
              "MoveBirdView",
              "MoveTo",
              "Lerp",
              "Route",
            ].includes(op[0])
              ? {
                  animationActor: existingPresentationActor(this, task.actor),
                  customAnimations: program.animations || [],
                }
              : {}),
          });
        } catch (error) {
          console.warn("Presentation observer failed; game continues", error);
        }
        return result;
      } finally {
        listening.set(this, listening.get(this) - 1);
      }
    }
  };
}
