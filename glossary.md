# Gamma GEX Trading System - Terminology Glossary

This glossary contains detailed explanations of the key quantitative metrics, Greek exposures, and market structure terminology used throughout the Gamma Gex Trading System.

---

## 1. GEX (Gamma Exposure)
*   **Definition**: Gamma Exposure measures the rate of change of options **Delta** with respect to the change in the underlying stock price ($S$), scaled by the size of the options open interest ($OI$) and dealer positioning assumptions.
*   **Dealer Hedging Mechanics**: 
    *   **Positive GEX (Long Gamma)**: Dealers are net buyers of options (typically long calls and puts). To maintain a delta-neutral book, they must **sell underlying stock when the price rises** and **buy stock when the price falls**. This dampens market volatility, creating a range-bound environment.
    *   **Negative GEX (Short Gamma)**: Dealers are net sellers of options. To remain delta-neutral, they must **buy stock when the price rises** (short-covering) and **sell stock when the price falls**. This amplifies market volatility, leading to rapid trend extensions or cascades.
*   **Mathematical Formula**:
    $$\text{GEX}_{\text{Call}} = \Gamma_{\text{Call}} \times \text{OI}_{\text{Call}} \times S^2 \times 0.01 \times 100$$
    $$\text{GEX}_{\text{Put}} = -\Gamma_{\text{Put}} \times \text{OI}_{\text{Put}} \times S^2 \times 0.01 \times 100$$
    $$\text{Net GEX} = \text{GEX}_{\text{Call}} + \text{GEX}_{\text{Put}}$$
*   **Unit**: Expressed in **Dollar Gamma per 1% move** (e.g., "$100M GEX" means dealers must buy/sell $100M worth of stock for every 1% move in the asset).

---

## 2. Gamma Flip Point
*   **Definition**: The price level at which the net dealer exposure changes from **Positive Gamma** (market stabilizing) to **Negative Gamma** (market accelerating).
*   **Significance**: When the underlying spot price crosses below the GEX Flip point, index volatility typically expands rapidly. Conversely, crossing above the Flip level cushions price movements.
*   **Engine Calculation**: The system uses Brent's root-finding numerical method to solve the equation:
    $$\sum_{i} \text{GEX}_i(S_{\text{Flip}}) = 0$$

---

## 3. VEX (Vanna Exposure)
*   **Definition**: Vanna Exposure measures the sensitivity of dealer **Delta** to changes in **Implied Volatility (IV)**.
*   **Significance**: Represents how dealer hedging requirements change as the market's fear index (IV) rises or falls.
    *   In a **Vanna Squeeze**, a drop in IV reduces dealer delta obligations, forcing them to buy stock to cover, which pushes prices higher and crushes IV further—creating a feedback loop.
*   **Formula**:
    $$\text{VEX}_{\text{Call}} = \text{Vanna}_{\text{Call}} \times \text{OI}_{\text{Call}} \times S \times 100 \times 0.01$$
    $$\text{VEX}_{\text{Put}} = -\text{Vanna}_{\text{Put}} \times \text{OI}_{\text{Put}} \times S \times 100 \times 0.01$$

---

## 4. CEX (Charm Exposure)
*   **Definition**: Charm Exposure (also known as Delta Decay) measures the rate of change of dealer **Delta** with respect to **Time to Expiration ($T$)**.
*   **Significance**: As time passes, the delta of out-of-the-money options decays to zero, while the delta of in-the-money options converges to 1.0. This decay forces dealers to continuously adjust (unwind) their delta hedges as expiration week approaches, creating a magnetic pull toward major strikes.
*   **Formula**:
    $$\text{CEX} = \text{Charm}_{\text{per\_day}} \times \text{OI} \times 100 \times S$$

---

## 5. OVI (Option Volume Imbalance)
*   **Definition**: A proprietary indicator measuring the imbalance of trading volume between call options and put options.
*   **Significance**: OVI acts as a proxy for institutional positioning. When OVI is highly positive ($> 30\%$), it suggests aggressive institutional call-buying flow on lit exchanges. When negative ($< -30\%$), it indicates heavy put-buying flows.
*   **Formula**:
    $$\text{OVI} = \frac{\text{Call Volume} - \text{Put Volume}}{\text{Call Volume} + \text{Put Volume}}$$

---

## 6. Unusual Option Activity (UOA)
*   **Definition**: Occurs when the intraday trading volume of a specific options contract significantly exceeds its existing open interest.
*   **Significance**: Indicates fresh, aggressive block positioning (often from hedge funds or institutional desks) targeting a specific strike, rather than retail day-trading.
*   **Trigger Rule**: A contract is flagged for UOA if its daily trading volume is $> 500$ contracts and the ratio of **Volume to Open Interest (Vol/OI)** is $> 1.5$.

---

## 7. Volatility Skew (IV Skew)
*   **Definition**: The difference in implied volatility between out-of-the-money (OTM) put options and OTM call options.
*   **Significance**: Measures the premium traders are willing to pay for downside protection (fear) relative to upside participation (greed). A steep skew indicates high demand for puts (bearish market expectations).
*   **Formula (25-Delta Skew)**:
    $$\text{IV Skew} = \text{IV}_{\text{25-Delta Put}} - \text{IV}_{\text{25-Delta Call}}$$

---

## 8. Put Wall and Call Wall
*   **Definition**: 
    *   **Call Wall**: The strike price holding the largest positive GEX (resistance). It represents a structural ceiling because dealers must sell stock to maintain neutrality as the price approaches it.
    *   **Put Wall**: The strike price holding the largest negative GEX (support). It acts as a structural floor because dealers buy stock to defend their positions, unless the wall is breached, which triggers capitulation selling.

---

## 9. $ADD (NYSE/Nasdaq Tick Breadth)
*   **Definition**: Measures the net number of advancing stocks minus declining stocks trading on the exchange in real-time.
*   **Significance**: Used to diagnose broad market participation.
    *   **Bullish ($ADD > +500$):** Indicates broad-based buying (a rising tide lifting all boats).
    *   **Bearish ($ADD < -500$):** Indicates broad selling pressure. 

---

## 10. $VOLD (Volume Flow Ratio)
*   **Definition**: The ratio of daily transacted volume in advancing stocks vs. declining stocks.
*   **Significance**: Measures the strength of money flow.
    *   **Bullish ($VOLD > 1.5x$):** Implies institutional buying block flows (accumulation).
    *   **Bearish ($VOLD < 0.7x$):** Implies institutional selling and liquidations (distribution).

---

## 11. $TICK (Exchange Momentum Index)
*   **Definition**: The net difference between stocks executing on an uptick minus those executing on a downtick at any given instant.
*   **Significance**: Measures short-term market momentum. Extreme spikes ($\pm 1000$) indicate momentum exhaustion and often trigger intraday mean reversion.

---

## 12. $TRIN (Arms Index)
*   **Definition**: The Arms Index measures the velocity of market volume relative to breadth:
    $$\text{TRIN} = \frac{\text{Advancing Stocks / Declining Stocks}}{\text{Advancing Volume / Declining Volume}}$$
*   **Significance**: Volatility momentum indicator.
    *   **Bullish (< 0.8):** Buying pressure is heavy and concentrated.
    *   **Bearish (> 1.2):** Selling pressure is panic-driven. Readings $> 2.0$ indicate extreme capitulation.

---

## 13. Bayesian Success Probability Engine
*   **Definition**: A predictive model combining prior static probabilities (calculated via a logistic regression on GEX regimes and VIX) with live intraday order flow inputs ($TICK$ and $VOLD$).
*   **Formula**:
    $$\text{Posterior Probability } P(S|F) = \frac{P(F|S) \cdot P(S)}{P(F|S) \cdot P(S) + P(F|S^c) \cdot P(S^c)}$$
*   **Significance**: Computes a dynamic probability of success for credit-reversion or debit-breakout trades, allowing capital sizing adjustments based on flow shifts.

---

## 14. Kelly Criterion Position Sizing
*   **Definition**: A mathematical formula used to calculate the optimal fraction of trading capital to allocate to a trade to maximize growth:
    $$f^* = \frac{p \cdot (b + 1) - 1}{b}$$
    Where $p$ is the posterior success probability, and $b$ is the net payout odds (set to 0.5 for credit reversion and 1.5 for debit breakouts).
*   **Significance**: Determines allocation fractions (e.g. 5% of equity) and adjusts risk multipliers to prevent account blowouts during adverse drawdowns.

---

## 15. Relative Close Strength (RCS) & Transition Check
*   **Definition**: A quantitative scorecard run at 3:45 PM EST that calculates an active trade's relative performance against its daily range:
    $$\text{RCS} = \frac{\text{Last Price} - \text{Low}}{\text{High} - \text{Low}}$$
*   **Significance**: Used to transition a day trade into an overnight swing. Long trades require RCS $\ge 0.85$ (closing at the absolute high), a positive GEX regime, and no upcoming morning macro/earnings catalysts to hold overnight.

---

## 16. Federal Reserve Net Liquidity
*   **Definition**: An indicator measuring the quantity of liquid reserves held by commercial banks at the central bank:
    $$\text{Net Liquidity} = \text{Fed Balance Sheet (WALCL)} - \text{Treasury General Account (TGA)} - \text{Reverse Repo Facility (RRP)}$$
*   **Significance**: Strong leading indicator for S&P 500 swings. Upward trends support equity price multiple expansions; downward trends precede corrections.

---

## 17. VIX / VXV Term Structure
*   **Definition**: The ratio of front-month implied volatility (VIX, 30 days) vs. three-month implied volatility (VXV, 90 days).
*   **Significance**: 
    *   **Contango (< 1.0):** Normal quiet market state; low volatility risk.
    *   **Backwardation (≥ 1.0):** Extreme panic state; short-term fear outpaces mid-term expectations. Swing positions should be scaled back or closed.

---

## 18. Yield Curve Spread (10Y - 3M)
*   **Definition**: The yield spread between the US 10-Year Treasury Note and the 3-Month Treasury Bill.
*   **Significance**: A classic recession indicator. Persistent inversion (negative spread) followed by a rapid steepening (un-inversion) indicates credit market distress and structural economic transitions.

---

## 19. High-Yield Credit Spreads (BofA HY Spread)
*   **Definition**: The yield spread difference between high-yield corporate junk bonds and safe Treasury bonds.
*   **Significance**: Measures corporate default risk premium. Widening spreads indicate tightening credit conditions and systemic corporate distress.

---

## 20. Relative Strength (RS) watchlist leaderboard
*   **Definition**: Tracks the current-session performance of watchlist assets relative to the benchmark index:
    $$\text{RS} = \text{Asset Perf \%} - \text{SPY Perf \%}$$
*   **Significance**: Used to identify leaders and laggards. During market rallies, buy the leaders (top RS); during flushes, short the laggards (lowest RS).

---

## 21. VCP (Volatility Contraction Pattern)
*   **Definition**: A chart pattern popularized by Mark Minervini showing price consolidations with sequential contraction waves (e.g. 15% &rarr; 8% &rarr; 4% swings) under shrinking volume.
*   **Significance**: Indicates institutional accumulation and absorption of sellers. When sellers are exhausted, a small amount of buying volume triggers explosive breakouts.

---

## 22. Mean Reversion (Wall Exhaustion)
*   **Definition**: The tendency of an asset's price to revert back to its historical average or central gravity anchor (e.g. the GEX Flip level) after testing extreme boundaries (the Call Wall or Put Wall).
*   **Significance**: Dealers defend their wall strikes by buying/selling underlying stock, capping price momentum and prompting high-probability counter-trend reversals.

