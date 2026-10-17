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
      if (!audioInstructions.has(op?.[0])) return super.step(task);
      listening.set(this, (listening.get(this) || 0) + 1);
      try {
        const result = super.step(task);
        try {
          this.onPresentation?.({
            kind: "audio-command",
            name: op[0],
            i: op[1],
            r: op[2],
            s: op[3],
            script: program.name,
            index,
            time: this.time,
            mapId: this.mapId,
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
