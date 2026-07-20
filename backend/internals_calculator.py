import numpy as np
import logging
from datetime import datetime
import yfinance as yf

from backend.data_fetcher import DataFetcher
from backend.gex_engine import GEXEngine

logger = logging.getLogger(__name__)

def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + np.exp(-max(-20.0, min(20.0, x))))

class InternalsCalculator:
    def __init__(self):
        self.fetcher = DataFetcher()
        self.gex_engine = GEXEngine()

    def calculate_logistic_probability(self, gex_val: float, vix: float, tick: float, vold_ratio: float, rs_score: float, strategy: str) -> float:
        """
        Calculates setup success probability using a logistic regression model.
        Features are normalized to Z-scores internally.
        """
        # 1. Normalize features (using typical ranges as rolling Z-score proxies)
        gex_z = max(-3.0, min(3.0, gex_val / 50.0))  # Scale: +/- $50M GEX
        vix_z = max(-3.0, min(3.0, (vix - 18.0) / 5.0)) # Normal VIX around 18
        tick_z = max(-3.0, min(3.0, tick / 400.0))    # Normal TICK std dev is ~400
        
        # VOLD ratio log-transformed: log(1) = 0 (neutral), log(3) = 1.1 (bullish), log(0.33) = -1.1 (bearish)
        vold_z = max(-3.0, min(3.0, np.log(max(0.05, vold_ratio)) / 0.5)) 
        rs_z = max(-3.0, min(3.0, rs_score / 1.5))     # RS standard deviation is ~1.5%
        
        # 2. Coefficients vary depending on the strategy type
        if strategy == "wall_reversion":
            # Reversion thrives in low VIX, extreme TICK (buying selling exhaustions), and range GEX
            # We want TICK to be OPPOSITE to GEX position (e.g. at Put Wall, we want highly negative TICK which shows exhaustion)
            # Thus, we model the coefficient of TICK to favor exhaustion
            z = 0.5 - 0.4 * vix_z - 0.6 * abs(tick_z) + 0.3 * gex_z - 0.2 * abs(vold_z) + 0.3 * rs_z
        elif strategy == "gex_flip" or strategy == "ovi_breakout":
            # Breakout/Momentum thrives in high VIX, positive trend TICK, high VOLD ratio, and negative GEX (accelerating volatility)
            z = -0.3 + 0.3 * vix_z + 0.5 * tick_z + 0.7 * vold_z - 0.4 * gex_z + 0.6 * rs_z
        else:
            # Default weights
            z = 0.0 + 0.2 * tick_z + 0.3 * vold_z - 0.1 * vix_z + 0.3 * rs_z
            
        p = sigmoid(z)
        logger.info(f"Logistic Model ({strategy}): z={z:.3f}, p={p:.4f} (Features: GEX={gex_z:.2f}, VIX={vix_z:.2f}, TICK={tick_z:.2f}, VOLD={vold_z:.2f}, RS={rs_z:.2f})")
        return p

    def calculate_bayesian_update(self, prior: float, tick: float, vold_ratio: float, strategy: str) -> float:
        """
        Updates the prior probability sequentially using Naive Bayes likelihood ratios.
        """
        p_success = prior
        p_fail = 1.0 - prior
        
        # Define likelihoods: P(Indicator | Success) / P(Indicator | Fail)
        # 1. TICK update
        if strategy == "wall_reversion":
            # Reversion success likelihood is extremely high if TICK reached panic levels (< -1000 or > +1000)
            if tick <= -950 or tick >= 950:
                lh_success = 0.45
                lh_fail = 0.15
            else:
                lh_success = 0.55
                lh_fail = 0.85
        else: # Breakout/Trend
            if (strategy in ["gex_flip", "ovi_breakout"]) and (tick >= 500 or tick <= -500):
                lh_success = 0.40
                lh_fail = 0.20
            else:
                lh_success = 0.60
                lh_fail = 0.80
                
        # Apply TICK Bayesian step
        num = lh_success * p_success
        den = (lh_success * p_success) + (lh_fail * p_fail)
        p_success = num / max(1e-9, den)
        p_fail = 1.0 - p_success
        
        # 2. VOLD update
        if strategy in ["gex_flip", "ovi_breakout"]:
            if vold_ratio >= 2.5 or vold_ratio <= 0.4:
                lh_success_vol = 0.50
                lh_fail_vol = 0.18
            else:
                lh_success_vol = 0.50
                lh_fail_vol = 0.82
        else: # Reversion
            if 0.8 <= vold_ratio <= 1.25: # flat volume flow is good for reversion
                lh_success_vol = 0.45
                lh_fail_vol = 0.25
            else:
                lh_success_vol = 0.55
                lh_fail_vol = 0.75
                
        # Apply VOLD Bayesian step
        num = lh_success_vol * p_success
        den = (lh_success_vol * p_success) + (lh_fail_vol * p_fail)
        p_success = num / max(1e-9, den)
        
        logger.info(f"Bayesian Update ({strategy}): Prior={prior:.4f} -> Posterior={p_success:.4f}")
        return p_success

    def calculate_kelly_sizing(self, p: float, b: float, fraction: float = 0.25) -> dict:
        """
        Applies a fractional Kelly Criterion:
        f* = fraction * ( (p * b - q) / b )
        """
        q = 1.0 - p
        if b <= 0:
            return {"kelly_fraction": 0.0, "risk_multiplier": 0.0}
            
        raw_f = (p * b - q) / b
        kelly_f = fraction * raw_f
        
        # Constrain between 0% and 25% (max capital allocation)
        kelly_constrained = max(0.0, min(0.25, kelly_f))
        
        # Risk multiplier converts size relative to standard day trade sizing
        risk_multiplier = kelly_constrained / 0.05 # standard sizing is 5% allocation
        
        return {
            "kelly_fraction": float(kelly_constrained),
            "risk_multiplier": float(risk_multiplier),
            "raw_kelly": float(raw_f)
        }

    def evaluate_trade_transition(self, symbol: str, price: float, entry_price: float, direction: str) -> dict:
        """
        Evaluates a day trade at 3:45 PM to determine if it should transition to a swing trade.
        """
        symbol = symbol.upper().strip()
        direction = direction.lower().strip()
        
        try:
            # 1. Fetch daily candle and historical series
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="5d")
            
            if hist.empty:
                raise ValueError("No historical prices available.")
                
            last_row = hist.iloc[-1]
            day_high = float(last_row['High'])
            day_low = float(last_row['Low'])
            day_close = float(last_row['Close'])
            day_volume = float(last_row['Volume'])
            vol_avg = float(hist['Volume'].tail(5).mean())
            
            # Ensure price uses current if available
            price = price or day_close
            
            # 2. Relative Close Strength (RCS)
            # RCS = (Close - Low) / (High - Low)
            denom = (day_high - day_low)
            rcs = (price - day_low) / denom if denom > 1e-9 else 0.5
            
            # 3. GEX Regime
            raw_chain = self.fetcher.fetch_options_chain(symbol, max_expirations=3)
            processed = self.gex_engine.process_options_chain(raw_chain)
            aggregated = self.gex_engine.compute_aggregated_exposures(processed)
            
            call_wall = float(aggregated['call_wall'])
            put_wall = float(aggregated['put_wall'])
            gamma_flip = float(aggregated['gamma_flip'])
            net_gex = float(aggregated['net_gex'])
            
            gex_regime = "Positive Gamma" if price >= gamma_flip else "Negative Gamma"
            
            # 4. Option Volume Imbalance (OVI)
            ovi = GEXEngine.calculate_ovi(processed['calls'], processed['puts'])
            
            # 5. Catalyst checking
            catalysts = self.fetcher.fetch_overnight_catalysts()
            tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
            active_warnings = [c for c in catalysts if c['date'] == tomorrow and c['importance'] in ['HIGH', 'CRITICAL']]
            
            # 6. Evaluate transition rules
            rules = {
                "rcs_check": False,
                "regime_check": False,
                "volume_check": False,
                "catalyst_check": len(active_warnings) == 0,
                "wall_proximity_check": True
            }
            
            # Rules logic
            # A. RCS
            if direction == "long" and rcs >= 0.85:
                rules["rcs_check"] = True
            elif direction == "short" and rcs <= 0.15:
                rules["rcs_check"] = True
                
            # B. Regime
            # Negative GEX supports swing trades due to momentum extensions and gaps
            if gex_regime == "Negative Gamma":
                rules["regime_check"] = True
                
            # C. Volume
            if day_volume >= 1.5 * vol_avg:
                rules["volume_check"] = True
                
            # D. Wall proximity: exit if too close to major wall (absorption risk)
            if abs(price - call_wall) / price <= 0.005 or abs(price - put_wall) / price <= 0.005:
                rules["wall_proximity_check"] = False
                
            # Decision determination: hold overnight if RCS passes AND Catalyst passes AND not too close to wall
            hold_overnight = rules["rcs_check"] and rules["catalyst_check"] and rules["wall_proximity_check"]
            
            return {
                "symbol": symbol,
                "price": price,
                "direction": direction,
                "rcs": rcs,
                "gex_regime": gex_regime,
                "ovi": ovi,
                "volume_ratio": day_volume / vol_avg if vol_avg > 0 else 1.0,
                "hold_overnight": hold_overnight,
                "active_warnings": active_warnings,
                "checklist": rules,
                "decision_text": "HOLD SWING OVERNIGHT" if hold_overnight else "EXIT DAY TRADE (CLOSE CASH)"
            }
            
        except Exception as e:
            logger.error(f"Failed to evaluate transition: {e}")
            return {
                "symbol": symbol,
                "price": price,
                "direction": direction,
                "rcs": 0.5,
                "gex_regime": "Unknown",
                "ovi": 0.0,
                "volume_ratio": 1.0,
                "hold_overnight": False,
                "active_warnings": [],
                "checklist": {"rcs_check": False, "regime_check": False, "volume_check": False, "catalyst_check": True, "wall_proximity_check": True},
                "decision_text": "EXIT DAY TRADE (API ERROR FALLBACK)"
            }
