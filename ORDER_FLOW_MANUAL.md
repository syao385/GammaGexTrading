# Institutional Order Flow & GEX Trading Manual
**Document Version**: 2.0.0 (Living Cumulative Document)  
**System Status**: Production / Active  
**Last Updated**: September 2026 (Release v2.0)  
**Repository**: [syao385/GammaGexTrading](https://github.com/syao385/GammaGexTrading)  

---

## Document Revision & Version Control History

| Version | Date | Author | Description of Changes |
| :--- | :--- | :--- | :--- |
| **v1.0.0** | July 2026 | Desk Engineering | Initial manual defining GEX structural barriers and basic order flow principles. |
| **v1.5.0** | August 2026 | Desk Engineering | Integrated Bookmap Heatmap, Footprint chart with POC, DOM ladder, and Cumulative Delta. |
| **v2.0.0** | September 2026 | Desk Engineering | **Cumulative Living Release v2.0**: Added Candlestick overlays onto Bookmap canvas; added Volume Profile histogram and level overlays (POC, VAH, VAL); increased right-margin padding to prevent price label cutoff; implemented stacked imbalance zone drawing; integrated resilient WebSocket queue for Schwab and Alpaca; added automatic graceful fallback to simulation mode; and added key-based simulator hiding. |

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

### A. The Bookmap Heatmap Canvas
The Bookmap canvas displays resting limit order book depth (L2 DOM) scrolling horizontally across time, overlaid with executed transactions, candlesticks, and volume profiles.

*   **Resting Liquidity Heat:** The background color gradient represents resting limit order size:
    *   **Bright Orange / Yellow Bands:** Large institutional limit orders (walls). These act as price targets or support/resistance blocks.
    *   **Indigo / Dark Blue Zones:** Thin liquidity. Price travels through these areas rapidly.
*   **Aggressive Execution Bubbles:** Circles represent market orders executing instantly:
    *   **Green Bubbles:** Aggressive buying sweeping the offer.
    *   **Red Bubbles:** Aggressive selling hitting the bid.
    *   **Bubble Size:** Scaled logarithmically by transaction size. Massive bubbles indicate block trades from institutional players.
*   **Candlestick Overlay:** Real-time candlestick bodies and wicks plotted directly on top of the depth heatmap, providing continuous Price Action context.
*   **Volume Profile Histogram Overlay:** Displays horizontal volume distribution bars anchored to the right axis with Point of Control (**POC**), Value Area High (**VAH**), and Value Area Low (**VAL**).
*   **Calibrated Right Margin (`padRight`):** Dedicated right padding guarantees price scale badges and current market prices are never clipped.

### B. The Consolidated Footprint Chart
The Footprint chart shows a detailed internal breakdown of the buy vs. sell volume traded at every price level inside each time bar.

*   **Bid / Ask Sub-Boxes:** Volume split rendered as `Bid Volume (Sells) | Ask Volume (Buys)` with tiered background shading (Light, Medium, Dark Red/Green) reflecting volume intensity.
*   **Point of Control (POC - Purple Border):** The price bucket in a bar containing the **highest total volume**. It acts as the fair-value anchor for that time segment.
*   **Buying Imbalance (Green Cells):** Triggered when aggressive ask volume is $\ge 3.0\times$ the diagonal bid volume. Confirms institutional buyers are lifting the offer.
*   **Selling Imbalance (Red Cells):** Triggered when aggressive bid volume is $\ge 3.0\times$ the diagonal ask volume. Confirms institutional sellers are hitting the bid.
*   **Stacked Imbalance Zones:** When $\ge 2$ consecutive diagonal imbalances occur in the same bar, horizontal shaded bands (Green for Buyside, Red for Sellside) project forward as support/resistance zones.
*   **Passive Absorption Badges (`ABS`):** High-volume nodes ($> 3\times$ average cell volume) at bar High/Low boundaries highlighted with bold cyan/magenta borders and `ABS` badges, signaling institutional absorption.
*   **Net Delta Footers:** Quantitative net delta (`Ask Vol - Bid Vol`) printed at the base of every footprint column.

### C. The Cumulative Delta Sub-Chart & MLOFI
Running session calculation of aggressive market orders:
$$\text{Cumulative Delta} = \sum (\text{Aggressive Buy Volume} - \text{Aggressive Sell Volume})$$

*   **Upward Trend:** Aggressive buyers are driving the auction.
*   **Downward Trend:** Aggressive sellers are driving the auction.
*   **Bullish Divergence:** Price makes a lower low while Cumulative Delta makes a higher low $\rightarrow$ sellers are exhausting themselves into passive limit bids.
*   **Bearish Divergence:** Price makes a higher high while Cumulative Delta makes a lower high $\rightarrow$ buyers are exhausting themselves into passive limit asks.
*   **MLOFI (Modified Limit Order Flow Imbalance):** Secondary orange line tracking the velocity of resting limit orders stacking vs. pulling.

### D. The DOM (Depth of Market) Ladder & Center of Gravity (CoG)
Vertical grid displaying queued bids (left) and asks (right) centered around the last traded price.
*   **Center of Gravity (CoG):** Volume-weighted average price of resting liquidity:
    $$\text{CoG} = \frac{\sum (Price \cdot Size)}{\sum Size}$$
    Rendered as green (Bid CoG) and red (Ask CoG) dotted lines tracking dynamic liquidity shelves.

---

## 3. High-Probability Trading Setups

### Setup 1: Absorption at the Put Wall (Reversal Setup)
```
 Price Path:  =====================\               /===========> (Long Entry)
                                    \  Absorption /
                                     \=====v=====/
------------------------------------- Put Wall (Support) -----------------------------------
```
*   **Pre-Condition:** Spot approaches the Put Wall in a positive gamma regime.
*   **Order Flow Trigger:**
    1. Large red execution bubbles print on Bookmap into the wall, but price stalls.
    2. Footprint displays a selling imbalance with an `ABS` badge at the bottom wick.
    3. DOM Bid CoG flattens and rises, confirming buyers are stepping in.
*   **Execution:** Enter **Bull Put Credit Spread** (Sell ATM Put, Buy $1–$2 OTM Put).
*   **Stop Loss:** 1 tick below the lowest footprint absorption wick.

### Setup 2: Momentum Sweep at the GEX Flip (Breakout Setup)
```
                                                  /============> (Long Breakout)
                                                 /
------------------------------------- GEX Flip Level ---------------------------------------
                                         / (Sweep)
 Price Path:  ==========================/
```
*   **Pre-Condition:** Spot crosses above the Gamma Flip point into a positive gamma squeeze or below into negative gamma acceleration.
*   **Order Flow Trigger:**
    1. DOM Ask orders ahead of price cancel rapidly (liquidity pulling).
    2. Cumulative Delta spikes aggressively in the direction of the break.
    3. Footprint prints a **stacked buying imbalance ($\ge 2$ consecutive green levels)**.
*   **Execution:** Enter **Bull Call Debit Spread** (Buy ATM Call, Sell $2–$3 OTM Call).
*   **Stop Loss:** Cross back across the GEX Flip level with negative delta.

### Setup 3: Exhaustion Rejection at the Call Wall (Sonar Divergence)
*   **Pre-Condition:** Spot runs into the Call Wall or Max Gamma strike.
*   **Order Flow Trigger:**
    1. Massive green bubbles print on Bookmap, but price cannot advance.
    2. Sonar Pulse warning flashes on screen (Sonar ratio $< 0.15$).
    3. Footprint bar closes red with an absorption badge at the high.
*   **Execution:** Enter **Bear Call Credit Spread** or buy short-term **OTM Puts**.
*   **Stop Loss:** 1 tick above the resting Call Wall block.

---

## 4. Live Streaming Architecture & Operational Controls

### A. Resilient Upstream Queuing
The backend WebSocket proxy (`/api/orderflow/live`) implements an internal asynchronous message queue (`asyncio.Queue(maxsize=1000)`). High-frequency market bursts from Charles Schwab or Alpaca are buffered smoothly, eliminating dropped frames and browser rendering locks.

### B. Automatic Simulation Fallback
If Charles Schwab or Alpaca credentials are not configured, expired, or rejected during handshakes, the streamer automatically transitions to High-Fidelity Simulation mode without throwing unhandled exceptions.

### C. Automatic Simulator Visibility Toggle
- **No Keys Configured**: Simulator control bar is visible for offline training and scenario analysis.
- **Keys Configured**: Simulator control bar is automatically hidden, ensuring an unobstructed institutional cockpit.

### D. Dynamic Symbol Re-Subscription
Changing the active ticker in the global search instantly re-subscribes the live stream to the new symbol without requiring a manual page refresh.