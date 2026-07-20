import logging
import numpy as np
import pandas as pd
import yfinance as yf

from backend.data_fetcher import DataFetcher
from backend.gex_engine import GEXEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MarketScreener:
    def __init__(self):
        self.fetcher = DataFetcher()
        self.engine = GEXEngine()

    def screen_symbols(self, symbols: list = None) -> list:
        """
        Screens a watchlist of symbols and aggregates GEX, walls, OVI, skew, setups, and alerts.
        """
        if symbols is None:
            symbols = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'TSLA', 'NVDA']
            
        results = []
        for symbol in symbols:
            try:
                symbol = symbol.upper().strip()
                logger.info(f"Screener: processing symbol {symbol}")
                
                # Fetch option chain (next 5 expirations is enough for rapid screening)
                raw_data = self.fetcher.fetch_options_chain(symbol, max_expirations=5)
                
                # Process GEX
                processed = self.engine.process_options_chain(raw_data)
                aggregated = self.engine.compute_aggregated_exposures(processed)
                
                price = aggregated['current_price']
                flip = aggregated['gamma_flip']
                call_wall = aggregated['call_wall']
                put_wall = aggregated['put_wall']
                
                # Distance to flip
                dist_flip = ((price - flip) / price) * 100
                
                # Regime determination
                regime = "Positive Gamma (Low Vol)" if price >= flip else "Negative Gamma (High Vol)"
                
                # OVI Calculation
                ovi = GEXEngine.calculate_ovi(processed['calls'], processed['puts'])
                
                # Generate Alerts & Setups list
                alerts = []
                setups_triggered = []
                
                # Fetch daily history for Price Action and Setup scans
                hist = pd.DataFrame()
                try:
                    hist = yf.Ticker(symbol).history(period="60d")
                except Exception as hist_err:
                    logger.warning(f"Screener: failed to fetch history for {symbol}: {hist_err}")
                
                if not hist.empty and len(hist) >= 20:
                    last_row = hist.iloc[-1]
                    prev_row = hist.iloc[-2]
                    
                    o_prev, h_prev, l_prev, c_prev = prev_row['Open'], prev_row['High'], prev_row['Low'], prev_row['Close']
                    o_cur, h_cur, l_cur, c_cur = last_row['Open'], last_row['High'], last_row['Low'], last_row['Close']
                    
                    body_cur = abs(c_cur - o_cur)
                    range_cur = h_cur - l_cur
                    
                    # 1. Price Action: Hammer near Put Wall
                    if range_cur > 0:
                        upper_w = h_cur - max(o_cur, c_cur)
                        lower_w = min(o_cur, c_cur) - l_cur
                        
                        if lower_w > body_cur * 1.8 and upper_w < body_cur * 0.5:
                            if abs(price - put_wall) / price <= 0.015:
                                alerts.append(f"Price Action: Daily Hammer at Put Wall ({put_wall:.1f})")
                        
                        # Price Action: Shooting Star near Call Wall
                        if upper_w > body_cur * 1.8 and lower_w < body_cur * 0.5:
                            if abs(price - call_wall) / price <= 0.015:
                                alerts.append(f"Price Action: Daily Shooting Star at Call Wall ({call_wall:.1f})")
                                
                        # Price Action: Bullish Engulfing near key support
                        if (c_prev < o_prev) and (c_cur > o_cur) and (c_cur > o_prev) and (o_cur < c_prev):
                            if (abs(price - put_wall) / price <= 0.015) or (abs(price - flip) / price <= 0.015):
                                alerts.append("Price Action: Daily Bullish Engulfing near support")

                    # --- RUN ADVANCED TECHNICAL SETUPS ---
                    
                    # A. VCP Setup
                    vcp_detected, vcp_summary = self.detect_vcp_pattern(hist)
                    if vcp_detected:
                        setups_triggered.append("VCP Pattern")
                        alerts.append(f"VCP: {vcp_summary}")
                        
                    # B. Breakout Setup
                    breakout_detected, breakout_desc = self.detect_breakout(hist, call_wall)
                    if breakout_detected:
                        setups_triggered.append("Breakout")
                        alerts.append(f"Breakout: {breakout_desc}")
                        
                    # C. Unusual Volume / Options Sweep
                    unusual_vol_detected, vol_desc = self.detect_unusual_volume(hist, processed)
                    if unusual_vol_detected:
                        setups_triggered.append("Unusual Volume")
                        alerts.append(f"Volume: {vol_desc}")
                        
                    # D. Mean Reversion
                    mean_rev_detected, mean_rev_desc = self.detect_mean_reversion(hist, call_wall, put_wall)
                    if mean_rev_detected:
                        setups_triggered.append("Mean Reversion")
                        alerts.append(f"Mean Rev: {mean_rev_desc}")
                        
                    # E. Trend Continuation
                    trend_cont_detected, trend_desc = self.detect_trend_continuation(hist, flip)
                    if trend_cont_detected:
                        setups_triggered.append("Trend Continuation")
                        alerts.append(f"Trend: {trend_desc}")

                # GEX alerts
                if abs(price - call_wall) / price <= 0.005:
                    alerts.append(f"Proximity: Spot at Call Wall ({call_wall:.1f})")
                elif abs(price - put_wall) / price <= 0.005:
                    alerts.append(f"Proximity: Spot at Put Wall ({put_wall:.1f})")
                    
                if abs(dist_flip) <= 0.5:
                    alerts.append(f"Proximity: Spot at Gamma Flip ({flip:.1f})")

                # UOA Alerts
                strikes_df = aggregated['strikes'].copy()
                strikes_df['call_vol_oi_ratio'] = np.where(
                    strikes_df['call_openInterest'] > 0,
                    strikes_df['call_volume'] / strikes_df['call_openInterest'],
                    0.0
                )
                strikes_df['put_vol_oi_ratio'] = np.where(
                    strikes_df['put_openInterest'] > 0,
                    strikes_df['put_volume'] / strikes_df['put_openInterest'],
                    0.0
                )
                
                uoa_calls = strikes_df[(strikes_df['call_volume'] > 500) & (strikes_df['call_vol_oi_ratio'] > 1.5)]
                uoa_puts = strikes_df[(strikes_df['put_volume'] > 500) & (strikes_df['put_vol_oi_ratio'] > 1.5)]
                
                for _, row in uoa_calls.iterrows():
                    alerts.append(f"UOA: Call sweep strike {row['strike']:.1f} (Ratio {row['call_vol_oi_ratio']:.1f})")
                for _, row in uoa_puts.iterrows():
                    alerts.append(f"UOA: Put sweep strike {row['strike']:.1f} (Ratio {row['put_vol_oi_ratio']:.1f})")

                summary = {
                    'symbol': symbol,
                    'price': float(price),
                    'gamma_flip': float(flip),
                    'distance_to_flip_pct': float(dist_flip),
                    'regime': regime,
                    'call_wall': float(call_wall),
                    'put_wall': float(put_wall),
                    'max_gex_strike': float(aggregated['max_gex_strike']),
                    'ovi': float(ovi),
                    'iv_skew': float(aggregated['iv_skew']),
                    'total_gex_dollar': float(aggregated['total_gex_dollar']),
                    'total_vex_dollar': float(aggregated['total_vex_dollar']),
                    'total_cex_dollar': float(aggregated['total_cex_dollar']),
                    'setups': setups_triggered,
                    'alerts': alerts[:5]
                }
                results.append(summary)
            except Exception as e:
                logger.error(f"Screener failed to process {symbol}: {e}")
                results.append({
                    'symbol': symbol,
                    'error': f"Failed to process: {str(e)}"
                })
                
        return results

    def detect_vcp_pattern(self, df_hist: pd.DataFrame) -> tuple:
        """
        Calculates if the stock has formed a Volatility Contraction Pattern (VCP).
        """
        closes = df_hist['Close'].values
        highs = df_hist['High'].values
        lows = df_hist['Low'].values
        volumes = df_hist['Volume'].values
        
        if len(closes) < 30:
            return False, ""
            
        std_5 = np.std(closes[-5:])
        rolling_std = pd.Series(closes).rolling(20).std()
        min_std = rolling_std.min()
        max_std = rolling_std.max()
        pct_rank = (rolling_std.iloc[-1] - min_std) / (max_std - min_std) if max_std > min_std else 0.0
        
        if pct_rank > 0.35:
            return False, ""
            
        peaks = []
        troughs = []
        window = 4
        for i in range(window, len(closes) - window):
            if highs[i] == max(highs[i-window:i+window+1]):
                peaks.append((i, highs[i]))
            if lows[i] == min(lows[i-window:i+window+1]):
                troughs.append((i, lows[i]))
                
        recent_peaks = [p for p in peaks if p[0] >= len(closes) - 45]
        recent_troughs = [t for t in troughs if t[0] >= len(closes) - 45]
        
        if len(recent_peaks) < 2 or len(recent_troughs) < 2:
            return False, ""
            
        depths = []
        for p in recent_peaks:
            next_t = [t for t in recent_troughs if t[0] > p[0]]
            if next_t:
                depths.append(((p[1] - next_t[0][1]) / p[1]) * 100.0)
                
        if len(depths) < 2:
            return False, ""
            
        is_contracting = True
        for i in range(len(depths) - 1):
            if depths[i] <= depths[i+1]:
                is_contracting = False
                break
                
        if not is_contracting:
            if depths[0] > depths[-1] * 1.5 and depths[-1] < 6.0:
                is_contracting = True
            else:
                return False, ""
                
        vol_avg = volumes[-20:].mean()
        vol_last = volumes[-4:].mean()
        if vol_last > 0.85 * vol_avg:
            return False, ""
            
        summary = " -> ".join([f"{d:.1f}%" for d in depths[-3:]])
        return True, f"VCP {len(depths)} contractions ({summary}) with dry volume"

    def detect_breakout(self, df_hist: pd.DataFrame, call_wall: float) -> tuple:
        """
        Detects if stock is breaking out of daily highs or Call Walls on heavy volume.
        """
        closes = df_hist['Close'].values
        highs = df_hist['High'].values
        volumes = df_hist['Volume'].values
        
        price = closes[-1]
        high_20 = highs[-21:-1].max()
        vol_avg_20 = volumes[-21:-1].mean()
        vol_current = volumes[-1]
        
        if price > high_20 and vol_current >= 1.5 * vol_avg_20:
            return True, f"20-day High Breakout (Vol: {vol_current/vol_avg_20:.1f}x)"
        if abs(price - call_wall) / price <= 0.005 and price > call_wall and vol_current >= 1.3 * vol_avg_20:
            return True, "Call Wall Breakout Squeeze"
        return False, ""

    def detect_unusual_volume(self, df_hist: pd.DataFrame, processed_chain: dict) -> tuple:
        """
        Flags extreme volume multipliers in shares or options.
        """
        volumes = df_hist['Volume'].values
        vol_current = volumes[-1]
        vol_avg_20 = volumes[-21:-1].mean()
        
        if vol_current >= 2.0 * vol_avg_20:
            return True, f"Shares Volume spike {vol_current/vol_avg_20:.1f}x"
            
        # Options ratio scan
        max_ratio = 0.0
        for df in [processed_chain['calls'], processed_chain['puts']]:
            if not df.empty:
                r = df['volume'] / (df['openInterest'] + 1.0)
                if r.max() > max_ratio:
                    max_ratio = r.max()
        if max_ratio > 1.5:
            return True, f"Options sweep outlier ({max_ratio:.1f}x Vol/OI)"
        return False, ""

    def detect_mean_reversion(self, df_hist: pd.DataFrame, call_wall: float, put_wall: float) -> tuple:
        """
        Flags extreme overextensions or test of GEX Walls.
        """
        closes = df_hist['Close'].values
        price = closes[-1]
        ema_20 = pd.Series(closes).ewm(span=20, adjust=False).mean().iloc[-1]
        
        std_20 = np.std(closes[-20:])
        dist_ema = price - ema_20
        z_score = dist_ema / std_20 if std_20 > 1e-9 else 0.0
        
        if abs(price - call_wall) / price <= 0.005:
            return True, f"Stalling at Call Wall Resistance ({call_wall:.1f})"
        if abs(price - put_wall) / price <= 0.005:
            return True, f"Holding at Put Wall Support ({put_wall:.1f})"
        if abs(z_score) >= 2.2:
            return True, f"Overextended Z-Score = {z_score:.1f} from 20-day EMA"
        return False, ""

    def detect_trend_continuation(self, df_hist: pd.DataFrame, flip_level: float) -> tuple:
        """
        Flags low-volume pullbacks to key support (20-day EMA or GEX Flip level) in a strong trend.
        """
        closes = df_hist['Close'].values
        price = closes[-1]
        volumes = df_hist['Volume'].values
        
        ema_20 = pd.Series(closes).ewm(span=20, adjust=False).mean()
        ema_50 = pd.Series(closes).ewm(span=50, adjust=False).mean()
        
        # Check if trend is established
        bullish_trend = ema_20.iloc[-1] > ema_20.iloc[-5] and ema_50.iloc[-1] > ema_50.iloc[-5]
        bearish_trend = ema_20.iloc[-1] < ema_20.iloc[-5] and ema_50.iloc[-1] < ema_50.iloc[-5]
        
        vol_avg = volumes[-20:].mean()
        vol_current = volumes[-1]
        
        if bullish_trend:
            # Price pulls back close to 20-day EMA from above
            if price >= ema_20.iloc[-1] and (price - ema_20.iloc[-1]) / price <= 0.015:
                if vol_current < 0.9 * vol_avg: # volume dry up
                    return True, "Bullish pullback to 20 EMA on low volume"
            # Pullback to GEX flip (as support)
            if price >= flip_level and (price - flip_level) / price <= 0.005:
                if vol_current < 0.9 * vol_avg:
                    return True, "Bullish test of Flip support level"
                    
        if bearish_trend:
            if price <= ema_20.iloc[-1] and (ema_20.iloc[-1] - price) / price <= 0.015:
                if vol_current < 0.9 * vol_avg:
                    return True, "Bearish rally to 20 EMA on low volume"
            if price <= flip_level and (flip_level - price) / price <= 0.005:
                if vol_current < 0.9 * vol_avg:
                    return True, "Bearish test of Flip resistance level"
                    
        return False, ""
