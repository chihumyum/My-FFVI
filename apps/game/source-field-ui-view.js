/** The current published Field is the only input. This component owns DOM,
 * never a title clock, location register, readiness flag or saved game state. */
export class SourceFieldUiView {
  constructor(container) {
    if (!container || !container.ownerDocument || !container.isConnected)
      throw new Error("Source Field UI requires an attached DOM container");
    this.container = container;
    this.title = container.ownerDocument.createElement("section");
    this.title.className = "source-map-title";
    this.title.setAttribute("aria-live", "polite");
    this.title.setAttribute("aria-label", "地点");
    this.area = container.ownerDocument.createElement("div");
    this.location = container.ownerDocument.createElement("div");
    this.title.append(this.area, this.location);
    this.title.hidden = true;
    container.append(this.title);
  }
  render(field, hidden = false) {
    if (!this.container.isConnected || !this.title.isConnected ||
        this.title.parentNode !== this.container || this.area.parentNode !== this.title || this.location.parentNode !== this.title)
      throw new Error("Source Field UI DOM owner was detached or replaced");
    const projection = field?.sourceFieldUiSnapshot ?? null;
    this.area.textContent = projection?.title?.area ?? "";
    this.location.textContent = projection?.title?.title ?? "";
    this.title.hidden = hidden || !projection?.title;
    this.container.dataset.sourceMainGameState = projection?.mainGameState === null || !projection ? "unknown" : String(projection.mainGameState);
    this.container.dataset.sourceMapView = projection?.view ?? "unknown";
    // Explicit Web layout policy. Source MapUIView's native active table is
    // still unverified; no boolean here is presented as that recovered table.
    return {
      source: projection !== null,
      event: projection?.mainGameState === 12,
      view: projection?.view ?? null,
    };
  }
}
