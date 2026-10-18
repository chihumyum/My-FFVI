// Capture only diagnostics. This module never dispatches game input or edits a save.
export function reportValue(value) {
  const ancestors = [];
  return JSON.parse(
    JSON.stringify(value, function (key, item) {
      if (typeof item === "function") return undefined;
      if (item instanceof Map) return [...item];
      if (item instanceof Set) return [...item];
      if (!item || typeof item !== "object") return item;
      while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop();
      if (ancestors.includes(item)) return "[Circular]";
      ancestors.push(item);
      return item;
    }),
  );
}

export function createEventHistory(limit = 20) {
  const events = [];
  return {
    record(event) {
      events.push(reportValue(event));
      if (events.length > limit) events.shift();
    },
    clear() {
      events.length = 0;
    },
    read: () => reportValue(events),
  };
}

export function describeBugState(game, renderer, events, mapNames = {}) {
  // PlayGame.party lazily creates roster entries. Diagnostics must not do that.
  const party = (game?.partySlots?.[game.partyIndex || 0] || []).map(
    (id) =>
      game.roster?.[id] || {
        id,
        name: game.battleData?.characters?.[id]?.name,
        uninitialized: true,
      },
  );
  return reportValue({
    schema: "ffvi-bug-report",
    version: 1,
    createdAt: new Date().toISOString(),
    map: {
      id: game?.mapId ?? null,
      name: mapNames[game?.mapId] || game?.map?.name || "标题画面",
      sourceName: game?.map?.name ?? null,
    },
    script: {
      story: game?.furthest?.script ?? null,
      lastInstruction: game?.lastInstruction ?? null,
      tasks: (game?.tasks || [])
        .filter((task) => !task.done)
        .map((task) => ({
          id: task.id,
          name: game.data.programs[task.program]?.name ?? task.program,
          nextInstruction: task.pc,
          previousInstruction: task.pc - 1,
          actor: task.actor,
          wait: task.wait,
          waitFor: task.waitFor,
          background: task.background,
        })),
    },
    time: game?.time ?? null,
    player: game?.player ?? null,
    camera: game?.camera ?? null,
    groups: game?.groups ?? [],
    actors: renderer.frameActors || [],
    party: party.map((unit) =>
      Object.fromEntries(
        [
          "id",
          "name",
          "level",
          "hp",
          "maxHp",
          "mp",
          "maxMp",
          "strength",
          "magic",
          "speed",
          "defense",
          "magicDefense",
          "row",
          "equipment",
          "magicite",
          "conditions",
          "magitek",
          "trance",
          "uninitialized",
        ].map((key) => [key, unit[key]]),
      ),
    ),
    battle: game?.battle
      ? {
          encounterId: game.battle.encounterId,
          pattern: game.battle.pattern,
          phase: game.battle.phase,
          uiVisible: game.battle.events?.uiVisible !== false,
          enemies: game.battle.enemies.map((unit) => ({
            id: unit.id,
            name: unit.name,
            hp: unit.hp,
            maxHp: unit.maxHp,
            conditions: unit.conditions,
            hidden: unit.hidden,
            removed: unit.removed,
          })),
        }
      : null,
    events,
    rendering: renderer.metrics(),
    renderIssues: renderer.diagnostics?.summary() || [],
    viewport: {
      width: renderer.canvas?.width || renderer._width,
      height: renderer.canvas?.height || renderer._height,
      logicalWidth: renderer._width,
      logicalHeight: renderer._height,
      resolution: renderer._resolution || 1,
    },
    location: globalThis.location?.href ?? null,
  });
}

export async function saveBugReport(report, { development = false, fetcher = fetch } = {}) {
  const text = JSON.stringify(report, null, 2);
  if (development) {
    const response = await fetcher(new URL("/__bug-reports", location.href), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || `Bug report HTTP ${response.status}`);
    return { method: "directory", ...result };
  }
  const file = `ffvi-bug-${report.createdAt.replace(/[:.]/g, "-")}.json`;
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { method: "download", file };
}
