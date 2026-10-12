/** A render-texture board adapter, not a particle simulator. Every board needs
 * an explicitly prepared material/depth implementation. The ordinary game
 * renderer must not replace that provider with unconditional source-over. */
export function prepareFieldEffectBoards({ boards, frames, project, prepareMaterial }) {
  if (!Array.isArray(boards) || typeof project !== "function" || typeof prepareMaterial !== "function")
    throw new Error("Field effect projection/material/depth host is unavailable");
  if (new Set(boards.map((board) => board.id)).size !== boards.length)
    throw new Error("Duplicate field effect board render identity");
  const batches = [];
  for (const board of boards) {
    if (!board.activeSelf) continue;
    const frame = frames.get(board.cameraId);
    if (!frame || !frame.image || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
        frame.width <= 0 || frame.height <= 0 || frame.rowOrder !== "top-to-bottom")
      throw new Error("Missing field effect render texture: " + board.cameraId);
    if (frame.image.width !== frame.width || frame.image.height !== frame.height)
      throw new Error("Field effect render texture dimensions changed");
    const { mesh } = board;
    if (!mesh || mesh.vertices.length !== mesh.uv.length || mesh.vertices.length % 4 !== 0 ||
        mesh.triangles.length !== mesh.vertices.length / 4 * 6 || board.currentFadeStatus !== 0 ||
        !Number.isFinite(board.fadeAlpha) || board.fadeAlpha < 0 || board.fadeAlpha > 1)
      throw new Error("Invalid effect board projection");
    const quads = [];
    for (let index = 0; index < mesh.vertices.length; index += 4) {
      const expected = [index, index + 1, index + 2, index + 2, index + 1, index + 3];
      if (expected.some((value, offset) => mesh.triangles[index / 4 * 6 + offset] !== value))
        throw new Error("Unknown effect board topology");
      const vertices = mesh.vertices.slice(index, index + 4).map((vertex) => {
        const p = project({ x: board.position.x + vertex.x, y: board.position.y + vertex.y,
          z: board.position.z + vertex.z });
        if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) throw new Error("Invalid effect vertex projection");
        return { x: p.x, y: p.y, z: p.z };
      });
      const uv = mesh.uv.slice(index, index + 4).map((value) => {
        if (!value || ![value.x, value.y].every(Number.isFinite)) throw new Error("Invalid effect texture coordinate");
        return { x: value.x, y: value.y };
      });
      quads.push({ vertices, uv, alpha: board.fadeAlpha });
    }
    const material = prepareMaterial({ boardId: board.id, cameraId: board.cameraId,
      renderQueue: mesh.renderQueue, affectedMode: mesh.affectedMode, zTest: mesh.zTest, blendType: mesh.blendType });
    if (!material || typeof material.drawQuad !== "function") throw new Error("Unprepared field effect material");
    batches.push({ frame: { ...frame }, material, quads });
  }
  return {
    boardCount: batches.length,
    draw(context) {
      // All lookups, projections and material admission happen during prepare.
      // Order is supplied by the source-aware scene renderer, not sorted by ID.
      for (const batch of batches) for (const quad of batch.quads)
        batch.material.drawQuad(context, batch.frame, quad);
    },
  };
}

/** Controlled orthographic drawing primitive for a material host that has
 * separately established its compositing and depth policy. This is never the
 * default implementation of Unity's source board/particle shaders. */
export function drawAxisAlignedEffectQuad(context, frame, quad) {
  const [a, b, c, d] = quad.vertices, [u0, u1, u2, u3] = quad.uv;
  if (a.y !== b.y || c.y !== d.y || a.x !== c.x || b.x !== d.x || a.z !== b.z || a.z !== c.z || a.z !== d.z ||
      u0.y !== u1.y || u2.y !== u3.y || u0.x !== u2.x || u1.x !== u3.x)
    throw new Error("Effect quad is not axis aligned");
  const source = { x: u0.x * frame.width, y: (1 - u0.y) * frame.height,
    width: (u1.x - u0.x) * frame.width, height: (u0.y - u2.y) * frame.height };
  // Zero-area source strips are native mesh entries but rasterize no pixels.
  if (source.width === 0 || source.height === 0 || a.x === b.x || a.y === c.y) return;
  context.save();
  try {
    context.imageSmoothingEnabled = false; context.globalAlpha *= quad.alpha;
    context.drawImage(frame.image, source.x, source.y, source.width, source.height,
      a.x, a.y, b.x - a.x, c.y - a.y);
  } finally { context.restore(); }
}

/** Source board material preparation for the ordinary CPU compositor. The
 * frame and renderer order are explicit providers: graph parsing does not
 * manufacture either. In particular this never invokes the Canvas adapter. */
export function prepareSourceFieldEffectBoards({ boards, frames, boardOrder, material, camera, width, height }, kernel) {
  if (!kernel || typeof kernel.validateFieldEffectBoardMaterial !== "function") throw new Error("Missing source effect material kernel");
  kernel.validateFieldEffectBoardMaterial(material);
  if (!Array.isArray(boards) || !(frames instanceof Map) || !Array.isArray(boardOrder) ||
      !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      !camera || ![camera.x, camera.y].every(Number.isFinite) || width !== 320 || height !== 180)
    throw new Error("Source field effect camera/frame/order provider is unavailable");
  const active = boards.filter((b) => b.activeSelf), byId = new Map(active.map((b) => [b.id, b]));
  if (new Set(boards.map((b) => b.id)).size !== boards.length || byId.size !== boardOrder.length ||
      new Set(boardOrder).size !== boardOrder.length || boardOrder.some((id) => !byId.has(id)))
    throw new Error("Source field effect draw order is not a complete active-board permutation");
  const batches = [], copied = new Map();
  for (const id of boardOrder) {
    const board = byId.get(id), d = board.definition, mesh = board.mesh, frame = frames.get(board.cameraId);
    if (!d || d.kind !== "source-field-effect-board-v1" || d.building || d.collision || d.birdviewPuppet || d.screen || d.visibleMinimap ||
        board.currentFadeStatus !== 0 || !Number.isFinite(board.fadeAlpha) || board.fadeAlpha < 0 || board.fadeAlpha > 1)
      throw new Error("Unrecovered source effect board host branch");
    if (!frame || frame.kind !== "field-effect-sampled-rt-v1" || frame.assetGroup !== d.assetGroup || frame.cameraId !== board.cameraId ||
        frame.sampleEncoding !== "rgba8-unorm" || frame.rowOrder !== "top-to-bottom" ||
        !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.width !== frame.height ||
        !(frame.data instanceof Uint8ClampedArray) || frame.data.length !== frame.width * frame.height * 4)
      throw new Error("Missing qualified source particle render texture: " + board.cameraId);
    if (!copied.has(board.cameraId)) copied.set(board.cameraId, { width: frame.width, height: frame.height, data: frame.data.slice() });
    const queue = d.front ? d.affected ? 2458 : 2460 : 2453;
    if (!mesh || mesh.renderQueue !== queue || mesh.affectedMode !== (d.affected ? 0 : 2) || mesh.blendType !== d.blendType ||
        mesh.zTest !== d.zTest || ![0, 1, 2].includes(d.blendType) || ![4, 8].includes(d.zTest) ||
        !Array.isArray(mesh.vertices) || mesh.vertices.length !== mesh.uv?.length || mesh.vertices.length % 4 !== 0 ||
        mesh.triangles?.length !== mesh.vertices.length / 4 * 6)
      throw new Error("Invalid source board mesh/material binding");
    const quads = [];
    for (let i = 0; i < mesh.vertices.length; i += 4) {
      if ([i, i + 1, i + 2, i + 2, i + 1, i + 3].some((v, j) => mesh.triangles[i / 4 * 6 + j] !== v))
        throw new Error("Unrecovered source effect triangle topology");
      const vertices = mesh.vertices.slice(i, i + 4).map((v) => ({
        x: Math.fround(Math.fround(board.position.x + v.x) - camera.x) + width / 2,
        y: height / 2 - Math.fround(Math.fround(board.position.y + v.y) - camera.y),
        z: Math.fround(board.position.z + v.z),
      }));
      if (vertices.some((v) => ![v.x, v.y, v.z].every(Number.isFinite))) throw new Error("Invalid source board vertex");
      const [a, b, c, e] = vertices, [u0, u1, u2, u3] = mesh.uv.slice(i, i + 4);
      if (!u0 || !u1 || !u2 || !u3 || [u0, u1, u2, u3].some((v) => ![v.x, v.y].every(Number.isFinite)) ||
          a.y !== b.y || c.y !== e.y || a.x !== c.x || b.x !== e.x || a.z !== b.z || a.z !== c.z || a.z !== e.z ||
          u0.y !== u1.y || u2.y !== u3.y || u0.x !== u2.x || u1.x !== u3.x)
        throw new Error("Unrecovered source board transform or UV");
      quads.push({ image: copied.get(board.cameraId), destination: { x: a.x, y: a.y, width: b.x - a.x, height: c.y - a.y },
        uv: { left: u0.x, right: u1.x, top: u0.y, bottom: u2.y }, depth: a.z });
    }
    batches.push({ id, queue, blendType: d.blendType, zTest: d.zTest, stencilReference: mesh.affectedMode, alpha: board.fadeAlpha, quads });
  }
  return { material: structuredClone(material), batches };
}
