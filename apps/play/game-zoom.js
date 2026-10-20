const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function constrainZoom({ scale = 1, x = 0, y = 0 } = {}) {
  scale = clamp(Number.isFinite(scale) ? scale : 1, 0.1, 10);
  const low = Math.min(0, 1 - scale),
    high = Math.max(0, 1 - scale);
  return { scale, x: clamp(x || 0, low, high), y: clamp(y || 0, low, high) };
}

// Offsets are fractions of the unscaled game viewport. The complete canvas,
// including its game UI, follows this transform; page controls stay outside it.
export function zoomAt(view, scale, anchor, previousAnchor = anchor) {
  scale = constrainZoom({ scale }).scale;
  const ratio = scale / view.scale;
  return constrainZoom({
    scale,
    x: anchor.x - (previousAnchor.x - view.x) * ratio,
    y: anchor.y - (previousAnchor.y - view.y) * ratio,
  });
}

export function mountGameZoom({
  element,
  onChange = () => {},
  onGesture = () => {},
  isSurface = (event) => event.target === element,
  getViewport = () => element.getBoundingClientRect(),
}) {
  let view = { scale: 1, x: 0, y: 0 };
  let gesture = null;
  let trackpadGesture = null;
  const pointers = new Map();
  const targets = new Map();
  const suppressed = new Set();
  const cancelled = new WeakSet();
  const recent = new Map();
  let legacyClickUntil = 0;
  const point = (event) => ({ x: event.clientX, y: event.clientY });
  const pair = () => {
    const [a, b] = [...pointers.values()];
    const rect = getViewport();
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
    trackpadGesture = null;
    emit();
  };
  const center = { x: 0.5, y: 0.5 };
  const anchorAt = (event) => {
    const rect = getViewport();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };
  const reset = () => {
    release();
    view = { scale: 1, x: 0, y: 0 };
    emit();
  };
  const keydown = (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (!["+", "=", "-", "_", "0"].includes(event.key)) return;
    stop(event);
    onGesture();
    if (event.key === "0") return reset();
    view = zoomAt(view, view.scale * (["-", "_"].includes(event.key) ? 1 / 1.2 : 1.2), center);
    emit();
  };
  const wheel = (event) => {
    if (!event.ctrlKey) return;
    stop(event);
    onGesture();
    view = zoomAt(view, view.scale * Math.exp(clamp(-event.deltaY * 0.01, -5, 5)), anchorAt(event));
    emit();
  };
  // Desktop Safari supplies GestureEvent for trackpad pinch. Touch screens
  // already use the pointer pair above, so never process both paths for a pinch.
  const gestureStart = (event) => {
    if (navigator.maxTouchPoints > 0) return;
    stop(event);
    onGesture();
    trackpadGesture = { view: { ...view }, anchor: anchorAt(event) };
  };
  const gestureChange = (event) => {
    if (!trackpadGesture) return;
    stop(event);
    view = zoomAt(
      trackpadGesture.view,
      trackpadGesture.view.scale * event.scale,
      anchorAt(event),
      trackpadGesture.anchor,
    );
    emit(true);
  };
  const gestureEnd = (event) => {
    if (!trackpadGesture) return;
    stop(event);
    trackpadGesture = null;
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
  window.addEventListener("keydown", keydown, true);
  window.addEventListener("wheel", wheel, { capture: true, passive: false });
  window.addEventListener("gesturestart", gestureStart, { capture: true, passive: false });
  window.addEventListener("gesturechange", gestureChange, { capture: true, passive: false });
  window.addEventListener("gestureend", gestureEnd, { capture: true, passive: false });
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);
  return {
    reset,
    destroy() {
      release();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("gesturestart", gestureStart, true);
      window.removeEventListener("gesturechange", gestureChange, true);
      window.removeEventListener("gestureend", gestureEnd, true);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
