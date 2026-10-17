/** Source control operations; browser mixer curves use an explicit Web policy. */
export type FieldBgmControlOp =
  | { kind: "bgm-pause"; channel: number; paused: boolean; fade: number; policy: "web-static-audio-control-v1" }
  | { kind: "bgm-replay"; channel: 0; fade: number; policy: "web-static-audio-control-v1" };
