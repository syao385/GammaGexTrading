import unittest
from backend.data_fetcher import DataFetcher
from backend.gex_engine import GEXEngine
from backend.data_validator import DataValidator
from backend.screener import MarketScreener
from backend.backtester import Backtester

class TestExistingFeatures(unittest.TestCase):
    
    def test_fetcher_instantiation(self):
        fetcher = DataFetcher()
        self.assertIsNotNone(fetcher)

    def test_gex_engine_instantiation(self):
        engine = GEXEngine()
        self.assertIsNotNone(engine)

    def test_validator_instantiation(self):
        engine = GEXEngine()
        validator = DataValidator(engine)
        self.assertIsNotNone(validator)

    def test_screener_instantiation(self):
        screener = MarketScreener()
        self.assertIsNotNone(screener)

    def test_backtester_instantiation(self):
        backtester = Backtester()
        self.assertIsNotNone(backtester)

if __name__ == '__main__':
    unittest.main()
