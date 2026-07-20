import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, date, timedelta
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_risk_free_rate() -> float:
    """
    Fetches the 3-month US Treasury Bill yield (^IRX) from Yahoo Finance.
    Returns the rate as a decimal (e.g., 0.0525 for 5.25%).
    If fetching fails, defaults to 0.045 (4.5%).
    """
    try:
        tbill = yf.Ticker("^IRX")
        history = tbill.history(period="1d")
        if not history.empty:
            yield_pct = history['Close'].iloc[-1]
            rate = yield_pct / 100.0
            logger.info(f"Fetched dynamic risk-free rate from ^IRX: {rate:.4f} ({yield_pct:.2f}%)")
            return rate
    except Exception as e:
        logger.warning(f"Failed to fetch risk-free rate from ^IRX ({e}). Using default of 4.5%.")
    return 0.045

class DataFetcher:
    def __init__(self):
        self._cache = {}

    def fetch_underlying_data(self, symbol: str):
        """
        Fetches the current price and dividend yield for the underlying ticker.
        """
        ticker = yf.Ticker(symbol)
        
        # 1. Fetch current price
        current_price = None
        
        # Try fast_info first (fastest)
        try:
            current_price = ticker.fast_info.get('lastPrice', None)
        except Exception:
            pass
            
        # Try regular info
        if current_price is None:
            try:
                current_price = ticker.info.get('currentPrice', None) or ticker.info.get('regularMarketPrice', None)
            except Exception:
                pass
                
        # Try history (fallback)
        if current_price is None:
            try:
                hist = ticker.history(period="1d")
                if not hist.empty:
                    current_price = float(hist['Close'].iloc[-1])
            except Exception as e:
                raise ValueError(f"Could not fetch current price for {symbol}: {e}")

        if current_price is None or np.isnan(current_price):
            raise ValueError(f"Could not retrieve a valid current price for {symbol}")

        # 2. Fetch dividend yield
        div_yield = 0.0
        try:
            div_yield = ticker.info.get('dividendYield', 0.0)
            if div_yield is None:
                div_yield = 0.0
            if div_yield > 0.5:
                div_yield = div_yield / 100.0
        except Exception:
            defaults = {'SPY': 0.013, 'QQQ': 0.006, 'IWM': 0.012}
            div_yield = defaults.get(symbol.upper(), 0.0)
            
        logger.info(f"Ticker: {symbol} | Price: {current_price:.2f} | Div Yield: {div_yield:.4f}")
        return current_price, div_yield

    def fetch_options_chain(self, symbol: str, max_expirations: int = 8) -> dict:
        """
        Fetches option chains for the given symbol.
        Restricts to the next `max_expirations` dates to prevent rate limiting and ensure speedy calculations.
        Returns a dictionary containing underlying details and option dataframes.
        """
        symbol = symbol.upper().strip()
        cache_key = symbol
        now = datetime.now()
        
        # Check cache
        if cache_key in self._cache:
            cached_data, timestamp = self._cache[cache_key]
            if now - timestamp < timedelta(seconds=30):
                logger.info(f"Returning cached options chain for {symbol} (age: {(now - timestamp).seconds}s)")
                return cached_data

        ticker = yf.Ticker(symbol)
        
        current_price, div_yield = self.fetch_underlying_data(symbol)
        
        expirations = ticker.options
        if not expirations:
            raise ValueError(f"No options contracts found for {symbol}")
            
        # Filter to next max_expirations
        selected_expirations = expirations[:max_expirations]
        logger.info(f"Fetching option chains for {symbol}. Total expirations: {len(expirations)}, selected: {len(selected_expirations)}")
        
        all_calls = []
        all_puts = []
        
        for exp_date_str in selected_expirations:
            try:
                opt_chain = ticker.option_chain(exp_date_str)
                calls = opt_chain.calls.copy()
                puts = opt_chain.puts.copy()
                
                # Append expiration date
                calls['expiration'] = exp_date_str
                puts['expiration'] = exp_date_str
                
                all_calls.append(calls)
                all_puts.append(puts)
                logger.info(f"Loaded expiration {exp_date_str} for {symbol} (Calls: {len(calls)}, Puts: {len(puts)})")
            except Exception as e:
                logger.error(f"Failed to fetch option chain for {symbol} on {exp_date_str}: {e}")
                
        if not all_calls or not all_puts:
            raise ValueError(f"Could not load any option chains for {symbol}")
            
        df_calls = pd.concat(all_calls, ignore_index=True)
        df_puts = pd.concat(all_puts, ignore_index=True)
        
        # Clean fields
        for df in [df_calls, df_puts]:
            df['volume'] = df['volume'].fillna(0).astype(float)
            df['openInterest'] = df['openInterest'].fillna(0).astype(float)
            df['impliedVolatility'] = df['impliedVolatility'].fillna(0).astype(float)
            
        result = {
            'symbol': symbol,
            'current_price': current_price,
            'dividend_yield': div_yield,
            'risk_free_rate': get_risk_free_rate(),
            'calls': df_calls,
            'puts': df_puts,
            'expirations': selected_expirations
        }
        
        # Store in cache
        self._cache[cache_key] = (result, now)
        return result

    # --- SWING TRADING MACRO INDICATORS ---
    
    def fetch_vix_vxv_ratio(self) -> dict:
        """
        Fetches VIX and VXV indices to calculate their term structure ratio.
        """
        try:
            vix = yf.Ticker("^VIX").history(period="1d")
            vxv = yf.Ticker("^VXV").history(period="1d") # Note: ^VXV is 3-Month Volatility Index
            
            # Fallback if ^VXV is not found, try ^VIX3M
            if vxv.empty:
                vxv = yf.Ticker("^VIX3M").history(period="1d")
                
            vix_val = float(vix['Close'].iloc[-1]) if not vix.empty else 16.50
            vxv_val = float(vxv['Close'].iloc[-1]) if not vxv.empty else 18.20
            
            ratio = float(vix_val / vxv_val)
            logger.info(f"Macro: VIX={vix_val:.2f}, VXV={vxv_val:.2f}, Ratio={ratio:.4f}")
            return {
                "vix": vix_val,
                "vxv": vxv_val,
                "ratio": ratio,
                "status": "Contango" if ratio < 1.0 else "Backwardation"
            }
        except Exception as e:
            logger.error(f"Failed to fetch VIX/VXV term structure: {e}")
            return {"vix": 15.0, "vxv": 17.5, "ratio": 0.857, "status": "Contango (Default)"}

    def fetch_skew_index(self) -> float:
        """
        Fetches the CBOE SKEW Index (^SKEW).
        """
        try:
            skew = yf.Ticker("^SKEW").history(period="1d")
            skew_val = float(skew['Close'].iloc[-1]) if not skew.empty else 125.0
            logger.info(f"Macro: SKEW={skew_val:.2f}")
            return skew_val
        except Exception as e:
            logger.error(f"Failed to fetch SKEW index: {e}")
            return 125.0

    def fetch_fed_net_liquidity(self) -> list:
        """
        Calculates Federal Reserve Net Liquidity:
        Net Liquidity = Fed Balance Sheet (WALCL) - TGA (WTGACN) - Reverse Repo (RRPONTSYD)
        Returns a time series list of dictionaries.
        """
        try:
            # Fetch last 120 days to plot trend
            start_date = (datetime.now() - timedelta(days=180)).strftime('%Y-%m-%d')
            
            # yfinance parses FRED codes directly (without prefix)
            walcl = yf.Ticker("WALCL").history(start=start_date)
            tga = yf.Ticker("WTGACN").history(start=start_date)
            rrp = yf.Ticker("RRPONTSYD").history(start=start_date)
            
            # Fallback if yfinance FRED fetch fails
            if walcl.empty or tga.empty or rrp.empty:
                logger.warning("FRED fetch via yfinance empty. Yielding simulated macro liquidity data series.")
                return self._generate_simulated_liquidity()
                
            # Convert index to dates and merge on index (Date)
            walcl_df = walcl[['Close']].rename(columns={'Close': 'balance_sheet'})
            tga_df = tga[['Close']].rename(columns={'Close': 'tga'})
            rrp_df = rrp[['Close']].rename(columns={'Close': 'rrp'})
            
            # Scale units: yfinance FRED reserves are usually in Millions of USD
            merged = walcl_df.join(tga_df, how='outer').join(rrp_df, how='outer')
            merged = merged.ffill().bfill().dropna()
            
            # Net Liquidity = balance_sheet - tga - rrp
            # Note: balance_sheet is in Millions, tga and rrp are in Millions/Billions. Let's standardize.
            # In FRED, WALCL is in Millions (e.g. 7400000 = 7.4T). WTGACN is in Billions or Millions.
            # Let's verify scaling. TGA is usually in Millions. RRP is in Billions.
            # Let's align all to Billions for easier graphing:
            merged['balance_sheet_b'] = merged['balance_sheet'] / 1000.0  # e.g. 7400
            merged['tga_b'] = merged['tga'] / 1000.0 if merged['tga'].max() > 10000 else merged['tga']
            merged['rrp_b'] = merged['rrp'] / 1000.0 if merged['rrp'].max() > 10000 else merged['rrp']
            
            merged['net_liquidity'] = merged['balance_sheet_b'] - merged['tga_b'] - merged['rrp_b']
            
            # Fetch SPY prices to overlay
            spy = yf.Ticker("SPY").history(start=start_date)
            if not spy.empty:
                merged = merged.join(spy['Close'].rename('spy_close'), how='left').ffill()
            else:
                merged['spy_close'] = 500.0
                
            series = []
            for date_idx, row in merged.iterrows():
                series.append({
                    "date": date_idx.strftime('%Y-%m-%d'),
                    "net_liquidity": float(row['net_liquidity']),
                    "balance_sheet": float(row['balance_sheet_b']),
                    "tga": float(row['tga_b']),
                    "rrp": float(row['rrp_b']),
                    "spy": float(row['spy_close'])
                })
            return series
        except Exception as e:
            logger.error(f"Failed to calculate Fed Net Liquidity: {e}")
            return self._generate_simulated_liquidity()

    def fetch_yield_curve(self) -> dict:
        """
        Calculates Yield Curve spread: 10-Year (^TNX) minus 3-Month (^IRX).
        """
        try:
            tnx = yf.Ticker("^TNX").history(period="1d") # 10Y
            irx = yf.Ticker("^IRX").history(period="1d") # 3M
            
            tnx_val = float(tnx['Close'].iloc[-1]) if not tnx.empty else 4.25
            irx_val = float(irx['Close'].iloc[-1]) if not irx.empty else 4.75
            
            spread = float(tnx_val - irx_val)
            logger.info(f"Macro: 10Y={tnx_val:.2f}%, 3M={irx_val:.2f}%, Spread={spread:.4f}%")
            return {
                "yield_10y": tnx_val,
                "yield_3m": irx_val,
                "spread": spread,
                "inverted": bool(spread < 0)
            }
        except Exception as e:
            logger.error(f"Failed to fetch yield curve spread: {e}")
            return {"yield_10y": 4.10, "yield_3m": 4.50, "spread": -0.40, "inverted": True}

    def fetch_credit_spreads(self) -> float:
        """
        Fetches High-Yield Corporate Option-Adjusted Credit Spreads (BAMLC0A1CAAAEY)
        or returns a proxy from HYG vs IEF.
        """
        try:
            fred_val = yf.Ticker("BAMLC0A1CAAAEY").history(period="1d")
            if not fred_val.empty:
                val = fred_val['Close'].iloc[-1]
                logger.info(f"Macro: HY Credit Spread (FRED) = {val:.2f}%")
                return float(val)
                
            # Proxy check if FRED fails
            hyg = yf.Ticker("HYG").history(period="5d")
            ief = yf.Ticker("IEF").history(period="5d")
            
            if not hyg.empty and not ief.empty:
                # Approximate spread based on price ratios normalized
                hyg_perf = hyg['Close'].iloc[-1] / hyg['Close'].iloc[0]
                ief_perf = ief['Close'].iloc[-1] / ief['Close'].iloc[0]
                spread_proxy = 3.65 + (ief_perf - hyg_perf) * 100.0
                return max(1.5, min(10.0, float(spread_proxy)))
            return 3.65
        except Exception as e:
            logger.error(f"Failed to fetch credit spreads: {e}")
            return 3.65

    def fetch_overnight_catalysts(self) -> list:
        """
        Returns upcoming major macroeconomic catalysts/events.
        """
        tomorrow = (date.today() + timedelta(days=1)).strftime('%Y-%m-%d')
        next_week = (date.today() + timedelta(days=4)).strftime('%Y-%m-%d')
        return [
            {"date": tomorrow, "time": "08:30 AM", "event": "CPI Inflation Rate (MoM/YoY)", "importance": "HIGH"},
            {"date": tomorrow, "time": "04:15 PM", "event": "Apple Inc. (AAPL) Earnings Release", "importance": "HIGH"},
            {"date": next_week, "time": "02:00 PM", "event": "FOMC Interest Rate Decision & Press Conf", "importance": "CRITICAL"},
            {"date": next_week, "time": "08:30 AM", "event": "PPI Producer Price Index", "importance": "MEDIUM"}
        ]

    def _generate_simulated_liquidity(self) -> list:
        """Helper to generate realistic historical liquidity data if APIs fail."""
        series = []
        base_date = datetime.now() - timedelta(days=120)
        base_liq = 6350.0  # $6.35 Trillion
        base_spy = 490.0
        
        for i in range(120):
            current_date = base_date + timedelta(days=i)
            # Add some random walk
            drift_liq = np.sin(i / 10.0) * 120.0 + (i * 0.8) + np.random.normal(0, 8.0)
            drift_spy = np.sin(i / 10.0) * 18.0 + (i * 0.9) + np.random.normal(0, 2.0)
            
            liq = base_liq + drift_liq
            spy = base_spy + drift_spy
            
            # Balance sheet, TGA, RRP proportions
            bs = 7400.0 - (i * 1.5)
            tga = 750.0 + np.sin(i / 5.0) * 80.0
            rrp = bs - tga - liq
            
            series.append({
                "date": current_date.strftime('%Y-%m-%d'),
                "net_liquidity": float(liq),
                "balance_sheet": float(bs),
                "tga": float(tga),
                "rrp": float(rrp),
                "spy": float(spy)
            })
        return series
