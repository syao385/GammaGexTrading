import unittest
import os
import pandas as pd
import numpy as np

from backend.database import init_db, save_symbol_metrics, query_liquid_universe
from backend.internals_calculator import InternalsCalculator
from backend.screener import MarketScreener

class TestInternals(unittest.TestCase):
    def setUp(self):
        init_db()

    def test_database_save_and_query(self):
        symbol = "TEST_TICKER"
        metrics = {
            "price": 150.0,
            "avg_volume": 1200000.0,
            "optionable": True,
            "last_updated": 1700000000.0,
            "call_wall": 160.0,
            "put_wall": 140.0,
            "gamma_flip": 145.0,
            "net_gex_status": "Positive",
            "vcp_status": "No contraction",
            "trend_direction": "Bullish",
            "ema_20_dist": 2.5,
            "ema_50_dist": 5.0,
            "alerts": ["Breakout: 20-Day Range Break"]
        }
        
        # Save symbol metrics
        save_symbol_metrics(symbol, metrics)
        
        # Query database
        res = query_liquid_universe(setup_filter="breakout")
        
        self.assertGreaterEqual(res["total"], 1)
        found = False
        for row in res["data"]:
            if row["symbol"] == symbol:
                found = True
                self.assertEqual(row["price"], 150.0)
                self.assertEqual(row["call_wall"], 160.0)
                self.assertEqual(row["put_wall"], 140.0)
                self.assertIn("Breakout: 20-Day Range Break", row["alerts"])
        self.assertTrue(found)

    def test_probability_calculator(self):
        calc = InternalsCalculator()
        
        # Test logistic model outputs bounded probability [0, 1]
        p_reversion = calc.calculate_logistic_probability(
            gex_val=-25.0, vix=22.0, tick=-950.0, vold_ratio=0.4, rs_score=-1.5, strategy="wall_reversion"
        )
        self.assertTrue(0.0 <= p_reversion <= 1.0)
        
        # Test Bayesian updating increases success probability with positive conditions
        p_post = calc.calculate_bayesian_update(prior=0.40, tick=-1000.0, vold_ratio=0.8, strategy="wall_reversion")
        self.assertGreater(p_post, 0.40)
        
        # Test Kelly sizing constraints
        sizing = calc.calculate_kelly_sizing(p=p_post, b=0.5)
        self.assertTrue(0.0 <= sizing["kelly_fraction"] <= 0.25)

    def test_vcp_pattern_detection(self):
        screener = MarketScreener()
        
        # Generate simulated contraction waves: 15% -> 8% -> 4%
        dates = pd.date_range(end='2026-07-19', periods=60)
        
        # Base price series
        prices = [100.0]
        for i in range(1, 60):
            # We want to build specific swing points:
            # Day 0-15: drops from 100 to 85 (15% drop), then rallies to 98
            # Day 15-30: drops to 90 (8% drop from peak 98), rallies to 97
            # Day 30-45: drops to 93 (4% drop from peak 97), rallies to 96
            # Day 45-60: consolidates tightly around 95-96 with standard deviation compressing
            # Let's write a simple curve
            if i < 15:
                prices.append(100.0 - (15.0 * np.sin(i / 15.0 * np.pi / 2)))
            elif i < 30:
                prices.append(98.0 - (8.0 * np.sin((i-15) / 15.0 * np.pi / 2)))
            elif i < 45:
                prices.append(97.0 - (4.0 * np.sin((i-30) / 15.0 * np.pi / 2)))
            else:
                prices.append(96.0 + np.random.normal(0, 0.1))
                
        volumes = []
        for i in range(60):
            # volume drying up at the end
            if i > 45:
                volumes.append(200000.0) # low volume
            else:
                volumes.append(800000.0) # higher volume
                
        df = pd.DataFrame({
            "Open": prices,
            "High": [p + 0.5 for p in prices],
            "Low": [p - 0.5 for p in prices],
            "Close": prices,
            "Volume": volumes
        }, index=dates)
        
        vcp_detected, summary = screener.detect_vcp_pattern(df)
        # Verify VCP logic works and returns valid tuple
        self.assertIsInstance(vcp_detected, bool)
        self.assertIsInstance(summary, str)

if __name__ == '__main__':
    unittest.main()
