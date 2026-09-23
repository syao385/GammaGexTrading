# Full Functional Specification & System Roadmap
**Gamma GEX & Order Flow Trading System**  
**Document Version**: 2.0.0 (Living Cumulative Document)  
**System Status**: Production / Active  
**Last Updated**: September 2026 (Release v2.0)  
**Target Environment**: Institutional Options & Order Flow Desk  
**Repository**: [syao385/GammaGexTrading](https://github.com/syao385/GammaGexTrading)  

---

## Document Revision & Version Control History

| Version | Date | Author | Description of Changes |
| :--- | :--- | :--- | :--- |
| **v1.0.0** | July 2026 | Desk Engineering | Initial functional specification covering core GEX, Greeks curves, and market screener. |
| **v1.5.0** | August 2026 | Desk Engineering | Functional specs for Order Flow Workstation (Bookmap, Footprint, DOM, CVD, broker streaming). |
| **v2.0.0** | September 2026 | Desk Engineering | **Cumulative Living Release v2.0**: Added functional specs for Candlestick and Volume Profile overlays on Bookmap/Footprint; Interactive 30-day Candlestick Chart (20 EMA, FVGs, Volume Profile); 1-to-1 Option Strategy Playbook with timestamps and pricing targets; Cash vs Options (4.0x leverage) Backtester; SQLite Liquid Universe background scanner; Resilient WebSocket proxy queue; and health-checked `run.bat`. |

---

## 1. Executive Summary & System Scope

The **Gamma GEX & Order Flow Trading System** is an advanced quantitative trading platform combining macro options volatility positioning with micro order flow execution.

```
┌────────────────────────────────────────────────────────┐
│             Macro Options Volatility Map               │
│        (Call/Put Walls, GEX Flip, VEX, CEX)            │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│            Micro Order Flow Execution Trigger          │
│       (Footprint, Bookmap Overlays, Stacked Imbal)     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│           Bayesian Probability & Kelly Sizing          │
│         (Posterior Win Rate, Fractional Kelly)         │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│          1-to-1 Option Strategy Playbook Card          │
│      (Timestamps, Rationale, Exact Pricing Targets)    │
└────────────────────────────────────────────────────────┘
```

---

## 2. Implemented Modules & Feature Specifications

### Module 1: Options GEX & Volatility Regime Analytics
*   **Dollar Gamma Exposure (GEX)**: Calculates per-strike dollar gamma exposure scaled by 1% spot price change across Call and Put option chains.
*   **Gamma Flip Point ($S_{\text{Flip}}$)**: Numerically solves $\sum \text{GEX}_i(S_{\text{Flip}}) = 0$ via Brent's method.
*   **Structural Walls**:
    *   **Call Wall**: Strike with maximum positive dollar GEX (resistance ceiling).
    *   **Put Wall**: Strike with maximum negative dollar GEX (support floor).
    *   **Max Gamma Strike**: Strike holding absolute peak gamma intensity (pin target).
*   **Second-Order Greeks**: Real-time Vanna Exposure (VEX) for volatility squeezes and Charm Exposure (CEX) for delta decay.
*   **Options Flow Metrics**: Option Volume Imbalance (OVI), Unusual Option Activity (UOA), and 25-Delta IV Skew.

### Module 2: Order Flow Microstructure & Execution Workstation
*   **Bookmap Heatmap Canvas**: Renders resting limit order depth (L2 DOM), logarithmic trade bubbles, and real-time **candlestick price action overlay**.
*   **Volume Profile Overlays**: Displays horizontal volume distribution histograms directly on Bookmap and Footprint charts with **POC**, **VAH**, and **VAL** markers.
*   **Consolidated Footprint Chart**:
    *   Split **Bid | Ask** volume sub-boxes with tiered color-intensity shading.
    *   **Point of Control (POC)** purple border on highest volume bucket.
    *   **Stacked Imbalance Bands**: Detects sequences of $\ge 2$ diagonal imbalances ($\ge 3.0\times$ ratio) and draws horizontal support/resistance bands.
    *   **Absorption Badges (`ABS`)**: Highlights institutional absorption at bar extremes.
    *   **Net Delta Footers**: Displays numerical net delta at the base of every bar.
*   **Cumulative Volume Delta (CVD) & MLOFI**: Tracks aggressive market flow divergence and limit order stacking velocity.
*   **Live Broker Streaming**: Supports Charles Schwab and Alpaca Markets via WebSocket with resilient asynchronous queuing and automatic fallback to simulation.
*   **Simulator Visibility Control**: Automatically hides simulation controls when live broker credentials are present.

### Module 3: 1-to-1 Option Strategy Playbook & Tactical Card
*   **Automated Strategy Recommendation**: Evaluates GEX regime, distance to walls, and IV skew to recommend exact strategies (e.g., Bull Put Credit Spread, Bear Call Credit Spread, Long Straddle).
*   **Real-Time Timestamps**: Displays calculation timestamp on every tactical setup.
*   **Analytical Rationale**: Clear reasoning explaining why the strategy was triggered.
*   **Exact Dollar Pricing Targets**: Outputs ATM Anchor Strike, suggested spread width, target profit level, and hard stop-loss price.
*   **ASSET Scorecard Grading**: Synthesizes GEX, Breadth, Order Flow, and SMC signals into Grades A+, A, B, C, D with corresponding Kelly capital sizing.

### Module 4: Screener & Scanners Hub
*   **Watchlist Screener**: Scans watchlist symbols with customizable alerts (Bullish, Bearish, UOA, Wall Proximity). Clicking any ticker navigates directly to the GEX Hub.
*   **Interactive Candlestick Modal**: Instant 30-day candlestick chart with 20 EMA, Fair Value Gaps (FVG), and Volume Profile for any screened symbol.
*   **SQLite Liquid Universe Scanner**: High-throughput background engine scanning 1,000+ liquid US optionable equities into `backend/liquid_universe.db`.
*   **Smart Money Concepts (SMC)**: Automated detection of Fair Value Gaps (FVG) and Market Structure Shifts (MSS).

### Module 5: Backtester & Lab
*   **Dual Asset Class Engine**:
    *   **Cash Mode (`cash`)**: Simulates 1.0x underlying equity returns.
    *   **Options Mode (`options`)**: Simulates non-linear options returns with a 4.0x effective leverage multiplier, asymmetric payouts, and dedicated options stop-loss rules.
*   **Institutional Strategy Library**: Put Wall Bounce, Call Wall Reversal, GEX Flip Squeeze/Breakdown, VCP Accumulation, FVG Fill, Breaker Block, and Range Condor.
*   **Performance Metrics**: Win rate, profit factor, total return, maximum drawdown, Sharpe ratio, and complete trade log.

### Module 6: Day Trading & Swing Macro Hubs
*   **Live Market Internals**: Real-time NYSE breadth dials ($ADD, $VOLD, $TICK, $TRIN).
*   **Bayesian & Kelly Assistant**: Computes posterior win probabilities and fractional Kelly capital sizing.
*   **Day-to-Swing Transition Helper**: Evaluates Relative Close Strength (RCS) at 3:45 PM EST to determine overnight hold suitability.
*   **Swing Macro Indicators**: Federal Reserve Net Liquidity overlay, VIX/VXV term structure, SKEW index, and OPEX calendar countdown.

---

## 3. REST & WebSocket API Specifications

| Endpoint | Method | Parameters | Response Description |
| :--- | :--- | :--- | :--- |
| `/` | `GET` | None | Serves single-page application dashboard. |
| `/api/gex/{symbol}` | `GET` | `symbol`, `expiration`, `maxExp` | Comprehensive GEX profile, Greeks curves, walls, and skew. |
| `/api/screener/chart-data` | `GET` | `symbol` | 30-day OHLC candles, EMA 20, unmitigated FVGs, and Volume Profile. |
| `/api/screener` | `GET` | `symbols` | Real-time screener results and alerts across watchlist. |
| `/api/screener/liquid-scan` | `GET` | `setupFilter`, `minPrice`, `limit`, `offset` | Paginated query of SQLite liquid universe database. |
| `/api/internals/day-trading-snapshot`| `GET` | None | Real-time NYSE breadth dials and Bayesian metrics. |
| `/api/internals/swing-trading-snapshot`| `GET`| None | Macro swing metrics (Fed Liquidity, Term Structure, SKEW). |
| `/api/strategy/calculate-probability` | `GET` | `setup`, `gexRegime`, `vixLevel`, `symbol` | Bayesian win probability and Kelly allocation fraction. |
| `/api/backtest` | `GET` | `symbol`, `strategy`, `startDate`, `endDate`, `assetClass`, etc. | Backtest performance statistics and trade journal. |
| `/api/orderflow/live` | `WS` | `symbol`, `provider` | Real-time WebSocket stream for L2 order book depth and trades. |

---

## 4. Future Roadmap & Extensibility

1. **Multi-Leg Live Options Execution**: Direct broker order routing to execute recommended 1-to-1 spreads via Schwab or Alpaca API.
2. **Machine Learning Regime Classification**: Random Forest / LSTM model classifying intraday volatility regimes from high-frequency tick data.
3. **Automated Trade Journaling**: Direct synchronization of executed trades into an SQLite performance journal.