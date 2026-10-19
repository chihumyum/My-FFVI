// Nearby authored exits only. This never chooses a route or sends game input.
export class MapPreloader {
  constructor(repository, renderer, { connection = globalThis.navigator?.connection } = {}) {
    this.repository = repository;
    this.renderer = renderer;
    this.connection = connection;
    this.completed = new Set();
    this.inFlight = null;
    this.lastCheck = 0;
    this.pages = 0;
  }
  update(game, now = performance.now()) {
    if (
      this.inFlight ||
      !game?.map ||
      game.loading ||
      game.battle ||
      this.connection?.saveData ||
      /(^|-)2g$/.test(this.connection?.effectiveType || "") ||
      now - this.lastCheck < 750
    )
      return;
    this.lastCheck = now;
    const { x, y } = game.player;
    const exits = (game.map.entities || [])
      .filter((entity) => entity.destination?.mapId && entity.destination.mapId !== game.mapId)
      .map((entity) => ({
        id: entity.destination.mapId,
        distance: Math.abs(entity.x - x) + Math.abs(entity.y - y),
      }))
      .filter((exit) => exit.distance <= 10 && !this.completed.has(exit.id))
      .sort((a, b) => a.distance - b.distance);
    const target = exits[0]?.id;
    if (!target) return;
    this.inFlight = this.repository
      .prefetchMap(target)
      .then(async (map) => {
        if (map) this.pages += await this.renderer.prefetchMap(map, this.repository.data);
        this.completed.add(target);
      })
      .catch((error) => console.warn(`[preload] Map ${target}: ${error.message}`))
      .finally(() => {
        this.inFlight = null;
      });
  }
}
