"""台新證券行情轉接。

在這台電腦登入台新行情元件，瀏覽器開 http://127.0.0.1:8765 看即時報價。
帳號密碼只從本機的 .env 讀取，不會寫進畫面或程式碼。
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from format_quote import basic_fields, tick_fields

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web" / "index.html"
ENV_PATH = ROOT / ".env"


class QuoteHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._quotes: dict[str, dict[str, Any]] = {}
        self._listeners: list[queue.Queue[str]] = []
        self.status = "尚未連線"
        self.ok = False
        self.bad = False

    def set_status(self, text: str, *, ok: bool = False, bad: bool = False) -> None:
        with self._lock:
            self.status = text
            self.ok = ok
            self.bad = bad
        self._broadcast()

    def upsert(self, symbol: str, fields: dict[str, Any]) -> None:
        if not symbol:
            return
        with self._lock:
            row = self._quotes.setdefault(symbol, {"symbol": symbol})
            for key, value in fields.items():
                if key == "symbol":
                    continue
                if value in ("", None, []):
                    continue
                row[key] = value
        self._broadcast()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "status": self.status,
                "ok": self.ok,
                "bad": self.bad,
                "quotes": list(self._quotes.values()),
            }

    def listen(self) -> queue.Queue[str]:
        listener: queue.Queue[str] = queue.Queue()
        with self._lock:
            self._listeners.append(listener)
        listener.put(json.dumps(self.snapshot(), ensure_ascii=False))
        return listener

    def unlisten(self, listener: queue.Queue[str]) -> None:
        with self._lock:
            if listener in self._listeners:
                self._listeners.remove(listener)

    def _broadcast(self) -> None:
        payload = json.dumps(self.snapshot(), ensure_ascii=False)
        with self._lock:
            listeners = list(self._listeners)
        for listener in listeners:
            listener.put(payload)


HUB = QuoteHub()


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def make_handler() -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            if self.path.startswith("/api/stream"):
                self._stream()
                return
            if self.path.startswith("/api/quotes"):
                body = json.dumps(HUB.snapshot(), ensure_ascii=False).encode("utf-8")
                self._send(200, "application/json; charset=utf-8", body)
                return
            if self.path in {"/", "/index.html"}:
                self._send(200, "text/html; charset=utf-8", WEB.read_bytes())
                return
            self._send(404, "text/plain; charset=utf-8", "找不到頁面".encode("utf-8"))

        def _send(self, status: int, content_type: str, body: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _stream(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            listener = HUB.listen()
            try:
                while True:
                    try:
                        payload = listener.get(timeout=15)
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        continue
                    self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                return
            finally:
                HUB.unlisten(listener)

    return Handler


def serve(port: int) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler())
    print(f"報價頁：http://127.0.0.1:{port}")
    server.serve_forever()


def run_preview(symbols: list[str]) -> None:
    HUB.set_status("預覽資料，尚未連上台新", ok=False, bad=False)
    bases = {"2330": ("台積電", 1090), "2317": ("鴻海", 232), "2454": ("聯發科", 1420)}
    for symbol in symbols:
        name, ref = bases.get(symbol, (f"代號 {symbol}", 100))
        HUB.upsert(symbol, {"symbol": symbol, "name": name, "refPrice": str(ref), "matchPrice": str(ref)})
    step = 0
    while True:
        step += 1
        for index, symbol in enumerate(symbols):
            _name, ref = bases.get(symbol, (f"代號 {symbol}", 100))
            price = ref + ((step + index) % 5) - 2
            HUB.upsert(
                symbol,
                {
                    "symbol": symbol,
                    "matchPrice": str(price),
                    "matchTime": time.strftime("%H:%M:%S"),
                    "matchQty": "12",
                    "totalMatchQty": str(1000 + step * 10),
                    "buyPrice": [str(price - i) for i in range(1, 6)],
                    "buyQty": ["20", "18", "16", "12", "9"],
                    "sellPrice": [str(price + i) for i in range(1, 6)],
                    "sellQty": ["11", "14", "15", "19", "22"],
                },
            )
        time.sleep(1)


def run_taishin(user_id: str, password: str, symbols: list[str]) -> None:
    try:
        from PY_Trade_package.MarketDataMart import MarketDataMart
        from PY_Trade_package.Sol_D import Sol_D
        from PY_Trade_package.SolPYAPI_Model import RCode
    except ImportError:
        HUB.set_status("還沒安裝台新行情元件。請先執行 python setup_sdk.py", bad=True)
        print("還沒安裝台新行情元件。請先在這個資料夾執行：python setup_sdk.py")
        return

    config = ROOT / "Configs" / "SYS_SOLACE.ini"
    if not config.exists():
        HUB.set_status("缺少 Configs/SYS_SOLACE.ini。請先執行 python setup_sdk.py", bad=True)
        print(f"找不到 {config}")
        return

    HUB.set_status("正在登入台新行情")
    events = MarketDataMart()

    def on_basic(data: Any) -> None:
        fields = basic_fields(data)
        HUB.upsert(fields.get("symbol", ""), fields)

    def on_match(data: Any) -> None:
        fields = tick_fields(data, book=False)
        HUB.upsert(fields.get("symbol", ""), fields)

    def on_book(data: Any) -> None:
        fields = tick_fields(data, book=True)
        HUB.upsert(fields.get("symbol", ""), fields)

    def on_login(ok: bool, message: str) -> None:
        HUB.set_status(message or ("已登入" if ok else "登入失敗"), ok=ok, bad=not ok)

    def on_verified(data: Any) -> None:
        ok = bool(getattr(data, "IsSucc", False))
        message = str(getattr(data, "Msg", "") or "")
        HUB.set_status(message or ("驗證成功" if ok else "驗證失敗"), ok=ok, bad=not ok)

    events.OnUpdateBasic = on_basic
    events.OnMatch = on_match
    events.OnOrderBook = on_book
    sol = Sol_D(events, str(ROOT / "server.py"))
    sol.Set_OnLoginResultEvent_DAPI(on_login)
    sol.Set_OnVerifiedEvent_DAPI(on_verified)
    sol.Set_OnLogEvent(lambda message: print(message))

    result = sol.Login(user_id, password, "TWS")
    if result != RCode.OK:
        HUB.set_status(f"登入沒有成功：{result.name}", bad=True)
        print(f"登入沒有成功：{result.name}")
        return

    HUB.set_status("已連上台新，等待成交", ok=True)
    for symbol in symbols:
        subscribed = sol.Subscribe("TWS", symbol)
        print(f"訂閱 {symbol}：{subscribed.name}")
        if subscribed != RCode.OK:
            HUB.set_status(f"{symbol} 訂閱失敗：{subscribed.name}", bad=True)

    try:
        while True:
            time.sleep(1)
    finally:
        for symbol in symbols:
            sol.Unsubscribe("TWS", symbol)
        sol.DisConnect()


def parse_symbols(raw: str) -> list[str]:
    symbols = [part.strip() for part in raw.split(",") if part.strip()]
    return symbols or ["2330", "2317", "2454"]


def main() -> None:
    load_env(ENV_PATH)
    parser = argparse.ArgumentParser(description="台新即時報價網頁")
    parser.add_argument("--preview", action="store_true", help="用示範價格看畫面，不登入台新")
    args = parser.parse_args()
    port = int(os.environ.get("TAISHIN_PORT", "8765"))
    symbols = parse_symbols(os.environ.get("TAISHIN_SYMBOLS", ""))
    threading.Thread(target=serve, args=(port,), daemon=True).start()
    if args.preview:
        run_preview(symbols)
        return
    user_id = os.environ.get("TAISHIN_ID", "").strip()
    password = os.environ.get("TAISHIN_PASSWORD", "").strip()
    if not user_id or not password:
        HUB.set_status("請在 quote_bridge/.env 填入 TAISHIN_ID 和 TAISHIN_PASSWORD", bad=True)
        print("請複製 .env.example 為 .env，填入台新帳號與密碼。密碼不要貼到對話裡。")
    else:
        run_taishin(user_id, password, symbols)
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
