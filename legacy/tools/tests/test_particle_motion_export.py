import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('field_particle_motion_export', ROOT / 'export_field_particle_motion.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MotionExportTests(unittest.TestCase):
    def test_gravity_preserves_source_axes_without_screen_coordinate_conversion(self):
        gravity = {'x': .1, 'y': -9.81, 'z': -.3}
        self.assertEqual(module.gravity_values({'m_Gravity': gravity}), gravity)
        self.assertIsNot(module.gravity_values({'m_Gravity': gravity}), gravity)

    def test_missing_extra_or_boolean_gravity_components_are_rejected(self):
        for value in [{'x': 0, 'y': -9.81}, {'x': 0, 'y': 0, 'z': 0, 'w': 0}, {'x': False, 'y': 0, 'z': 0}]:
            with self.assertRaises(ValueError): module.gravity_values({'m_Gravity': value})

    def test_nonfinite_gravity_is_not_silently_replaced(self):
        for value in [float('nan'), float('inf'), '0']:
            with self.assertRaises(ValueError): module.gravity_values({'m_Gravity': {'x': value, 'y': 0, 'z': 0}})


if __name__ == '__main__': unittest.main()
