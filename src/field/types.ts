/** Browser-safe field content: no Unity readers or renderer dependencies in the runtime. */
export type Point = { x: number; y: number };
export type Direction = "up" | "right" | "down" | "left";
export type Evidence = {
  file: string;
  assetPath: string;
  objectId?: string | undefined;
  pointer?: string;
};
export type FieldEntity = Point & {
  id: string;
  layer: number;
  kind: number;
  width: number;
  height: number;
  asset: string | null;
  direction: Direction;
  script: string | null;
  collision: number | null;
  destinationLayer: number | null;
  source: Evidence;
};
export type Sprite = {
  file: string;
  width: number;
  height: number;
  pivot: number[];
  sha256: string;
  source: Evidence;
};
export type Frame = {
  sprite: string;
  x: number;
  y: number;
  flip: boolean;
  alpha: number;
};
export type Animation = {
  frames: Frame[];
  duration: number;
  mode: number;
  flip: boolean;
  next: string;
};
export type Character = {
  sprites: Record<string, Sprite>;
  animations: Record<string, Animation>;
  source: Evidence;
};
export type Site = { script: string; index: number; source: Evidence };
export type Op = Site &
  (
    | { kind: "nop" | "exit" | "return" | "join" | "hide" }
    | { kind: "set-flag"; namespace: string; flag: number }
    | { kind: "fade-in"; seconds: number }
    | { kind: "call"; target: number }
    | { kind: "wait"; seconds: number }
    | { kind: "puppet"; slot: number; actor: string; target: number }
    | { kind: "position"; x: number; y: number; animation: string }
    | {
        kind: "move";
        direction: Direction;
        steps: number;
        secondsPerCell: number;
      }
    | { kind: "look"; direction: Direction }
    | { kind: "message"; key: string; text: string; speaker: string }
    | { kind: "encounter"; party: number; continuation: string }
    | { kind: "blocked"; mnemonic: string; reason: string }
  );
export type TileLayer = {
  name: string;
  width: number;
  height: number;
  data: number[];
  opacity: number;
};
export type Tileset = {
  firstgid: number;
  columns: number;
  tilewidth: number;
  tileheight: number;
  image: string;
  spacing?: number;
  margin?: number;
  tiles?: { id: number; animation?: { tileid: number; duration: number }[] }[];
};
export type FieldContent = {
  formatVersion: 1;
  kind: "field-development";
  sourceSetHash: string;
  parentSourceSetHash: string;
  contentHash: string;
  map: {
    id: string;
    width: number;
    height: number;
    tileSize: number;
    layers: TileLayer[];
    tilesets: Tileset[];
    textures: Record<string, string>;
    collisions: Record<string, number[]>;
    entities: FieldEntity[];
    source: Evidence;
  };
  characters: Record<string, Character>;
  scripts: Record<string, Op[]>;
  entry: {
    player: Point & {
      direction: Direction;
      layer: number;
      asset: string;
      mount: string;
    };
    evidence: Evidence[];
    description: string;
  };
  limitations: string[];
};
