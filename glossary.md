# Gamma GEX Trading System - Terminology Glossary
**Document Version**: 2.0.0 (Living Cumulative Document)  
**System Status**: Production / Active  
**Last Updated**: September 2026 (Release v2.0)  
**Repository**: [syao385/GammaGexTrading](https://github.com/syao385/GammaGexTrading)  

---

## Document Revision & Version Control History

| Version | Date | Author | Description of Changes |
| :--- | :--- | :--- | :--- |
| **v1.0.0** | July 2026 | Desk Engineering | Initial quantitative definitions: GEX, Gamma Flip, VEX, CEX, OVI, and 25-Delta Skew. |
| **v1.5.0** | August 2026 | Desk Engineering | Added Order Flow terminology: Footprints, Bookmap, DOM, CVD, CoG, and MLOFI. |
| **v2.0.0** | September 2026 | Desk Engineering | **Cumulative Living Release v2.0**: Added Smart Money Concepts (FVG, MSS, Breaker Blocks); Volume Profile metrics (POC, VAH, VAL, HVN, LVN); ASSET Scorecard definitions; Bayesian & Kelly mathematical formulas; and Backtesting Asset Class modes (Cash 1.0x vs Options 4.0x Leverage Factor). |

---

## 1. Options Greeks & Exposure Metrics

### 1.1 GEX (Gamma Exposure)
*   **Definition**: Measures the dollar change in options delta per 1% change in underlying price ($S$), scaled by open interest ($OI$) and dealer positioning assumptions.
*   **Dealer Hedging Mechanics**:
    *   **Positive GEX (Long Gamma)**: Dealers are net long options. They sell stock on rallies and buy on dips to stay delta-neutral, suppressing market volatility.
    *   **Negative GEX (Short Gamma)**: Dealers are net short options. They buy stock on rallies and sell on dips, accelerating market volatility and creating directional trends.
*   **Formula**:
    $$\text{GEX}_{\text{Call}} = \Gamma_{\text{Call}} \times \text{OI}_{\text{Call}} \times S^2 \times 0.01 \times 100$$
    $$\text{GEX}_{\text{Put}} = -\Gamma_{\text{Put}} \times \text{OI}_{\text{Put}} \times S^2 \times 0.01 \times 100$$
    $$\text{Net GEX} = \sum \text{GEX}_{\text{Call}} + \sum \text{GEX}_{\text{Put}}$$

### 1.2 Gamma Flip Point ($S_{\text{Flip}}$)
*   **Definition**: The underlying price level at which net dealer exposure transitions between Positive and Negative Gamma regimes.
*   **Numerical Formulation**: Brent's root-finding method (`scipy.optimize.brentq`) solves:
    $$\sum_{i} \text{GEX}_i(S_{\text{Flip}}) = 0$$

### 1.3 VEX (Vanna Exposure)
*   **Definition**: Sensitivity of dealer delta to changes in Implied Volatility ($\sigma$).
*   **Significance**: Identifies **Vanna Squeezes**—drops in IV reduce dealer short delta requirements, forcing dealers to buy stock and causing upward price spirals.
*   **Formula**:
    $$\text{VEX}_{\text{Call}} = \frac{\partial \Delta_{\text{Call}}}{\partial \sigma} \times \text{OI}_{\text{Call}} \times S \times 100 \times 0.01$$
    $$\text{VEX}_{\text{Put}} = -\frac{\partial \Delta_{\text{Put}}}{\partial \sigma} \times \text{OI}_{\text{Put}} \times S \times 100 \times 0.01$$

### 1.4 CEX (Charm Exposure)
*   **Definition**: Rate of change of dealer delta with respect to the passage of time ($t$), known as delta decay.
*   **Significance**: Tracks dealer rehedging obligations during expiration week as out-of-the-money options decay toward zero.
*   **Formula**:
    $$\text{CEX} = \frac{\partial \Delta}{\partial t} \times \text{OI} \times 100 \times S$$

### 1.5 Structural GEX Walls
*   **Call Wall**: Strike price holding the largest positive dollar GEX, serving as an institutional ceiling during positive gamma regimes.
*   **Put Wall**: Strike price holding the largest negative dollar GEX, serving as an institutional floor during positive gamma regimes.
*   **Max Gamma Strike**: Strike with absolute maximum gamma concentration, acting as the primary pinning target during OPEX cycles.

### 1.6 OVI & Unusual Option Activity (UOA)
*   **OVI (Option Volume Imbalance)**: Normalized ratio measuring aggressive call vs. put volume:
    $$\text{OVI} = \frac{\text{Call Volume} - \text{Put Volume}}{\text{Call Volume} + \text{Put Volume}}$$
*   **UOA (Unusual Option Activity)**: Flags contracts where daily volume $> 500$ and Volume/OI ratio $> 1.5$.

---

## 2. Order Flow & Microstructure Terminology

### 2.1 Consolidated Footprint Chart
*   **Bid / Ask Sub-Boxes**: Displays volume split at each price bucket with color-intensity shading based on relative volume tiers.
*   **Diagonal Imbalance**: Triggered when ask volume is $\ge 3.0\times$ the diagonal bid volume (Buyside Imbalance) or bid volume is $\ge 3.0\times$ the diagonal ask volume (Sellside Imbalance).
*   **Stacked Imbalance Zone**: A sequence of $\ge 2$ consecutive diagonal imbalances in the same bar, forming structural support/resistance bands.
*   **Passive Absorption (`ABS`)**: Occurs when massive aggressive volume executes at a bar extreme but fails to push price further, indicating institutional limit absorption.

### 2.2 Volume Profile Metrics
*   **Point of Control (POC)**: The price level containing the highest transacted volume over the sample period.
*   **Value Area (VA)**: The price range enclosing 70% of total transacted volume.
    *   **Value Area High (VAH)**: Upper boundary of the Value Area.
    *   **Value Area Low (VAL)**: Lower boundary of the Value Area.
*   **High Volume Node (HVN)**: Price peaks representing acceptance and liquidity clusters.
*   **Low Volume Node (LVN)**: Price troughs representing rejection and rapid slippage zones.

### 2.3 Bookmap & Depth of Market (DOM)
*   **Bookmap Heatmap**: Graphical timeline rendering resting limit order depth (color gradient) and aggressive market orders (bubbles sized logarithmically).
*   **Center of Gravity (CoG)**: Volume-weighted average price of resting liquidity:
    $$\text{CoG} = \frac{\sum (Price \cdot Size)}{\sum Size}$$
*   **MLOFI (Modified Limit Order Flow Imbalance)**: Velocity of limit orders stacking vs. pulling:
    $$\text{MLOFI} = \Delta \text{Bids} - \Delta \text{Asks}$$
*   **Sonar Pulse Divergence**: Evaluates execution volume vs. DOM shifts; ratios $< 0.15$ warn that aggressive buyers/sellers are encountering an immovable passive institutional wall.

---

## 3. Smart Money Concepts (SMC)

### 3.1 Fair Value Gap (FVG)
*   **Definition**: A 3-candle price imbalance where Candle 1 High $<$ Candle 3 Low (Bullish FVG) or Candle 1 Low $>$ Candle 3 High (Bearish FVG).
*   **Strict Mitigation Rule**: An FVG is considered **unmitigated (active)** until a subsequent candle **CLOSE** penetrates completely through the gap boundaries.

### 3.2 Market Structure Shift (MSS)
*   **Definition**: A decisive break of the most recent swing high (bullish shift) or swing low (bearish shift) on expanding volume, confirming trend reversals.

### 3.3 Breaker Block
*   **Definition**: An order block that was breached by aggressive price action and subsequently flips from support to resistance (or vice versa).

---

## 4. Quantitative, Bayesian & Backtesting Terminology

### 4.1 Logistic Prior & Sequential Bayesian Updating
*   **Logistic Prior**: Evaluates base probability $P(S)$ using GEX regime, VIX level, and breadth:
    $$P(S) = \frac{1}{1 + e^{-z}}$$
*   **Bayesian Update**: Updates win probability based on real-time $ADD$, $VOLD$, and $TICK$ breadth flows:
    $$P(S|F) = \frac{P(F|S) P(S)}{P(F|S) P(S) + P(F|S^c) P(S^c)}$$

### 4.2 Fractional Kelly Criterion Position Sizing
*   **Formula**:
    $$f^* = \frac{p(b + 1) - 1}{b}$$
    Where $p$ is posterior win probability and $b$ is payout ratio ($b=0.5$ for credit spreads, $b=1.5$ for debit spreads). Recommends optimal capital allocation fraction.

### 4.3 ASSET Confluence Scorecard
*   **Definition**: Proprietary scoring model synthesizing GEX structural position, Market Breadth, Order Flow, and SMC signals into an institutional grade:
    *   **Grade A+ (9.0–10.0)**: Exceptional confluence.
    *   **Grade A (8.0–8.9)**: Strong structural edge.
    *   **Grade B (6.5–7.9)**: Moderate confluence.
    *   **Grade C/D (< 6.5)**: Low edge / choppy conditions.

### 4.4 Dual Asset Class Backtesting
*   **Cash Equity Mode (`cash`)**: Evaluates performance using standard 1.0x underlying equity price returns.
*   **Options Mode (`options`)**: Simulates options trade execution with a **4.0x effective leverage multiplier**, non-linear delta/gamma acceleration, theta decay, and options-specific stop-loss modeling.