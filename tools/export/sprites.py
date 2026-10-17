"""Decode Unity Sprite packing once, then restore its source logical canvas."""
from __future__ import annotations

from PIL import Image


def render_data(sprite):
    atlas = None
    if sprite.m_SpriteAtlas:
        atlas = sprite.m_SpriteAtlas.deref_parse_as_object()
    elif sprite.m_AtlasTags:
        matches = [obj for obj in sprite.assets_file.objects.values()
                   if obj.type.name == "SpriteAtlas" and obj.peek_name() == sprite.m_AtlasTags[0]]
        if len(matches) == 1:
            atlas = matches[0].read()
    if atlas:
        return next(value for key, value in atlas.m_RenderDataMap if key == sprite.m_RenderDataKey)
    return sprite.m_RD


def sprite_image(sprite):
    from UnityPy.helpers.MeshHelper import MeshHandler
    from UnityPy.export.SpriteHelper import SpriteSettings

    rd = render_data(sprite)
    settings = SpriteSettings(rd.settingsRaw)
    mesh = MeshHandler(sprite.m_RD, sprite.object_reader.version)
    mesh.process()
    vector = lambda value: [value.x, value.y]
    rect = lambda value: [value.x, value.y, value.width, value.height]
    metadata = {
        "logicalRect": rect(sprite.m_Rect), "pivot": vector(sprite.m_Pivot),
        "pixelsPerUnit": sprite.m_PixelsToUnits, "textureRect": rect(rd.textureRect),
        "textureRectOffset": vector(rd.textureRectOffset), "atlasRectOffset": vector(rd.atlasRectOffset),
        "settingsRaw": rd.settingsRaw, "packed": bool(settings.packed),
        "packingMode": int(settings.packingMode), "packingRotation": int(settings.packingRotation),
        "downscaleMultiplier": rd.downscaleMultiplier,
        "texture": {"fileId": rd.texture.m_FileID, "pathId": str(rd.texture.m_PathID)},
        "mesh": {"vertices": mesh.m_Vertices, "uv": mesh.m_UV0, "triangles": list(mesh.get_triangles())},
        "imageOrientation": "top-left", "packingDecoded": True,
    }
    # UnityPy applies atlas flips/rotation, optional UV mesh mapping and exactly
    # one storage-to-display Y flip. Do not flip or resample its decoded pixels.
    decoded = sprite.image.convert("RGBA")
    width, height = sprite.m_Rect.width, sprite.m_Rect.height
    pixel = lambda value: round(value) if abs(value - round(value)) < 0.001 else None
    w, h = pixel(width), pixel(height)
    if not w or not h:
        raise ValueError("Sprite logical dimensions are not integral pixels")
    vertices = mesh.m_Vertices
    if vertices:
        ppu, pivot = sprite.m_PixelsToUnits, sprite.m_Pivot
        low = [min(v[i] for v in vertices) * ppu + [pivot.x * w, pivot.y * h][i] for i in (0, 1)]
        high = [max(v[i] for v in vertices) * ppu + [pivot.x * w, pivot.y * h][i] for i in (0, 1)]
        edges = [pixel(n) for n in [*low, *high]]
        if None in edges:
            raise ValueError("Sprite mesh needs subpixel geometry rendering")
        left, bottom, right, top_edge = edges
    else:
        left, bottom = pixel(rd.textureRectOffset.x), pixel(rd.textureRectOffset.y)
        if left is None or bottom is None:
            raise ValueError("Sprite texture offset is not integral pixels")
        right, top_edge = left + decoded.width, bottom + decoded.height
    if decoded.size != (right - left, top_edge - bottom):
        raise ValueError(f"Decoded Sprite {decoded.size} differs from source mesh bounds {(right-left, top_edge-bottom)}")
    if not 0 <= left < right <= w or not 0 <= bottom < top_edge <= h:
        raise ValueError("Sprite mesh extends beyond the original logical canvas")
    canvas = Image.new("RGBA", (w, h))
    top = h - top_edge
    canvas.paste(decoded, (left, top))  # No alpha mask: preserve source RGBA bytes.
    metadata["padding"] = {"left": left, "right": w-right, "top": top, "bottom": bottom}
    metadata["decodedWidth"], metadata["decodedHeight"] = decoded.size
    metadata["logicalCanvas"] = True
    return canvas, metadata
