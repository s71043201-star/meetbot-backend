# meetbot-backend

> MeetBot 會議任務追蹤與臨時人員出缺勤系統的後端服務 — LINE Bot、打卡、Slack 通知與管理後台整合於單一 Express 伺服器。

這是 **meetbot 出勤打卡系統較早期的單檔（single `index.js`）後端版本**，將 LINE 官方帳號機器人、臨時人員簽到/簽退、任務進度追蹤、會議提醒與簡易管理後台全部集中在一支約 1,450 行的 `index.js` 內。它與後續拆分、部署於 Render 的 **meetbot-check-in-system** 屬於同一套系統的不同版本；程式碼中仍可見到對 `meetbot-check-in-system.onrender.com` 與 `meetbot-backend.onrender.com` 等線上服務的交互引用。

---

## 主要功能

### 1. LINE Bot（`/webhook`）
透過文字指令與圖文選單（Rich Menu）操作，並依使用者身分（一般成員 / 管理員 / 出缺勤管理員）顯示不同權限的功能：

- **個人功能**
  - `工作` — 查詢自己在 Firebase 中尚未完成的待辦任務，並標示逾期 / 今日截止 / 剩餘天數。
- **系統連結**（輸入關鍵字回傳網址）
  - `週報`、`會議`、`歷次列管`、`簽到`（附 QR Code）、`後台`。
- **管理員功能**（限特定 boss 帳號）
  - `進度` — 全團隊任務完成率與逐人待辦/已完成清單。
  - `下載` — 推送任務進度報告 PDF 連結。
  - `提醒`／`提醒 姓名` — 以 Quick Reply 選人或指定成員，同時透過 LINE 與 Slack 發出工作提醒。
  - `臨時人員`／`臨時人員 N`（月份）— 查詢某月臨時人員出勤統計。
  - `指令`／`說明`／`help` — 顯示可用指令清單。

### 2. 臨時人員出缺勤系統
- **簽到** `POST /checkin`：記錄姓名、課程、簽到時間（民國年/月/日），寫入 Firebase，並透過 LINE/Slack 通知管理員。
- **簽退** `POST /checkout`：計算工作時數、補登課程屬性/老師/人數/摘要，產生可列印或另存 PDF 的「課程開課紀錄表」HTML 頁面。
- **查詢**：`GET /session/:id`、`GET /active-session`（查某人是否有進行中的簽到）、`GET /records`。
- **刪除**：`DELETE /records/:id`。
- **匯出 Excel** `GET /export`：依姓名/年/月篩選，使用 ExcelJS 產生「健康台灣深耕計畫專職人員出勤記錄表」，每人一個工作表並累計時數。

### 3. 任務與會議
- `POST /parse-meeting`：以 Google Gemini 解析會議記錄文字，自動抽取任務（負責人、描述、截止日期）。
- `POST /check-reminders`：依設定（前 N 天 / 截止前 N 小時 / 逾期 / 例行任務）發送 Slack DM 提醒，每人每日僅發送一次。
- `POST /notify-new-task`、`POST /notify-task-done`：新任務指派與任務完成的 Slack 通知。
- `GET /export-pdf`（舊路徑 `/export-word` 會 302 轉址至此）：產生任務進度報告 HTML（可列印另存 PDF），支援 `from`/`to` 日期區間。
- `POST /send-slack`、`POST /check-meeting-reminders`：手動觸發 Slack 訊息與會議提醒檢查。

### 4. LINE 圖文選單管理（需 `SETUP_SECRET`）
- `GET /setup-richmenu` — 一般成員 4 格選單。
- `GET /setup-admin-menu` — 管理員 6 格選單。
- `GET /setup-huifang-menu` — 特定使用者專屬 6 格選單。
- `GET /link-boss-menu` — 將指定 boss 帳號綁定為相同選單。

### 5. 排程與維運（`setInterval`，台北時區）
- **平日 16:30** — 通知全員至 meetbot 系統勾選完成項目。
- **平日 16:50** — 推送進度追蹤與 Quick Reply 給 boss，可補發提醒。
- **每小時整點（08:00–20:00）** — 自動檢查會議，於會議前 7／3／1 天發送 Slack 提醒（已發送狀態寫回 Firebase 避免重複）。
- **自我保活** — 每 14 分鐘 ping 自身 `/ping`，防止 Render 免費方案休眠。

### 6. 其他端點
- `GET /` → 轉址至 `/checkin.html`
- `GET /ping` → `pong`
- `GET /line-quota` — 查詢 LINE 訊息額度
- `GET /test-me`、`GET /test-slack`、`GET /debug-webhook` — 連線與除錯
- `POST /gemini-proxy` — 供前端（meeting-system）轉發呼叫 Gemini API
- `GET /download/:uid` — 取得簽退後產生的課程記錄 HTML（存於記憶體，伺服器重啟後失效）

---

## 技術棧

- **執行環境**：Node.js
- **Web 框架**：[Express](https://expressjs.com/) `^4.21.0`
- **HTTP 客戶端**：[axios](https://axios-http.com/) `^1.6.0`（內建 `https` 模組用於部分 Firebase 讀取）
- **Excel 產生**：[ExcelJS](https://github.com/exceljs/exceljs) `^4.4.0`
- **資料儲存**：Firebase Realtime Database（透過 REST API 存取，`asia-southeast1`）
- **第三方整合**：
  - LINE Messaging API（Webhook、Push/Reply、Rich Menu、額度查詢）
  - Slack（Incoming Webhook 與 Bot Token DM）
  - Google Gemini API（會議記錄解析、Proxy）
- **前端**：原生 HTML/JS 靜態頁面（`public/` 目錄，由 Express static 提供）

---

## 專案結構

```
meetbot-backend/
├── index.js                      # 主程式：所有路由、LINE/Slack/Gemini 整合、排程
├── package.json                  # 相依套件與啟動腳本
├── gitignore                     # 忽略清單
└── public/                       # 靜態前端與 Rich Menu 圖檔
    ├── checkin.html              # 臨時人員簽到/簽退頁
    ├── admin.html                # 出缺勤後台管理（查詢、刪除、匯出 Excel）
    ├── richmenu-regular.jpg/png  # 一般成員圖文選單
    ├── richmenu-admin.jpg        # 管理員圖文選單
    └── richmenu-huifang.jpg      # 特定使用者專屬圖文選單
```

> 注意：成員名單、LINE/Slack 使用者 ID、權限（boss / 出缺勤管理員）以及 Firebase 資料庫網址等，目前皆**硬編碼於 `index.js`**，新增或調整成員需直接修改原始碼。

---

## 安裝與啟動

需求：Node.js（建議 18 以上）。

```bash
# 1. 安裝相依套件
npm install

# 2. 設定環境變數（見下方清單，可使用 .env 或部署平台環境設定）

# 3. 啟動
npm start          # 等同 node index.js
```

啟動後預設監聽 `0.0.0.0:3000`（或環境變數 `PORT`）。本機可開啟 <http://localhost:3000/>（會自動轉址到簽到頁），或 `http://localhost:3000/admin.html` 進入後台。

---

## 環境變數

以下為程式中實際使用到的環境變數：

| 變數 | 必要性 | 說明 |
| --- | --- | --- |
| `LINE_TOKEN` | LINE 功能必要 | LINE Messaging API 的 Channel Access Token，用於 Push/Reply/Rich Menu/額度查詢。 |
| `GEMINI_API_KEY` | AI 功能必要 | Google Gemini API 金鑰，供 `/parse-meeting` 與 `/gemini-proxy` 使用。 |
| `SLACK_WEBHOOK_URL` | 選用 | Slack Incoming Webhook，用於頻道訊息與會議提醒（未設定時會嘗試從 Firebase 讀取 webhook）。 |
| `SLACK_BOT_TOKEN` | 選用 | Slack Bot Token，用於對個別成員發送 DM（`chat.postMessage`）。 |
| `SETUP_SECRET` | 選用 | 保護 `/setup-*`、`/link-boss-menu` 等 Rich Menu 設定端點的密碼（預設值 `meetbot2024`）。 |
| `BASE_URL` | 選用 | 產生課程記錄下載連結的基底網址（預設 `https://meetbot-check-in-system.onrender.com`）。 |
| `PORT` | 選用 | 伺服器埠號（預設 `3000`）。 |
| `RENDER_EXTERNAL_URL` | 選用（Render） | 自我保活 ping 的目標網址；未設定時使用 `http://localhost:PORT`。 |

---

## 部署說明

程式碼多處跡象顯示本服務部署於 **[Render](https://render.com/)**：

- 使用 `RENDER_EXTERNAL_URL` 取得對外網址。
- 內建每 14 分鐘自我 ping `/ping` 的保活機制，以避免 Render 免費方案的閒置休眠（冷啟動）。
- 指令訊息中引用線上網址 `https://meetbot-backend.onrender.com/export-pdf`。

部署時於 Render（或其他平台）設定：

- **Build Command**：`npm install`
- **Start Command**：`npm start`
- 於環境變數設定上表中的 `LINE_TOKEN`、`GEMINI_API_KEY`、`SLACK_WEBHOOK_URL`、`SLACK_BOT_TOKEN`、`SETUP_SECRET` 等。

部署後，請至 LINE Developers 後台將 Webhook URL 指向 `https://<your-domain>/webhook`，並透過瀏覽器存取 `GET /setup-richmenu?secret=<SETUP_SECRET>` 等端點初始化圖文選單。

---

## 備註

- 資料儲存於外部 Firebase Realtime Database，本服務僅以 REST API 讀寫，未包含資料庫憑證設定。
- 課程記錄頁（`/download/:uid`）暫存於記憶體，伺服器重啟後連結即失效，需重新簽到/簽退產生新記錄。
- 此版本為單檔整合式後端；如需更完整、模組化的部署，請參考同系統的 meetbot-check-in-system 版本。
