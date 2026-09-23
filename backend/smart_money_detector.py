import numpy as np
import pandas as pd
import logging

logger = logging.getLogger(__name__)

class SmartMoneyDetector:
    @staticmethod
    def detect_fvgs(df: pd.DataFrame, lookback: int = 20) -> list:
        """
        Detects active and inverted Fair Value Gaps (FVGs) in the recent lookback window.
        Returns a list of dictionaries detailing the FVG type, price boundaries, state (active/inverted), and index.
        """
        if df.empty or len(df) < 5:
            return []

        fvgs = []
        highs = df['High'].values
        lows = df['Low'].values
        closes = df['Close'].values
        
        start_idx = max(2, len(df) - lookback)
        
        # Scan for FVG and Price Gap formations
        seen_gaps = set()
        for i in range(1, len(df)):
            high_prev1, low_prev1 = float(highs[i-1]), float(lows[i-1])
            c3_high, c3_low = float(highs[i]), float(lows[i])
            
            gaps = []
            # 2-candle gap
            if c3_low > high_prev1:
                gaps.append(("bullish", high_prev1, c3_low, i))
            elif c3_high < low_prev1:
                gaps.append(("bearish", c3_high, low_prev1, i))
                
            # 3-candle FVG
            if i >= 2:
                c1_high, c1_low = float(highs[i-2]), float(lows[i-2])
                if c3_low > c1_high:
                    gaps.append(("bullish", c1_high, c3_low, i))
                elif c3_high < c1_low:
                    gaps.append(("bearish", c3_high, c1_low, i))
                    
            for gtype, fvg_bottom, fvg_top, candle_idx in gaps:
                key = (gtype, round(fvg_bottom, 2), round(fvg_top, 2))
                if key in seen_gaps:
                    continue
                    
                # Mitigation check: ONLY mitigated if candle CLOSE passes through the gap
                state = "active"
                for j in range(candle_idx + 1, len(df)):
                    c_close = float(closes[j])
                    if gtype == "bullish" and c_close < fvg_bottom:
                        state = "filled"
                        break
                    elif gtype == "bearish" and c_close > fvg_top:
                        state = "filled"
                        break
                        
                if state == "active":
                    seen_gaps.add(key)
                    fvgs.append({
                        "type": gtype,
                        "top": fvg_top,
                        "bottom": fvg_bottom,
                        "state": "active",
                        "index": candle_idx - 1
                    })
                    
        return fvgs

    @staticmethod
    def detect_breaker_and_mitigation_blocks(df: pd.DataFrame, lookback: int = 30) -> dict:
        """
        Detects Breaker Blocks (requires liquidity sweep) and Mitigation Blocks (no liquidity sweep)
        on the daily or intraday dataframe.
        """
        if df.empty or len(df) < 10:
            return {"bullish_breaker": None, "bearish_breaker": None, "bullish_mitigation": None, "bearish_mitigation": None}

        highs = df['High'].values
        lows = df['Low'].values
        closes = df['Close'].values
        opens = df['Open'].values
        
        bullish_breaker = None
        bearish_breaker = None
        bullish_mitigation = None
        bearish_mitigation = None
        
        # Scan for swing points
        # A swing high is a local peak in a 5-candle window
        # A swing low is a local trough in a 5-candle window
        start_idx = max(5, len(df) - lookback)
        
        # 1. Bullish Reversal Blocks (Scan for Breaker and Mitigation)
        for i in range(start_idx, len(df) - 2):
            # Check for a Swing Low at index i-4 to i
            is_swing_low = lows[i-2] == min(lows[i-4:i+1])
            if is_swing_low:
                swing_low_val = float(lows[i-2])
                
                # Look for a Swing High after this swing low
                for j in range(i + 1, len(df) - 1):
                    is_swing_high = highs[j] == max(highs[j-2:j+3]) if j+2 < len(df) else False
                    if is_swing_high:
                        swing_high_val = float(highs[j])
                        
                        # Look for the next low (sweep or higher low)
                        for k in range(j + 1, len(df)):
                            is_next_low = lows[k] == min(lows[k-2:k+3]) if k+2 < len(df) else False
                            if is_next_low:
                                next_low_val = float(lows[k])
                                
                                # Check if price has broken above the intermediate Swing High
                                # This represents a Market Structure Shift (MSS)
                                mss_triggered = False
                                trigger_idx = -1
                                for m in range(k + 1, len(df)):
                                    if closes[m] > swing_high_val:
                                        mss_triggered = True
                                        trigger_idx = m
                                        break
                                        
                                if mss_triggered:
                                    # Locate the up-close candles between the initial swing low and the secondary low
                                    # The breaker/mitigation zone price is the highest body/high in that range
                                    zone_price = swing_high_val
                                    
                                    # Determine if it's a Breaker (liquidity sweep: next_low < initial_swing_low)
                                    # or a Mitigation Block (failure to sweep: next_low >= initial_swing_low)
                                    if next_low_val < swing_low_val:
                                        bullish_breaker = {
                                            "block_price": zone_price,
                                            "stop_loss": next_low_val,
                                            "sweep_price": next_low_val,
                                            "high_timeframe_level": swing_low_val,
                                            "index": int(i-2)
                                        }
                                    else:
                                        bullish_mitigation = {
                                            "block_price": zone_price,
                                            "stop_loss": next_low_val,
                                            "index": int(i-2)
                                        }
                                    break
                                    
        # 2. Bearish Reversal Blocks
        for i in range(start_idx, len(df) - 2):
            is_swing_high = highs[i-2] == max(highs[i-4:i+1])
            if is_swing_high:
                swing_high_val = float(highs[i-2])
                
                for j in range(i + 1, len(df) - 1):
                    is_swing_low = lows[j] == min(lows[j-2:j+3]) if j+2 < len(df) else False
                    if is_swing_low:
                        swing_low_val = float(lows[j])
                        
                        for k in range(j + 1, len(df)):
                            is_next_high = highs[k] == max(highs[k-2:k+3]) if k+2 < len(df) else False
                            if is_next_high:
                                next_high_val = float(highs[k])
                                
                                mss_triggered = False
                                trigger_idx = -1
                                for m in range(k + 1, len(df)):
                                    if closes[m] < swing_low_val:
                                        mss_triggered = True
                                        trigger_idx = m
                                        break
                                        
                                if mss_triggered:
                                    zone_price = swing_low_val
                                    
                                    if next_high_val > swing_high_val:
                                        bearish_breaker = {
                                            "block_price": zone_price,
                                            "stop_loss": next_high_val,
                                            "sweep_price": next_high_val,
                                            "high_timeframe_level": swing_high_val,
                                            "index": int(i-2)
                                        }
                                    else:
                                        bearish_mitigation = {
                                            "block_price": zone_price,
                                            "stop_loss": next_high_val,
                                            "index": int(i-2)
                                        }
                                    break

        return {
            "bullish_breaker": bullish_breaker,
            "bearish_breaker": bearish_breaker,
            "bullish_mitigation": bullish_mitigation,
            "bearish_mitigation": bearish_mitigation
        }
