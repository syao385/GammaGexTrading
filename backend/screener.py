import logging
from backend.data_fetcher import DataFetcher
from backend.gex_engine import GEXEngine
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MarketScreener:
    def __init__(self):
        self.fetcher = DataFetcher()
        self.engine = GEXEngine()

    def screen_symbols(self, symbols: list = None) -> list:
        """
        Screens a watchlist of symbols and aggregates GEX, walls, OVI, skew, and alerts.
        """
        if symbols is None:
            symbols = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'TSLA', 'NVDA']
            
        results = []
        for symbol in symbols:
            try:
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
                
                # Generate Alerts
                alerts = []
                
                # Alert: Spot proximity to walls
                if abs(price - call_wall) / price <= 0.005:
                    alerts.append(f"Spot near Call Wall ({call_wall:.1f}) - Potential resistance/reversal")
                elif abs(price - put_wall) / price <= 0.005:
                    alerts.append(f"Spot near Put Wall ({put_wall:.1f}) - Potential support/reversal")
                    
                # Alert: OVI signals
                if ovi > 0.4:
                    alerts.append("Bullish OVI Imbalance - Large institutional call volume")
                elif ovi < -0.4:
                    alerts.append("Bearish OVI Imbalance - Large institutional put volume")
                    
                # Alert: Gamma Regime Flip warning
                if abs(dist_flip) <= 0.5:
                    alerts.append(f"Spot near Gamma Flip Level ({flip:.1f}) - High volatility regime change warning")
                    
                # Alert: Unusual Options Activity (UOA)
                # Scan strikes for high Volume/OI ratios
                strikes_df = aggregated['strikes'].copy()
                # Calculate call/put specific Vol/OI ratios on the fly for UOA scanning
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
                
                # Filter strikes where volume > 500 and Volume/OI > 1.5
                uoa_calls = strikes_df[
                    (strikes_df['call_volume'] > 500) & (strikes_df['call_vol_oi_ratio'] > 1.5)
                ]
                uoa_puts = strikes_df[
                    (strikes_df['put_volume'] > 500) & (strikes_df['put_vol_oi_ratio'] > 1.5)
                ]
                
                for _, row in uoa_calls.iterrows():
                    alerts.append(f"UOA: Call volume outlier at strike {row['strike']:.1f} (Vol/OI: {row['call_vol_oi_ratio']:.1f})")
                for _, row in uoa_puts.iterrows():
                    alerts.append(f"UOA: Put volume outlier at strike {row['strike']:.1f} (Vol/OI: {row['put_vol_oi_ratio']:.1f})")

                # Core metrics
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
                    'alerts': alerts[:5] # Limit to top 5 alerts to keep clean
                }
                results.append(summary)
            except Exception as e:
                logger.error(f"Screener failed to process {symbol}: {e}")
                results.append({
                    'symbol': symbol,
                    'error': f"Failed to process: {str(e)}"
                })
                
        return results
