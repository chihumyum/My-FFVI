/** Explicit opt-in evidence. It never grants script entry, readiness or gameplay authority. */
export const WEB_SOURCE_STORY_EXECUTION = "source-story-execution-evidence-v1" as const;
export type FieldStoryExecutionEvent = {
  kind: "root-enter" | "branch" | "natural-finish" | "map-handoff" | "battle-handoff";
  taskId: number; rootScript: string; script: string; pc: number; nextPc: number | null;
  slot: number | null; atMilliseconds: number; currentField: null;
  site: { kind: string; index: number; source: unknown } | null;
};
