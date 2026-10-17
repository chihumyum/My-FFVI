// One pointer/focus highlight survives at a time; late leave events cannot clear
// the new owner after a window has been hidden or its controls have moved.
export class SingleHover {
  constructor(changed = () => {}) {
    this.changed = changed;
    this.current = null;
  }
  enter(view) {
    if (view === this.current) return;
    if (this.current) this.current.hover = false;
    this.current = view;
    if (view) view.hover = true;
    this.changed();
  }
  leave(view) {
    if (view === this.current) this.enter(null);
  }
  clear() {
    if (this.current) this.enter(null);
  }
}
