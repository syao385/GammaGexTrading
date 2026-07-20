from fastapi import FastAPI, UploadFile, File, Query, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import io
import pandas as pd
import logging
import asyncio
from typing import Optional
from datetime import datetime
import yfinance as yf

from backend.data_fetcher import DataFetcher
from backend.gex_engine import GEXEngine
from backend.data_validator import DataValidator
from backend.screener import MarketScreener
from backend.backtester import Backtester
from backend.schwab_streamer import schwab_manager, run_schwab_ws_proxy
from backend.alpaca_streamer import alpaca_manager, run_alpaca_ws_proxy

# New imports
from backend.database import query_liquid_universe, init_db
from backend.background_scanner import run_universe_scan, get_scanner_status
from backend.internals_calculator import InternalsCalculator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Gamma GEX Trading System API", version="1.0.0")

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instantiate core engines
fetcher = DataFetcher()
engine = GEXEngine()
validator = DataValidator(engine)
screener = MarketScreener()
backtester = Backtester()
calc = InternalsCalculator()

# Initialize SQLite database on startup
@app.on_event("startup")
def on_startup():
    init_db()
    logger.info("Application startup: SQLite GEX Database checked/initialized.")
    
    # Start auto-rebuild scheduler task
    from backend.background_scanner import auto_rebuild_scheduler_loop, AUTO_REBUILD_ENABLED
    if AUTO_REBUILD_ENABLED:
        asyncio.create_task(auto_rebuild_scheduler_loop())

# --- static file routes ---
@app.get("/")
def read_root():
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "index.html"))
    if os.path.exists(path):
        return FileResponse(path)
    raise HTTPException(status_code=404, detail=f"index.html not found at path {path}")

@app.get("/index.html")
def read_index():
    return read_root()

@app.get("/index.css")
def read_css():
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "index.css"))
    if os.path.exists(path):
        return FileResponse(path, media_type="text/css")
    raise HTTPException(status_code=404, detail="index.css not found")

@app.get("/app.js")
def read_js():
    path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "app.js"))
    if os.path.exists(path):
        return FileResponse(path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="app.js not found")

# --- API Endpoints ---
@app.get("/api/gex/{symbol}")
def get_gex_profile(symbol: str, expiration: Optional[str] = Query(None), max_exp: int = Query(8, alias="maxExp")):
    """
    Retrieves options GEX curves, VEX curves, CEX curves, key walls, IV skew, 
    and sensitivity bounds for a symbol.
    """
    try:
        symbol = symbol.upper().strip()
        logger.info(f"API: fetching options data for {symbol}")
        raw_data = fetcher.fetch_options_chain(symbol, max_expirations=max_exp)
        
        # Calculate base GEX
        processed = engine.process_options_chain(raw_data)
        
        # Filter by expiration if specified
        if expiration and expiration.lower() != 'all':
            processed['calls'] = processed['calls'][processed['calls']['expiration'] == expiration].copy()
            processed['puts'] = processed['puts'][processed['puts']['expiration'] == expiration].copy()
            
        aggregated = engine.compute_aggregated_exposures(processed)
        
        # Calculate sensitivity bounds
        sensitivity = validator.run_sensitivity_analysis(raw_data)
        
        # Formulate clean JSON response
        strikes_df = aggregated['strikes']
        
        # Prune strikes list to keep payload manageable (within +/- 30% of spot price)
        spot = aggregated['current_price']
        strikes_filtered = strikes_df[
            (strikes_df['strike'] >= spot * 0.7) & (strikes_df['strike'] <= spot * 1.3)
        ]
        
        strikes_list = strikes_filtered.to_dict(orient="records")
        expirations_list = [str(exp) for exp in raw_data['expirations']]

        # Execute MarketScreener to fetch Volume Profile levels and Playbook ASSET grade/score
        volume_profile_poc = 0.0
        volume_profile_vah = 0.0
        volume_profile_val = 0.0
        volume_profile_bins = []
        volume_profile_poc_25d = 0.0
        volume_profile_vah_25d = 0.0
        volume_profile_val_25d = 0.0
        volume_profile_poc_60d = 0.0
        volume_profile_vah_60d = 0.0
        volume_profile_val_60d = 0.0
        asset_grade = "D"
        asset_confluence_score = 0.0
        asset_sizing_recommendation = "Grade D Setup: Stay Out (0% Risk)"
        setups = []
        scorecard_breakdown = {}
        
        try:
            screener_results = screener.screen_symbols([symbol])
            if screener_results and "error" not in screener_results[0]:
                scr = screener_results[0]
                volume_profile_poc = scr.get("volume_profile_poc", 0.0)
                volume_profile_vah = scr.get("volume_profile_vah", 0.0)
                volume_profile_val = scr.get("volume_profile_val", 0.0)
                volume_profile_bins = scr.get("volume_profile_bins", [])
                volume_profile_poc_25d = scr.get("volume_profile_poc_25d", 0.0)
                volume_profile_vah_25d = scr.get("volume_profile_vah_25d", 0.0)
                volume_profile_val_25d = scr.get("volume_profile_val_25d", 0.0)
                volume_profile_poc_60d = scr.get("volume_profile_poc_60d", 0.0)
                volume_profile_vah_60d = scr.get("volume_profile_vah_60d", 0.0)
                volume_profile_val_60d = scr.get("volume_profile_val_60d", 0.0)
                asset_grade = scr.get("asset_grade", "D")
                asset_confluence_score = scr.get("asset_confluence_score", 0.0)
                asset_sizing_recommendation = scr.get("asset_sizing_recommendation", "Grade D Setup: Stay Out (0% Risk)")
                setups = scr.get("setups", [])
                scorecard_breakdown = scr.get("scorecard_breakdown", {})
        except Exception as scr_err:
            logger.warning(f"API: screener integration failed in get_gex_profile: {scr_err}")

        return {
            'symbol': aggregated['symbol'],
            'current_price': aggregated['current_price'],
            'gamma_flip': aggregated['gamma_flip'],
            'distance_to_flip_pct': ((spot - aggregated['gamma_flip']) / spot) * 100,
            'call_wall': aggregated['call_wall'],
            'put_wall': aggregated['put_wall'],
            'max_gex_strike': aggregated['max_gex_strike'],
            'total_gex_dollar': aggregated['total_gex_dollar'],
            'total_vex_dollar': aggregated['total_vex_dollar'],
            'total_cex_dollar': aggregated['total_cex_dollar'],
            'iv_skew': aggregated['iv_skew'],
            'expirations': expirations_list,
            'strikes': strikes_list,
            'sensitivity': sensitivity,
            # Volume Profile
            'volume_profile_poc': volume_profile_poc,
            'volume_profile_vah': volume_profile_vah,
            'volume_profile_val': volume_profile_val,
            'volume_profile_bins': volume_profile_bins,
            'volume_profile_poc_25d': volume_profile_poc_25d,
            'volume_profile_vah_25d': volume_profile_vah_25d,
            'volume_profile_val_25d': volume_profile_val_25d,
            'volume_profile_poc_60d': volume_profile_poc_60d,
            'volume_profile_vah_60d': volume_profile_vah_60d,
            'volume_profile_val_60d': volume_profile_val_60d,
            # ASSET Scorecard
            'asset_grade': asset_grade,
            'asset_confluence_score': asset_confluence_score,
            'asset_sizing_recommendation': asset_sizing_recommendation,
            'scorecard_breakdown': scorecard_breakdown,
            'setups': setups
        }
    except Exception as e:
        logger.error(f"API failed to fetch GEX profile for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/screener")
def get_screener_results(symbols: Optional[str] = Query(None)):
    """
    Screens market watchlists. Accepts a comma-separated list of symbols.
    """
    try:
        sym_list = None
        if symbols:
            sym_list = [s.strip().upper() for s in symbols.split(',') if s.strip()]
        
        results = screener.screen_symbols(sym_list)
        return results
    except Exception as e:
        logger.error(f"API: screener endpoint failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/backtest")
def run_strategy_backtest(
    symbol: str = Query(...),
    strategy: str = Query(...),
    capital: float = Query(100000.0),
    startDate: Optional[str] = Query(None),
    endDate: Optional[str] = Query(None),
    emaLen: int = Query(20),
    wallLen: int = Query(20),
    gexThreshold: float = Query(0.2),
    oviThreshold: float = Query(0.3),
    stopLoss: float = Query(0.015)
):
    """
    Runs historical backtest with custom parameters.
    """
    try:
        params = {
            'ema_len': emaLen,
            'wall_len': wallLen,
            'gex_threshold': gexThreshold,
            'ovi_threshold': oviThreshold,
            'stop_loss': stopLoss
        }
        res = backtester.run_backtest(
            symbol=symbol,
            strategy=strategy,
            initial_capital=capital,
            start_date=startDate,
            end_date=endDate,
            params=params
        )
        if not res.get('success', False):
            raise HTTPException(status_code=400, detail=res.get('error', 'Backtest failed'))
        return res
    except Exception as e:
        logger.error(f"API: backtest endpoint failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/validate/{symbol}")
async def validate_gex_data(symbol: str, file: UploadFile = File(...)):
    """
    Validates internal calculations against an uploaded external CSV of GEX data.
    """
    try:
        symbol = symbol.upper().strip()
        contents = await file.read()
        
        # Load external data
        df_ext = pd.read_csv(io.BytesIO(contents))
        
        # Fetch current calculations
        raw_data = fetcher.fetch_options_chain(symbol, max_expirations=5)
        processed = engine.process_options_chain(raw_data)
        aggregated = engine.compute_aggregated_exposures(processed)
        
        # Compare
        results = validator.compare_with_external(aggregated, df_ext)
        return results
    except Exception as e:
        logger.error(f"API: validation endpoint failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- NEW API ENDPOINTS: SWING, DAY & LIQUID UNIVERSE DASHBOARDS ---

from zoneinfo import ZoneInfo

def is_market_hours() -> bool:
    """
    Checks if current time is within US Stock Market hours:
    Monday - Friday, 9:30 AM to 4:00 PM EST/EDT.
    """
    try:
        tz = ZoneInfo("America/New_York")
        now_ny = datetime.now(tz)
        if now_ny.weekday() >= 5:
            return False
        time_float = now_ny.hour + now_ny.minute / 60.0
        return 9.5 <= time_float <= 16.0
    except Exception:
        # Fallback if timezone data is missing
        now = datetime.now()
        if now.weekday() >= 5:
            return False
        return 9 <= now.hour < 16

@app.get("/api/internals/day-trading-snapshot")
def get_day_trading_snapshot(symbol: str = "SPY"):
    """
    Returns a snapshot of day trading internals: VIX, PCC, ADD, VOLD, TICK, TRIN,
    and a relative strength table for liquid stock tickers.
    """
    try:
        symbol = symbol.upper().strip()
        vix_term = fetcher.fetch_vix_vxv_ratio()
        pcc = 0.85  # default/mock Put-Call Ratio
        
        # Only return internal indices if the market is open
        if is_market_hours():
            import random
            tick = random.choice([250, -420, 110, -50, 780, -950, 1150]) # mock ticks
            trin = 1.0 + random.uniform(-0.4, 0.4)
            add = random.choice([450, -210, 890, -1100, 150])
            vold = 1.6 + random.uniform(-0.8, 0.8)
        else:
            tick = None
            trin = None
            add = None
            vold = None
        # Download SPY once to avoid rate limiting in the loop
        try:
            hist_spy = yf.Ticker("SPY").history(period="2d")
        except Exception as e:
            logger.error(f"Watchlist: Failed to download SPY: {e}")
            hist_spy = pd.DataFrame()

        # Compute Relative Strength over watchlist symbols
        watchlist = ["AAPL", "MSFT", "TSLA", "NVDA", "AMD", "AMZN", "META", "GOOGL"]
        rs_data = []
        for sym in watchlist:
            try:
                hist_sym = yf.Ticker(sym).history(period="2d")
                if len(hist_sym) >= 2 and len(hist_spy) >= 2:
                    perf_sym = float((hist_sym['Close'].iloc[-1] / hist_sym['Close'].iloc[-2] - 1.0) * 100.0)
                    perf_spy = float((hist_spy['Close'].iloc[-1] / hist_spy['Close'].iloc[-2] - 1.0) * 100.0)
                    rs_ratio = float(perf_sym - perf_spy)
                    rs_data.append({"symbol": sym, "performance_pct": perf_sym, "rs_vs_spy": rs_ratio})
                else:
                    logger.warning(f"Watchlist: len(hist_sym)={len(hist_sym)} or len(hist_spy)={len(hist_spy)} less than 2 for {sym}")
                    rs_data.append({"symbol": sym, "performance_pct": 0.0, "rs_vs_spy": 0.0})
            except Exception as e:
                logger.error(f"Watchlist: Failed for symbol {sym}: {e}")
                rs_data.append({"symbol": sym, "performance_pct": 0.0, "rs_vs_spy": 0.0})
                
        # Sort by relative strength
        rs_data = sorted(rs_data, key=lambda x: x["rs_vs_spy"], reverse=True)

        return {
            "vix": vix_term["vix"],
            "pcc": pcc,
            "add": add,
            "vold": vold,
            "tick": tick,
            "trin": trin,
            "relative_strength": rs_data,
            "timestamp": datetime.now().strftime('%H:%M:%S')
        }
    except Exception as e:
        logger.error(f"API: day-trading internals fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/internals/swing-trading-snapshot")
def get_swing_trading_snapshot():
    """
    Returns swing trading macro, debt, breadth, and catalyst snapshots.
    """
    try:
        vix_vxv = fetcher.fetch_vix_vxv_ratio()
        skew = fetcher.fetch_skew_index()
        fed_liq = fetcher.fetch_fed_net_liquidity()
        yield_curve = fetcher.fetch_yield_curve()
        credit_spreads = fetcher.fetch_credit_spreads()
        catalysts = fetcher.fetch_overnight_catalysts()
        
        # Long-term breadth (Stocks above 50/200 DMA) - mock/simulated indices
        import random
        mmfi = 45.0 + random.uniform(-10, 10) # % of stocks > 50 DMA
        mmth = 52.0 + random.uniform(-5, 5)   # % of stocks > 200 DMA
        
        # Monthly OPEX Calendars (Third Friday calculations)
        today = datetime.now()
        opex_dates = []
        for m in range(3):
            # calculate opex for month today + m
            year = today.year
            month = today.month + m
            if month > 12:
                month -= 12
                year += 1
            # find third Friday
            first_day = datetime(year, month, 1)
            first_friday = 1 + (4 - first_day.weekday()) % 7
            third_friday = first_friday + 14
            opex_dates.append(datetime(year, month, third_friday).strftime('%Y-%m-%d'))

        return {
            "vix_vxv": vix_vxv,
            "skew": skew,
            "fed_liquidity": fed_liq,
            "yield_curve": yield_curve,
            "credit_spreads": credit_spreads,
            "catalysts": catalysts,
            "breadth": {
                "stocks_above_50dma_pct": mmfi,
                "stocks_above_200dma_pct": mmth
            },
            "opex_dates": opex_dates
        }
    except Exception as e:
        logger.error(f"API: swing-trading snapshot failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/strategy/calculate-probability")
def calculate_trade_probability(symbol: str = Query(...), strategy: str = Query(...), tick: float = Query(0.0), voldRatio: float = Query(1.0)):
    """
    Calculates live probability success score and Kelly sizing.
    """
    try:
        symbol = symbol.upper().strip()
        raw_chain = fetcher.fetch_options_chain(symbol, max_expirations=3)
        processed = engine.process_options_chain(raw_chain)
        aggregated = engine.compute_aggregated_exposures(processed)
        
        price = aggregated['current_price']
        flip = aggregated['gamma_flip']
        gex_val = aggregated['total_gex_dollar']
        vix = fetcher.fetch_vix_vxv_ratio()["vix"]
        
        # Calculate Relative Strength vs SPY
        hist_sym = yf.Ticker(symbol).history(period="2d")
        hist_spy = yf.Ticker("SPY").history(period="2d")
        rs_score = 0.0
        if len(hist_sym) >= 2 and len(hist_spy) >= 2:
            perf_sym = (hist_sym['Close'].iloc[-1] / hist_sym['Close'].iloc[-2] - 1.0) * 100.0
            perf_spy = (hist_spy['Close'].iloc[-1] / hist_spy['Close'].iloc[-2] - 1.0) * 100.0
            rs_score = perf_sym - perf_spy
            
        prior = calc.calculate_logistic_probability(gex_val, vix, tick, voldRatio, rs_score, strategy)
        posterior = calc.calculate_bayesian_update(prior, tick, voldRatio, strategy)
        
        # Payout odds: b=0.5 for credit reversion (Play 1), b=1.5 for debit breakout (Play 2)
        b = 0.5 if strategy == "wall_reversion" else 1.5
        sizing = calc.calculate_kelly_sizing(posterior, b)
        
        return {
            "strategy": strategy,
            "prior_probability": prior,
            "updated_probability": posterior,
            "kelly": sizing,
            "b": b
        }
    except Exception as e:
        logger.error(f"API: probability calculation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/trade_transition_eval")
def get_trade_transition_eval(symbol: str = Query(...), price: Optional[float] = Query(None), entryPrice: float = Query(...), direction: str = Query("long")):
    """
    Evaluates an active day trade to check hold swing transition.
    """
    try:
        res = calc.evaluate_trade_transition(symbol, price, entryPrice, direction)
        return res
    except Exception as e:
        logger.error(f"API: trade transition evaluation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/screener/liquid-scan")
def get_liquid_universe_scan(setupFilter: Optional[str] = Query(None), minPrice: float = 10.0, limit: int = 50, offset: int = 0):
    """
    Queries the SQLite database for symbols matching active setup alerts.
    """
    try:
        res = query_liquid_universe(setup_filter=setupFilter, min_price=minPrice, limit=limit, offset=offset)
        return res
    except Exception as e:
        logger.error(f"API: liquid-scan query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screener/liquid-update")
def trigger_liquid_universe_update():
    """
    Triggers background scan to rebuild liquid_universe.db database.
    """
    try:
        status = get_scanner_status()
        if not status["is_running"]:
            asyncio.create_task(run_universe_scan())
            return {"success": True, "message": "Background scanning thread started successfully."}
        return {"success": False, "message": "Scanner is already actively running."}
    except Exception as e:
        logger.error(f"API: trigger-liquid-update failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/screener/liquid-status")
def get_liquid_universe_status():
    """
    Returns current status and progress of the background database scan.
    """
    return get_scanner_status()

# --- Schwab Authentication and Streaming Endpoints ---

@app.get("/api/schwab/status")
def get_schwab_status():
    """Returns whether credentials are set and if the user is authenticated."""
    return {
        "configured": bool(schwab_manager.app_key and schwab_manager.app_secret),
        "authenticated": schwab_manager.is_authenticated()
    }

@app.post("/api/schwab/save_credentials")
def save_schwab_credentials(appKey: str = Query(...), appSecret: str = Query(...)):
    """Saves App Key and App Secret locally to disk."""
    try:
        schwab_manager.save_config(app_key=appKey, app_secret=appSecret)
        return {"success": True, "message": "Schwab credentials saved successfully."}
    except Exception as e:
        logger.error(f"Failed to save Schwab credentials: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/alpaca/status")
def get_alpaca_status():
    """Returns whether Alpaca API credentials are set."""
    return {
        "configured": bool(alpaca_manager.api_key_id and alpaca_manager.secret_key)
    }

@app.post("/api/alpaca/save_credentials")
def save_alpaca_credentials(apiKeyId: str = Query(...), secretKey: str = Query(...)):
    """Saves Alpaca API Key ID and Secret Key locally to disk."""
    try:
        alpaca_manager.save_config(api_key_id=apiKeyId, secret_key=secretKey)
        return {"success": True, "message": "Alpaca credentials saved successfully."}
    except Exception as e:
        logger.error(f"Failed to save Alpaca credentials: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/schwab/login")
def get_schwab_login_url():
    """Generates the Schwab OAuth consent URL."""
    try:
        url = schwab_manager.get_consent_url()
        return {"url": url}
    except Exception as e:
        logger.error(f"Failed to generate login URL: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/schwab/callback", response_class=HTMLResponse)
async def schwab_oauth_callback(code: str = Query(...)):
    """Handles the OAuth redirection from Schwab, exchanges the code for tokens, and closes the popup."""
    success = await schwab_manager.exchange_code_for_tokens(code)
    if success:
        return """
        <html>
            <head>
                <title>Authentication Successful</title>
                <style>
                    body {
                        background-color: #070913;
                        color: #10b981;
                        font-family: sans-serif;
                        text-align: center;
                        padding-top: 50px;
                    }
                    .box {
                        display: inline-block;
                        border: 1px solid #10b981;
                        padding: 30px;
                        border-radius: 12px;
                        background-color: rgba(16, 185, 129, 0.05);
                    }
                </style>
                <script>
                    setTimeout(function() {
                        if (window.opener) {
                            window.opener.postMessage({ type: 'SCHWAB_AUTH_SUCCESS' }, '*');
                        }
                        window.close();
                    }, 1500);
                </script>
            </head>
            <body>
                <div class="box">
                    <h2>Authentication Successful!</h2>
                    <p>Schwab tokens saved successfully. This window will close automatically...</p>
                </div>
            </body>
        </html>
        """
    else:
        return """
        <html>
            <head>
                <title>Authentication Failed</title>
                <style>
                    body {
                        background-color: #070913;
                        color: #f43f5e;
                        font-family: sans-serif;
                        text-align: center;
                        padding-top: 50px;
                    }
                    .box {
                        display: inline-block;
                        border: 1px solid #f43f5e;
                        padding: 30px;
                        border-radius: 12px;
                        background-color: rgba(244, 63, 94, 0.05);
                    }
                </style>
            </head>
            <body>
                <div class="box">
                    <h2>Authentication Failed</h2>
                    <p>Failed to exchange code for tokens. Please check your console/logs or try again.</p>
                </div>
            </body>
        </html>
        """

@app.websocket("/api/orderflow/live")
async def websocket_schwab_endpoint(websocket: WebSocket, symbol: str = "SPY", provider: str = "schwab"):
    """WebSocket proxy endpoint that relays live streaming data (Schwab or Alpaca) directly to the frontend client."""
    await websocket.accept()
    logger.info(f"WebSocket client connected to live order flow proxy for {symbol} via {provider}")
    
    stop_event = asyncio.Event()
    
    def handle_schwab_message(msg_str: str):
        asyncio.create_task(websocket.send_text(msg_str))
        
    if provider.lower() == "alpaca":
        run_task = asyncio.create_task(
            run_alpaca_ws_proxy(symbol, handle_schwab_message, stop_event)
        )
    else:
        run_task = asyncio.create_task(
            run_schwab_ws_proxy(symbol, handle_schwab_message, stop_event)
        )
    
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug(f"Client message on live socket: {data}")
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected from live order flow proxy for {symbol}")
    finally:
        stop_event.set()
        await run_task

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, reload=True)
