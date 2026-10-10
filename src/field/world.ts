import type { Character, Evidence, FieldContent, Op } from "./types.js";
import type { ScriptLocals } from "../core/event-state.js";

export type ContentIssue = { reason: string; source: Evidence };
export type WorldMapContent = {
  formatVersion: 1;
  kind: "world-map-development";
  sourceSetHash: string;
  parentSourceSetHash: string;
  mediaSourceSetHash: string;
  contentHash: string;
  mapId: number;
  areaId: number;
  name: string;
  map: FieldContent["map"] | null;
  scripts: Record<string, Op[]>;
  scriptLocals: Record<string, ScriptLocals | null>;
  initializer: string | null;
  characterAssets: string[];
  blockers: ContentIssue[];
  limitations: string[];
};
export type WorldCatalog = {
  formatVersion: 1;
  kind: "world-development";
  sourceSetHash: string;
  parentSourceSetHash: string;
  mediaSourceSetHash: string;
  contentHash: string;
  characters: Record<string, Character>;
  minimap?: FieldContent["minimap"];
  bgm?: FieldContent["bgm"];
  environment?: FieldContent["environment"];
  characterIssues: Record<string, ContentIssue[]>;
  maps: Record<
    string,
    {
      url: string;
      contentHash: string;
      name: string;
      areaId: number;
      geometryReady: boolean;
      defaultGroupReady: boolean;
      blockers: ContentIssue[];
    }
  >;
  limitations: string[];
};
