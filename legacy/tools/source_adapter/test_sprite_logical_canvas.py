import copy
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
from PIL import Image
from sprite_logical_canvas import logical_canvas


def metadata(rotation=0):
    return {'logicalRect': [0, 0, 8, 9], 'pivot': [.5, 0], 'pixelsPerUnit': 1,
            'textureRect': [0, .125, 3, 2], 'textureRectOffset': [2.125, 3.125], 'atlasRectOffset': [0, -24],
            'settingsRaw': 3 | (rotation << 2), 'packed': True, 'packingMode': 1,
            'packingRotation': rotation, 'downscaleMultiplier': 1,
            'mesh': {'vertices': [[-2, 3, 0], [1, 3, 0], [1, 5, 0], [-2, 5, 0]],
                     'uv': [[0, 0]] * 4, 'triangles': [[[0, 1, 2], [0, 2, 3]]]}}


class LogicalCanvasTests(unittest.TestCase):
    def image(self):
        image = Image.new('RGBA', (3, 2))
        image.putdata([(i * 31, 255 - i * 23, 11 + i, [0, 1, 32, 127, 254, 255][i]) for i in range(6)])
        return image

    def test_anchor_transparency_and_alpha_are_exact(self):
        image = self.image()
        canvas, padding = logical_canvas(image, metadata())
        self.assertEqual(padding, {'left': 2, 'right': 3, 'top': 4, 'bottom': 3})
        self.assertEqual(canvas.crop((2, 4, 5, 6)).tobytes(), image.tobytes())
        for y in range(9):
            for x in range(8):
                if not (2 <= x < 5 and 4 <= y < 6):
                    self.assertEqual(canvas.getpixel((x, y)), (0, 0, 0, 0))

    def test_actual_decoder_unpacking_is_not_applied_twice(self):
        from UnityPy.export import SpriteHelper
        image = self.image()
        storage = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        # Forward atlas packing is the inverse of the installed decoder lane.
        forward = [None, Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.FLIP_TOP_BOTTOM,
                   Image.Transpose.ROTATE_180, Image.Transpose.ROTATE_90]
        for rotation, transform in enumerate(forward):
            with self.subTest(rotation=rotation):
                packed = storage if transform is None else storage.transpose(transform)
                data = NS(texture=None, alphaTexture=None, textureRect=NS(x=0, y=0, width=packed.width, height=packed.height),
                          settingsRaw=3 | (rotation << 2))
                sprite = NS(m_SpriteAtlas=None, m_AtlasTags=[], m_RD=data)
                with patch.object(SpriteHelper, 'get_image', return_value=packed):
                    decoded = SpriteHelper.get_image_from_sprite(sprite)
                self.assertEqual(decoded.tobytes(), image.tobytes())
                canvas, _ = logical_canvas(decoded, metadata(rotation))
                self.assertEqual(canvas.crop((2, 4, 5, 6)).tobytes(), image.tobytes())

    def test_unknown_geometry_and_protocol_remain_gated(self):
        mutations = [lambda m: m['mesh']['vertices'][0].__setitem__(0, -2.5),
                     lambda m: m['mesh']['vertices'][0].__setitem__(2, 1),
                     lambda m: m['mesh']['uv'][0].__setitem__(0, .1),
                     lambda m: m.__setitem__('packingRotation', 5),
                     lambda m: m.__setitem__('settingsRaw', 128),
                     lambda m: m.__setitem__('packingMode', 0),
                     lambda m: m.__setitem__('downscaleMultiplier', .5),
                     lambda m: m.__setitem__('pivot', [0, 0]),
                     lambda m: m['mesh']['triangles'][0][0].__setitem__(0, 9)]
        for mutate in mutations:
            m = copy.deepcopy(metadata())
            mutate(m)
            with self.subTest(metadata=m), self.assertRaises(ValueError):
                logical_canvas(self.image(), m)

    def test_tight_mesh_and_pixels_per_unit_use_original_pivot(self):
        m = metadata()
        m.update(pixelsPerUnit=2, settingsRaw=1, packingMode=0)
        m['mesh']['vertices'] = [[x / 2, y / 2, z] for x, y, z in m['mesh']['vertices']]
        # Translation is still the original logical pivot, not atlas offset.
        canvas, padding = logical_canvas(self.image(), m)
        self.assertEqual(padding, {'left': 2, 'right': 3, 'top': 4, 'bottom': 3})
        self.assertEqual(canvas.crop((2, 4, 5, 6)).tobytes(), self.image().tobytes())


if __name__ == '__main__':
    unittest.main()
