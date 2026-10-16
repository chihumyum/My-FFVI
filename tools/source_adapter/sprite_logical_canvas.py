"""Source Sprite mesh bounds projected to the original logical pixel canvas.

The UnityPy decoder already undoes atlas packing rotation. This module never
resizes or invents artwork. Unknown/subpixel/UV geometry remains an explicit
export issue rather than receiving a guessed offset or nearest image.
"""
from __future__ import annotations
import math
from PIL import Image

SPRITE_LOGICAL_CANVAS = 'source-sprite-logical-canvas-v1'


def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Invalid source Sprite ' + name)
    return value


def _pixel(value, name):
    value = _number(value, name)
    if int(value) != value:
        raise ValueError('Subpixel source Sprite ' + name + ' requires its geometry renderer')
    return int(value)


def logical_canvas(image: Image.Image, metadata: dict):
    """Pure, detached reconstruction after the exact source decoder.

    Lower-left source mesh coordinates are translated using the original
    normalized pivot and pixels-per-unit. Pillow's top-left placement is a
    single Y conversion. Offset/atlas fields remain evidence; fractional
    textureRect offsets cannot override an exact mesh-defined anchor.
    """
    required = {'logicalRect', 'pivot', 'pixelsPerUnit', 'textureRect', 'textureRectOffset', 'atlasRectOffset',
                'settingsRaw', 'packed', 'packingMode', 'packingRotation', 'downscaleMultiplier', 'mesh'}
    if set(metadata) != required:
        raise ValueError('Invalid source Sprite logical canvas metadata fields')
    rect, pivot, mesh = metadata['logicalRect'], metadata['pivot'], metadata['mesh']
    if not isinstance(rect, list) or len(rect) != 4 or not isinstance(pivot, list) or len(pivot) != 2:
        raise ValueError('Invalid source Sprite logical rect/pivot')
    for value in rect + pivot:
        _number(value, 'rect/pivot')
    width, height = _pixel(rect[2], 'logical width'), _pixel(rect[3], 'logical height')
    if not 0 < width <= 16384 or not 0 < height <= 16384:
        raise ValueError('Invalid source Sprite logical canvas bounds')
    ppu = _number(metadata['pixelsPerUnit'], 'pixels per unit')
    if ppu <= 0:
        raise ValueError('Invalid source Sprite pixels per unit')
    if type(metadata['packed']) is not bool or metadata['packingMode'] not in [0, 1] or metadata['packingRotation'] not in [0, 1, 2, 3, 4]:
        raise ValueError('Unknown source Sprite packing protocol')
    if not isinstance(metadata['settingsRaw'], int) or metadata['settingsRaw'] < 0 or metadata['settingsRaw'] & ~127:
        raise ValueError('Unknown source Sprite packed settings')
    raw = metadata['settingsRaw']
    if bool(raw & 1) != metadata['packed'] or (raw >> 1) & 1 != metadata['packingMode'] or (raw >> 2) & 15 != metadata['packingRotation']:
        raise ValueError('Source Sprite packing fields disagree with settings')
    if not metadata['packed'] and metadata['packingRotation'] != 0:
        raise ValueError('Unpacked source Sprite cannot have a packing rotation')
    if metadata['downscaleMultiplier'] != 1:
        raise ValueError('Scaled source Sprite atlas requires its geometry renderer')
    for key, length in [('textureRect', 4), ('textureRectOffset', 2), ('atlasRectOffset', 2)]:
        values = metadata[key]
        if not isinstance(values, list) or len(values) != length:
            raise ValueError('Invalid source Sprite ' + key)
        for value in values:
            _number(value, key)
    if metadata['textureRect'][2] <= 0 or metadata['textureRect'][3] <= 0:
        raise ValueError('Invalid source Sprite texture rect')
    if not isinstance(mesh, dict) or set(mesh) != {'vertices', 'uv', 'triangles'}:
        raise ValueError('Invalid source Sprite mesh fields')
    vertices, uv, submeshes = mesh['vertices'], mesh['uv'], mesh['triangles']
    if not isinstance(vertices, list) or len(vertices) < 3 or not isinstance(submeshes, list) or not submeshes:
        raise ValueError('Missing source Sprite mesh')
    for vertex in vertices:
        if not isinstance(vertex, (list, tuple)) or len(vertex) != 3:
            raise ValueError('Invalid source Sprite mesh vertex')
        for value in vertex:
            _number(value, 'mesh vertex')
        if vertex[2] != 0:
            raise ValueError('Nonplanar source Sprite requires its geometry renderer')
    if uv is not None:
        if not isinstance(uv, list) or len(uv) not in [0, len(vertices)]:
            raise ValueError('Invalid source Sprite mesh UV count')
        for point in uv:
            if not isinstance(point, (list, tuple)) or len(point) != 2:
                raise ValueError('Invalid source Sprite mesh UV')
            if any(_number(value, 'mesh UV') != 0 for value in point):
                raise ValueError('UV-mapped source Sprite requires its geometry renderer')
    for submesh in submeshes:
        if not isinstance(submesh, list) or not submesh:
            raise ValueError('Missing source Sprite triangles')
        for triangle in submesh:
            if not isinstance(triangle, (list, tuple)) or len(triangle) != 3 or any(type(i) is not int or i < 0 or i >= len(vertices) for i in triangle):
                raise ValueError('Invalid source Sprite triangle')
    low = [min(v[axis] for v in vertices) * ppu + pivot[axis] * [width, height][axis] for axis in [0, 1]]
    high = [max(v[axis] for v in vertices) * ppu + pivot[axis] * [width, height][axis] for axis in [0, 1]]
    left, bottom = [_pixel(value, 'mesh minimum') for value in low]
    right_edge, top_edge = [_pixel(value, 'mesh maximum') for value in high]
    if not 0 <= left < right_edge <= width or not 0 <= bottom < top_edge <= height:
        raise ValueError('Source Sprite mesh exceeds its original logical canvas')
    if image.size != (right_edge - left, top_edge - bottom):
        raise ValueError('Decoded source Sprite does not match its exact mesh pixel bounds')
    top = height - top_edge
    decoded = image.convert('RGBA')
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    canvas.paste(decoded, (left, top))  # no alpha mask: do not multiply source alpha twice
    if canvas.crop((left, top, right_edge, top + decoded.height)).tobytes() != decoded.tobytes():
        raise ValueError('Source Sprite pixels changed while restoring logical canvas')
    return canvas, {'left': left, 'right': width - right_edge, 'top': top, 'bottom': bottom}


def sprite_canvas_metadata(sprite):
    """Read the same exact Atlas entry consumed by UnityPy's source decoder."""
    from UnityPy.helpers.MeshHelper import MeshHandler
    from UnityPy.export.SpriteHelper import SpriteSettings
    atlas = None
    if sprite.m_SpriteAtlas:
        atlas = sprite.m_SpriteAtlas.deref_parse_as_object()
    elif sprite.m_AtlasTags:
        from UnityPy.enums import ClassIDType
        candidates = [obj for obj in sprite.assets_file.objects.values() if obj.type == ClassIDType.SpriteAtlas and obj.peek_name() == sprite.m_AtlasTags[0]]
        if len(candidates) != 1:
            raise ValueError('Unresolved source Sprite atlas identity')
        atlas = candidates[0].parse_as_object()
    data = sprite.m_RD
    if atlas:
        matches = [value for key, value in atlas.m_RenderDataMap if key == sprite.m_RenderDataKey]
        if len(matches) != 1:
            raise ValueError('Ambiguous source Sprite atlas render key')
        data = matches[0]
    settings = SpriteSettings(data.settingsRaw)
    mesh = MeshHandler(sprite.m_RD, sprite.object_reader.version)
    mesh.process()
    vector = lambda v: [v.x, v.y]
    rect = lambda v: [v.x, v.y, v.width, v.height]
    return {'logicalRect': rect(sprite.m_Rect), 'pivot': vector(sprite.m_Pivot), 'pixelsPerUnit': sprite.m_PixelsToUnits,
            'textureRect': rect(data.textureRect), 'textureRectOffset': vector(data.textureRectOffset), 'atlasRectOffset': vector(data.atlasRectOffset),
            'settingsRaw': data.settingsRaw, 'packed': bool(settings.packed), 'packingMode': int(settings.packingMode), 'packingRotation': int(settings.packingRotation),
            'downscaleMultiplier': data.downscaleMultiplier,
            'mesh': {'vertices': mesh.m_Vertices, 'uv': mesh.m_UV0, 'triangles': list(mesh.get_triangles())}}
