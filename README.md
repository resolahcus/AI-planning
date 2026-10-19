# AI 學習所

把六份 115 年初級 AI 應用規劃師公告試題整理成電腦、平板及手機都能使用的練習網站，並提供可加入手機主畫面的 PWA。收錄第一至第三次、兩科共 **300 題**。

這是獨立製作的學習工具，並非考試主辦單位的官方網站。題目與答案依使用者提供的原始 PDF 收錄；原檔沒有逐題解析，因此網站不提供或宣稱有官方詳解。

## 可以怎麼使用

- **日常刷題：** 按科目、場次、題數與出題順序建立練習，提交答案後核對原公告答案。
- **集中複習：** 查看錯題、收藏題及個人筆記，針對需要加強的題目再練一次。
- **模擬測驗：** 使用計時作答，交卷後查看成績與逐題結果。預設 60 分鐘是本站自訂的練習計時，並非對正式考試規則的宣告。
- **學習進度：** 保留作答紀錄、練習結果與未完成的作答，支援深淺色模式。
- **手機與離線：** 首次連線下載題庫後可離線練習；公告 PDF 來源需連線開啟。

網站沒有帳號、後端資料庫或雲端同步。作答、收藏、筆記及測驗紀錄只存在目前的瀏覽器／裝置。請定期匯出備份；換裝置時再匯入。匯入會取代目前裝置的學習資料，建議先匯出現有資料。清除瀏覽器網站資料、私人瀏覽、自動儲存空間清理或更換網址都可能讓本機資料消失；安裝 PWA 不等於備份。

## 題庫範圍與來源

| 科目 | 第一次 | 第二次 | 第三次 | 合計 |
| --- | ---: | ---: | ---: | ---: |
| 第一科：人工智慧基礎概論 | 50 | 50 | 50 | 150 |
| 第二科：生成式 AI 應用與規劃 | 50 | 50 | 50 | 150 |

`data/questions.json` 包含每題的題幹、四個選項、公告答案、來源文件與頁碼。`data/sources.json` 保存六份原始 PDF 的檔名、SHA-256、頁數及答案來源；原檔位於 `sources/`。網站可開啟原始頁面核對。

答案從原 PDF 的「答案」欄抄錄，沒有使用模型推論。完整擷取與交叉檢查說明見 [題庫驗證紀錄](docs/data-validation.md)。本次以提供的檔案為依據，未另行確認官方網站後續是否有更正版本。

## 在電腦啟動

需要 Node.js 22 以上，不需要安裝套件。

Windows 解壓縮後，可直接雙擊 `START.cmd`，保持啟動視窗開著，再用瀏覽器開啟畫面顯示的網址。也可以在專案資料夾執行：

```powershell
node scripts/serve.mjs
```

瀏覽器開啟 `http://127.0.0.1:4173`。請透過這個網址操作，不要直接雙擊 `index.html`。

```powershell
# 檢查六份 PDF 雜湊與全部題目結構
node scripts/validate-data.mjs

# 執行全部自動化測試
node --test tests/*.test.mjs

# 產生正式部署檔案，會先執行題庫驗證
node scripts/build.mjs

# 預覽打包結果
node scripts/serve.mjs --dist
```

## GitHub 與 Vercel 上線

指定儲存庫：[resolahcus/AI-planning](https://github.com/resolahcus/AI-planning)。在 Vercel 匯入此儲存庫，使用以下設定：

本次交付為完整原始碼；尚未推送至 GitHub，也沒有正式線上網址。發布時的 Git 帳號 `tfccbank` 被 GitHub 拒絕寫入（403），Vercel Git 連結也回傳 `repo_no_access`。請使用有權限的帳號將本資料夾內容放進指定 repository，並授權 Vercel 讀取這個 repository。

建議步驟：

1. 解壓縮後，將此資料夾內的檔案放在 repository 根目錄（`package.json`、`index.html`、`vercel.json` 同一層）。
2. 使用有權限的 GitHub 帳號 commit 並 push 到 `main`。
3. 在 Vercel 新增專案，匯入 `resolahcus/AI-planning`；若找不到 repository，先調整 Vercel 的 GitHub App repository 存取範圍。
4. 確認下表設定，部署完成且狀態為 READY 後，用手機開啟 HTTPS 網址並安裝。

| 設定 | 值 |
| --- | --- |
| Framework Preset | `Other` |
| Build Command | `node scripts/build.mjs` |
| Output Directory | `dist` |
| Environment Variables | 不需要 |

`vercel.json` 已包含建置設定、安全標頭及 Service Worker 更新快取設定。GitHub Actions 會在 `main` 推送與 Pull Request 時，以 Node.js 22、24 檢查資料、語法、測試與建置；遠端 CI 是否成功仍以該次 GitHub 執行結果為準。

正式網站使用 HTTPS 後，就能在支援的手機瀏覽器安裝。iPhone／iPad 使用 Safari「分享 → 加入主畫面」；Android 使用 Chrome 安裝功能。完整步驟見 [安裝與部署指南](docs/INSTALL.md)。程式、題庫或圖示更新時，要同步增加 `sw.js` 的 `CACHE_NAME` 版本；新版本會等待使用者按更新才切換。

## 維護與驗證

| 檔案／目錄 | 用途 |
| --- | --- |
| `index.html`、`styles.css`、`js/app.js` | 介面與互動 |
| `js/engine.js` | 作答、計分、篩選與備份驗證 |
| `js/pwa.js`、`sw.js`、`manifest.webmanifest` | 安裝、離線與更新 |
| `data/`、`sources/` | 題庫與原始 PDF |
| `scripts/` | 本機啟動、資料驗證、建置 |
| `tests/` | 資料、作答與 PWA 自動化測試 |
| `docs/QA.md` | 實際驗證狀態與待驗項目 |

沒有第三方執行時套件、外部字型、追蹤碼或 AI API 呼叫。程式建置成功、GitHub 推送成功、Vercel 部署完成及手機真機驗收是不同的狀態，請參閱 [驗證紀錄](docs/QA.md)。

## 選用的瀏覽器驗證

網站本身不需要 Playwright。要重跑 Chromium／WebKit 的端到端檢查，可先啟動本機網站，再於另一個終端機執行：

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
node scripts/qa-browser.cjs
```

測試使用獨立瀏覽器環境，檢查作答、錯題、備份往返、計時交卷、離線重整及 360／390／768／1280／1440px 版面。結果 JSON 與截圖預設存入已被 Git 忽略的 `test-results/`。深色截圖會等待選項底色符合目前主題，並停用截圖中的動畫，避免擷取切換過程。

| 選用環境變數 | 用途 |
| --- | --- |
| `QA_URL` | 測試網址，預設 `http://127.0.0.1:4173` |
| `QA_ARTIFACTS` | 結果與截圖輸出目錄，預設專案內 `test-results/` |
| `PLAYWRIGHT_MODULE` | 已安裝的 Playwright 套件路徑；未設定時載入本機 `playwright` |
| `CHROMIUM_EXECUTABLE` | 自訂 Chromium 執行檔；未設定時使用 Playwright 預設瀏覽器 |
| `WEBKIT_EXECUTABLE` | 自訂 WebKit 執行檔；未設定時使用 Playwright 預設瀏覽器 |

這是桌面瀏覽器自動化與手機尺寸模擬，不能取代 iPhone／Android 真機的安裝與離線啟動驗收。
