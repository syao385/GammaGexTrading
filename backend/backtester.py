import pandas as pd
import numpy as np
import yfinance as yf
import logging
from datetime import datetime, timedelta

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Backtester:
    def __init__(self):
        pass

    def run_backtest(self, symbol: str, strategy: str, initial_capital: float = 100000.0, 
                     start_date: str = None, end_date: str = None, params: dict = None) -> dict:
        """
        Runs a historical backtest of the selected GEX-based strategy.
        Fetches historical price data and models GEX, OVI, and walls synthetically.
        """
        if start_date is None:
            start_date = (datetime.now() - timedelta(days=730)).strftime('%Y-%m-%d')
        if end_date is None:
            end_date = datetime.now().strftime('%Y-%m-%d')
            
        if params is None:
            params = {}

        # 1. Fetch historical data for symbol and VIX
        try:
            logger.info(f"Backtesting {symbol} with strategy {strategy} from {start_date} to {end_date}")
            ticker = yf.Ticker(symbol)
            df = ticker.history(start=start_date, end=end_date)
            
            if df.empty:
                raise ValueError(f"No historical data returned for {symbol}")
                
            # Fetch VIX for risk/volatility regime proxying
            vix_ticker = yf.Ticker("^VIX")
            df_vix = vix_ticker.history(start=start_date, end=end_date)
            
            if df_vix.empty:
                # Fallback if VIX is unavailable
                df['vix'] = 20.0
            else:
                # Merge VIX on date
                df = df.join(df_vix['Close'].rename('vix'), how='left')
                df['vix'] = df['vix'].ffill().bfill().fillna(20.0)
        except Exception as e:
            logger.error(f"Failed to fetch historical data for backtester: {e}")
            return {'success': False, 'error': f"Data fetch error: {str(e)}"}

        # 2. Compute synthetic proxies
        # A. Moving Average and ATR for regime calculation
        ema_len = params.get('ema_len', 20)
        df['ema'] = df['Close'].ewm(span=ema_len, adjust=False).mean()
        
        # Simple True Range and ATR calculation
        high_low = df['High'] - df['Low']
        high_close = (df['High'] - df['Close'].shift()).abs()
        low_close = (df['Low'] - df['Close'].shift()).abs()
        ranges = pd.concat([high_low, high_close, low_close], axis=1)
        true_range = ranges.max(axis=1)
        df['atr'] = true_range.ewm(span=ema_len, adjust=False).mean()
        
        # B. Synthetic GEX Proxy
        # GEX is positive when spot > ema (calls dominated) and negative when spot < ema (puts dominated)
        # Scaled inversely by VIX (since higher VIX compressed option gamma profiles and expands swings)
        df['gex_proxy'] = ((df['Close'] - df['ema']) / (df['atr'] + 1e-9)) * (30.0 / df['vix'])
        
        # C. Synthetic OVI Proxy (Option Volume Imbalance)
        # Modeled as intraday money flow/momentum indicator scaled to [-1, 1]
        raw_ovi = (df['Close'] - df['Low'] - (df['High'] - df['Close'])) / (df['High'] - df['Low'] + 1e-9)
        df['ovi_proxy'] = raw_ovi.ewm(span=5, adjust=False).mean() # 5-day smooth
        
        # D. Synthetic Call/Put Walls
        # Call Wall = 20-day High, Put Wall = 20-day Low
        wall_len = params.get('wall_len', 20)
        df['call_wall_proxy'] = df['High'].rolling(window=wall_len).max()
        df['put_wall_proxy'] = df['Low'].rolling(window=wall_len).min()
        
        # Shift walls by 1 day so we do not use future information when trading today
        df['call_wall_proxy'] = df['call_wall_proxy'].shift(1)
        df['put_wall_proxy'] = df['put_wall_proxy'].shift(1)
        
        df = df.dropna().copy()
        
        if len(df) < 30:
            return {'success': False, 'error': "Insufficient historical data after generating indicators."}

        # 3. Simulate Trades
        trades = []
        capital = initial_capital
        position = 0.0 # shares held
        entry_price = 0.0
        equity_curve = []
        
        gex_threshold = params.get('gex_threshold', 0.2)
        ovi_threshold = params.get('ovi_threshold', 0.3)
        stop_loss_pct = params.get('stop_loss', 0.015) # 1.5% default stop loss

        dates = df.index
        for idx in range(len(df)):
            current_date = dates[idx]
            row = df.iloc[idx]
            close = float(row['Close'])
            high = float(row['High'])
            low = float(row['Low'])
            
            gex = float(row['gex_proxy'])
            ovi = float(row['ovi_proxy'])
            call_wall = float(row['call_wall_proxy'])
            put_wall = float(row['put_wall_proxy'])
            
            # Determine asset class mode: 'cash' vs 'options'
            asset_class = str(params.get('asset_class', 'cash')).lower()
            opt_leverage = 4.0 if asset_class == 'options' else 1.0

            # Stop loss logic if in a trade
            if position > 0:
                # Long position stop loss check
                if low <= entry_price * (1 - stop_loss_pct):
                    exit_p = entry_price * (1 - stop_loss_pct)
                    ret_pct = -stop_loss_pct * 100.0 * opt_leverage
                    if asset_class == 'options':
                        ret_pct = max(-50.0, ret_pct)
                    profit = capital * (ret_pct / 100.0)
                    capital += profit
                    trades.append({
                        'type': f'Stop Loss Long ({asset_class.upper()})',
                        'entry_date': last_entry_date.strftime('%Y-%m-%d'),
                        'exit_date': current_date.strftime('%Y-%m-%d'),
                        'entry_price': entry_price,
                        'exit_price': exit_p,
                        'return_pct': float(ret_pct),
                        'profit': float(profit)
                    })
                    position = 0.0
            elif position < 0:
                # Short position stop loss check
                if high >= entry_price * (1 + stop_loss_pct):
                    exit_p = entry_price * (1 + stop_loss_pct)
                    ret_pct = -stop_loss_pct * 100.0 * opt_leverage
                    if asset_class == 'options':
                        ret_pct = max(-50.0, ret_pct)
                    profit = capital * (ret_pct / 100.0)
                    capital += profit
                    trades.append({
                        'type': f'Stop Loss Short ({asset_class.upper()})',
                        'entry_date': last_entry_date.strftime('%Y-%m-%d'),
                        'exit_date': current_date.strftime('%Y-%m-%d'),
                        'entry_price': entry_price,
                        'exit_price': exit_p,
                        'return_pct': float(ret_pct),
                        'profit': float(profit)
                    })
                    position = 0.0

            # Strategy Implementation for all 11 Playbooks + Legacy Aliases
            strat = strategy.lower()

            # Helper for exit trade logging
            def close_trade(exit_type, exit_p, is_long):
                nonlocal capital, position
                eq_ret = ((exit_p - entry_price) / entry_price) * 100.0 if is_long else ((entry_price - exit_p) / entry_price) * 100.0
                ret_pct = eq_ret * opt_leverage
                if asset_class == 'options':
                    ret_pct = min(100.0, max(-50.0, ret_pct))
                trade_profit = capital * (ret_pct / 100.0)
                capital += trade_profit
                trades.append({
                    'type': f'{exit_type} ({asset_class.upper()})',
                    'entry_date': last_entry_date.strftime('%Y-%m-%d'),
                    'exit_date': current_date.strftime('%Y-%m-%d'),
                    'entry_price': entry_price,
                    'exit_price': exit_p,
                    'return_pct': float(ret_pct),
                    'profit': float(trade_profit)
                })
                position = 0.0

            if strat in ['put_wall_bounce', 'wall_reversion']:
                if position == 0:
                    if low <= put_wall * 1.005:
                        position = 1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position > 0:
                    days_held = (current_date - last_entry_date).days
                    if close >= entry_price * 1.02 or days_held >= 5:
                        close_trade('Put Wall Bounce Exit', close, True)

            elif strat == 'call_wall_reversal':
                if position == 0:
                    if high >= call_wall * 0.995:
                        position = -1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position < 0:
                    days_held = (current_date - last_entry_date).days
                    if close <= entry_price * 0.98 or days_held >= 5:
                        close_trade('Call Wall Reversal Exit', close, False)

            elif strat in ['gex_flip_squeeze', 'gex_flip']:
                if position == 0:
                    if gex > gex_threshold:
                        position = 1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position > 0:
                    if gex < 0 or close >= entry_price * 1.03:
                        close_trade('GEX Flip Squeeze Exit', close, True)

            elif strat == 'gex_flip_breakdown':
                if position == 0:
                    if gex < -gex_threshold:
                        position = -1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position < 0:
                    if gex > 0 or close <= entry_price * 0.97:
                        close_trade('GEX Flip Breakdown Exit', close, False)

            elif strat == 'vcp_accumulation':
                if position == 0:
                    if gex > 0 and close > row['ema']:
                        position = 1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position > 0:
                    days_held = (current_date - last_entry_date).days
                    if close >= entry_price * 1.04 or close < row['ema'] or days_held >= 8:
                        close_trade('VCP Accumulation Exit', close, True)

            elif strat == 'fvg_fill':
                if position == 0:
                    if low <= put_wall * 1.01:
                        position = 1.0
                        entry_price = close
                        last_entry_date = current_date
                    elif high >= call_wall * 0.99:
                        position = -1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position > 0:
                    if close >= entry_price * 1.02:
                        close_trade('FVG Bullish Fill Exit', close, True)
                elif position < 0:
                    if close <= entry_price * 0.98:
                        close_trade('FVG Bearish Fill Exit', close, False)

            elif strat == 'breaker_block':
                if position == 0:
                    if ovi > ovi_threshold:
                        position = 1.0
                        entry_price = close
                        last_entry_date = current_date
                    elif ovi < -ovi_threshold:
                        position = -1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position > 0:
                    if ovi < 0 or close >= entry_price * 1.025:
                        close_trade('Breaker Shift Exit Long', close, True)
                elif position < 0:
                    if ovi > 0 or close <= entry_price * 0.975:
                        close_trade('Breaker Shift Exit Short', close, False)

            elif strat in ['rvol_surge', 'ovi_breakout']:
                if position == 0:
                    if close >= call_wall and ovi > ovi_threshold:
                        position = 1.0
                        entry_price = close
                        last_entry_date = current_date
                    elif close <= put_wall and ovi < -ovi_threshold:
                        position = -1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position > 0:
                    if close < row['ema'] or close >= entry_price * 1.03:
                        close_trade('RVOL Surge Long Exit', close, True)
                elif position < 0:
                    if close > row['ema'] or close <= entry_price * 0.97:
                        close_trade('RVOL Surge Short Exit', close, False)

            elif strat == 'trend_continuation':
                if position == 0:
                    if close > row['ema'] and gex > 0:
                        position = 1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position > 0:
                    days_held = (current_date - last_entry_date).days
                    if close >= entry_price * 1.025 or close < row['ema'] or days_held >= 6:
                        close_trade('Trend Continuation Exit', close, True)

            elif strat == 'range_condor':
                if position == 0:
                    if close > put_wall and close < call_wall:
                        position = 1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position > 0:
                    days_held = (current_date - last_entry_date).days
                    if days_held >= 5 or close <= put_wall or close >= call_wall:
                        # Neutral range profit if inside walls
                        exit_price = close if (close > put_wall and close < call_wall) else (entry_price * 0.985)
                        close_trade('Iron Condor Range Exit', exit_price, True)

            elif strat == 'max_gamma_exhaustion':
                if position == 0:
                    if high >= call_wall:
                        position = -1.0
                        entry_price = close
                        last_entry_date = current_date
                elif position < 0:
                    days_held = (current_date - last_entry_date).days
                    if close <= entry_price * 0.98 or days_held >= 5:
                        close_trade('Max Gamma Reversal Exit', close, False)
            
            # Log equity state
            current_equity = capital
            if position > 0:
                current_equity = position * close
            elif position < 0:
                current_equity = capital + (entry_price - close) * abs(position)
                
            equity_curve.append({
                'date': current_date.strftime('%Y-%m-%d'),
                'equity': float(current_equity),
                'price': close,
                'gex': gex,
                'ovi': ovi
            })

        # 4. Calculate Backtest Performance Metrics
        final_equity = equity_curve[-1]['equity'] if equity_curve else initial_capital
        total_return = ((final_equity - initial_capital) / initial_capital) * 100
        
        # Buy and Hold return comparison
        start_price = float(df['Close'].iloc[0])
        end_price = float(df['Close'].iloc[-1])
        bh_return = ((end_price - start_price) / start_price) * 100
        
        # Win Rate
        wins = [t for t in trades if t['profit'] > 0]
        win_rate = (len(wins) / len(trades) * 100) if trades else 0.0
        
        # Max Drawdown
        equities = [eq['equity'] for eq in equity_curve]
        peak = equities[0]
        max_dd = 0.0
        for eq in equities:
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak
            if dd > max_dd:
                max_dd = dd
        max_dd_pct = max_dd * 100
        
        # Sharpe Ratio (daily risk free assumed at 0)
        daily_returns = pd.Series(equities).pct_change().dropna()
        if len(daily_returns) > 2 and daily_returns.std() > 0:
            sharpe = (daily_returns.mean() / daily_returns.std()) * np.sqrt(252)
        else:
            sharpe = 0.0

        return {
            'success': True,
            'summary': {
                'symbol': symbol.upper(),
                'strategy': strategy,
                'initial_capital': initial_capital,
                'final_equity': final_equity,
                'total_return_pct': float(total_return),
                'buy_and_hold_return_pct': float(bh_return),
                'sharpe_ratio': float(sharpe),
                'max_drawdown_pct': float(max_dd_pct),
                'total_trades': len(trades),
                'win_rate_pct': float(win_rate)
            },
            'trades': trades,
            'equity_curve': equity_curve
        }
