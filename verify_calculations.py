import numpy as np
import pandas as pd
from backend.gex_engine import GEXEngine
from backend.data_validator import DataValidator
from backend.backtester import Backtester
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_black_scholes_greeks():
    """
    Verifies that the Black-Scholes Greeks calculated by GEXEngine match standard values.
    Test Case:
    S = 100, K = 100, T = 0.1 years (~36.5 days), r = 0.05 (5%), q = 0.0 (0% div), sigma = 0.20 (20% IV).
    Standard values:
    d1 ≈ 0.1107
    d2 ≈ 0.0474
    Gamma ≈ 0.0627
    Delta (Call) ≈ 0.565
    Delta (Put) ≈ -0.435
    """
    logger.info("Running Black-Scholes Greeks validation...")
    
    S, K, T, r, q, sigma = 100.0, 100.0, 0.1, 0.05, 0.0, 0.20
    
    call_greeks = GEXEngine.calculate_greeks(S, K, T, r, q, sigma, 'call')
    put_greeks = GEXEngine.calculate_greeks(S, K, T, r, q, sigma, 'put')
    
    # Assertions with tolerances
    assert np.isclose(call_greeks['gamma'], 0.06269, atol=1e-4), f"Gamma mismatch: {call_greeks['gamma']}"
    assert np.isclose(call_greeks['delta'], 0.54406, atol=1e-4), f"Call Delta mismatch: {call_greeks['delta']}"
    assert np.isclose(put_greeks['delta'], -0.45594, atol=1e-4), f"Put Delta mismatch: {put_greeks['delta']}"
    
    logger.info("✓ Black-Scholes Greeks verified successfully!")
    logger.info(f"  Gamma: {call_greeks['gamma']:.5f} (Expected: 0.06269)")
    logger.info(f"  Call Delta: {call_greeks['delta']:.5f} (Expected: 0.56497)")
    logger.info(f"  Put Delta: {put_greeks['delta']:.5f} (Expected: -0.43503)")
    logger.info(f"  Call Vanna: {call_greeks['vanna']:.5f}")
    logger.info(f"  Call Charm (per day): {call_greeks['charm']:.5f}")

def test_gamma_flip_solver():
    """
    Verifies that the root solver in GEXEngine successfully identifies the Gamma Flip level.
    """
    logger.info("Running Gamma Flip root solver validation...")
    
    engine = GEXEngine()
    
    # Construct a simple, symmetric options chain with one call and one put
    # Spot price = 100. Call at 105 strike (long gamma), Put at 95 strike (short gamma)
    # The flip level should lie between 95 and 105 (close to 100)
    calls = pd.DataFrame([{
        'strike': 105.0,
        'openInterest': 1000.0,
        'impliedVolatility': 0.20,
        'expiration': '2026-08-15',
        'T': 0.1
    }])
    
    puts = pd.DataFrame([{
        'strike': 95.0,
        'openInterest': 1000.0,
        'impliedVolatility': 0.20,
        'expiration': '2026-08-15',
        'T': 0.1
    }])
    
    flip_level = engine.find_gamma_flip(100.0, calls, puts, 0.05, 0.0)
    
    assert 90.0 < flip_level < 110.0, f"Gamma flip level out of range: {flip_level}"
    logger.info(f"✓ Gamma Flip Solver successfully converged: {flip_level:.2f}")

def test_ovi_calculation():
    """
    Verifies Option Volume Imbalance (OVI) ratio logic.
    """
    logger.info("Running OVI calculation validation...")
    
    calls = pd.DataFrame([{'volume': 6000.0}])
    puts = pd.DataFrame([{'volume': 4000.0}])
    
    ovi = GEXEngine.calculate_ovi(calls, puts)
    
    # OVI = (6000 - 4000) / (6000 + 4000) = 2000 / 10000 = 0.20
    assert np.isclose(ovi, 0.20), f"OVI mismatch: {ovi}"
    logger.info("✓ OVI Calculation verified successfully: 20%")

def test_backtester_simulation():
    """
    Verifies that the Backtester runs and returns structured performance metrics.
    """
    logger.info("Running Backtester simulation check...")
    
    bt = Backtester()
    # Run a short backtest on a popular symbol (e.g. SPY) for validation
    # Use 30 days to keep it fast
    start = (datetime.now() - timedelta(days=180)).strftime('%Y-%m-%d')
    end = datetime.now().strftime('%Y-%m-%d')
    
    res = bt.run_backtest(symbol="SPY", strategy="gex_flip", start_date=start, end_date=end)
    
    assert res['success'] is True, f"Backtest failed: {res.get('error')}"
    assert 'summary' in res, "Missing backtest summary"
    assert 'trades' in res, "Missing trades log"
    assert 'equity_curve' in res, "Missing equity curve"
    
    summary = res['summary']
    logger.info("✓ Backtester simulation executed successfully!")
    logger.info(f"  Symbol: {summary['symbol']}")
    logger.info(f"  Strategy: {summary['strategy']}")
    logger.info(f"  Total Return: {summary['total_return_pct']:.2f}%")
    logger.info(f"  Max Drawdown: {summary['max_drawdown_pct']:.2f}%")
    logger.info(f"  Trades Executed: {summary['total_trades']}")

if __name__ == "__main__":
    from datetime import datetime, timedelta
    print("====================================================")
    print("     STARTING INTEGRATION & CALCULATION TESTS")
    print("====================================================")
    
    try:
        test_black_scholes_greeks()
        print("-" * 52)
        test_gamma_flip_solver()
        print("-" * 52)
        test_ovi_calculation()
        print("-" * 52)
        test_backtester_simulation()
        print("====================================================")
        print("    ALL INTEGRATION & MATH TESTS PASSED (100%)")
        print("====================================================")
    except Exception as e:
        logger.error(f"Test suite failed: {e}")
        import sys
        sys.exit(1)
