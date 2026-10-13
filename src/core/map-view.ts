/** Last.Map.ViewType. World-map identity is a separate MapModel/area fact;
 * neither a loop flag nor a requested bird view establishes that identity. */
export type MapViewType = 0 | 1 | 2;
export type MapEntryViewInput = {
  mapId: number;
  /** Bound by the content compiler to the source MapModel world predicate. */
  isWorld: boolean | null;
  requestedViewType: MapViewType;
  loopType: 0 | 1 | 2 | 3;
};
/** Explicit Web presentation policy. It admits flat world travel without
 * claiming native Bird/FlatBird rendering or changing the source request. */
export type FrameworkWorldMapPresentation = "framework-world-map-flat-v1";
export type MapEntryViewPlan = {
  kind: "map-entry-view-v1";
  mapId: number;
  isWorld: boolean;
  requestedViewType: MapViewType;
  /** MapViewSetup source choice, before transportation-specific view overrides. */
  mapViewType: MapViewType;
  /** View supported by the explicitly selected host presentation. */
  presentationViewType: MapViewType;
  loopType: 0 | 1 | 2 | 3;
  loop: { horizontal: boolean; vertical: boolean };
  presentationPolicy: FrameworkWorldMapPresentation | null;
};

function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid map entry view record");
  const descriptors = Object.getOwnPropertyDescriptors(raw), own = Reflect.ownKeys(raw);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable))
    throw new Error("Invalid map entry view fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function integer(raw: unknown, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || Object.is(raw, -0) || raw < min || raw > max)
    throw new Error("Invalid map entry view integer");
  return raw;
}

/** MapViewSetup uses LoadData.Type only on a world map. Unknown world
 * applicability fails rather than becoming a normal/sub-map default. */
export function projectMapEntryView(input: MapEntryViewInput,
  presentationPolicy?: FrameworkWorldMapPresentation): MapEntryViewPlan {
  const data = record(input, ["mapId", "isWorld", "requestedViewType", "loopType"]);
  const mapId = integer(data.mapId, 1, 0x7fffffff);
  if (typeof data.isWorld !== "boolean") throw new Error("Unknown map world applicability");
  const requestedViewType = integer(data.requestedViewType, 0, 2) as MapViewType;
  const loopType = integer(data.loopType, 0, 3) as MapEntryViewPlan["loopType"];
  if (presentationPolicy !== undefined && (presentationPolicy !== "framework-world-map-flat-v1" || !data.isWorld))
    throw new Error("Unadmitted framework world-map presentation");
  const mapViewType = data.isWorld ? requestedViewType : 0;
  return { kind: "map-entry-view-v1", mapId, isWorld: data.isWorld, requestedViewType, mapViewType,
    presentationViewType: presentationPolicy === undefined ? mapViewType : 0, loopType,
    loop: { horizontal: (loopType & 1) !== 0, vertical: (loopType & 2) !== 0 },
    presentationPolicy: presentationPolicy ?? null };
}

/** View plans remain plain immutable-input projections. A loaded checkpoint
 * cannot change the source request, loop axes or presentation by forging a
 * derived field; the owner must additionally bind this to trusted map content. */
export function parseMapEntryViewPlan(raw: unknown): MapEntryViewPlan {
  const data = record(raw, ["kind", "mapId", "isWorld", "requestedViewType", "mapViewType",
    "presentationViewType", "loopType", "loop", "presentationPolicy"]);
  if (data.kind !== "map-entry-view-v1") throw new Error("Unknown map entry view kind");
  const loop = record(data.loop, ["horizontal", "vertical"]);
  if (typeof loop.horizontal !== "boolean" || typeof loop.vertical !== "boolean")
    throw new Error("Unknown map entry view loop axes");
  if (data.presentationPolicy !== null && data.presentationPolicy !== "framework-world-map-flat-v1")
    throw new Error("Unadmitted framework world-map presentation");
  const expected = projectMapEntryView({ mapId: integer(data.mapId, 1, 0x7fffffff),
    isWorld: data.isWorld as boolean | null,
    requestedViewType: integer(data.requestedViewType, 0, 2) as MapViewType,
    loopType: integer(data.loopType, 0, 3) as MapEntryViewPlan["loopType"] },
  data.presentationPolicy === null ? undefined : data.presentationPolicy);
  if (data.mapViewType !== expected.mapViewType || data.presentationViewType !== expected.presentationViewType ||
      loop.horizontal !== expected.loop.horizontal || loop.vertical !== expected.loop.vertical)
    throw new Error("Map entry view projection mismatch");
  return expected;
}

export function assertMapEntryViewBinding(plan: MapEntryViewPlan,
  binding: { mapId: number; loopType: number; presentationViewType: number }): MapEntryViewPlan {
  const candidate = parseMapEntryViewPlan(plan);
  if (candidate.mapId !== binding.mapId || candidate.loopType !== binding.loopType ||
      candidate.presentationViewType !== binding.presentationViewType)
    throw new Error("Map entry view binding mismatch");
  return candidate;
}
