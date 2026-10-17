/** Source interpreter requests, not proof that a field host can execute them.
 * Logical transportation identity and a particular actor's riding state are
 * separate owners. Entity selectors are resolved by the existing field port. */
export type FieldTransportationCommand =
  | { kind: "lose"; transportationId: number }
  | { kind: "set-position"; transportationId: number }
  | { kind: "active"; transportationId?: never; active: boolean }
  | {
      kind: "place";
      transportationId: number;
      stayMapId: number;
      /** Native Vector2 map coordinates, after int32 -> float32 conversion. */
      position: { x: number; y: number };
      /** Operand zero reads the actual player's current Unity GameObject layer;
       * it is not a nullable/default logical map layer. */
      layer: { kind: "player" } | { kind: "unity"; value: 9 | 10 | 11 | 12 };
      direction: 1 | 2 | 4 | 8;
    }
  | {
      kind: "change";
      transportationId: number;
      changeCollisionEnable: true;
      isBackground: boolean;
      viewType: 0 | 1;
    }
  | {
      kind: "ride-npc";
      /** ID 1 dispatches RideOutTransportation; other IDs dispatch RideOn.
       * Neither path changes the player's current transportation identity. */
      transportationId: number;
      actorSelector: number;
    };

/** All decoded source wrappers return Next after their accessor call. The host
 * must prepare the complete operation before advancing the interpreter. */
export type FieldTransportationOp = {
  kind: "field-transportation";
  command: FieldTransportationCommand;
};
