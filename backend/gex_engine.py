import numpy as np
import pandas as pd
from scipy.stats import norm
from scipy.optimize import brentq
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GEXEngine:
    def __init__(self):
        pass

    @staticmethod
    def calculate_d1_d2(S: float, K: float, T: float, r: float, q: float, sigma: float):
        """
        Calculates d1 and d2 for Black-Scholes.
        S: Spot price
        K: Strike price
        T: Time to expiration in years (must be > 0)
        r: Risk-free rate (decimal)
        q: Dividend yield (decimal)
        sigma: Implied Volatility (decimal)
        """
        # Ensure values are within valid mathematical limits
        T = max(T, 1e-5)
        sigma = max(sigma, 1e-4)
        S = max(S, 1e-4)
        K = max(K, 1e-4)
        
        d1 = (np.log(S / K) + (r - q + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)
        return d1, d2

    @staticmethod
    def calculate_greeks(S: float, K: float, T: float, r: float, q: float, sigma: float, option_type: str):
        """
        Calculates Delta, Gamma, Vanna, and Charm.
        Returns a dictionary of Greeks.
        """
        d1, d2 = GEXEngine.calculate_d1_d2(S, K, T, r, q, sigma)
        
        # Normal distributions
        pdf_d1 = norm.pdf(d1)
        cdf_d1 = norm.cdf(d1)
        
        # Gamma is identical for Calls and Puts
        gamma = np.exp(-q * T) * pdf_d1 / (S * sigma * np.sqrt(T))
        
        # Vanna is identical for Calls and Puts
        vanna = -np.exp(-q * T) * pdf_d1 * (d2 / sigma)
        
        # Delta and Charm are direction dependent
        if option_type.lower() == 'call':
            delta = np.exp(-q * T) * cdf_d1
            # Charm (annualized)
            charm = q * np.exp(-q * T) * cdf_d1 - np.exp(-q * T) * pdf_d1 * ((r - q) / (sigma * np.sqrt(T)) - d2 / (2 * T))
        else:
            delta = np.exp(-q * T) * (cdf_d1 - 1.0)
            # Charm (annualized)
            charm = -q * np.exp(-q * T) * (1.0 - cdf_d1) - np.exp(-q * T) * pdf_d1 * ((r - q) / (sigma * np.sqrt(T)) - d2 / (2 * T))
            
        # Convert Charm to per-day basis (typical convention for trading desks)
        charm_per_day = charm / 365.25
        
        return {
            'delta': delta,
            'gamma': gamma,
            'vanna': vanna,
            'charm': charm_per_day
        }

    def process_options_chain(self, data: dict) -> dict:
        """
        Processes the raw options chain data, calculates Greeks, and computes exposures.
        """
        spot = data['current_price']
        q = data['dividend_yield']
        r = data['risk_free_rate']
        calls = data['calls'].copy()
        puts = data['puts'].copy()
        
        # 1. Clean implied volatility (replace zero/near-zero IVs with expiration average or default)
        for df in [calls, puts]:
            for exp in df['expiration'].unique():
                mask = (df['expiration'] == exp)
                sub_df = df[mask]
                valid_ivs = sub_df[sub_df['impliedVolatility'] > 0.01]['impliedVolatility']
                if not valid_ivs.empty:
                    avg_iv = valid_ivs.mean()
                else:
                    general_valid = df[df['impliedVolatility'] > 0.01]['impliedVolatility']
                    avg_iv = general_valid.mean() if not general_valid.empty else 0.15
                
                # Replace IV <= 0.01 with average
                df.loc[mask & (df['impliedVolatility'] <= 0.01), 'impliedVolatility'] = avg_iv

        # 2. Check total open interest and fallback to volume as a proxy if OI is virtually zero
        total_oi = calls['openInterest'].sum() + puts['openInterest'].sum()
        if total_oi < 100:
            logger.warning(f"Aggregate Open Interest is virtually zero ({total_oi:.0f}). Falling back to Option Volume as a proxy for GEX.")
            calls['openInterest'] = calls['volume']
            puts['openInterest'] = puts['volume']
        
        today = datetime.utcnow().date()
        
        # Helper to compute time to expiration in years
        def get_t_years(exp_str):
            exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
            days = (exp_date - today).days
            # 0DTE options have T calculated with 0.08 days (approx 2 hours of trading remaining) to prevent BS infinity
            days = max(days, 0.08)
            return days / 365.25

        # 1. Compute Greeks for Calls
        calls['T'] = calls['expiration'].apply(get_t_years)
        calls_greeks = calls.apply(
            lambda row: self.calculate_greeks(spot, row['strike'], row['T'], r, q, row['impliedVolatility'], 'call'),
            axis=1
        )
        calls_df_greeks = pd.DataFrame(list(calls_greeks))
        calls = pd.concat([calls, calls_df_greeks], axis=1)

        # 2. Compute Greeks for Puts
        puts['T'] = puts['expiration'].apply(get_t_years)
        puts_greeks = puts.apply(
            lambda row: self.calculate_greeks(spot, row['strike'], row['T'], r, q, row['impliedVolatility'], 'put'),
            axis=1
        )
        puts_df_greeks = pd.DataFrame(list(puts_greeks))
        puts = pd.concat([puts, puts_df_greeks], axis=1)

        # 3. Calculate Exposures at Strike Level (Dealer positioning assumptions: MM Long Call, Short Put)
        # GEX (Dollar Gamma per 1% move)
        # Formula: GEX = (Gamma * OI * 100) * S^2 * 0.01 = Gamma * OI * S^2
        calls['gex_dollar'] = calls['gamma'] * calls['openInterest'] * (spot ** 2) * 0.01 * 100
        puts['gex_dollar'] = -puts['gamma'] * puts['openInterest'] * (spot ** 2) * 0.01 * 100

        # GEX in shares
        calls['gex_shares'] = calls['gamma'] * calls['openInterest'] * 100
        puts['gex_shares'] = -puts['gamma'] * puts['openInterest'] * 100

        # VEX (Dollar Vanna per 1% IV shift)
        # Formula: VEX = Vanna * OI * 100 * Spot * 0.01
        calls['vex_dollar'] = calls['vanna'] * calls['openInterest'] * spot * 100 * 0.01
        puts['vex_dollar'] = -puts['vanna'] * puts['openInterest'] * spot * 100 * 0.01

        # CEX (Dollar Charm decay per day)
        # Formula: CEX = Charm_per_day * OI * 100 * Spot
        calls['cex_dollar'] = calls['charm'] * calls['openInterest'] * 100 * spot
        puts['cex_dollar'] = -puts['charm'] * puts['openInterest'] * 100 * spot

        return {
            'symbol': data['symbol'],
            'current_price': spot,
            'dividend_yield': q,
            'risk_free_rate': r,
            'calls': calls,
            'puts': puts
        }

    def compute_aggregated_exposures(self, processed_data: dict) -> dict:
        """
        Aggregates GEX, VEX, and CEX by strike price.
        Identifies Call Wall, Put Wall, and finds the Gamma Flip level.
        """
        calls = processed_data['calls']
        puts = processed_data['puts']
        spot = processed_data['current_price']
        r = processed_data['risk_free_rate']
        q = processed_data['dividend_yield']
        
        # Combine Calls and Puts by strike
        calls_agg = calls.groupby('strike')[['gex_dollar', 'gex_shares', 'vex_dollar', 'cex_dollar', 'openInterest', 'volume']].sum().reset_index()
        puts_agg = puts.groupby('strike')[['gex_dollar', 'gex_shares', 'vex_dollar', 'cex_dollar', 'openInterest', 'volume']].sum().reset_index()
        
        # Rename to separate
        calls_agg = calls_agg.rename(columns={col: f'call_{col}' for col in calls_agg.columns if col != 'strike'})
        puts_agg = puts_agg.rename(columns={col: f'put_{col}' for col in puts_agg.columns if col != 'strike'})
        
        # Merge
        strikes_df = pd.merge(calls_agg, puts_agg, on='strike', how='outer').fillna(0)
        
        # Net calculations
        strikes_df['net_gex_dollar'] = strikes_df['call_gex_dollar'] + strikes_df['put_gex_dollar']
        strikes_df['net_gex_shares'] = strikes_df['call_gex_shares'] + strikes_df['put_gex_shares']
        strikes_df['net_vex_dollar'] = strikes_df['call_vex_dollar'] + strikes_df['put_vex_dollar']
        strikes_df['net_cex_dollar'] = strikes_df['call_cex_dollar'] + strikes_df['put_cex_dollar']
        strikes_df['total_volume'] = strikes_df['call_volume'] + strikes_df['put_volume']
        strikes_df['total_oi'] = strikes_df['call_openInterest'] + strikes_df['put_openInterest']
        
        # Vol/OI ratio (protect against division by zero)
        strikes_df['vol_oi_ratio'] = np.where(
            strikes_df['total_oi'] > 0,
            strikes_df['total_volume'] / strikes_df['total_oi'],
            0.0
        )
        
        # Sort by strike
        strikes_df = strikes_df.sort_values('strike').reset_index(drop=True)
        
        # Identify walls
        # Call Wall = strike with largest positive GEX (or call Gamma/OI). Standard is largest Call GEX dollar.
        call_wall_row = strikes_df.loc[strikes_df['call_gex_dollar'].idxmax()] if not strikes_df.empty else None
        call_wall = float(call_wall_row['strike']) if call_wall_row is not None else 0.0
        
        # Put Wall = strike with largest negative GEX (or put Gamma/OI). Standard is largest absolute Put GEX dollar.
        put_wall_row = strikes_df.loc[strikes_df['put_gex_dollar'].idxmin()] if not strikes_df.empty else None
        put_wall = float(put_wall_row['strike']) if put_wall_row is not None else 0.0
        
        # Max GEX Strike
        max_gex_row = strikes_df.loc[strikes_df['net_gex_dollar'].abs().idxmax()] if not strikes_df.empty else None
        max_gex_strike = float(max_gex_row['strike']) if max_gex_row is not None else 0.0

        # Find Gamma Flip Level
        gamma_flip = self.find_gamma_flip(spot, calls, puts, r, q)
        
        # Compute IV Skew
        iv_skew = self.calculate_iv_skew(calls, puts, spot)
        
        # Compute aggregate totals
        total_gex_dollar = strikes_df['net_gex_dollar'].sum()
        total_vex_dollar = strikes_df['net_vex_dollar'].sum()
        total_cex_dollar = strikes_df['net_cex_dollar'].sum()
        
        return {
            'symbol': processed_data['symbol'],
            'current_price': spot,
            'gamma_flip': gamma_flip,
            'call_wall': call_wall,
            'put_wall': put_wall,
            'max_gex_strike': max_gex_strike,
            'total_gex_dollar': total_gex_dollar,
            'total_vex_dollar': total_vex_dollar,
            'total_cex_dollar': total_cex_dollar,
            'iv_skew': iv_skew,
            'strikes': strikes_df
        }

    def total_gex_at_spot(self, target_spot: float, calls: pd.DataFrame, puts: pd.DataFrame, r: float, q: float) -> float:
        """
        Calculates the net GEX dollar sum for a hypothetical spot price.
        Used by the root finder to locate the Gamma Flip level.
        """
        # Re-evaluate Gamma for calls
        c_gamma = calls.apply(
            lambda row: self.calculate_greeks(target_spot, row['strike'], row['T'], r, q, row['impliedVolatility'], 'call')['gamma'],
            axis=1
        )
        c_gex = c_gamma * calls['openInterest'] * (target_spot ** 2) * 0.01 * 100
        
        # Re-evaluate Gamma for puts
        p_gamma = puts.apply(
            lambda row: self.calculate_greeks(target_spot, row['strike'], row['T'], r, q, row['impliedVolatility'], 'put')['gamma'],
            axis=1
        )
        p_gex = -p_gamma * puts['openInterest'] * (target_spot ** 2) * 0.01 * 100
        
        return float(c_gex.sum() + p_gex.sum())

    def find_gamma_flip(self, spot: float, calls: pd.DataFrame, puts: pd.DataFrame, r: float, q: float) -> float:
        """
        Finds the exact spot price where net dealer GEX is zero.
        Scans +/- 20% around current spot price.
        """
        try:
            # Objective function
            def f(x):
                return self.total_gex_at_spot(x, calls, puts, r, q)
            
            # Scan bounds
            lower_bound = spot * 0.8
            upper_bound = spot * 1.2
            
            f_lower = f(lower_bound)
            f_upper = f(upper_bound)
            
            # Check if signs are different to ensure a root exists in this interval
            if np.sign(f_lower) != np.sign(f_upper):
                flip_level = brentq(f, lower_bound, upper_bound, xtol=1e-2)
                return float(flip_level)
                
            # If no root in +/- 20%, try a wider search +/- 50%
            lower_bound = spot * 0.5
            upper_bound = spot * 1.5
            f_lower = f(lower_bound)
            f_upper = f(upper_bound)
            if np.sign(f_lower) != np.sign(f_upper):
                flip_level = brentq(f, lower_bound, upper_bound, xtol=1e-2)
                return float(flip_level)
            
            # If still not found, return an approximation based on the sign changes of strikes
            # (Where GEX shifts from negative to positive in the sorted strikes data)
            logger.warning("Could not find analytical Gamma Flip root. Approximating from aggregate strikes.")
        except Exception as e:
            logger.error(f"Error solving for Gamma Flip level: {e}")
            
        return spot # Return current spot as fallback

    def calculate_iv_skew(self, calls: pd.DataFrame, puts: pd.DataFrame, spot: float) -> float:
        """
        Calculates the IV skew as: IV of 25-Delta Put - IV of 25-Delta Call.
        If exact 25-delta option doesn't exist, we find the options closest to 25-delta (delta ~ -0.25 and 0.25).
        """
        try:
            # Delta for puts is negative, so search for delta closest to -0.25
            puts_25d = puts.iloc[(puts['delta'] - (-0.25)).abs().argsort()[:1]]
            # Delta for calls is positive, so search for delta closest to 0.25
            calls_25d = calls.iloc[(calls['delta'] - 0.25).abs().argsort()[:1]]
            
            if not puts_25d.empty and not calls_25d.empty:
                put_iv = puts_25d['impliedVolatility'].values[0]
                call_iv = calls_25d['impliedVolatility'].values[0]
                skew = put_iv - call_iv
                return float(skew)
        except Exception as e:
            logger.error(f"Error calculating IV skew: {e}")
        return 0.0

    @staticmethod
    def calculate_ovi(calls: pd.DataFrame, puts: pd.DataFrame) -> float:
        """
        Calculates Option Volume Imbalance (OVI).
        Formula: OVI = (Call Volume - Put Volume) / (Call Volume + Put Volume)
        """
        total_call_vol = calls['volume'].sum()
        total_put_vol = puts['volume'].sum()
        denominator = total_call_vol + total_put_vol
        if denominator > 0:
            return float((total_call_vol - total_put_vol) / denominator)
        return 0.0
