export function visualPointKey(point) {
  return JSON.stringify(
    ["kind", "mapId", "script", "instruction", "programInstruction", "encounterId", "outcome"].map(
      (key) => point[key] ?? null,
    ),
  );
}

// Match source positions and their occurrence, never an old wall-clock time,
// player coordinate or capture ordinal. The actual current state is retained.
export function selectVisualPoints(scenes) {
  const targets = new Map(),
    counts = new Map();
  for (const scene of scenes) {
    const key = visualPointKey(scene.point);
    if (!targets.has(key)) targets.set(key, []);
    targets.get(key).push(scene);
  }
  return (metadata) => {
    const key = visualPointKey(metadata);
    if (!targets.has(key)) return false;
    const occurrence = (counts.get(key) || 0) + 1;
    counts.set(key, occurrence);
    const scene = targets.get(key).find((scene) => scene.occurrence === occurrence);
    return scene ? { referenceSequence: scene.sequence } : false;
  };
}
