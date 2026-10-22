# 景氣觀測（iOS／免費 Apple ID）

原生 SwiftUI App：在 **自己的 iPhone** 用免費 Apple ID 安裝，不必上架 App Store，也不必讓電腦一直開著當伺服器。

## 你需要

- Mac（裝 [Xcode](https://developer.apple.com/xcode/)，App Store 免費）
- iPhone + 傳輸線
- 一般 Apple ID（免費即可）

## 安裝步驟（約 10 分鐘）

1. 用 Mac 開啟專案：
   ```bash
   open ios/JingqiGuance.xcodeproj
   ```
2. 第一次開啟時，Xcode 會自動抓 Swift Package（ZIPFoundation），等右上角進度跑完。
3. 上方 Target 選 **景氣觀測**，裝置選你的 **實體 iPhone**（需解鎖並信任此電腦）。
4. 左側專案設定 → **Signing & Capabilities**：
   - 勾選 **Automatically manage signing**
   - **Team** 選你的個人 Apple ID（若沒有，按 Add Account 登入）
   - Bundle ID 預設 `com.personal.jingqiguance`；若提示被占用，改成獨一無二的，例如 `com.你的名字.jingqiguance`
5. 按 ▶ Run。第一次在 iPhone 上可能無法開啟：
   - iPhone：**設定 → 一般 → VPN 與裝置管理**（或「描述檔與裝置管理」）
   - 點你的 Apple ID 開發者 App → **信任**
6. 再回主畫面點「景氣觀測」即可使用。

## 免費帳號限制（重要）

| 項目 | 說明 |
|------|------|
| 有效期限 | 約 **7 天** 後簽名過期，App 打不開 |
| 怎麼辦 | 再用 Mac 接上 iPhone，在 Xcode 按一次 Run 即可續期 |
| 裝置數 | 同時大約只能裝有限幾個免費簽名 App |
| 網路 | App 會在手機上直接抓公開資料，**不需要電腦常開** |

之後若每天都用、不想每週重裝，再用同一個 Apple ID 升級付費 Apple Developer（約 US$99／年）即可。

## 功能

- 美國 ISM 製造業指數
- 薩姆規則衰退指標
- 景氣燈號
- 台灣出口年增率
- BDI
- 前一日台股資訊總結
- 趨勢圖週期：一年／半年／三個月／一個月

## 系統需求

- iOS 17 以上（使用 Swift Charts）
- 需要網路以抓取最新公開資料
