/** FieldGame owns pending questions and the selection register. This view owns
 * only keyboard focus; a retained DOM callback never answers a newer question. */
export class ChoiceView {
  constructor(root, onChange = () => {}) {
    this.root = root;
    this.onChange = onChange;
    this.reset();
  }
  reset() {
    this.flow = null;
    this.session = null;
    this.request = null;
    this.selected = 0;
    this.disabled = true;
    this.buttons = [];
    this.root.hidden = true;
    this.root.replaceChildren();
  }
  render(flow, { disabled = false } = {}) {
    const request = flow.session.field.choice;
    const visible = !!request && flow.started && !flow.paused && !flow.session.battle && !flow.session.field.stop;
    const fresh = this.session !== flow.session || this.request?.id !== request?.id;
    const wasHidden = this.root.hidden;
    this.flow = flow;
    this.session = flow.session;
    this.request = request;
    this.disabled = disabled || !flow.inputReady || !visible;
    this.root.hidden = !visible;
    if (!request) {
      this.buttons = [];
      this.root.replaceChildren();
      return;
    }
    if (fresh) {
      this.selected = request.initialIndex;
      this.root.dataset.anchor = request.anchor;
      this.root.replaceChildren();
      const heading = document.createElement("p");
      heading.textContent = "请选择";
      this.root.append(heading);
      const session = flow.session;
      this.buttons = request.options.map((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = option.text;
        button.dataset.choiceIndex = String(index);
        button.onclick = () => this.answer(flow, session, request.id, index);
        button.onfocus = () => {
          if (this.session !== session || this.request?.id !== request.id) return;
          this.selected = index;
          this.updateButtons();
        };
        this.root.append(button);
        return button;
      });
    }
    this.updateButtons();
    if (visible && !this.disabled && (fresh || wasHidden)) this.buttons[this.selected]?.focus();
  }
  updateButtons() {
    this.buttons.forEach((button, index) => {
      button.disabled = this.disabled;
      button.tabIndex = index === this.selected ? 0 : -1;
      button.setAttribute("aria-current", String(index === this.selected));
    });
  }
  answer(flow, session, requestId, answer) {
    if (this.disabled || this.root.hidden || document.hidden || this.flow !== flow ||
        this.session !== session || flow.session !== session || this.request?.id !== requestId ||
        !flow.inputReady || session.field.choice?.id !== requestId) return false;
    if (!flow.choose(requestId, answer)) return false;
    this.render(flow);
    this.onChange();
    return true;
  }
  keyboard(event) {
    if (this.disabled || this.root.hidden || !this.request) return false;
    if (!["ArrowUp", "ArrowDown", "KeyW", "KeyS", "Enter", "Space"].includes(event.code)) return false;
    event.preventDefault();
    if (event.repeat) return true;
    if (["Enter", "Space"].includes(event.code))
      this.answer(this.flow, this.session, this.request.id, this.selected);
    else {
      const step = ["ArrowUp", "KeyW"].includes(event.code) ? -1 : 1;
      this.selected = (this.selected + step + this.buttons.length) % this.buttons.length;
      this.updateButtons();
      this.buttons[this.selected]?.focus();
    }
    return true;
  }
}
