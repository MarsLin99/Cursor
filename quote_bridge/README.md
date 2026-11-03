# 台新即時報價

在你自己的電腦登入台新行情，瀏覽器開本機頁面看成交價與五檔。

雲端這台機器沒有你的台新密碼，也到不了公司電腦的 `D:\Agent\Grok\`。元件要裝在會一直開著、而且上網不經過 proxy 的那台 Windows。

## 這台電腦要做的事

```bash
cd quote_bridge
python setup_sdk.py
copy .env.example .env
```

用記事本打開 `.env`，填入台新電子交易帳號與密碼，以及要看的代號。然後：

```bash
python server.py
```

瀏覽器打開 `http://127.0.0.1:8765`。

只想先看畫面、先不登入：

```bash
python server.py --preview
```

## 連不上時

- 風險預告書簽完還不夠。網站上的線上認證要顯示驗證成功，下一個工作日才開通行情。
- 公司網路如果強制走 proxy，台新會拒絕連線。請改在沒有 proxy 的網路執行 `server.py`，再用那台電腦的瀏覽器看。
- 防火牆要允許連到連接埠 `55555`。
