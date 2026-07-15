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
