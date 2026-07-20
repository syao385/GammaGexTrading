import time
import logging
import asyncio
import traceback
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime

from backend.database import save_symbol_metrics, init_db
from backend.data_fetcher import DataFetcher
from backend.gex_engine import GEXEngine
from backend.screener import MarketScreener

logger = logging.getLogger(__name__)

# Fallback pool in case network Wikipedia requests fail
LIQUID_POOL = [
    # Indices & Sector ETFs
    'SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLK', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLB', 'XLU', 'XRT', 'XBI', 'SMH', 'KWEB', 'EEM', 'GDX',
    # Tech / Mega Caps
    'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', 'NFLX', 'AMD', 'AVGO', 'QCOM', 'MU', 'INTC', 'ADBE', 'CRM', 'ORCL', 'CSCO',
    # Financials
    'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'AXP',
    # Energy / Materials
    'XOM', 'CVX', 'COP', 'SLB', 'FCX', 'NEM',
    # Healthcare
    'UNH', 'LLY', 'JNJ', 'PFE', 'ABBV', 'MRK', 'GILD',
    # Industrials / Discretionary
    'CAT', 'DE', 'GE', 'HON', 'LMT', 'UPS', 'FDX', 'HD', 'WMT', 'COST', 'MCD', 'NKE', 'SBUX', 'DIS',
    # Commodities / Fixed Income / Other
    'TLT', 'HYG', 'GLD', 'SLV', 'USO', 'UNG', 'SQ', 'PYPL', 'UBER', 'LYFT', 'COIN', 'MARA', 'RIOT', 'BABA', 'JD'
]

# Shared scanner lock and status to prevent duplicate runs
scanner_status = {
    "is_running": False,
    "progress": 0,
    "total": 0,
    "last_run": None,
    "error": None
}
scanner_lock = asyncio.Lock()

def get_liquid_universe_symbols() -> list:
    """
    Dynamically loads the 1,000+ most liquid optionable US equities & ETFs
    from S&P 500, S&P 400 MidCap, Nasdaq 100, and popular retail names.
    """
    symbols = set()
    
    # 1. Major sector/thematic ETFs
    etfs = [
        'SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'SOXX', 'XBI', 'IBB', 'XLF', 'XLE', 'XLK', 'XLV', 
        'XLI', 'XLY', 'XLP', 'XLB', 'XLU', 'XLRE', 'XRT', 'KRE', 'GDX', 'GDXJ', 'EEM', 'EFA',
        'TLT', 'HYG', 'LQD', 'GLD', 'SLV', 'USO', 'UNG', 'KWEB', 'FXI', 'EWG', 'EWJ', 'EWZ'
    ]
    symbols.update(etfs)
    
    # 2. Fetch S&P 500 components from Wikipedia
    try:
        url_sp = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
        sp_tables = pd.read_html(url_sp)
        sp_df = sp_tables[0]
        sp_tickers = sp_df['Symbol'].tolist()
        sp_tickers = [s.replace('.', '-') for s in sp_tickers]
        symbols.update(sp_tickers)
        logger.info(f"Background Scanner: Loaded {len(sp_tickers)} S&P 500 symbols from Wikipedia.")
    except Exception as e:
        logger.warning(f"Background Scanner: Failed to fetch S&P 500 from Wikipedia: {e}")
        
    # 3. Fetch S&P MidCap 400 components from Wikipedia
    try:
        url_mid = "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies"
        mid_tables = pd.read_html(url_mid)
        mid_df = mid_tables[0]
        col = 'Symbol' if 'Symbol' in mid_df.columns else 'Ticker symbol'
        if col in mid_df.columns:
            mid_tickers = mid_df[col].tolist()
            mid_tickers = [s.replace('.', '-') for s in mid_tickers]
            symbols.update(mid_tickers)
            logger.info(f"Background Scanner: Loaded {len(mid_tickers)} S&P 400 symbols from Wikipedia.")
    except Exception as e:
        logger.warning(f"Background Scanner: Failed to fetch S&P 400 from Wikipedia: {e}")

    # 4. Fetch Nasdaq 100 components from Wikipedia
    try:
        url_ndx = "https://en.wikipedia.org/wiki/Nasdaq-100"
        ndx_tables = pd.read_html(url_ndx)
        for table in ndx_tables:
            if 'Ticker' in table.columns:
                ndx_tickers = table['Ticker'].tolist()
                ndx_tickers = [s.replace('.', '-') for s in ndx_tickers]
                symbols.update(ndx_tickers)
                logger.info(f"Background Scanner: Loaded {len(ndx_tickers)} Nasdaq 100 symbols from Wikipedia.")
                break
    except Exception as e:
        logger.warning(f"Background Scanner: Failed to fetch Nasdaq 100 from Wikipedia: {e}")
        
    # 5. Add retail trading leaders
    retail_leaders = [
        'PLTR', 'COIN', 'HOOD', 'SOFI', 'DKNG', 'GME', 'AMC', 'RBLX', 'SNOW', 'MDB', 'CRWD', 'DDOG', 
        'NET', 'OKTA', 'ZS', 'PATH', 'U', 'RIVN', 'LCID', 'SQ', 'PYPL', 'UBER', 'LYFT', 'MARA', 'RIOT',
        'BABA', 'JD', 'PDD', 'NIO', 'LI', 'XPEV', 'FUTU', 'TME', 'AFRM', 'SOUN', 'BILI', 'UPST', 'CVNA'
    ]
    symbols.update(retail_leaders)
    
    # Fallback to static list if wiki fetches failed
    if len(symbols) < 100:
        symbols.update(LIQUID_POOL)
        
    return sorted(list(symbols))

async def run_universe_scan():
    """
    Asynchronous task that filters and scans the liquid pool,
    calculates metrics, and populates the SQLite database.
    """
    global scanner_status
    if scanner_status["is_running"]:
        logger.warning("Background scanner is already running.")
        return
        
    async with scanner_lock:
        scanner_status["is_running"] = True
        scanner_status["progress"] = 0
        scanner_status["error"] = None
        
        try:
            # Dynamically fetch 1000+ most liquid assets
            logger.info("Compiling dynamic liquid symbols universe (~1000 tickers)...")
            pool = get_liquid_universe_symbols()
            scanner_status["total"] = len(pool)
            scanner_status["progress"] = 0
            
            logger.info(f"Starting background scan of the Liquid Universe ({len(pool)} tickers)...")
            
            # Ensure DB is initialized
            init_db()
            
            fetcher = DataFetcher()
            engine = GEXEngine()
            screener = MarketScreener()
            
            for index, symbol in enumerate(pool):
                try:
                    logger.info(f"Scanning {symbol} ({index+1}/{len(pool)})...")
                    ticker = yf.Ticker(symbol)
                    
                    # 1. Fetch 50 days of historical bars to compute averages and check criteria
                    hist = ticker.history(period="60d")
                    if hist.empty or len(hist) < 20:
                        logger.warning(f"Skipping {symbol}: Insufficient historical price data.")
                        scanner_status["progress"] = index + 1
                        continue
                        
                    # Calculate filters
                    last_row = hist.iloc[-1]
                    price = float(last_row['Close'])
                    avg_volume = float(hist['Volume'].tail(20).mean())
                    
                    # Criteria check
                    if price < 10.0:
                        logger.info(f"Skipping {symbol}: Price is ${price:.2f} (criteria: >= 10.0)")
                        scanner_status["progress"] = index + 1
                        continue
                        
                    if avg_volume < 500000:
                        logger.info(f"Skipping {symbol}: Avg daily volume is {avg_volume:.0f} shares (criteria: > 500k)")
                        scanner_status["progress"] = index + 1
                        continue
                        
                    # Check if optionable
                    options = ticker.options
                    if not options:
                        logger.info(f"Skipping {symbol}: No option contracts found.")
                        scanner_status["progress"] = index + 1
                        continue
                        
                    # 2. Fetch Option Chain (max 4 expirations for screening speed)
                    try:
                        raw_chain = fetcher.fetch_options_chain(symbol, max_expirations=4)
                    except Exception as chain_err:
                        logger.warning(f"Skipping {symbol}: Option chain fetch failed: {chain_err}")
                        scanner_status["progress"] = index + 1
                        continue
                        
                    # 3. Process options data & GEX walls
                    processed = engine.process_options_chain(raw_chain)
                    aggregated = engine.compute_aggregated_exposures(processed)
                    
                    call_wall = float(aggregated['call_wall'])
                    put_wall = float(aggregated['put_wall'])
                    gamma_flip = float(aggregated['gamma_flip'])
                    net_gex_status = "Positive" if price >= gamma_flip else "Negative"
                    
                    # 4. Compute moving averages
                    closes = hist['Close'].values
                    ema_20 = float(hist['Close'].ewm(span=20, adjust=False).mean().iloc[-1])
                    ema_50 = float(hist['Close'].ewm(span=50, adjust=False).mean().iloc[-1])
                    ema_20_dist = ((price - ema_20) / price) * 100
                    ema_50_dist = ((price - ema_50) / price) * 100
                    
                    # 5. Determine Trend Direction
                    ema_20_hist = hist['Close'].ewm(span=20, adjust=False).mean()
                    ema_50_hist = hist['Close'].ewm(span=50, adjust=False).mean()
                    if ema_20_hist.iloc[-1] > ema_20_hist.iloc[-5] and ema_50_hist.iloc[-1] > ema_50_hist.iloc[-5]:
                        trend_direction = "Bullish"
                    elif ema_20_hist.iloc[-1] < ema_20_hist.iloc[-5] and ema_50_hist.iloc[-1] < ema_50_hist.iloc[-5]:
                        trend_direction = "Bearish"
                    else:
                        trend_direction = "Neutral"
                        
                    # 6. Run Screener Technical Setup Detectors
                    alerts = []
                    
                    # A. Breakout Check
                    # Close > 20-day high (excluding today) and volume > 1.5x average
                    high_20 = float(hist['High'].iloc[-21:-1].max())
                    current_volume = float(last_row['Volume'])
                    vol_avg_20 = float(hist['Volume'].iloc[-21:-1].mean())
                    if price > high_20 and current_volume >= 1.5 * vol_avg_20:
                        alerts.append("Breakout: 20-Day Range Break")
                    elif abs(price - call_wall) / price <= 0.005 and price > call_wall:
                        alerts.append("Breakout: Call Wall Breach")
                        
                    # B. Unusual Volume (Vol > 2.0x average)
                    if current_volume >= 2.0 * vol_avg_20:
                        alerts.append(f"Unusual Vol: Volume {current_volume/vol_avg_20:.1f}x of 20-day MA")
                        
                    # Check options unusual sweeps
                    option_vol_oi_max = 0.0
                    for chain in [processed['calls'], processed['puts']]:
                        if not chain.empty:
                            ratio = chain['volume'] / (chain['openInterest'] + 1.0)
                            max_ratio = ratio.max()
                            if max_ratio > option_vol_oi_max:
                                option_vol_oi_max = max_ratio
                    if option_vol_oi_max > 1.5:
                        alerts.append(f"Unusual Vol: Options UOA sweep ratio {option_vol_oi_max:.1f}x")
                        
                    # C. VCP Check
                    vcp_detected, vcp_summary = detect_vcp_pattern_local(hist)
                    if vcp_detected:
                        alerts.append(f"VCP Pattern: {vcp_summary}")
                        
                    # D. Mean Reversion check
                    # Within 0.5% of Call/Put Wall, and price far from 20-day EMA
                    if abs(price - call_wall) / price <= 0.005:
                        alerts.append(f"Mean Rev: At Call Wall ({call_wall:.2f})")
                    elif abs(price - put_wall) / price <= 0.005:
                        alerts.append(f"Mean Rev: At Put Wall ({put_wall:.2f})")
                    elif abs(ema_20_dist) > 5.0:
                        alerts.append(f"Mean Rev: Overextended {ema_20_dist:.1f}% from 20-day EMA")
                        
                    # E. Trend Continuation Check
                    # Spot pulls back to test 20 EMA in strong trend with low volume
                    if trend_direction == "Bullish" and abs(price - ema_20) / price <= 0.015:
                        # Pullback check (price low tested near EMA, close holds above, volume low)
                        if price >= ema_20 and current_volume < vol_avg_20:
                            alerts.append("Trend Cont: Pullback to 20-day EMA")
                            
                    # 7. Save to Database
                    metrics = {
                        "price": price,
                        "avg_volume": avg_volume,
                        "optionable": True,
                        "last_updated": time.time(),
                        "call_wall": call_wall,
                        "put_wall": put_wall,
                        "gamma_flip": gamma_flip,
                        "net_gex_status": net_gex_status,
                        "vcp_status": vcp_summary if vcp_detected else "No contraction",
                        "trend_direction": trend_direction,
                        "ema_20_dist": ema_20_dist,
                        "ema_50_dist": ema_50_dist,
                        "alerts": alerts
                    }
                    save_symbol_metrics(symbol, metrics)
                    logger.info(f"Saved {symbol} metrics successfully. Alerts: {alerts}")
                    
                except Exception as sym_err:
                    logger.error(f"Error scanning symbol {symbol}: {sym_err}")
                
                # Throttle requests to avoid yfinance rate limits
                await asyncio.sleep(1.0)
                
                # Update progress
                scanner_status["progress"] = index + 1
                
            scanner_status["last_run"] = datetime.now().isoformat()
            logger.info("Finished background scan of the Liquid Universe.")
            
        except Exception as e:
            scanner_status["error"] = str(e)
            logger.error(f"Background scanner failed: {e}\n{traceback.format_exc()}")
        finally:
            scanner_status["is_running"] = False

def detect_vcp_pattern_local(df_hist: pd.DataFrame) -> tuple:
    """
    Locates Volatility Contraction Pattern (VCP) waves in daily price series.
    Returns: (bool vcp_detected, str summary)
    """
    closes = df_hist['Close'].values
    highs = df_hist['High'].values
    lows = df_hist['Low'].values
    volumes = df_hist['Volume'].values
    
    # Needs at least 30 days
    if len(closes) < 30:
        return False, "Insufficient history"
        
    std_5 = np.std(closes[-5:])
    rolling_std = pd.Series(closes).rolling(20).std()
    min_std_20 = rolling_std.min()
    max_std_20 = rolling_std.max()
    
    if max_std_20 - min_std_20 > 1e-9:
        pct_rank = (rolling_std.iloc[-1] - min_std_20) / (max_std_20 - min_std_20)
    else:
        pct_rank = 0.0
        
    if pct_rank > 0.35:
        return False, "Not compressed"
        
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
        return False, "Not enough swing points"
        
    depths = []
    for peak in recent_peaks:
        next_troughs = [t for t in recent_troughs if t[0] > peak[0]]
        if next_troughs:
            trough = next_troughs[0]
            depth = (peak[1] - trough[1]) / peak[1]
            depths.append(depth * 100.0)
            
    if len(depths) < 2:
        return False, "Too few contraction waves"
        
    is_contracting = True
    for i in range(len(depths) - 1):
        if depths[i] <= depths[i+1]:
            is_contracting = False
            break
            
    if not is_contracting:
        if depths[0] > depths[-1] * 1.5 and depths[-1] < 6.0:
            is_contracting = True
        else:
            return False, "Not contracting"
            
    vol_avg = volumes[-20:].mean()
    vol_last_4 = volumes[-4:].mean()
    if vol_last_4 > 0.85 * vol_avg:
        return False, "Volume did not dry up"
        
    waves_summary = " -> ".join([f"{d:.1f}%" for d in depths[-3:]])
    return True, f"{len(depths)} contractions ({waves_summary}) with dry volume"

def get_scanner_status():
    global scanner_status
    return scanner_status

# --- AUTOMATIC BACKGROUND SCHEDULER ---
AUTO_REBUILD_ENABLED = True
AUTO_REBUILD_TIME_EST = "08:30"  # 24-hour format in New York time (EST/EDT)

async def auto_rebuild_scheduler_loop():
    """
    Asynchronous loop that runs inside the web server process and triggers
    a database rebuild scan at 8:30 AM EST/EDT every weekday (Monday-Friday).
    """
    from zoneinfo import ZoneInfo
    from datetime import datetime, timedelta
    
    logger.info("Auto-Rebuild: Scheduler Loop started.")
    while AUTO_REBUILD_ENABLED:
        try:
            tz = ZoneInfo("America/New_York")
            now_ny = datetime.now(tz)
            
            # Parse target hour and minute
            target_hour, target_min = map(int, AUTO_REBUILD_TIME_EST.split(":"))
            target_time = now_ny.replace(hour=target_hour, minute=target_min, second=0, microsecond=0)
            
            # If target time is in the past for today, schedule it for tomorrow
            if now_ny >= target_time:
                target_time += timedelta(days=1)
                
            # If the scheduled day is a weekend, shift to Monday
            while target_time.weekday() >= 5:
                target_time += timedelta(days=1)
                
            # Calculate sleep duration
            sleep_seconds = (target_time - now_ny).total_seconds()
            logger.info(f"Auto-Rebuild: Next database scan scheduled for {target_time.strftime('%Y-%m-%d %H:%M:%S')} EST (sleeping {sleep_seconds:.1f} seconds)")
            
            await asyncio.sleep(sleep_seconds)
            
            # Double check config before triggering
            if AUTO_REBUILD_ENABLED:
                logger.info("Auto-Rebuild: Scheduled trigger reached. Rebuilding database...")
                await run_universe_scan()
                
        except asyncio.CancelledError:
            logger.info("Auto-Rebuild: Scheduler Loop task cancelled.")
            break
        except Exception as err:
            logger.error(f"Auto-Rebuild: Scheduler Loop encountered error: {err}")
            await asyncio.sleep(60) # Wait 1 minute before retrying to prevent loops on persistent failures

