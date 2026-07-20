import numpy as np
import pandas as pd
import logging

logger = logging.getLogger(__name__)

class VolumeProfileCalculator:
    @staticmethod
    def calculate_volume_profile(df: pd.DataFrame, bins: int = 50) -> dict:
        """
        Calculates the Volume Profile, Point of Control (POC), and Value Area (VAH/VAL)
        from a DataFrame containing 'High', 'Low', 'Close', and 'Volume' columns.
        Supports both daily and intraday (5-minute) bars.
        """
        if df.empty or len(df) < 5:
            logger.warning("Volume Profile: insufficient history to calculate profile.")
            return {"poc": 0.0, "vah": 0.0, "val": 0.0, "hvn": [], "lvn": []}

        # Check required columns
        for col in ['High', 'Low', 'Close', 'Volume']:
            if col not in df.columns:
                logger.error(f"Volume Profile: missing required column {col}")
                return {"poc": 0.0, "vah": 0.0, "val": 0.0, "hvn": [], "lvn": []}

        try:
            # Determine price boundaries
            min_price = float(df['Low'].min())
            max_price = float(df['High'].max())
            
            if min_price == max_price:
                # Fallback if price is flat
                return {"poc": min_price, "vah": min_price, "val": min_price, "hvn": [], "lvn": []}

            price_bins = np.linspace(min_price, max_price, bins + 1)
            bin_volumes = np.zeros(bins)
            
            # Distribute each bar's volume across the bins it overlaps
            for _, row in df.iterrows():
                h = float(row['High'])
                l = float(row['Low'])
                v = float(row['Volume'])
                
                if h == l:
                    # Allocate entire volume to the bin containing this single price
                    bin_idx = np.digitize([l], price_bins)[0] - 1
                    bin_idx = max(0, min(bins - 1, bin_idx))
                    bin_volumes[bin_idx] += v
                else:
                    # Find bins that overlap with the high-low range
                    # A bin overlaps if its upper bound is > low and its lower bound is < high
                    indices = np.where((price_bins[1:] > l) & (price_bins[:-1] < h))[0]
                    if len(indices) > 0:
                        # Allocate volume equally across all overlapping bins
                        allocated_vol = v / len(indices)
                        bin_volumes[indices] += allocated_vol

            # Point of Control (POC)
            poc_idx = int(np.argmax(bin_volumes))
            poc = float((price_bins[poc_idx] + price_bins[poc_idx + 1]) / 2.0)
            
            # Calculate Value Area (VAH/VAL) enclosing 70% of total volume
            total_vol = float(np.sum(bin_volumes))
            if total_vol <= 0:
                return {"poc": poc, "vah": poc, "val": poc, "hvn": [], "lvn": []}
                
            target_vol = total_vol * 0.70
            
            # Initialize search from the POC bin
            low_idx = poc_idx
            high_idx = poc_idx
            current_vol = float(bin_volumes[poc_idx])
            
            # Expand outwards from POC, choosing the side with the higher volume bin
            while current_vol < target_vol and (low_idx > 0 or high_idx < bins - 1):
                next_low_vol = float(bin_volumes[low_idx - 1]) if low_idx > 0 else 0.0
                next_high_vol = float(bin_volumes[high_idx + 1]) if high_idx < bins - 1 else 0.0
                
                if next_low_vol >= next_high_vol and low_idx > 0:
                    low_idx -= 1
                    current_vol += next_low_vol
                elif high_idx < bins - 1:
                    high_idx += 1
                    current_vol += next_high_vol
                else:
                    # Fallback in case indices are constrained
                    if low_idx > 0:
                        low_idx -= 1
                        current_vol += next_low_vol
                    else:
                        break
                    
            val = float(price_bins[low_idx])
            vah = float(price_bins[high_idx + 1])
            
            # Identify High Volume Nodes (HVNs) and Low Volume Nodes (LVNs)
            # Smooth the histogram to filter out minor noise using a 3-bin rolling mean
            smoothed = pd.Series(bin_volumes).rolling(window=3, center=True).mean().fillna(0).values
            hvn = []
            lvn = []
            
            for i in range(1, bins - 1):
                # Local peak (HVN) must be greater than neighbors and exceed 2% of total volume
                if smoothed[i] > smoothed[i-1] and smoothed[i] > smoothed[i+1]:
                    if smoothed[i] > total_vol * 0.02:
                        bin_center = float((price_bins[i] + price_bins[i+1]) / 2.0)
                        hvn.append(bin_center)
                # Local trough (LVN) must be less than neighbors and less than 1% of total volume
                if smoothed[i] < smoothed[i-1] and smoothed[i] < smoothed[i+1]:
                    if smoothed[i] < total_vol * 0.01:
                        bin_center = float((price_bins[i] + price_bins[i+1]) / 2.0)
                        lvn.append(bin_center)
                        
            # Sort HVNs by volume (descending) and LVNs by volume (ascending)
            hvn = sorted(hvn, key=lambda p: bin_volumes[max(0, min(bins-1, np.digitize([p], price_bins)[0] - 1))], reverse=True)
            lvn = sorted(lvn, key=lambda p: bin_volumes[max(0, min(bins-1, np.digitize([p], price_bins)[0] - 1))])
            
            return {
                "poc": poc,
                "vah": vah,
                "val": val,
                "hvn": hvn[:5],  # top 5 HVNs
                "lvn": lvn[:5]   # top 5 LVNs
            }
        except Exception as e:
            logger.error(f"Volume Profile: calculation failed: {e}")
            return {"poc": 0.0, "vah": 0.0, "val": 0.0, "hvn": [], "lvn": []}
