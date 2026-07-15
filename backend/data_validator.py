import numpy as np
import pandas as pd
import logging
from typing import Dict, Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DataValidator:
    def __init__(self, gex_engine):
        self.engine = gex_engine

    def run_sensitivity_analysis(self, raw_data: dict) -> dict:
        """
        Runs sensitivity analysis by varying parameters to establish confidence bounds.
        Varies:
        1. Risk-free rate (lower: 3.0%, base: fetched, upper: 6.0%)
        2. Implied Volatility multiplier (lower: 0.9x, base: 1.0x, upper: 1.1x)
        """
        base_r = raw_data['risk_free_rate']
        spot = raw_data['current_price']
        q = raw_data['dividend_yield']
        calls = raw_data['calls']
        puts = raw_data['puts']

        scenarios = {
            'Base Model': {'r': base_r, 'iv_mult': 1.0},
            'High Interest Rate (6.0%)': {'r': 0.06, 'iv_mult': 1.0},
            'Low Interest Rate (3.0%)': {'r': 0.03, 'iv_mult': 1.0},
            'Vol Crush (-10% IV)': {'r': base_r, 'iv_mult': 0.9},
            'Vol Spike (+10% IV)': {'r': base_r, 'iv_mult': 1.1}
        }

        results = {}
        for name, params in scenarios.items():
            try:
                # Prepare data clone with modified parameters
                calls_clone = calls.copy()
                puts_clone = puts.copy()
                
                # Apply IV multiplier
                calls_clone['impliedVolatility'] = calls_clone['impliedVolatility'] * params['iv_mult']
                puts_clone['impliedVolatility'] = puts_clone['impliedVolatility'] * params['iv_mult']
                
                # Run GEX calculations
                sim_data = {
                    'symbol': raw_data['symbol'],
                    'current_price': spot,
                    'dividend_yield': q,
                    'risk_free_rate': params['r'],
                    'calls': calls_clone,
                    'puts': puts_clone
                }
                
                processed = self.engine.process_options_chain(sim_data)
                aggregated = self.engine.compute_aggregated_exposures(processed)
                
                results[name] = {
                    'gamma_flip': float(aggregated['gamma_flip']),
                    'call_wall': float(aggregated['call_wall']),
                    'put_wall': float(aggregated['put_wall']),
                    'total_gex_dollar': float(aggregated['total_gex_dollar'])
                }
            except Exception as e:
                logger.error(f"Error running sensitivity scenario '{name}': {e}")
                results[name] = {'error': str(e)}

        # Compile confidence intervals
        flips = [res['gamma_flip'] for res in results.values() if 'gamma_flip' in res]
        call_walls = [res['call_wall'] for res in results.values() if 'call_wall' in res]
        put_walls = [res['put_wall'] for res in results.values() if 'put_wall' in res]

        confidence_bounds = {
            'gamma_flip': {
                'min': min(flips) if flips else spot,
                'max': max(flips) if flips else spot,
                'spread_pct': float((max(flips) - min(flips)) / spot * 100) if flips else 0.0
            },
            'call_wall': {
                'min': min(call_walls) if call_walls else 0.0,
                'max': max(call_walls) if call_walls else 0.0
            },
            'put_wall': {
                'min': min(put_walls) if put_walls else 0.0,
                'max': max(put_walls) if put_walls else 0.0
            }
        }

        return {
            'scenarios': results,
            'confidence_bounds': confidence_bounds
        }

    def compare_with_external(self, our_aggregated: dict, external_df: pd.DataFrame) -> dict:
        """
        Compares our self-calculated levels and GEX curves with external GEX platform data uploads.
        Expects external_df to contain columns: 'strike' and 'gex_dollar' (or equivalent).
        """
        our_strikes = our_aggregated['strikes']
        
        # Normalize external columns
        ext_cols = {col.lower(): col for col in external_df.columns}
        
        strike_col = next((ext_cols[c] for c in ['strike', 'price'] if c in ext_cols), None)
        gex_col = next((ext_cols[c] for c in ['gex_dollar', 'gex', 'gamma_exposure', 'exposure'] if c in ext_cols), None)
        
        if not strike_col or not gex_col:
            return {
                'success': False,
                'error': "Uploaded file must contain 'strike' and 'gex_dollar' (or 'gex') columns."
            }

        # Select columns and rename
        ext_clean = external_df[[strike_col, gex_col]].copy()
        ext_clean.columns = ['strike', 'ext_gex_dollar']
        ext_clean['strike'] = ext_clean['strike'].astype(float)
        ext_clean['ext_gex_dollar'] = ext_clean['ext_gex_dollar'].astype(float)

        # Merge our data with external data
        merged = pd.merge(our_strikes[['strike', 'net_gex_dollar']], ext_clean, on='strike', how='inner')

        if len(merged) < 3:
            return {
                'success': False,
                'error': f"Not enough matching strikes between internal and external data. Found: {len(merged)} matches."
            }

        # Calculate metrics
        correlation = float(merged['net_gex_dollar'].corr(merged['ext_gex_dollar']))
        mae = float((merged['net_gex_dollar'] - merged['ext_gex_dollar']).abs().mean())
        
        # Scaling correction: external data is often quoted in millions or thousands.
        # Check if they are offset by orders of magnitude (e.g. 1,000,000x or 1,000x)
        ratio = (merged['net_gex_dollar'].abs().mean() / (merged['ext_gex_dollar'].abs().mean() + 1e-9))
        
        if ratio > 500:
            scale_factor = "10^6 (Millions) vs raw dollars"
        elif ratio < 0.002:
            scale_factor = "raw dollars vs 10^6 (Millions)"
        else:
            scale_factor = "1:1 Matches"

        # Compare Walls
        ext_call_wall = float(ext_clean.loc[ext_clean['ext_gex_dollar'].idxmax()]['strike'])
        ext_put_wall = float(ext_clean.loc[ext_clean['ext_gex_dollar'].idxmin()]['strike'])
        
        # Find external flip approximation (where sign changes near spot)
        # Sort and find where product of consecutive GEX is negative
        ext_sorted = ext_clean.sort_values('strike').reset_index(drop=True)
        ext_flip = None
        for i in range(len(ext_sorted) - 1):
            if np.sign(ext_sorted.loc[i, 'ext_gex_dollar']) != np.sign(ext_sorted.loc[i+1, 'ext_gex_dollar']):
                # Interpolate
                s1, s2 = ext_sorted.loc[i, 'strike'], ext_sorted.loc[i+1, 'strike']
                g1, g2 = ext_sorted.loc[i, 'ext_gex_dollar'], ext_sorted.loc[i+1, 'ext_gex_dollar']
                ext_flip = s1 - g1 * (s2 - s1) / (g2 - g1 + 1e-9)
                break
                
        if ext_flip is None:
            ext_flip = 0.0

        return {
            'success': True,
            'metrics': {
                'correlation': correlation,
                'mean_absolute_error': mae,
                'scale_imbalance': scale_factor,
                'common_strikes_count': len(merged)
            },
            'comparison': {
                'internal': {
                    'call_wall': our_aggregated['call_wall'],
                    'put_wall': our_aggregated['put_wall'],
                    'gamma_flip': our_aggregated['gamma_flip']
                },
                'external': {
                    'call_wall': ext_call_wall,
                    'put_wall': ext_put_wall,
                    'gamma_flip': float(ext_flip)
                },
                'differences': {
                    'call_wall_diff': abs(our_aggregated['call_wall'] - ext_call_wall),
                    'put_wall_diff': abs(our_aggregated['put_wall'] - ext_put_wall),
                    'gamma_flip_diff': abs(our_aggregated['gamma_flip'] - ext_flip)
                }
            }
        }
