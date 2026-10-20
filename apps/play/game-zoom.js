const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Offsets are fractions of the unscaled game viewport. Only the renderer's
// world container consumes these values; neither the canvas nor its UI scales.
export function zoomAt(view, scale, anchor, previousAnchor = anchor) {
  scale = clamp(scale, 1, 3);
  const ratio = scale / view.scale;
  return {
    scale,
    x: clamp(anchor.x - (previousAnchor.x - view.x) * ratio, 1 - scale, 0),
    y: clamp(anchor.y - (previousAnchor.y - view.y) * ratio, 1 - scale, 0),
  };
}

export function mountGameZoom({
  element,
  onChange = () => {},
  onGesture = () => {},
  isSurface = (event) => event.target === element,
}) {
  let view = { scale: 1, x: 0, y: 0 };
  let gesture = null;
  const pointers = new Map();
  const targets = new Map();
  const suppressed = new Set();
  const cancelled = new WeakSet();
  const recent = new Map();
  let legacyClickUntil = 0;
  const point = (event) => ({ x: event.clientX, y: event.clientY });
  const pair = () => {
    const [a, b] = [...pointers.values()];
    const rect = element.getBoundingClientRect();
    return {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      anchor: {
        x: ((a.x + b.x) / 2 - rect.left) / Math.max(1, rect.width),
        y: ((a.y + b.y) / 2 - rect.top) / Math.max(1, rect.height),
      },
    };
  };
  const emit = (active = false) => onChange({ ...view, active });
  const stop = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const begin = () => {
    const next = pair();
    gesture = { ...next, view: { ...view } };
    for (const id of pointers.keys()) suppressed.add(id);
    // The first finger may already have reached Pixi. Cancel that pending tap
    // before suppressing subsequent events so its pointer state is not stuck.
    if (typeof PointerEvent !== "undefined")
      for (const [pointerId, position] of pointers) {
        const event = new PointerEvent("pointercancel", {
          pointerId,
          pointerType: "touch",
          clientX: position.x,
          clientY: position.y,
          bubbles: true,
        });
        cancelled.add(event);
        (targets.get(pointerId) || element).dispatchEvent(event);
      }
    onGesture();
    emit(true);
  };
  const down = (event) => {
    if (!isSurface(event)) return;
    if (event.pointerType !== "touch") {
      legacyClickUntil = 0;
      return;
    }
    if (!pointers.size) {
      recent.delete(event.pointerId);
      legacyClickUntil = 0;
    }
    pointers.set(event.pointerId, point(event));
    targets.set(event.pointerId, event.target);
    if (pointers.size >= 2) {
      begin();
      stop(event);
    } else if (suppressed.size) {
      suppressed.add(event.pointerId);
      stop(event);
    }
  };
  const move = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, point(event));
    if (!suppressed.has(event.pointerId)) return;
    stop(event);
    if (!gesture || pointers.size < 2) return;
    const next = pair();
    view = zoomAt(
      gesture.view,
      (gesture.view.scale * next.distance) / gesture.distance,
      next.anchor,
      gesture.anchor,
    );
    emit(true);
  };
  const up = (event) => {
    if (cancelled.has(event)) return;
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    targets.delete(event.pointerId);
    if (suppressed.has(event.pointerId)) {
      recent.set(event.pointerId, performance.now() + 700);
      legacyClickUntil = performance.now() + 700;
      stop(event);
    }
    if (pointers.size < 2) {
      gesture = null;
      emit();
    } else if (gesture) begin();
    // Keep both fingers suppressed until the gesture has entirely ended. This
    // prevents the remaining finger from clicking a target after its mate lifts.
    if (!pointers.size) suppressed.clear();
  };
  const release = () => {
    pointers.clear();
    targets.clear();
    suppressed.clear();
    gesture = null;
    emit();
  };
  const click = (event) => {
    if (!isSurface(event)) return;
    const now = performance.now();
    for (const [id, until] of recent) if (until < now) recent.delete(id);
    if (
      suppressed.has(event.pointerId) ||
      (event.pointerType === "touch" && recent.has(event.pointerId)) ||
      (event.pointerType !== "touch" && now < legacyClickUntil)
    )
      stop(event);
  };
  const visibility = () => {
    if (document.hidden) release();
  };
  window.addEventListener("pointerdown", down, true);
  // Capture before Pixi's canvas/document listeners can turn a pinch into a tap.
  window.addEventListener("pointermove", move, { capture: true, passive: false });
  window.addEventListener("pointerup", up, { capture: true, passive: false });
  window.addEventListener("pointercancel", up, { capture: true, passive: false });
  window.addEventListener("click", click, true);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);
  return {
    reset() {
      release();
      view = { scale: 1, x: 0, y: 0 };
      emit();
    },
    destroy() {
      release();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
