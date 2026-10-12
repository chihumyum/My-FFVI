/** Source-material raster kernel for already-projected particle billboards.
 * This does not emit particles, choose Unity camera/transform state, or grant
 * the Noise/RNG/prewarm provider. A caller must supply those dependencies.
 * All work targets a private RGBA8 buffer; no shared Canvas is touched. */
export function prepareFieldParticleFrame(input, kernel) {
  if (!kernel || typeof kernel.shadeFieldParticle !== "function" || typeof kernel.sampleFieldParticleTexture !== "function")
    throw new Error("Source particle shader kernel is unavailable");
  const { width, height, material, textures, particles, engineSeconds, elapsedSeconds, depth, rgba } = input;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 4194304 ||
      !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4 ||
      !(depth instanceof Float32Array) || depth.length !== width * height || !Array.isArray(particles) ||
      ![engineSeconds, elapsedSeconds].every(Number.isFinite)) throw new Error("Unbound particle render target");
  if (!material || material.kind !== "field-particle-material-v1" || material.colorSpace !== "gamma" || material.blend.source !== 1 || material.blend.destination !== 10 ||
      material.blend.depthWrite !== false || material.blend.depthTest !== 4 || material.blend.colorMask !== 15 || material.blend.cull !== 0)
    throw new Error("Unknown particle material blend/depth state");
  for (const value of depth) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Invalid particle depth attachment");
  for (const key of Object.values(material.textures)) {
    const texture = textures.get(key); if (!texture) throw new Error("Missing source particle texture " + key);
    kernel.sampleFieldParticleTexture(texture, 0.5, 0.5); // Validate every required attachment before any fragment.
  }
  const ids = new Set();
  for (const p of particles) {
    if (typeof p.id !== "string" || !p.id || ids.has(p.id)) throw new Error("Duplicate/missing particle identity");
    ids.add(p.id);
    if (![p.x, p.y, p.z, p.width, p.height, p.rotation, p.color?.r, p.color?.g, p.color?.b, p.color?.a].every(Number.isFinite) ||
        p.z < 0 || p.z > 1 || p.width < 0 || p.height < 0) throw new Error("Invalid particle billboard projection");
  }
  const output = new Uint8ClampedArray(rgba), sample = (key, u, v) => kernel.sampleFieldParticleTexture(textures.get(key), u, v);
  let samples = 0, discarded = 0, depthRejected = 0, written = 0;
  for (const p of particles) {
    if (p.width === 0 || p.height === 0) continue;
    const cs = Math.cos(p.rotation), sn = Math.sin(p.rotation);
    const halfX = (Math.abs(cs) * p.width + Math.abs(sn) * p.height) / 2;
    const halfY = (Math.abs(sn) * p.width + Math.abs(cs) * p.height) / 2;
    const left = Math.max(0, Math.ceil(p.x - halfX - 0.5)), right = Math.min(width - 1, Math.floor(p.x + halfX - 0.5));
    const top = Math.max(0, Math.ceil(p.y - halfY - 0.5)), bottom = Math.min(height - 1, Math.floor(p.y + halfY - 0.5));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y;
      const u = (cs * dx + sn * dy) / p.width + 0.5, v = 0.5 - (-sn * dx + cs * dy) / p.height;
      // A controlled pixel-center coverage rule. Exact D3D top-left triangle
      // rasterization remains a separate renderer acceptance lane.
      if (u < 0 || u >= 1 || v <= 0 || v > 1) continue;
      const pixel = y * width + x;
      if (p.z > depth[pixel]) { depthRejected++; continue; }
      samples++;
      const source = kernel.shadeFieldParticle(material, { uv: [u, v], color: p.color, engineSeconds, elapsedSeconds }, sample);
      if (source === null) { discarded++; continue; }
      if (![source.r, source.g, source.b, source.a].every(Number.isFinite)) throw new Error("Nonfinite particle fragment");
      if (source.a < 0 || source.a > 1) throw new Error("Particle raster alpha outside the admitted normalized range");
      const i = pixel * 4, channels = [source.r, source.g, source.b, source.a];
      for (let c = 0; c < 4; c++) output[i + c] = Math.round(Math.max(0, Math.min(1, channels[c] + output[i + c] / 255 * (1 - source.a))) * 255);
      written++;
    }
  }
  return { width, height, rowOrder: "top-to-bottom", alpha: "premultiplied", samples, discarded, depthRejected, written,
    pixels() { return output.slice(); },
    /** Canvas ImageData expects straight RGB. Conversion is presentation only;
     * the prepared premultiplied render target above remains unchanged. */
    present(context) {
      const image = context.createImageData(width, height);
      for (let i = 0; i < output.length; i += 4) {
        const a = output[i + 3]; image.data[i + 3] = a;
        for (let c = 0; c < 3; c++) image.data[i + c] = a ? Math.round(Math.min(255, output[i + c] * 255 / a)) : 0;
      }
      context.putImageData(image, 0, 0);
    },
  };
}
