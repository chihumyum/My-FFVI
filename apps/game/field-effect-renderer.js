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
