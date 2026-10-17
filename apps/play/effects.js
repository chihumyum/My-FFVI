// Demand-loaded source effect packs; no simulation state is read or written here.
export class EffectLibrary {
  constructor(particles, catalog, json) {
    Object.assign(this, { particles, catalog, json });
    this.loaded = new Map();
    this.pending = new Map();
    particles.setCatalog(catalog);
  }
  async load(effectId) {
    const asset = this.catalog.effectIds[effectId]?.asset || effectId;
    if (!this.catalog.files[asset]) return null;
    if (!this.loaded.has(asset)) {
      if (!this.pending.has(asset))
        this.pending.set(
          asset,
          this.json(this.catalog.files[asset])
            .then((pack) => {
              this.loaded.set(asset, pack);
              this.pending.delete(asset);
              return pack;
            })
            .catch((error) => {
              this.pending.delete(asset);
              throw error;
            }),
        );
      await this.pending.get(asset);
    }
    const { warnings, ...effect } = this.loaded.get(asset);
    this.particles.setCatalog({ effects: { [asset]: effect }, warnings });
    return asset;
  }
  async play(effectId, options, isCurrent = () => true) {
    await this.load(effectId);
    if (!isCurrent()) return null;
    return this.particles.play(effectId, options);
  }
}
