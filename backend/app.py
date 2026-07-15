from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import io
import pandas as pd
import logging
from typing import Optional

from backend.data_fetcher import DataFetcher
from backend.gex_engine import GEXEngine
from backend.data_validator import DataValidator
from backend.screener import MarketScreener
from backend.backtester import Backtester

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
        # Pandas dataframes must be converted to JSON-compatible lists/dicts
        strikes_df = aggregated['strikes']
        
        # Prune strikes list to keep payload manageable (within +/- 30% of spot price)
        spot = aggregated['current_price']
        strikes_filtered = strikes_df[
            (strikes_df['strike'] >= spot * 0.7) & (strikes_df['strike'] <= spot * 1.3)
        ]
        
        strikes_list = strikes_filtered.to_dict(orient="records")
        
        # Format dates
        expirations_list = [str(exp) for exp in raw_data['expirations']]

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
            'sensitivity': sensitivity
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

if __name__ == "__main__":
    import uvicorn
    # When run as main, start the app on port 8000
    uvicorn.run("backend.app:app", host="127.0.0.1", port=8000, reload=True)
