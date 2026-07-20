import logging
import numpy as np
import pandas as pd
import yfinance as yf

from backend.data_fetcher import DataFetcher
from backend.gex_engine import GEXEngine
from backend.volume_profile import VolumeProfileCalculator
from backend.smart_money_detector import SmartMoneyDetector

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MarketScreener:
    def __init__(self):
        self.fetcher = DataFetcher()
        self.engine = GEXEngine()

    def screen_symbols(self, symbols: list = None) -> list:
        """
        Screens a watchlist of symbols and aggregates GEX, walls, Volume Profile levels,
        Smart Money setups (Breakers/FVGs), and the Playbook 10-point ASSET score.
        """
        if symbols is None:
            symbols = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'TSLA', 'NVDA']
            
        results = []
        for symbol in symbols:
            try:
                symbol = symbol.upper().strip()
                logger.info(f"Screener: processing symbol {symbol}")
                
                # Fetch option chain (next 5 expirations for screening speed)
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
                
                # 1. Fetch Daily History (for 25-day, 60-day Volume Profiles & basic technical filters)
                hist = pd.DataFrame()
                try:
                    hist = yf.Ticker(symbol).history(period="60d")
                except Exception as hist_err:
                    logger.warning(f"Screener: failed to fetch daily history for {symbol}: {hist_err}")
                
                # 2. Fetch Intraday 5-minute History (for 5-day Volume Profile, FVG, & Breaker detection)
                hist_5m = pd.DataFrame()
                try:
                    hist_5m = yf.Ticker(symbol).history(period="5d", interval="5m")
                except Exception as h5m_err:
                    logger.warning(f"Screener: failed to fetch 5m history for {symbol}: {h5m_err}")

                # Default values for profiles
                vp_5d = {"poc": 0.0, "vah": 0.0, "val": 0.0, "hvn": [], "lvn": []}
                vp_25d = {"poc": 0.0, "vah": 0.0, "val": 0.0, "hvn": [], "lvn": []}
                vp_60d = {"poc": 0.0, "vah": 0.0, "val": 0.0, "hvn": [], "lvn": []}
                fvgs = []
                breakers = {"bullish_breaker": None, "bearish_breaker": None, "bullish_mitigation": None, "bearish_mitigation": None}

                if not hist.empty and len(hist) >= 20:
                    # Calculate Volume Profiles
                    # Day trading lookback: 5-day composite from 5-minute bars
                    if not hist_5m.empty:
                        vp_5d = VolumeProfileCalculator.calculate_volume_profile(hist_5m)
                        fvgs = SmartMoneyDetector.detect_fvgs(hist_5m)
                        breakers = SmartMoneyDetector.detect_breaker_and_mitigation_blocks(hist_5m)
                    else:
                        vp_5d = VolumeProfileCalculator.calculate_volume_profile(hist.tail(5))
                        
                    # Swing trading lookback: 25-day (5 weeks) from daily
                    vp_25d = VolumeProfileCalculator.calculate_volume_profile(hist.tail(25))
                    # Macro lookback: 60-day rolling from daily
                    vp_60d = VolumeProfileCalculator.calculate_volume_profile(hist)

                    # Technical indicators
                    closes = hist['Close'].values
                    last_row = hist.iloc[-1]
                    prev_row = hist.iloc[-2]
                    
                    o_prev, h_prev, l_prev, c_prev = prev_row['Open'], prev_row['High'], prev_row['Low'], prev_row['Close']
                    o_cur, h_cur, l_cur, c_cur = last_row['Open'], last_row['High'], last_row['Low'], last_row['Close']
                    
                    body_cur = abs(c_cur - o_cur)
                    range_cur = h_cur - l_cur
                    vol_current = last_row['Volume']
                    vol_avg_20 = hist['Volume'].iloc[-21:-1].mean()
                    
                    # Hammer / Shooting Star Price Action checks
                    if range_cur > 0:
                        upper_w = h_cur - max(o_cur, c_cur)
                        lower_w = min(o_cur, c_cur) - l_cur
                        
                        if lower_w > body_cur * 1.8 and upper_w < body_cur * 0.5:
                            if abs(price - put_wall) / price <= 0.015:
                                alerts.append(f"Price Action: Daily Hammer at Put Wall ({put_wall:.1f})")
                        
                        if upper_w > body_cur * 1.8 and lower_w < body_cur * 0.5:
                            if abs(price - call_wall) / price <= 0.015:
                                alerts.append(f"Price Action: Daily Shooting Star at Call Wall ({call_wall:.1f})")
                                
                        if (c_prev < o_prev) and (c_cur > o_cur) and (c_cur > o_prev) and (o_cur < c_prev):
                            if (abs(price - put_wall) / price <= 0.015) or (abs(price - flip) / price <= 0.015):
                                alerts.append("Price Action: Daily Bullish Engulfing near support")

                    # Generate EST timestamp for setups
                    from datetime import datetime, timezone, timedelta
                    est_tz = timezone(timedelta(hours=-5))
                    est_time = datetime.now(timezone.utc).astimezone(est_tz)
                    est_timestamp_str = est_time.strftime("%Y-%m-%d %H:%M:%S")
                    time_short_str = est_time.strftime("%H:%M:%S EST")
                    
                    bias_direction = "Long" if price >= flip else "Short"

                    # Run Standard Setup Scans
                    vcp_detected, vcp_summary = self.detect_vcp_pattern(hist)
                    if vcp_detected:
                        setups_triggered.append(f"VCP Pattern [Long] @ {time_short_str}")
                        alerts.append(f"VCP Pattern [Long] @ {time_short_str}: {vcp_summary}")
                        
                    breakout_detected, breakout_desc = self.detect_breakout(hist, call_wall)
                    if breakout_detected:
                        setups_triggered.append(f"Breakout [Long] @ {time_short_str}")
                        alerts.append(f"Breakout [Long] @ {time_short_str}: {breakout_desc}")
                        
                    unusual_vol_detected, vol_desc = self.detect_unusual_volume(hist, processed)
                    if unusual_vol_detected:
                        setups_triggered.append(f"Unusual Volume [{bias_direction}] @ {time_short_str}")
                        alerts.append(f"Volume [{bias_direction}] @ {time_short_str}: {vol_desc}")
                        
                    mean_rev_detected, mean_rev_desc = self.detect_mean_reversion(hist, call_wall, put_wall)
                    if mean_rev_detected:
                        mr_dir = "Short" if ("call wall" in mean_rev_desc.lower() or ("z-score" in mean_rev_desc.lower() and "-" not in mean_rev_desc)) else "Long"
                        setups_triggered.append(f"Mean Reversion [{mr_dir}] @ {time_short_str}")
                        alerts.append(f"Mean Rev [{mr_dir}] @ {time_short_str}: {mean_rev_desc}")
                        
                    trend_cont_detected, trend_desc = self.detect_trend_continuation(hist, flip)
                    if trend_cont_detected:
                        setups_triggered.append(f"Trend Continuation [{bias_direction}] @ {time_short_str}")
                        alerts.append(f"Trend [{bias_direction}] @ {time_short_str}: {trend_desc}")

                    # Run Smart Money Scans
                    if fvgs:
                        active_fvgs = [f for f in fvgs if f['state'] == "active"]
                        if active_fvgs:
                            fvg_dir = "Long" if active_fvgs[0]['type'] == 'bullish' else "Short"
                            setups_triggered.append(f"Active FVG Imbalance [{fvg_dir}] @ {time_short_str}")
                            alerts.append(f"FVG [{fvg_dir}] @ {time_short_str}: {len(active_fvgs)} active gaps on 5m chart")
                    
                    if breakers.get("bullish_breaker") or breakers.get("bearish_breaker"):
                        breaker_dir = "Long" if breakers.get("bullish_breaker") else "Short"
                        setups_triggered.append(f"Breaker Block [{breaker_dir}] @ {time_short_str}")
                        alerts.append(f"Breaker [{breaker_dir}] @ {time_short_str}: {breaker_dir} structure shift on 5m chart")

                    setup_timestamp = est_timestamp_str if len(setups_triggered) > 0 else ""

                    # --- COMPUTE 10-POINT PLAYBOOK SCORECARD ---
                    bias_direction = "long" if price >= flip else "short"
                    
                    # 1. Catalyst & RVOL (Max 2.0 pts)
                    cat_points = 0.0
                    rvol_ratio = vol_current / vol_avg_20 if vol_avg_20 > 0 else 1.0
                    if rvol_ratio >= 2.0:
                        cat_points += 1.0
                    if rvol_ratio >= 3.0 or unusual_vol_detected:
                        cat_points += 1.0
                    
                    # 2. Index & HTF Alignment (Max 2.0 pts)
                    align_points = 0.0
                    ema_20_daily = pd.Series(closes).ewm(span=20, adjust=False).mean().iloc[-1]
                    ema_50_daily = pd.Series(closes).ewm(span=50, adjust=False).mean().iloc[-1]
                    stock_bullish_htf = price > ema_20_daily > ema_50_daily
                    stock_bearish_htf = price < ema_20_daily < ema_50_daily
                    
                    if (bias_direction == "long" and stock_bullish_htf) or (bias_direction == "short" and stock_bearish_htf):
                        align_points += 1.0
                        
                    spy_aligned = False
                    try:
                        if symbol == 'SPY':
                            spy_aligned = (stock_bullish_htf if bias_direction == "long" else stock_bearish_htf)
                        else:
                            spy_hist = yf.Ticker('SPY').history(period="60d")
                            if not spy_hist.empty:
                                spy_closes = spy_hist['Close'].values
                                spy_ema_20 = pd.Series(spy_closes).ewm(span=20, adjust=False).mean().iloc[-1]
                                spy_ema_50 = pd.Series(spy_closes).ewm(span=50, adjust=False).mean().iloc[-1]
                                if bias_direction == "long" and spy_closes[-1] > spy_ema_20 > spy_ema_50:
                                    spy_aligned = True
                                elif bias_direction == "short" and spy_closes[-1] < spy_ema_20 < spy_ema_50:
                                    spy_aligned = True
                    except Exception:
                        pass
                    if spy_aligned:
                        align_points += 1.0

                    # 3. Relative Strength (RS/RW) (Max 2.0 pts)
                    rs_points = 0.0
                    try:
                        if symbol != 'SPY':
                            perf_sym = (closes[-1] / closes[-2] - 1.0) * 100.0
                            spy_hist = yf.Ticker('SPY').history(period="2d")
                            if not spy_hist.empty and len(spy_hist) >= 2:
                                perf_spy = (spy_hist['Close'].iloc[-1] / spy_hist['Close'].iloc[-2] - 1.0) * 100.0
                                rs_daily_spread = perf_sym - perf_spy
                                if (bias_direction == "long" and rs_daily_spread > 0) or (bias_direction == "short" and rs_daily_spread < 0):
                                    rs_points += 1.0
                                    
                            if not hist_5m.empty and len(hist_5m) >= 5:
                                sym_5d_perf = (closes[-1] / closes[-5] - 1.0) * 100.0
                                spy_hist_5d = yf.Ticker('SPY').history(period="5d")
                                if not spy_hist_5d.empty:
                                    spy_5d_perf = (spy_hist_5d['Close'].iloc[-1] / spy_hist_5d['Close'].iloc[0] - 1.0) * 100.0
                                    rs_5d_spread = sym_5d_perf - spy_5d_perf
                                    if (bias_direction == "long" and rs_5d_spread > 0) or (bias_direction == "short" and rs_5d_spread < 0):
                                        rs_points += 1.0
                        else:
                            # SPY RS vs QQQ fallback
                            perf_sym = (closes[-1] / closes[-2] - 1.0) * 100.0
                            qqq_hist = yf.Ticker('QQQ').history(period="2d")
                            if not qqq_hist.empty and len(qqq_hist) >= 2:
                                perf_qqq = (qqq_hist['Close'].iloc[-1] / qqq_hist['Close'].iloc[-2] - 1.0) * 100.0
                                rs_daily_spread = perf_sym - perf_qqq
                                if (bias_direction == "long" and rs_daily_spread > 0) or (bias_direction == "short" and rs_daily_spread < 0):
                                    rs_points += 1.0
                            rs_points += 1.0  # default second point for index base
                    except Exception:
                        pass

                    # 4. Location / Zone (Linchpin) (Max 2.0 pts)
                    loc_points = 0.0
                    dist_call = abs(price - call_wall) / price
                    dist_put = abs(price - put_wall) / price
                    dist_val_flip = abs(price - flip) / price
                    if min(dist_call, dist_put, dist_val_flip) <= 0.007:
                        loc_points += 1.0
                        
                    dist_vah = abs(price - vp_5d['vah']) / price if vp_5d['vah'] > 0 else 999.0
                    dist_val = abs(price - vp_5d['val']) / price if vp_5d['val'] > 0 else 999.0
                    dist_poc = abs(price - vp_5d['poc']) / price if vp_5d['poc'] > 0 else 999.0
                    if min(dist_vah, dist_val, dist_poc) <= 0.007:
                        loc_points += 1.0

                    # 5. Tactical Trigger (Tape) (Max 1.0 pt)
                    trig_points = 0.0
                    active_fvgs = [f for f in fvgs if f['state'] == "active"]
                    has_fvg = False
                    has_breaker = False
                    if bias_direction == "long":
                        has_fvg = any(f['type'] == "bullish" for f in active_fvgs)
                        has_breaker = (breakers.get('bullish_breaker') is not None)
                    else:
                        has_fvg = any(f['type'] == "bearish" for f in active_fvgs)
                        has_breaker = (breakers.get('bearish_breaker') is not None)
                    if has_fvg or has_breaker or len(setups_triggered) > 0:
                        trig_points += 1.0

                    # 6. Risk/Reward Ratio (Skew) (Max 1.0 pt)
                    rr_points = 0.0
                    stop_dist = min(dist_put, dist_val_flip) if bias_direction == "long" else min(dist_call, dist_val_flip)
                    target_dist = dist_call if bias_direction == "long" else dist_put
                    if stop_dist > 0 and (target_dist / stop_dist) >= 2.5:
                        rr_points += 1.0
                        
                    confluence_score = float(cat_points + align_points + rs_points + loc_points + trig_points + rr_points)
                    
                    if confluence_score >= 8.5:
                        asset_grade = "A"
                        sizing_recommendation = "Grade A Setup: Full Size (100% Risk)"
                    elif confluence_score >= 6.5:
                        asset_grade = "B"
                        sizing_recommendation = "Grade B Setup: Muted Size (50% Risk)"
                    elif confluence_score >= 4.5:
                        asset_grade = "C"
                        sizing_recommendation = "Grade C Setup: Trial Size (20% Risk)"
                    else:
                        asset_grade = "D"
                        sizing_recommendation = "Grade D Setup: Stay Out (0% Risk)"

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
                    'alerts': alerts[:5],
                    'setup_timestamp': setup_timestamp,
                    'volume_profile_poc': float(vp_5d['poc']),
                    'volume_profile_vah': float(vp_5d['vah']),
                    'volume_profile_val': float(vp_5d['val']),
                    'volume_profile_poc_25d': float(vp_25d['poc']),
                    'volume_profile_vah_25d': float(vp_25d['vah']),
                    'volume_profile_val_25d': float(vp_25d['val']),
                    'volume_profile_poc_60d': float(vp_60d['poc']),
                    'volume_profile_vah_60d': float(vp_60d['vah']),
                    'volume_profile_val_60d': float(vp_60d['val']),
                    'asset_grade': asset_grade,
                    'asset_confluence_score': float(confluence_score),
                    'asset_sizing_recommendation': sizing_recommendation,
                    'scorecard_breakdown': {
                        'catalyst': float(cat_points),
                        'alignment': float(align_points),
                        'rs_rw': float(rs_points),
                        'location': float(loc_points),
                        'trigger': float(trig_points),
                        'risk_reward': float(rr_points)
                    }
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
