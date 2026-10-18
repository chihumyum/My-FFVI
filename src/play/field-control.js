import { fieldCharacterAsset } from "./appearance.js";

const poseInstructions = new Set(["SetPos", "Move", "MoveTo", "Route", "Lerp", "LerpTo", "LookAt"]);
const ownerOf = (task) => task?.fieldControlOwner || task;
const leaderOf = (game) => game.partySlots[game.partyIndex]?.[0] ?? game.player.characterId;

// The scene and ordinary field controller share a character in PR. Keep the
// authored body/pose until the owning foreground scene actually returns.
export function bindFieldControl(game, task, selector) {
  const owner = ownerOf(task),
    leader = leaderOf(game);
  if (!owner || owner.actor !== null || owner.background || owner.init || !leader) return;
  if (selector !== -1001 && selector !== -leader) return;
  const previous = game.fieldControl;
  if (previous?.owner !== owner || previous.characterId !== leader)
    game.fieldControl = {
      owner,
      program: owner.program,
      mapId: game.mapId,
      characterId: leader,
      direct: false,
      hiddenBySource: false,
      authoredPose: false,
    };
  if (selector === -1001) game.fieldControl.direct = true;
}

export function observeFieldControl(game, task, name, actor) {
  // Several source scenes hide the ordinary body before binding its first
  // puppet, then end with -1001 LookAt rather than another positional move.
  if (name === "HidePlayer") bindFieldControl(game, task, -1001);
  const control = game.fieldControl;
  if (!control || control.owner !== ownerOf(task) || actor !== game.player) return;
  if (name === "Hide" || name === "HidePlayer") control.hiddenBySource = true;
  else if (poseInstructions.has(name)) control.authoredPose = true;
}

export function returnFieldControl(game, { existingBody = false } = {}) {
  let control = game.fieldControl;
  const leader = leaderOf(game),
    puppet = game.actors.get(String(-leader));
  // Old input-boundary saves can contain the actual visible leader body but
  // predate the scene ownership field. An ordinary input can take that body.
  if (!control && existingBody && game.player.visible === false && puppet?.visible)
    control = {
      owner: { done: true },
      mapId: game.mapId,
      characterId: leader,
      direct: false,
    };
  if (!control || !control.owner.done || game.busy || game.loading) return false;
  game.fieldControl = null;
  if (
    !game.control ||
    game.titleScreen ||
    game.over ||
    control.mapId !== game.mapId ||
    control.characterId !== leader ||
    (game.map?.worldTerrain && game.player.vehicle > 1) ||
    game.player.visible !== false
  )
    return false;
  const sourceBody = puppet?.visible ? puppet : null;
  if (sourceBody) {
    if (
      sourceBody.motion ||
      game.tasks.some((task) => !task.done && [Number(sourceBody.id), -1001].includes(task.actor))
    ) {
      game.fieldControl = control;
      return false;
    }
    for (const key of [
      "x",
      "y",
      "layer",
      "direction",
      "animation",
      "asset",
      "vehicle",
      "walkAsset",
    ])
      if (Object.hasOwn(sourceBody, key)) game.player[key] = sourceBody[key];
    const facing = { Walk: "down", WalkB: "up", WalkR: "right", WalkL: "left", Default: "down" }[
      sourceBody.animation?.replace(/-S$/, "")
    ];
    if (facing) game.player.direction = facing;
    sourceBody.visible = false;
  } else if (!(
    control.direct &&
    control.hiddenBySource &&
    (control.authoredPose || control.poseAfterHide)
  ))
    return false;
  game.player.visible = true;
  game.player.motion = null;
  game.camera.manual = false;
  const source = game.data.programs[control.program]?.name;
  game.event("player-control-return", {
    characterId: leader,
    source,
    body: sourceBody ? "leader-puppet" : "authored-player",
    ...(control.legacyAutosave ? { legacyAutosave: control.legacyAutosave } : {}),
    x: game.player.x,
    y: game.player.y,
    layer: game.player.layer,
  });
  game.warn(
    control.program ? control.owner : null,
    "The completed foreground scene returns ordinary control to its current leader's authored body and pose. PR field-controller callback timing is inferred; pure Hide, vehicles and title scenes retain their hidden state.",
  );
  return true;
}

export function snapshotFieldControl(game) {
  if (!game.fieldControl) return null;
  const { owner, ...control } = game.fieldControl;
  return control;
}

// Old autosaves have no task/ownership record. Recognize only a completed,
// linear AutoSave -> Exit source with an independently calculable player pose.
// This is a read-only proof, not a second event interpreter: unknown operations
// reject migration, and neither coordinates nor source flags are repaired.
function legacyAutosaveControl(game, saved) {
  const leader = leaderOf(game),
    history = saved?.history,
    last = history?.at(-1),
    previous = history?.at(-2),
    resolve = (entry) =>
      game.data.byMap?.[entry?.mapId]?.[entry?.script] ?? game.data.global?.[entry?.script];
  if (
    !last ||
    !previous ||
    last.mapId !== game.mapId ||
    game.player.visible !== false ||
    game.player.motion ||
    game.player.characterId !== leader ||
    game.player.asset !== fieldCharacterAsset(game.data, leader) ||
    game.actors.get(String(-leader))?.visible ||
    game.map?.worldTerrain ||
    game.player.vehicle > 1
  )
    return null;
  const program = resolve(last),
    ops = game.data.programs[program]?.ops,
    prior = game.data.programs[resolve(previous)]?.ops,
    entrances = prior?.filter(
      ([name, i, , s]) => name === "ChangeMap" && i[0] === game.mapId && s[0] === last.script,
    );
  if (!ops || entrances?.length !== 1) return null;
  const entrance = game.map.entities?.find(
    (entity) => entity.kind === 0 && entity.objectId === entrances[0][1][1],
  );
  if (!Number.isFinite(entrance?.layer)) return null;
  const end = ops.findIndex(([name]) => name === "Exit"),
    main = ops.slice(0, end);
  if (end < 1 || main.at(-1)?.[0] !== "AutoSave") return null;
  const pose = { layer: entrance.layer },
    neutral = new Set(["Nop", "Wait", "LookAt", "CueAnim", "PlayAnim"]);
  let hidden = false,
    poseAfterHide = false;
  const callback = (pc) => {
    for (let n = pc; n < ops.length; n++) {
      const [name, i] = ops[n];
      if (name === "Exit") return true;
      if (neutral.has(name)) continue;
      if (name === "Hide") {
        hidden = true;
        poseAfterHide = false;
      } else if (name === "Show") hidden = false;
      else if (name === "SetPos" && i[3] === 0 && i[2] === 0 && i[0] >= 0 && i[1] >= 0) {
        // Only the source's preserve-current-layer form is proven here.
        // Nonzero requests use Unity's request-1 mapping, not a raw layer.
        Object.assign(pose, { x: i[0], y: i[1] });
        if (hidden) poseAfterHide = true;
      } else if (
        name === "Move" &&
        [0, 1, 2, 3].includes(i[0]) &&
        i[1] >= 0 &&
        Number.isFinite(pose.x) &&
        Number.isFinite(pose.y)
      ) {
        const [dx, dy] = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ][i[0]];
        pose.x += dx * i[1];
        pose.y += dy * i[1];
        if (hidden) poseAfterHide = true;
      } else return false;
    }
    return false;
  };
  const factory = (pc) => {
    let bindings = [];
    for (let n = pc; n < ops.length; n++) {
      const [name, i] = ops[n];
      if (name === "Return") return bindings.length === 0;
      if (name === "Nop") continue;
      if (name === "SetPuppet") bindings.push(i);
      else if (name === "ExecPuppet" && !i[0]) {
        for (const binding of bindings) {
          // Separate character puppets need their actual saved body; this narrow
          // migration only proves the ordinary player's own authored callback.
          if (binding[1] === -leader) return false;
          if (binding[1] === -1001 && !callback(binding[2])) return false;
        }
        bindings = [];
      } else return false;
    }
    return false;
  };
  for (const [name, i, , s] of main) {
    if (name === "Call") {
      if (!factory(i[0])) return null;
    } else if (name === "SetFlag" || name === "ResetFlag") {
      if ((saved.banks?.[s[0]]?.[i[0]] ?? 0) !== Number(name === "SetFlag")) return null;
    } else if (name === "SetEntities") {
      if (!saved.groups?.includes(s[0])) return null;
    } else if (name === "RideVehicleNPC") {
      if (!(i[1] > 0)) return null;
    } else if (
      ![
        "Nop",
        "Wait",
        "Msg",
        "FadeIn",
        "FadeOut",
        "PlayBGM",
        "StopBGM",
        "PlaySE",
        "StopSE",
        "AutoSave",
      ].includes(name)
    )
      return null;
  }
  if (
    !hidden ||
    !poseAfterHide ||
    !["x", "y", "layer"].every((key) => pose[key] === saved.player[key])
  )
    return null;
  return {
    program,
    mapId: game.mapId,
    characterId: leader,
    direct: true,
    hiddenBySource: true,
    authoredPose: true,
    legacyAutosave: { pc: end - 1, source: last.script },
  };
}

export function restoreFieldControl(game, saved, snapshot) {
  saved ||= legacyAutosaveControl(game, snapshot);
  game.fieldControl = saved
    ? { ...saved, owner: { done: true, program: saved.program, pc: 0 } }
    : null;
  // Saves do not resume event tasks. Preserve their pending control handoff,
  // including an authored autosave immediately before the scene's final Exit.
  returnFieldControl(game);
}
