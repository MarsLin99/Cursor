# 景氣觀測（PWA）

個人用景氣與台股觀測 Progressive Web App。可在 iPhone Safari「加入主畫面」當 App 使用，不必上架 App Store。

## 功能

1. 美國 ISM 製造業指數（含趨勢圖）
2. 薩姆規則衰退指標（由 BLS 失業率即時計算）
3. 台灣景氣燈號（國發會）
4. 台灣出口年增率（由海關出口值推算）
5. BDI 波羅的海乾散貨指數
6. 前一日台股資訊總結（證交所）

每個指標可切換：**一年／半年／三個月／一個月** 趨勢。

## 本機啟動

```bash
npm install
npm run dev
```

- 前端：http://127.0.0.1:5173
- API：http://127.0.0.1:4173

正式建置：

```bash
npm run build
npm start
```

瀏覽器開啟 http://127.0.0.1:4173 ，在 iPhone 上可用 Mac 分享同區網 IP，或以 Cloudflare Tunnel／內網穿透提供 HTTPS 後「加入主畫面」。

## 資料來源說明

| 指標 | 來源 |
|------|------|
| ISM | Bellwether 公開歷史資料 + PR Newswire 最新稿 |
| 薩姆規則 | 美國 BLS 失業率自行計算 |
| 景氣燈號 | 國發會開放資料 ZIP |
| 出口年增率 | 國發會海關出口值同比 |
| BDI | HiStock 日線 |
| 台股 | TWSE FMTQIK / OpenAPI |

資料有 15 分鐘伺服器快取；點「立即更新」可強制重新抓取。

## 注意

僅供個人觀察，非投資建議。各機構發布頻率不同（多為月資料），「即時」指抓取當下最新公開值。
