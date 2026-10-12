import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('particle_clock_export', pathlib.Path(__file__).parents[1] / 'export_field_particle_clock.py')
clock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clock)


class ParticleClockExport(unittest.TestCase):
    def values(self):
        return {'Fixed Timestep': .02, 'Maximum Allowed Timestep': .1, 'm_TimeScale': 1., 'Maximum Particle Timestep': .03}

    def test_distinct_engine_timestep_values_remain_distinct(self):
        result = clock.clock_values(self.values())
        self.assertEqual(result, {'fixedTimestep': .02, 'maximumTimestep': .1, 'timeScale': 1., 'maximumParticleTimestep': .03})

    def test_missing_invalid_and_unqualified_normalization_fail(self):
        for value in [float('nan'), float('inf'), True, -1, 0, '0.02']:
            tree = self.values(); tree['Fixed Timestep'] = value
            with self.assertRaises(ValueError): clock.clock_values(tree)
        tree = self.values(); del tree['Fixed Timestep']
        with self.assertRaises(KeyError): clock.clock_values(tree)
        tree = self.values(); tree['Maximum Particle Timestep'] = .01
        with self.assertRaises(ValueError): clock.clock_values(tree)


if __name__ == '__main__':
    unittest.main()
