/** SE uses dynamic play handles. Slots refer to the current ScriptLocalVariable
 * bank, not static audio channels; unknown/uninitialized banks stay unknown. */
export type FieldSoundCommand =
  | {
      kind: "play";
      soundId: number;
      asynchronous: boolean;
      /** Only an asynchronous request publishes its handle here. */
      handleSlot: number | null;
      fadeSeconds: number;
      seekSeconds: number;
      pan: number;
    }
  | { kind: "stop"; handleSlot: number; fadeSeconds: number }
  | { kind: "sync"; handleSlot: number }
  | { kind: "ready"; soundId: number };

export type FieldSoundOp = { kind: "field-sound"; command: FieldSoundCommand };
