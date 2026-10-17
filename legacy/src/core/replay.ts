/** A reconstruction-owned deterministic harness. It does not implement FFVI timing semantics. */
export type CoreState = { tick: number; flags: Record<string, boolean>; pending: Record<string, { scope: string; completed: boolean }> };
export type Input =
  | { type: "advance"; ticks: number }
  | { type: "setFlag"; key: string; value: boolean }
  | { type: "beginEffect"; id: string; scope: string }
  | { type: "completeEffect"; id: string; scope: string }
  | { type: "cancelScope"; scope: string };
export const initialState = (): CoreState => ({ tick: 0, flags: {}, pending: {} });
export function step(state: CoreState, input: Input): CoreState {
  const next = structuredClone(state);
  switch (input.type) {
    case "advance":
      if (!Number.isSafeInteger(input.ticks) || input.ticks < 0 || !Number.isSafeInteger(next.tick + input.ticks)) throw new Error("Invalid logical time");
      next.tick += input.ticks; break;
    case "setFlag": Object.defineProperty(next.flags, input.key, { value: input.value, writable: true, enumerable: true, configurable: true }); break;
    case "beginEffect":
      if (Object.hasOwn(next.pending, input.id)) throw new Error("Duplicate effect identity");
      Object.defineProperty(next.pending, input.id, { value: { scope: input.scope, completed: false }, writable: true, enumerable: true, configurable: true }); break;
    case "completeEffect": {
      const effect = Object.hasOwn(next.pending, input.id) ? next.pending[input.id] : undefined;
      if (!effect || effect.scope !== input.scope) throw new Error("Stale or unknown effect completion");
      if (effect.completed) throw new Error("Effect completed twice");
      effect.completed = true; break;
    }
    case "cancelScope": for (const [id, effect] of Object.entries(next.pending)) if (effect.scope === input.scope) delete next.pending[id]; break;
  }
  return next;
}
export function replay(inputs: Input[], state = initialState()): CoreState { return inputs.reduce(step, state); }
