import { PlayGame } from "../../src/play/game.js";
import { withPresentation, isAudioInstruction } from "./presentation-events.js";

export function mapAudioCommands(metadata = {}) {
  // Zero BGM preserves the previous song. Initializers explicitly StopBGM in
  // silent scenes, and otherwise choose from story flags (e.g. Narshe/Figaro).
  return [
    { name: "StopEnvSe", i: [], r: [] },
    ...(metadata.bgmId > 0 ? [{ name: "PlayBGM", i: [metadata.bgmId, 1, 0], r: [] }] : []),
    ...(metadata.environmentId > 0
      ? [{ name: "PlayEnvSe", i: [metadata.environmentId, 1, 0], r: [] }]
      : []),
  ];
}

// Old saves predate audio snapshots. Evaluate only the real initializer's
// synchronous prefix with the existing VM on a disposable clone. No commands,
// flags, entities, random draws or task changes are applied to the live game.
export async function legacySceneAudio(saved, { data, battleData, map, warn = console.warn }) {
  warn(
    `[audio restore] Legacy map${saved.mapId} save has no audio cursor; recovering PR map/default and flag-selected initializer cues. A prior temporary cutscene override/offset cannot be reconstructed.`,
  );
  const commands = mapAudioCommands(data.maps[saved.mapId]);
  const Probe = withPresentation(PlayGame);
  const probe = new Probe({
    data,
    battleData,
    random: () => 0.5,
    loadMap: async (id) => {
      if (id !== map.id) throw Error("Audio restore initializer attempted a map change");
      return structuredClone(map);
    },
    onPresentation: (command) => {
      if (isAudioInstruction(command.name)) commands.push(command);
    },
  });
  await probe.restore(structuredClone(saved));
  probe.tasks = [];
  const task = map.initializer && probe.startScript(map.initializer, { init: true });
  if (task) {
    for (let n = 0; n < 1000 && !task.done && !task.waitFor && !task.wait && !probe.loading; n++) {
      const op = data.programs[task.program]?.ops[task.pc]?.[0];
      if (["ChangeMap", "Encount", "EncountEx"].includes(op)) break;
      probe.step(task);
    }
    if (!task.done)
      warn(
        "[audio restore] Old save initializer has a wait; only its synchronous audio prefix was recovered.",
      );
  }
  return commands.filter((c) =>
    [
      "PlayBGM",
      "StopBGM",
      "PauseBGM",
      "ReplayBgm",
      "SetVolume",
      "PlayEnvSe",
      "StopEnvSe",
      "PauseEnvSe",
      "PitchEnvSe",
    ].includes(c.name),
  );
}
