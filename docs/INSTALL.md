# AI 學習所：安裝與部署

## 電腦預覽

在專案目錄執行 `node scripts/serve.mjs`，開啟 `http://127.0.0.1:4173`。不需要安裝套件。請不要直接雙擊 `index.html`；模組、題庫載入與離線功能需要網站環境。

打包執行 `node scripts/build.mjs`，產物在 `dist/`；以 `node scripts/serve.mjs --dist` 可驗證打包結果。`node --test tests/*.test.mjs` 執行自動化測試。

## GitHub 與 Vercel

1. 將此專案目錄的檔案提交到你的 GitHub 儲存庫。
2. 在 Vercel 匯入該儲存庫。若放在儲存庫的子目錄，將 Root Directory 設為本專案目錄。
3. Framework Preset 選 `Other`，Build Command 為 `node scripts/build.mjs`，Output Directory 為 `dist`。專案內 `vercel.json` 已提供這些設定及安全標頭。
4. 部署完成後，先以 Vercel 提供的 HTTPS 網址確認題庫、PDF 來源、手機畫面及離線重新整理，再交付使用者。

程式不需要環境變數、後端或付費 API。原始公告 PDF 會一同提供於 `sources/`。每次變更程式或題庫後，同時更新 `sw.js` 的 `CACHE_NAME` 版本，避免使用者留在舊題庫。即使要回退程式版本，也要給該次發布新的 cache 版本，不能在不同內容間重複使用相同名稱。

## 手機安裝

- **iPhone / iPad：** 使用 Safari 開啟正式 HTTPS 網址，點「分享」→「加入主畫面」；若系統提供「以網頁 App 打開」，請開啟。不同 iOS 版本的文字可能略有不同。
- **Android：** 使用 Chrome 開啟 HTTPS 網址，等待離線題庫準備完成，點網站安裝按鈕，或瀏覽器選單中的「安裝應用程式／加入主畫面」。實際選項依瀏覽器與裝置而異。
- **電腦：** 支援的瀏覽器可使用網址列或選單的安裝功能；沒有安裝選項時仍可直接在網頁練習。

一般手機無法安裝以電腦區網 IP 提供的純 HTTP 版本。PWA 安裝與 Service Worker 應使用 HTTPS；`localhost`／`127.0.0.1` 例外只適用該裝置本身的開發環境。

## 離線與更新

首次使用請保持網路連線，直到網站顯示「題庫已備妥」。之後可離線重新開啟、作答與複習。公告 PDF 不納入離線預存，需有網路才能查看。網站有新版時會提示，由使用者結束作答後按更新，不會在作答途中自行重新整理。

作答紀錄只存在目前瀏覽器／裝置，沒有帳號或雲端同步。請使用網站的匯出功能備份，再到另一裝置匯入。清除網站資料、私人瀏覽、瀏覽器自動清理或更換網址可能使紀錄消失；安裝 PWA 並不等於完成備份。

本文件是安裝操作說明，不能當作已完成手機真機安裝、正式部署或離線驗收的證明。實際交付狀態請依驗證紀錄。

官方參考：[MDN — Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)（查閱：2026-10-19）。
