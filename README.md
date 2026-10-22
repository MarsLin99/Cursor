# 景氣觀測

個人用景氣與台股觀測工具。**建議用 iOS 原生 App + 免費 Apple ID** 裝到自己手機；不必上架 App Store，也不必讓電腦一直開著。

## 推薦：iOS App（免費 Apple ID）

詳見 [`ios/README.md`](ios/README.md)。

```bash
open ios/JingqiGuance.xcodeproj
```

在 Xcode 登入 Apple ID → 選你的 iPhone → Run。約每 7 天需重裝續期一次。

## 內容

1. 美國 ISM 製造業指數  
2. 薩姆規則衰退指標  
3. 景氣燈號  
4. 台灣出口年增率  
5. BDI  
6. 前一日台股資訊總結  

趨勢圖可切換：一年／半年／三個月／一個月。

## 可選：網頁版 PWA

倉庫根目錄仍保留先前的 Node／Vite PWA（需本機或伺服器常開）。若要用：

```bash
npm install
npm run build && npm start
```

對多數「自己手機每天看」的情境，請優先使用 `ios/` 原生 App。
