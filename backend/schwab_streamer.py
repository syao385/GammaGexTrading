import os
import json
import base64
import time
import logging
import asyncio
import httpx
import websockets
from typing import Optional, Dict, Any, Callable

logger = logging.getLogger(__name__)

# File paths for local persistence
CONFIG_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".schwab_config.json"))
TOKENS_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".schwab_tokens.json"))

class SchwabStreamerManager:
    def __init__(self):
        self.app_key: str = ""
        self.app_secret: str = ""
        self.redirect_uri: str = "https://127.0.0.1:8000/api/schwab/callback"
        
        self.access_token: str = ""
        self.refresh_token: str = ""
        self.access_token_expires_at: float = 0.0
        self.refresh_token_expires_at: float = 0.0
        
        self.active_connections = set()
        self.load_config()
        self.load_tokens()

    def load_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r') as f:
                    config = json.load(f)
                    self.app_key = config.get("app_key", "")
                    self.app_secret = config.get("app_secret", "")
                    self.redirect_uri = config.get("redirect_uri", self.redirect_uri)
                    logger.info("Loaded Schwab configuration from disk.")
            except Exception as e:
                logger.error(f"Failed to load Schwab config: {e}")

    def save_config(self, app_key: str, app_secret: str, redirect_uri: Optional[str] = None):
        self.app_key = app_key.strip()
        self.app_secret = app_secret.strip()
        if redirect_uri:
            self.redirect_uri = redirect_uri.strip()
            
        config = {
            "app_key": self.app_key,
            "app_secret": self.app_secret,
            "redirect_uri": self.redirect_uri
        }
        try:
            with open(CONFIG_FILE, 'w') as f:
                json.dump(config, f, indent=4)
            logger.info("Saved Schwab configuration to disk.")
        except Exception as e:
            logger.error(f"Failed to save Schwab config: {e}")

    def load_tokens(self):
        if os.path.exists(TOKENS_FILE):
            try:
                with open(TOKENS_FILE, 'r') as f:
                    tokens = json.load(f)
                    self.access_token = tokens.get("access_token", "")
                    self.refresh_token = tokens.get("refresh_token", "")
                    self.access_token_expires_at = tokens.get("access_token_expires_at", 0.0)
                    self.refresh_token_expires_at = tokens.get("refresh_token_expires_at", 0.0)
                    logger.info("Loaded Schwab tokens from disk.")
            except Exception as e:
                logger.error(f"Failed to load Schwab tokens: {e}")

    def save_tokens(self):
        tokens = {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "access_token_expires_at": self.access_token_expires_at,
            "refresh_token_expires_at": self.refresh_token_expires_at
        }
        try:
            with open(TOKENS_FILE, 'w') as f:
                json.dump(tokens, f, indent=4)
            logger.info("Saved Schwab tokens to disk.")
        except Exception as e:
            logger.error(f"Failed to save Schwab tokens: {e}")

    def get_auth_header(self) -> Dict[str, str]:
        auth_str = f"{self.app_key}:{self.app_secret}"
        encoded = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
        return {
            "Authorization": f"Basic {encoded}",
            "Content-Type": "application/x-www-form-urlencoded"
        }

    def get_consent_url(self) -> str:
        if not self.app_key:
            raise ValueError("App Key (Client ID) is missing. Set credentials first.")
        
        # Build consent authorize URL
        return (
            f"https://api.schwabapi.com/v1/oauth/authorize"
            f"?client_id={self.app_key}"
            f"&redirect_uri={self.redirect_uri}"
            f"&response_type=code"
        )

    async def exchange_code_for_tokens(self, code: str) -> bool:
        if not self.app_key or not self.app_secret:
            logger.error("Cannot exchange code: App key or secret missing.")
            return False
            
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri
        }
        headers = self.get_auth_header()
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.schwabapi.com/v1/oauth/token",
                    data=data,
                    headers=headers,
                    timeout=15.0
                )
                if response.status_code == 200:
                    res_json = response.json()
                    self._parse_token_response(res_json)
                    self.save_tokens()
                    logger.info("Successfully exchanged code for Schwab access/refresh tokens.")
                    return True
                else:
                    logger.error(f"Failed to exchange code: {response.status_code} - {response.text}")
                    return False
        except Exception as e:
            logger.error(f"Token exchange HTTP call failed: {e}")
            return False

    async def refresh_access_token(self) -> bool:
        if not self.refresh_token:
            logger.error("Cannot refresh token: Refresh token missing.")
            return False
            
        data = {
            "grant_type": "refresh_token",
            "refresh_token": self.refresh_token
        }
        headers = self.get_auth_header()
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.schwabapi.com/v1/oauth/token",
                    data=data,
                    headers=headers,
                    timeout=15.0
                )
                if response.status_code == 200:
                    res_json = response.json()
                    self._parse_token_response(res_json)
                    self.save_tokens()
                    logger.info("Successfully refreshed Schwab access token.")
                    return True
                else:
                    logger.error(f"Failed to refresh token: {response.status_code} - {response.text}")
                    return False
        except Exception as e:
            logger.error(f"Token refresh HTTP call failed: {e}")
            return False

    def _parse_token_response(self, res_json: Dict[str, Any]):
        now = time.time()
        self.access_token = res_json.get("access_token", "")
        # Access token lasts 30 minutes (1800 seconds)
        expires_in = float(res_json.get("expires_in", 1800))
        self.access_token_expires_at = now + expires_in - 60.0  # 1 min buffer
        
        # Refresh token is sometimes returned on exchange, keep existing if missing
        if "refresh_token" in res_json:
            self.refresh_token = res_json["refresh_token"]
            # Refresh token lasts 7 days (604800 seconds)
            refresh_expires_in = float(res_json.get("refresh_token_expires_in", 604800))
            self.refresh_token_expires_at = now + refresh_expires_in - 3600.0  # 1 hour buffer

    async def get_valid_access_token(self) -> Optional[str]:
        if not self.access_token:
            # Try to refresh first
            if self.refresh_token:
                success = await self.refresh_access_token()
                if success:
                    return self.access_token
            return None
            
        now = time.time()
        if now >= self.access_token_expires_at:
            logger.info("Schwab Access Token has expired. Refreshing...")
            success = await self.refresh_access_token()
            if success:
                return self.access_token
            return None
            
        return self.access_token

    def is_authenticated(self) -> bool:
        if not self.refresh_token:
            return False
        # Check if refresh token is expired
        now = time.time()
        if self.refresh_token_expires_at > 0 and now >= self.refresh_token_expires_at:
            return False
        return True

    async def get_streamer_info(self) -> Optional[Dict[str, Any]]:
        token = await self.get_valid_access_token()
        if not token:
            logger.error("Authentication required to get Schwab streamer info.")
            return None
            
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://api.schwabapi.com/v1/userpreferences/streamerinfo",
                    headers=headers,
                    timeout=15.0
                )
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"Failed to fetch streamer info: {response.status_code} - {response.text}")
                    return None
        except Exception as e:
            logger.error(f"Streamer info request failed: {e}")
            return None

# Global manager instance
schwab_manager = SchwabStreamerManager()

# Background WebSocket handler
async def run_schwab_ws_proxy(symbol: str, message_handler: Callable[[str], None], stop_event: asyncio.Event):
    """
    Subscribes to Schwab's streaming services, receives ticks, and forwards
    them to frontend clients via the message_handler callback.
    """
    info = await schwab_manager.get_streamer_info()
    if not info or "streamerInfo" not in info or not info["streamerInfo"]:
        logger.error("Could not obtain Schwab streaming credentials.")
        message_handler(json.dumps({"error": "Auth credentials expired. Re-authenticate via Settings."}))
        return

    streamer_data = info["streamerInfo"][0]
    socket_url = f"wss://{streamer_data['streamerSocketUrl']}/ws"
    
    logger.info(f"Opening Schwab WebSocket connection to: {socket_url}")
    
    try:
        async with websockets.connect(socket_url) as ws:
            # 1. Send Login Payload
            login_request = {
                "requests": [{
                    "service": "ADMIN",
                    "requestid": "1",
                    "command": "LOGIN",
                    "parameters": {
                        "credential": streamer_data["token"],
                        "token": streamer_data["token"],
                        "appId": "GammaGexTradingDesk"
                    }
                }]
            }
            await ws.send(json.dumps(login_request))
            login_response = await ws.recv()
            logger.info(f"Schwab WS login response received: {login_response}")

            # 2. Subscribe to Trades (L1) and Book depth (L2)
            sub_request = {
                "requests": [
                    {
                        "service": "LEVELONE_EQUITIES",
                        "requestid": "2",
                        "command": "ADD",
                        "parameters": {
                            "keys": symbol.upper(),
                            # Fields: 0=Symbol, 1=Bid Price, 2=Ask Price, 3=Last Price, 4=Last Size, 5=Volume, 9=Trade Time
                            "fields": "0,1,2,3,4,5,9"
                        }
                    },
                    {
                        "service": "NASDAQ_BOOK",
                        "requestid": "3",
                        "command": "ADD",
                        "parameters": {
                            "keys": symbol.upper(),
                            # Fields: 0=Symbol, 1=Book Details
                            "fields": "0,1"
                        }
                    }
                ]
            }
            await ws.send(json.dumps(sub_request))
            logger.info(f"Sent Schwab subscription request for {symbol}.")

            # 3. Stream Reading Loop
            while not stop_event.is_set():
                try:
                    # Non-blocking wait with timeout to check stop_event
                    message = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    parsed = json.loads(message)
                    
                    # Log ticks briefly in server console
                    logger.debug(f"Schwab Tick received: {parsed}")
                    
                    # Forward the message to the frontend websocket handler
                    message_handler(json.dumps({"source": "schwab", "data": parsed}))
                except asyncio.TimeoutError:
                    continue
                except websockets.exceptions.ConnectionClosed:
                    logger.warning("Schwab WebSocket connection closed.")
                    message_handler(json.dumps({"error": "Schwab stream closed. Reconnecting..."}))
                    break
    except Exception as e:
        logger.error(f"Schwab WebSocket proxy run failed: {e}")
        message_handler(json.dumps({"error": f"Failed to connect: {str(e)}"}))
