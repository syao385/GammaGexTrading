import os
import json
import logging
import asyncio
import websockets
from typing import Optional, Dict, Any, Callable

logger = logging.getLogger(__name__)

CONFIG_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".alpaca_config.json"))

class AlpacaStreamerManager:
    def __init__(self):
        self.api_key_id: str = ""
        self.secret_key: str = ""
        self.load_config()

    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r') as f:
                    config = json.load(f)
                    self.api_key_id = config.get("api_key_id", "")
                    self.secret_key = config.get("secret_key", "")
                    logger.info("Loaded Alpaca configuration from disk.")
            except Exception as e:
                logger.error(f"Failed to load Schwab config: {e}")

    def save_config(self, api_key_id: str, secret_key: str):
        self.api_key_id = api_key_id.strip()
        self.secret_key = secret_key.strip()
        config = {
            "api_key_id": self.api_key_id,
            "secret_key": self.secret_key
        }
        try:
            with open(CONFIG_FILE, 'w') as f:
                json.dump(config, f, indent=4)
            logger.info("Saved Alpaca configuration to disk.")
        except Exception as e:
            logger.error(f"Failed to save Alpaca config: {e}")

alpaca_manager = AlpacaStreamerManager()

async def run_alpaca_ws_proxy(symbol: str, message_handler: Callable[[str], None], stop_event: asyncio.Event):
    """
    Subscribes to Alpaca's IEX WebSocket stream, translates ticks into the Schwab
    compatible format, and forwards them to the frontend proxy.
    Includes auto-reconnection on blips.
    """
    retry_delay = 2.0
    while not stop_event.is_set():
        if not alpaca_manager.api_key_id or not alpaca_manager.secret_key:
            logger.error("Alpaca credentials missing.")
            message_handler(json.dumps({"error": "Alpaca credentials missing. Enter them in settings."}))
            for _ in range(int(retry_delay)):
                if stop_event.is_set():
                    return
                await asyncio.sleep(1.0)
            retry_delay = min(retry_delay * 1.5, 15.0)
            continue

        socket_url = "wss://stream.data.alpaca.markets/v2/iex"
        logger.info(f"Opening Alpaca WebSocket connection to: {socket_url}")

        last_bid: Optional[float] = None
        last_ask: Optional[float] = None

        try:
            async with websockets.connect(socket_url, ping_interval=20, ping_timeout=20) as ws:
                retry_delay = 2.0
                
                # 1. Read Welcome Message
                welcome = await ws.recv()
                logger.info(f"Alpaca Welcome message: {welcome}")

                # 2. Authenticate
                auth_msg = {
                    "action": "auth",
                    "key": alpaca_manager.api_key_id,
                    "secret": alpaca_manager.secret_key
                }
                await ws.send(json.dumps(auth_msg))
                
                auth_resp = await ws.recv()
                logger.info(f"Alpaca Auth response: {auth_resp}")
                try:
                    auth_data = json.loads(auth_resp)
                except Exception as parse_err:
                    logger.error(f"Failed to parse Alpaca Auth response: {parse_err}")
                    message_handler(json.dumps({"error": "Invalid auth response from Alpaca server."}))
                    break

                if not auth_data or auth_data[0].get("T") != "success" or "authenticated" not in auth_data[0].get("msg", ""):
                    logger.error(f"Alpaca authentication failed: {auth_resp}")
                    message_handler(json.dumps({"error": "Alpaca authentication failed. Check your keys."}))
                    break

                # 3. Subscribe to Trades (t) and Quotes (q)
                sub_msg = {
                    "action": "subscribe",
                    "trades": [symbol.upper()],
                    "quotes": [symbol.upper()]
                }
                await ws.send(json.dumps(sub_msg))
                sub_resp = await ws.recv()
                logger.info(f"Alpaca Subscription response: {sub_resp}")

                # 4. Stream Reading and Translation Loop
                while not stop_event.is_set():
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=1.0)
                        data_list = json.loads(message)
                        
                        for item in data_list:
                            msg_type = item.get("T")
                            
                            # Handle Quote (q) to update last known bid/ask
                            if msg_type == "q":
                                last_bid = float(item.get("bp", 0.0))
                                last_ask = float(item.get("ap", 0.0))
                                
                                schwab_tick = {
                                    "key": symbol.upper(),
                                    "1": last_bid,
                                    "2": last_ask
                                }
                                schwab_payload = {
                                    "source": "schwab",
                                    "data": {
                                        "data": [
                                            {
                                                "service": "LEVELONE_EQUITIES",
                                                "content": [schwab_tick]
                                            }
                                        ]
                                    }
                                }
                                message_handler(json.dumps(schwab_payload))
                                
                            # Handle Trade (t) and translate to LEVELONE_EQUITIES trade tick
                            elif msg_type == "t":
                                price = float(item.get("p", 0.0))
                                size = int(item.get("s", 0))
                                
                                schwab_tick = {
                                    "key": symbol.upper(),
                                    "3": price,
                                    "4": size
                                }
                                if last_bid is not None:
                                    schwab_tick["1"] = last_bid
                                if last_ask is not None:
                                    schwab_tick["2"] = last_ask
                                    
                                schwab_payload = {
                                    "source": "schwab",
                                    "data": {
                                        "data": [
                                            {
                                                "service": "LEVELONE_EQUITIES",
                                                "content": [schwab_tick]
                                            }
                                        ]
                                    }
                                }
                                message_handler(json.dumps(schwab_payload))
                                
                    except asyncio.TimeoutError:
                        continue
                    except websockets.exceptions.ConnectionClosed:
                        logger.warning("Alpaca WebSocket connection closed upstream. Reconnecting...")
                        message_handler(json.dumps({"info": "Alpaca stream connection blip. Reconnecting automatically..."}))
                        break
        except Exception as e:
            if stop_event.is_set():
                break
            logger.error(f"Alpaca WebSocket proxy run exception: {e}")
            message_handler(json.dumps({"info": f"Connection lost ({str(e)}). Retrying..."}))
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 1.5, 15.0)
