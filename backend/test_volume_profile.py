import unittest
import numpy as np
import pandas as pd
from backend.volume_profile import VolumeProfileCalculator

class TestVolumeProfileCalculator(unittest.TestCase):
    def setUp(self):
        # Generate mock price and volume data
        # Let's create a normal distribution of volume centered around $100
        np.random.seed(42)
        prices = np.linspace(90, 110, 100)
        
        # Create a series of bars
        rows = []
        for i, p in enumerate(prices):
            # Normal distribution pdf for volume
            vol = int(1000 * np.exp(-((p - 100) ** 2) / (2 * 4 ** 2)))
            rows.append({
                'Open': p,
                'High': p + 0.1,
                'Low': p - 0.1,
                'Close': p,
                'Volume': max(10, vol)
            })
            
        self.mock_df = pd.DataFrame(rows)

    def test_volume_profile_basic(self):
        profile = VolumeProfileCalculator.calculate_volume_profile(self.mock_df, bins=20)
        
        # POC should be close to 100.0
        self.assertAlmostEqual(profile['poc'], 100.0, delta=1.5)
        
        # VAH should be greater than POC, VAL should be less than POC
        self.assertGreater(profile['vah'], profile['poc'])
        self.assertLess(profile['val'], profile['poc'])
        
        # Total range check
        self.assertGreaterEqual(profile['vah'], 95.0)
        self.assertLessEqual(profile['val'], 105.0)

    def test_volume_profile_empty(self):
        empty_df = pd.DataFrame()
        profile = VolumeProfileCalculator.calculate_volume_profile(empty_df)
        self.assertEqual(profile['poc'], 0.0)
        self.assertEqual(profile['vah'], 0.0)
        self.assertEqual(profile['val'], 0.0)

    def test_volume_profile_flat_price(self):
        # Flat price case (e.g. suspended stock)
        rows = [{'High': 100.0, 'Low': 100.0, 'Close': 100.0, 'Volume': 5000} for _ in range(10)]
        flat_df = pd.DataFrame(rows)
        profile = VolumeProfileCalculator.calculate_volume_profile(flat_df)
        self.assertEqual(profile['poc'], 100.0)
        self.assertEqual(profile['vah'], 100.0)
        self.assertEqual(profile['val'], 100.0)

if __name__ == '__main__':
    unittest.main()
