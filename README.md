# 走圖道場

用真實台股日 K 練習技術分析進出場，並在走圖過程中面對突發事件，訓練選擇權避險決策。

## 功能

- 輸入台股代號（如 `2330`）載入歷史日 K
- 走圖播放／單步，模擬買進賣出（預設本金 400 萬）
- 可開關 MA / EMA / 布林 / RSI / MACD / KD
- 走圖途中跳出事件關卡：Protective Put、領口、賣 Call、不加碼等

## 開發

```bash
npm install
npm run dev
```

Vite 會代理證交所與 Yahoo Finance API，避免瀏覽器 CORS 問題。

## 建置

```bash
npm run build
npm run preview
```

## 資料來源

1. 優先：臺灣證券交易所日成交資訊
2. 備援：Yahoo Finance
3. 皆失敗時：可重現的示範行情（仍可完整練習）

本工具僅供練習，非正式投資建議。
