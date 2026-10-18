// Looking up a texture and drawing it are different lifetimes. Cached UI,
// particle sprites and filter samplers can keep a page without another lookup.
export function sceneTextureBindings(root, { visibleOnly = false } = {}) {
  const bindings = [];
  const shader = (value, label) => {
    for (const [name, resource] of Object.entries(value?.resources || {})) {
      const source = resource?.source;
      if (!source) continue;
      bindings.push({
        source,
        label: `${label}:${name}`,
        replace: (texture) => {
          value.resources[name] = resource === source ? texture.source : texture;
        },
      });
    }
  };
  const visit = (node) => {
    if (!node || (visibleOnly && (node.visible === false || node.renderable === false))) return;
    const label = node.label || node.constructor?.name || "display-object";
    if (node.texture?.source)
      bindings.push({
        source: node.texture.source,
        label,
        replace: (texture) => {
          node.texture = texture;
        },
      });
    for (const filter of node.filters || [])
      if (!visibleOnly || filter.enabled !== false) shader(filter, label);
    shader(node.shader, label);
    for (const child of node.children || []) visit(child);
    for (const particle of node.particleChildren || []) visit(particle);
  };
  visit(root);
  return bindings;
}

export function detachTextureSource(root, source, replacement) {
  let detached = 0;
  for (const binding of sceneTextureBindings(root))
    if (binding.source === source) {
      binding.replace(replacement);
      detached++;
    }
  return detached;
}
