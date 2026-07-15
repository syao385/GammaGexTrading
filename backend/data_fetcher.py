import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, date
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
        pass

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
            # If div_yield is in percent, e.g. 1.3, divide by 100. yfinance info is sometimes decimal, sometimes percent.
            if div_yield > 0.5:  # If it's > 50%, it's likely quoted as a percentage (e.g. 1.3 meaning 1.3%)
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
            
        return {
            'symbol': symbol.upper(),
            'current_price': current_price,
            'dividend_yield': div_yield,
            'risk_free_rate': get_risk_free_rate(),
            'calls': df_calls,
            'puts': df_puts,
            'expirations': selected_expirations
        }
