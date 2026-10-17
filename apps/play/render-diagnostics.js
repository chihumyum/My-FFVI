// Resource diagnostics are observations only. They never choose a replacement asset.
export class RenderDiagnostics {
  constructor({ acceptance = false, onIssue = (issue) => console.warn("[render]", issue) } = {}) {
    this.acceptance = acceptance;
    this.onIssue = onIssue;
    this.mapNames = {};
    this.reset();
  }
  reset() {
    this.issues = new Map();
    this.context = {
      mapId: null,
      mapName: null,
      script: null,
      instructionIndex: null,
      instructionName: null,
      time: null,
    };
  }
  begin(game) {
    const instruction = game?.lastInstruction;
    this.context = {
      mapId: game?.mapId ?? null,
      mapName: this.mapNames[game?.mapId] || game?.map?.name || null,
      script: instruction?.script || game?.furthest?.script || null,
      instructionIndex: instruction?.index ?? null,
      instructionName: instruction?.name ?? null,
      time: game?.time ?? null,
    };
  }
  record(category, details = {}, context = this.context) {
    const issue = {
      ...context,
      category,
      entityId: details.entityId ?? null,
      resource: details.resource ?? details.asset ?? null,
      animation: details.animation ?? null,
      ...details,
    };
    const common = [
      category,
      issue.asset,
      issue.resource,
      issue.animation,
      issue.reason,
      issue.fallback,
    ];
    const key = JSON.stringify(
      this.acceptance
        ? [...common, issue.mapId, issue.script, issue.instructionIndex, issue.entityId]
        : common,
    );
    const existing = this.issues.get(key);
    if (existing) {
      if (this.acceptance) {
        existing.count++;
        existing.lastTime = issue.time;
      }
      return existing;
    }
    const record = { ...issue, count: 1, firstTime: issue.time, lastTime: issue.time };
    this.issues.set(key, record);
    this.onIssue(record);
    return record;
  }
  summary() {
    return [...this.issues.values()]
      .map((row) => ({ ...row }))
      .sort((a, b) => b.count - a.count || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
}
