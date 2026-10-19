# 驗證紀錄

更新日期：2026-10-19（Asia/Taipei）。本文件僅記錄已實際完成的檢查；其餘保留待驗，不將程式碼存在視為驗收通過。

## 已完成

| 項目 | 結果 | 證據／範圍 |
| --- | --- | --- |
| 題庫擷取與來源 | 通過 | 6 份提供的 PDF，300 題、1,200 選項、80 頁；詳見 `docs/data-validation.md` |
| 發布資料驗證 | 通過 | `node scripts/validate-data.mjs`：六份 SHA-256 一致、題數與題號完整、來源頁碼有效、選項唯一、答案 A–D、解析均為 null |
| 資料防錯測試 | 6 項通過 | `node --test tests/data.test.mjs`；包括錯誤答案、重複題號／選項、錯誤頁碼、竄改 hash、非法 PDF 路徑 |
| 全部自動化測試 | 26 項通過 | 最終 `npm.cmd test`：資料 6 項、作答引擎 14 項、PWA／build／HTTP 6 項；0 失敗 |
| PWA／HTTP 測試 | 6 項通過 | manifest／PNG、完整預存清單、同源 GET allowlist 與離線快取命中、登入轉址不快取、手動更新、產物位元一致、MIME／CSP／路徑防護；尚不代表真實瀏覽器離線驗收 |
| JavaScript 語法 | 通過 | `npm.cmd run check`：app、engine、pwa、SW；另檢查 build、serve 與 validate-data 工具 |
| 正式打包 | 通過 | `npm.cmd run build` 產生 `dist/`；先驗證六份 PDF 與題庫，測試確認產物與來源逐位元一致 |
| 本機 HTTP | 通過 | 測試實際啟動 127.0.0.1 HTTP server，驗證 MIME、安全標頭、路徑穿越拒絕、SW no-store 與 PDF HEAD |
| App 圖示 | 已目視確認 | 珊瑚色書本圖示，192／512 PNG、maskable 與 180px Apple 圖示 |
| 首頁圖示連結 | 一致 | `index.html` 的 favicon、apple-touch-icon、manifest 均對應現有檔案 |
| Chromium／WebKit 瀏覽器流程 | 13 項通過 | 實際執行瀏覽器檢查，詳見下方清單；使用獨立測試環境，沒有以使用者日常瀏覽器資料進行測試 |
| 響應式版面 | 通過 | Chromium 的首頁、題庫、錯題、收藏、統計、設定於 360、390、768、1280、1440px 無水平溢位；WebKit 390px 手機模擬作答通過 |
| 瀏覽器離線 | 通過 | 首次題庫備妥後切離線、重整、續答與提交；原 PDF 仍需連線 |
| 深色選項閱讀 | 通過 | 簡化版深色主題底色 `#1c1c1b`、選項底色 `#252524`、文字 `#f1f0e9`；瀏覽器深色樣式與畫面檢查通過 |
| 可攜式瀏覽器腳本 | 已實測通過 | `scripts/qa-browser.cjs`；重現相同 13 項流程，採環境變數與 `test-results/` 輸出，無個人機器路徑。已以交付的可攜版完整重跑，13 項全部通過 |

以上 Node 檢查在 Windows 本機 Node.js v26.5.0 執行。第一次測試的本機 HTTP 回送連線遭執行沙箱以 EACCES 阻擋；經允許於沙箱外重跑後全部通過，沒有略過 HTTP 測試。GitHub CI 已設定 Node.js 22、24；目前不以設定檔存在宣稱遠端已通過。

## 瀏覽器已通過的 13 項檢查

1. 桌面首頁、300 題統計與離線備妥狀態。
2. 鍵盤確認答案與錯題紀錄。
3. 重整續答、筆記與收藏保留；筆記 HTML 不執行，作答不重複計次。
4. 錯題重答正確後移出錯題本，保留累計紀錄。
5. 計時測驗可改選、交卷前隱藏答案、重整不重設期限、未答計分正確。
6. 匯出備份保留作答、收藏、筆記與歷史。
7. 確認清除後匯入備份，紀錄往返一致。
8. 主題切換持久保存，深色計算樣式正確。
9. 所有主要導覽頁面在五種指定寬度下無水平溢位。
10. 離線重整與答案提交可使用完整題庫。
11. 過期測驗重新開啟時自動交卷。
12. Chromium 流程無未捕捉的瀏覽器錯誤。
13. WebKit 手機尺寸版面與作答流程。

原始執行證據為開發工作區的 `work/browser-qa.json`，13 項全部通過。公開交付的可攜腳本重跑後會在 `test-results/browser-qa.json` 產生新的證據及截圖；不把先前個人機器路徑寫進腳本。

## 待整合驗證

| 項目 | 狀態 | 需完成的操作 |
| --- | --- | --- |
| 搜尋與全部鍵盤導覽 | 未完整驗收 | 瀏覽器 13 項檢查不涵蓋每一個搜尋組合或所有控制項的鍵盤路徑 |
| 新版等待／更新 | 已驗證 | 實際預覽從舊快取顯示新版提示，點「儲存進度並更新」後載入 v3 簡化版，首頁及四項導覽正確 |
| GitHub push／CI | 未推送 | GitHub 回傳 403：帳號 tfccbank 無 resolahcus/AI-planning 寫入權限。使用者選擇自行上線；GitHub CI 尚未執行 |
| Vercel 正式部署 | 權限待設定 | Vercel 建立 Git 連結回傳 repo_no_access；需授權 resolahcus/AI-planning repository 後匯入，再確認 READY 與正式網址 |
| iOS／Android 真機 | 未執行 | 使用正式 HTTPS 網址安裝、主畫面開啟與離線重啟 |

## 重跑命令

```powershell
node scripts/validate-data.mjs
npm.cmd run check
npm.cmd test
npm.cmd run build
node scripts/serve.mjs --dist
```

自動化測試驗證程式與資料行為；手機模擬畫面無法取代 iOS／Android 的實際安裝驗證。來源驗證證明題庫與提供的 PDF 一致，並未另行完成 300 題學理正確性的審查。

## 介面簡化版本

2026-10-19：首頁收斂為快速練習、兩科入口及一行進度；移除側欄、裝飾插圖、標語與首頁統計卡。四項主導覽集中為首頁／練習／複習／紀錄，收藏位於複習頁。作答採單欄，主導覽隱藏，題號與進階設定預設收合。

已重新執行 26 項 Node 測試、13 項 Chromium／WebKit 瀏覽器流程及正式 build，全部通過。桌面首頁、390px 手機首頁與作答頁均完成視覺檢查；題庫及個人資料格式保持相同，SW cache 更新為 `ai-study-115-v3`。仍採原始碼交付，未執行遠端推送或部署。
