import unittest
import pandas as pd
from backend.backtester import Backtester

class TestBacktesterAllSetups(unittest.TestCase):
    def setUp(self):
        self.bt = Backtester()
        self.symbol = "SPY"
        self.strategies = [
            "put_wall_bounce",
            "call_wall_reversal",
            "gex_flip_squeeze",
            "gex_flip_breakdown",
            "vcp_accumulation",
            "fvg_fill",
            "breaker_block",
            "rvol_surge",
            "trend_continuation",
            "range_condor",
            "max_gamma_exhaustion"
        ]

    def test_all_strategies_cash_and_options(self):
        start_date = "2024-06-01"
        end_date = "2025-02-01"
        
        for strategy in self.strategies:
            for asset_class in ["cash", "options"]:
                with self.subTest(strategy=strategy, asset_class=asset_class):
                    res = self.bt.run_backtest(
                        symbol=self.symbol,
                        strategy=strategy,
                        initial_capital=100000.0,
                        start_date=start_date,
                        end_date=end_date,
                        params={"asset_class": asset_class}
                    )
                    
                    if not res.get("success"):
                        self.fail(f"Strategy {strategy} failed in {asset_class} mode: {res.get('error')}")
                    
                    summary = res.get("summary")
                    self.assertEqual(summary.get("symbol"), "SPY")
                    self.assertEqual(summary.get("strategy"), strategy)
                    self.assertIn("total_return_pct", summary)
                    self.assertIn("win_rate_pct", summary)
                    self.assertGreater(len(res.get("equity_curve")), 0)

if __name__ == "__main__":
    unittest.main()
