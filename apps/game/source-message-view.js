const fieldOwners = new WeakMap();
/** One detached projection of the existing message owner. Long explicit source
 * pages wrap and scroll in the existing dialogue panel; no visual page is
 * injected into the interpreter and no source text is clipped or shortened. */
export function fieldMessageView(game) {
  const ordinary = game.messageWindow;
  if (ordinary) return { key: ordinary.key, speaker: ordinary.speaker, text: ordinary.text,
    alignment: ordinary.alignment ?? "left", window: ordinary.manual?.window ?? "frame",
    anchor: ordinary.manual?.anchor ?? "bottom", protocol: "ordinary", page: ordinary.manual?.page ?? 0,
    acceptsInput: true };
  const value = game.sourceMessage?.projection;
  return value?.documentKind === "source-message-sequence-v1" ? { key: value.key, speaker: value.speaker,
    text: value.text, alignment: value.alignment, window: value.window, anchor: value.anchor,
    protocol: value.documentKind, page: value.page, windowTicket: value.windowTicket, acceptsInput: value.acceptsInput,
    sourceWindow: game.messagePresentation?.sourceWindow ?? null, speakerAnchor: game.messagePresentation?.speakerAnchor ?? "left" } : null;
}
export function syncFieldMessageView(elements, game, paused) {
  const value = fieldMessageView(game), { dialogue, speaker, message, next } = elements;
  dialogue.hidden = !value || paused;
  next.hidden = game.choicePending || !!value && !value.acceptsInput;
  if (!value) return;
  const page = JSON.stringify([value.protocol, value.key, value.windowTicket ?? null, value.page]);
  if (fieldOwners.get(message) !== game || message.dataset.sourcePage !== page) { message.scrollTop = 0; speaker.scrollTop = 0; }
  // Setting textContent only when it changes preserves selection and scrolling
  // through repeated render syncs on the same held page.
  if (speaker.textContent !== value.speaker) speaker.textContent = value.speaker;
  if (message.textContent !== value.text) message.textContent = value.text;
  fieldOwners.set(message, game);
  message.dataset.sourcePage = page;
  message.style.textAlign = value.alignment;
  message.tabIndex = value.protocol === "source-message-sequence-v1" ? 0 : -1;
  dialogue.dataset.protocol = value.protocol;
  dialogue.dataset.window = value.window;
  dialogue.dataset.anchor = value.anchor;
  dialogue.dataset.sourceWindow = value.sourceWindow === null || value.sourceWindow === undefined ? "field" : String(value.sourceWindow);
  dialogue.dataset.speakerAnchor = value.speakerAnchor ?? "left";
  speaker.style.textAlign = value.speakerAnchor === "right" ? "right" : "left";
}
