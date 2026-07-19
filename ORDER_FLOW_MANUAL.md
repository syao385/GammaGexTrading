# Institutional Order Flow & GEX Trading Manual

This manual explains how to combine macro **Options GEX key levels** (support, resistance, and volatility zones) with micro **Order Flow execution metrics** (Footprints, Bookmap Heatmaps, DOM Ladders, and Cumulative Delta) to execute high-probability "sniper" entries and manage risk with minimal drawdown.

---

## 1. The Core Principle: Macro Context vs. Micro Confluence

```
+----------------------------------------+
|           Options GEX Profile          |  --> Defines WHERE dealers must hedge
|  (Call Wall, Put Wall, GEX Flip Level) |
+----------------------------------------+
                   |
                   v
+----------------------------------------+
|           Order Flow Engine            |  --> Confirms WHEN institutions are acting
|    (Resting Book, Imbalances, Delta)   |
+----------------------------------------+
```

*   **Options GEX (The Map):** Calculates where options market makers are positioned and where they must buy or sell stock to hedge their portfolios. This establishes structural barriers (Call/Put Walls) and volatility regime boundaries (Flip Levels).
*   **Order Flow (The Trigger):** Shows actual executed transactions (Market Orders) and resting liquidity (Limit Orders) in real-time. This confirms if a key GEX level is going to hold (absorption) or break (momentum sweep).

---

## 2. Order Flow Component Guide

### A. The Bookmap Heatmap
The Bookmap canvas displays resting limit order book depth (L2 DOM) scrolling over time, overlaid with executed transactions.

*   **Resting Liquidity Heat:** The background color gradient represents resting limit order size.
    *   **Bright Orange / Yellow Bands:** Large institutional limit orders (walls). These act as price targets or support/resistance blocks.
    *   **Indigo / Black Zones:** Thin liquidity. Price travels through these areas rapidly.
*   **Aggressive Execution Bubbles:** Circles represent market orders executing instantly.
    *   **Green Bubbles:** Aggressive buying sweeping the offer.
    *   **Red Bubbles:** Aggressive selling hitting the bid.
    *   **Bubble Size:** Scaled logarithmically by transaction size. Massive bubbles indicate block trades from institutional players.

### B. The Consolidated Footprint Chart
The Footprint chart shows a detailed internal breakdown of the buy vs. sell volume traded at every price level inside a specific time bar.

*   **Point of Control (POC - Purple Border):** The price level in a bar containing the **highest total volume**. It acts as the fair-value anchor for that time segment.
*   **Buying Imbalance (Green Cells):** Triggered when the aggressive ask volume is $\ge 3.5\times$ the diagonal bid volume. Confirms institutional buyers are lifting the offer.
*   **Selling Imbalance (Red Cells):** Triggered when the aggressive bid volume is $\ge 3.5\times$ the diagonal ask volume. Confirms institutional sellers are hitting the bid.

### C. The Cumulative Delta Sub-Chart
The Cumulative Delta line chart is a running session calculation of:
$$\text{Cumulative Delta} = \sum (\text{Aggressive Buy Volume} - \text{Aggressive Sell Volume})$$

*   **Upward Trend:** Aggressive buyers are driving the auction.
*   **Downward Trend:** Aggressive sellers are driving the auction.
*   **Divergence:** If price makes a new low but the Cumulative Delta line makes a higher low (Bullish Divergence), it indicates short sellers are hitting passive limit bids and exhausting themselves, signaling a reversal.

### D. The DOM (Depth of Market) Ladder
A vertical grid displaying currently queued bids (left) and asks (right) centered around the last traded price. Allows you to monitor order cancellations, additions, and spoofing attempts.

---

## 3. High-Probability Trading Setups

Use the **Offline Scenario Simulator** inside your desk to practice these plays:

### Setup 1: Absorption at the Put Wall (Reversal Setup)

Use this setup to buy support bounces with extremely tight risk parameters.

```
 Price Path:  =====================\               /===========> (Long Entry)
                                    \  Absorption /
 Put Wall GEX: ----------------------*----*---*---*-----------------------
 Limit Bids:   [ Bright Orange Band (Resting Buy Blocks) ]
 Executions:                         [ Large Red Bubbles (Aggressive Sells) ]
```

1.  **Macro Context:** Price declines towards the **Put Wall**. Options dealers are heavily long puts here and are structurally forced to buy the underlying stock to maintain delta neutrality.
2.  **Order Flow Confluence:**
    *   **Heatmap:** A thick, bright orange band representing large resting limit bids stacks at the Put Wall.
    *   **Bubbles:** Price hits the Put Wall, triggering large **Red execution bubbles** (market orders selling).
    *   **Price Action:** The price refuses to tick lower despite the high-volume selling. This is **Absorption**—passive institutional buy orders are swallowing the aggressive market sells.
    *   **Cumulative Delta:** The Delta line flattens out or begins diverging upwards.
    *   **Footprint:** Green cells (Buying Imbalances) print as price ticks up away from the wall.
3.  **Trade Execution:**
    *   **Trigger:** Enter **Long** (or buy Call options) when selling volume exhausts and green buying imbalances start ticking upwards.
    *   **Stop-Loss:** Place your stop-loss **3 to 5 cents** below the Put Wall. If the Put Wall breaks, the thesis is immediately invalidated, allowing you to exit with a minimal loss.
    *   **Target:** The GEX Flip Level or the next key liquidity band.

---

### Setup 2: Momentum Breakout at the GEX Flip Level (Breakout Setup)

Use this setup to trade trend continuations when shifting volatility regimes.

```
 GEX Flip Level: ---------------------[ Resting Ask Liquidity Pulls / Disappears ]
 Breakout Point: --------------------------------*-----> (Momentum Long Entry)
 Executions:                                     [ Large Green Bubbles Sweep Ask ]
 Footprint:                                      [ Stacked Green Imbalances ]
```

1.  **Macro Context:** Price approaches the **GEX Flip Level** from below. Below this level, the market is in a Negative Gamma regime (dealers sell on drops and buy on rises, accelerating volatility). Above it, dealers enter Positive Gamma (hedging dampens volatility). Breaking above forces a dealer short-covering squeeze.
2.  **Order Flow Confluence:**
    *   **Heatmap:** Resting ask limit orders stacked at the GEX Flip level suddenly vanish or turn dark blue. This is **Liquidity Pulling** (sellers clearing their offers, anticipating a breakout).
    *   **Bubbles:** Massive **Green execution bubbles** sweep through the Flip Level.
    *   **Footprint:** Stacked diagonal **Green Buying Imbalances** appear across 3 or more consecutive price bins.
    *   **Delta:** The Cumulative Delta line surges vertically.
3.  **Trade Execution:**
    *   **Trigger:** Enter **Long** (or buy ATM Calls) on the first 1-minute close above the GEX Flip Level supported by buying imbalances.
    *   **Stop-Loss:** Place your stop-loss just below the GEX Flip Level.
    *   **Target:** The GEX Call Wall.

---

## 4. UI Control Guidelines

To get the most out of your Order Flow dashboard, customize the panels based on current volatility:

*   **Tick Consolidation Dropdown:** 
    *   Use `0.05` for fine price action detailing on individual equities (AAPL, NVDA).
    *   Use `0.25` or `0.50` on QQQ/SPY to group fragmented price levels into consolidated blocks.
*   **Heatmap Contrast Slider:**
    *   Adjust to screen out noise. A setting of `35% - 50%` is recommended. This filters out retail limit orders under 200 contracts and highlights major institutional size ($1,000+$ contracts).
*   **Trade Bubble Scale Slider:**
    *   If bubbles overlap and block your view of the price line during high volume, slide the scale down to `1.5x` or `2.0x`. Set to `3.0x` when volume is low to highlight block executions.
*   **Toggle Delta Chart Button:**
    *   Keep the delta panel visible to monitor divergences. Collapse it only if you need more vertical screen space for the Bookmap timeline.
