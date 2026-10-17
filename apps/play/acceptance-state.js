// Diagnostic still frames, distinct from playable saves. Preserve VM cursors,
// actor identity, cycles and battle state without executing a getter or input.
export function encodeAcceptanceState(value, externalValues = {}) {
  const external = new Map(Object.entries(externalValues).map(([key, item]) => [item, key]));
  const seen = new Map(),
    nodes = [];
  function encode(item) {
    if (item === undefined) return { special: "undefined" };
    if (typeof item === "number" && !Number.isFinite(item)) return { number: String(item) };
    if (item === null || typeof item !== "object")
      return typeof item === "function" ? { special: "undefined" } : item;
    if (external.has(item)) return { external: external.get(item) };
    if (seen.has(item)) return { ref: seen.get(item) };
    const id = nodes.length;
    seen.set(item, id);
    const node = {
      type:
        item instanceof Map
          ? "Map"
          : item instanceof Set
            ? "Set"
            : Array.isArray(item)
              ? "Array"
              : "Object",
    };
    nodes.push(node);
    if (item instanceof Map) node.values = [...item].map(([k, v]) => [encode(k), encode(v)]);
    else if (item instanceof Set || Array.isArray(item)) node.values = [...item].map(encode);
    else {
      if (item.constructor?.name === "Battle") node.type = "Battle";
      node.values = [];
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
        if (typeof descriptor.value === "function" || descriptor.value instanceof Promise) continue;
        node.values.push([key, encode(descriptor.value)]);
      }
    }
    return { ref: id };
  }
  const root = encode(value);
  return { schema: "ffvi-frozen-frame", version: 1, root, nodes };
}

export function decodeAcceptanceState(graph, externalValues = {}, prototypes = {}) {
  if (graph.schema !== "ffvi-frozen-frame" || graph.version !== 1)
    throw Error("Unsupported diagnostic checkpoint");
  const objects = graph.nodes.map((node) =>
    node.type === "Map"
      ? new Map()
      : node.type === "Set"
        ? new Set()
        : node.type === "Array"
          ? []
          : Object.create(prototypes[node.type] || Object.prototype),
  );
  function decode(item) {
    if (!item || typeof item !== "object") return item;
    if (Object.hasOwn(item, "ref")) return objects[item.ref];
    if (Object.hasOwn(item, "external")) {
      if (!Object.hasOwn(externalValues, item.external))
        throw Error(`Missing checkpoint source ${item.external}`);
      return externalValues[item.external];
    }
    if (item.special === "undefined") return undefined;
    if (item.number) return Number(item.number);
    throw Error("Invalid diagnostic reference");
  }
  graph.nodes.forEach((node, id) => {
    const object = objects[id];
    if (node.type === "Map") for (const [k, v] of node.values) object.set(decode(k), decode(v));
    else if (node.type === "Set") for (const value of node.values) object.add(decode(value));
    else if (node.type === "Array") object.push(...node.values.map(decode));
    else
      for (const [key, value] of node.values)
        Object.defineProperty(object, key, {
          value: decode(value),
          enumerable: true,
          configurable: true,
          writable: true,
        });
  });
  return decode(graph.root);
}
