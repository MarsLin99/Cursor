"""從台新下載專區取得 Python 行情元件，並安裝到這台電腦。

下載內容與在網站按「行情 API / Python」相同，包含連線設定檔。
設定檔與安裝包留在本機，不送上 GitHub。
"""

from __future__ import annotations

import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
URL = "https://mlapi.tssco.com.tw/web_api/service/download/api/client/sample/quote_py"


def main() -> None:
    VENDOR.mkdir(exist_ok=True)
    archive = VENDOR / "SolPYAPI.7z"
    print("正在從台新下載行情元件…")
    urllib.request.urlretrieve(URL, archive)
    try:
        import py7zr
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "py7zr"])
        import py7zr
    with py7zr.SevenZipFile(archive, "r") as package:
        package.extractall(VENDOR)
    wheel = next(VENDOR.glob("PY_TradeD-*.whl"), None)
    config = next(VENDOR.glob("**/SYS_SOLACE.ini"), None)
    if wheel is None or config is None:
        raise SystemExit("下載的壓縮檔裡沒有行情元件或連線設定，請改從台新網站手動下載。")
    print(f"安裝 {wheel.name}")
    subprocess.check_call([sys.executable, "-m", "pip", "install", str(wheel)])
    destination = ROOT / "Configs"
    destination.mkdir(exist_ok=True)
    target = destination / "SYS_SOLACE.ini"
    target.write_bytes(config.read_bytes())
    print("安裝完成。下一步：複製 .env.example 為 .env，填入帳號後執行 python server.py")


if __name__ == "__main__":
    main()
