import sqlite3
import os
import json
import logging

logger = logging.getLogger(__name__)

DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "liquid_universe.db"))

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    logger.info(f"Initializing SQLite database at {DB_PATH}")
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create symbols table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS symbols (
        symbol TEXT PRIMARY KEY,
        price REAL,
        avg_volume REAL,
        optionable INTEGER,
        last_updated REAL
    )
    """)
    
    # Create gex_data table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS gex_data (
        symbol TEXT PRIMARY KEY,
        call_wall REAL,
        put_wall REAL,
        gamma_flip REAL,
        net_gex_status TEXT,
        FOREIGN KEY(symbol) REFERENCES symbols(symbol) ON DELETE CASCADE
    )
    """)
    
    # Create technical_setups table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS technical_setups (
        symbol TEXT PRIMARY KEY,
        vcp_status TEXT,
        trend_direction TEXT,
        ema_20_dist REAL,
        ema_50_dist REAL,
        alerts_json TEXT,
        FOREIGN KEY(symbol) REFERENCES symbols(symbol) ON DELETE CASCADE
    )
    """)
    
    conn.commit()
    conn.close()

def save_symbol_metrics(symbol: str, metrics: dict):
    """
    Saves or updates calculated GEX and technical metrics for a symbol in the database.
    metrics should contain keys:
      - price, avg_volume, optionable, last_updated
      - call_wall, put_wall, gamma_flip, net_gex_status
      - vcp_status, trend_direction, ema_20_dist, ema_50_dist, alerts_json
    """
    symbol = symbol.upper().strip()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Insert or replace in symbols
        cursor.execute("""
        INSERT OR REPLACE INTO symbols (symbol, price, avg_volume, optionable, last_updated)
        VALUES (?, ?, ?, ?, ?)
        """, (
            symbol,
            metrics.get('price'),
            metrics.get('avg_volume'),
            1 if metrics.get('optionable', True) else 0,
            metrics.get('last_updated')
        ))
        
        # Insert or replace in gex_data
        cursor.execute("""
        INSERT OR REPLACE INTO gex_data (symbol, call_wall, put_wall, gamma_flip, net_gex_status)
        VALUES (?, ?, ?, ?, ?)
        """, (
            symbol,
            metrics.get('call_wall'),
            metrics.get('put_wall'),
            metrics.get('gamma_flip'),
            metrics.get('net_gex_status')
        ))
        
        # Insert or replace in technical_setups
        cursor.execute("""
        INSERT OR REPLACE INTO technical_setups (symbol, vcp_status, trend_direction, ema_20_dist, ema_50_dist, alerts_json)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (
            symbol,
            metrics.get('vcp_status'),
            metrics.get('trend_direction'),
            metrics.get('ema_20_dist'),
            metrics.get('ema_50_dist'),
            json.dumps(metrics.get('alerts', []))
        ))
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to save metrics for {symbol}: {e}")
        raise e
    finally:
        conn.close()

def query_liquid_universe(setup_filter: str = None, min_price: float = 10.0, limit: int = 50, offset: int = 0):
    """
    Queries the database for liquid universe tickers.
    Filters:
      - min_price (defaults to 10.0)
      - setup_filter (e.g. 'vcp', 'breakout', 'trend_continuation', 'mean_reversion', 'unusual_volume')
    Returns list of dictionaries containing consolidated symbol metrics.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
    SELECT s.symbol, s.price, s.avg_volume, s.optionable, s.last_updated,
           g.call_wall, g.put_wall, g.gamma_flip, g.net_gex_status,
           t.vcp_status, t.trend_direction, t.ema_20_dist, t.ema_50_dist, t.alerts_json
    FROM symbols s
    LEFT JOIN gex_data g ON s.symbol = g.symbol
    LEFT JOIN technical_setups t ON s.symbol = t.symbol
    WHERE s.price >= ?
    """
    params = [min_price]
    
    results = []
    try:
        cursor.execute(query, params)
        rows = cursor.fetchall()
        for row in rows:
            data = dict(row)
            # Parse alerts_json
            alerts = []
            if data.get('alerts_json'):
                try:
                    alerts = json.loads(data['alerts_json'])
                except Exception:
                    pass
            data['alerts'] = alerts
            
            # Apply setup filter if provided
            if setup_filter:
                setup_filter = setup_filter.lower().strip()
                matches_filter = False
                for alert in alerts:
                    if setup_filter == 'vcp' and 'vcp' in alert.lower():
                        matches_filter = True
                    elif setup_filter == 'breakout' and 'breakout' in alert.lower():
                        matches_filter = True
                    elif setup_filter == 'trend_continuation' and ('trend' in alert.lower() or 'continuation' in alert.lower()):
                        matches_filter = True
                    elif setup_filter == 'mean_reversion' and ('mean' in alert.lower() or 'reversion' in alert.lower() or 'wall proximity' in alert.lower()):
                        matches_filter = True
                    elif setup_filter == 'unusual_volume' and ('volume' in alert.lower() or 'vol' in alert.lower() or 'sweep' in alert.lower()):
                        matches_filter = True
                    
                if not matches_filter:
                    continue
            
            results.append(data)
            
        paginated_results = results[offset:offset+limit]
        return {
            'total': len(results),
            'data': paginated_results
        }
    except Exception as e:
        logger.error(f"Failed to query liquid universe: {e}")
        return {'total': 0, 'data': []}
    finally:
        conn.close()

def clear_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM symbols")
    cursor.execute("DELETE FROM gex_data")
    cursor.execute("DELETE FROM technical_setups")
    conn.commit()
    conn.close()
    logger.info("Cleared SQLite database tables.")
