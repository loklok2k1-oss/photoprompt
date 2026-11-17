# 照片提示詞網站 — 獨立版（有資料庫）

**版本：v1.2.0（2026-11-17）**｜更新日誌見 `CHANGELOG.md`。

**版本號規則（以後每次更新都要跟）：每次改動都要升版本號，並同步更新 `package.json`、`VERSION` 檔案、`/api/health` 回傳、網站頁尾／站長工具顯示、同 `CHANGELOG.md`。詳情見 `CHANGELOG.md` 頂部。

呢個係可以下載、自己保存、自己放上伺服器嘅獨立版。唔係 Muse 入面先用到嘅版本，成套程式連埋資料庫都喺呢個資料夾入面。

## 入面有乜

- 首頁：12 款風格圖片卡（日本動漫、吉卜力、Pixar 3D、Q 版、水彩、古典油畫、漫畫線稿、復古菲林、韓系清新、電影感、賽博龐克、像素）
- 首頁唔顯示提示詞文字，每張卡有「複製提示詞」掣，撳一下就複製中文加英文加負面提示詞
- 撳入圖片入詳情頁，見到完整提示詞、負面提示詞、適用工具同使用步驟，逐段複製，仲有一鍵複製全部
- 前後對比：電腦版滑鼠放上去睇原相，移開變返效果圖；手機版㩒住睇原相，放開變返效果，圖上面有「效果／原相」切換掣
- 搜尋、分類、工具篩選、隨機一款
- 留言板：可以寫留言、上載效果圖，上面寫明上載嘅圖會由站長審批，獲批有機會成為網站素材；留言存入資料庫
- 站長工具：隱藏入口，入面可以直接喺網上新增、編輯、刪除提示詞，連原相、效果圖上載，加完即刻所有人睇到；仲有 JSON 匯入、匯出同留言管理
- **v2 匯入**：匯入前預覽（新增／重複／更新／格式錯）、CSV 匯入、由網址匯入（GitHub raw 等 JSON 網址）、待審核狀態（前台只顯示已上架，待審核要站長批准先出現）
- **v3（2026-11-17）**：可選站長密碼、完整備份／還原（提示詞＋留言）、動態分類／工具篩選＋排序、複製提示詞加標籤、手機版一欄＋捲動修正、SEO／favicon、CSV 加 `id`／`status`／`orig` 欄、刪除嗰陣清走舊上載圖。詳情見 `CHANGELOG.md`。

## v2 新功能：匯入前預覽、CSV、網址匯入、待審核

### 匯入流程（站長工具 →「匯入 / 匯出（v2）」）

1. 揀檔案（.json／.csv）、貼上文字，或者貼網址（例如 GitHub raw 連結嘅 JSON）
2. 揀「直接上架」定「先放待審核」，揀埋相同名稱／編號時係咪覆蓋
3. 撳「預覽匯入」，睇到逐行分類：新增／更新／跳過／格式錯
4. 撳「確認寫入」先真正寫入資料庫，之後會顯示匯入報告（新增／更新／跳過／錯誤行）
5. 一行格式錯唔會令成批失敗，嗰行會跳過並喺報告列明原因

### CSV 格式

第一行係欄位名，之後每行一款：

```
name,cat,promptZh,promptEn,negative,tools,subjects,tagline,tip,img
黏土風,動畫,中文提示詞…,English prompt…,negative prompt…,ChatGPT|Gemini,即夢,人物,一句話效果,小貼士,/images/seed/clay.jpg
```

- `tools`、`subjects` 用 `|` 分隔（例如 `ChatGPT|Gemini`）
- 欄位入面有逗號、換行要加雙引號包住（Excel 另存 CSV 時會自動處理）
- Excel 另存 CSV：**一定要揀「CSV UTF-8」**，否則中文會變亂碼
- 冇填 `name`，或者中文／英文提示詞兩個都冇，嗰行會當格式錯跳過
- 同名（唔分大小寫）或者相同編號嘅提示詞，預設會跳過；剔「覆蓋」先會更新

### 由網址匯入

貼 GitHub raw 連結等 JSON 網址（例如 `https://raw.githubusercontent.com/…/prompts.json`），伺服器會去抓返嚟再預覽。網址唔啱、抓唔到、唔係 JSON／CSV 格式，會直接報錯，唔會寫入任何嘢。

### 待審核流程

- 匯入嗰陣揀「先放待審核」，嗰啲提示詞狀態係 `pending`，**前台唔會顯示**，亦唔會喺搜尋出現
- 站長工具「待審核」清單可以逐款「批准上架」或者「刪除」
- 喺站長工具新增／編輯提示詞都可以揀狀態（預設直接上架）

### API（俾 n8n／其他工具用）

- `POST /api/prompts/import/preview` — 預覽：body 可以係 `{items:[...]}`、`{csv:"..."}`、`{text:"..."}` 或 `{url:"..."}`，加 `overwrite:true/false`；回傳逐行分類同統計，唔寫入
- `POST /api/prompts/import/confirm` — 確認寫入：同預覽一樣嘅輸入，加 `status:"live"|"pending"`；回傳 `added／updated／skipped／errors`
- `POST /api/prompts/import` — 舊版匯入，格式不變（JSON 陣列／`{items}`，按 id 去重，`overwrite` 選項），而家亦支援 `status`
- `GET /api/prompts?status=all|live|pending` — 預設只返 `live`（前台用）；站長工具用 `all`
- `GET /api/prompts/pending` — 待審核清單
- `POST /api/prompts/:id/approve` — 批准一項待審核，變 `live`

## v3 新功能（v1.2.0）

### 站長密碼（可選，但強烈建議設定）
- 之前任何人撳到站長工具入口（`#/owner`）都可以改題庫、刪留言，今版可以鎖起佢。
- 設定方法：啟動前加環境變數 `OWNER_PASSWORD`，例如：
  ```bash
  OWNER_PASSWORD=你嘅密碼 npm start
  ```
  用 pm2 嘅話，喺 `ecosystem.config.js` 入面加 `env: { OWNER_PASSWORD: "你嘅密碼" }`，或者 `OWNER_PASSWORD=你嘅密碼 pm2 start server.js --name photo-prompts`。
- 設定咗之後，入站長工具要輸入一次密碼（記喺瀏覽器 session，閂分頁即忘）；所有寫入 API 都要帶 `X-Owner-Pin` 標頭，n8n 呼叫匯入 API 嗰陣記得加埋。
- 未設定就沿用舊行為，站長工具頂部會顯示紅色警告。

### 完整備份／還原
- 站長工具「下載完整備份」：一次過下載提示詞＋留言嘅 JSON（`GET /api/backup`）。
- 站長工具「還原備份檔」：揀返備份 JSON 就還原（`POST /api/backup/restore`），提示詞按編號／名稱去重，留言按內容＋日期去重。
- **備份 JSON 唔包括圖片檔本身**：上載圖片要另外複製 `public/uploads/` 先算完整備份。

### 前台改進
- 分類、工具篩選由題庫實際資料動態生成，加新分類／新工具會自動出現；加排序（最新先／最舊先／名稱 A–Z）。
- 「複製提示詞」會加埋標籤（中文提示詞／English prompt／Negative prompt）；詳情頁加「複製呢款連結」。
- 手機窄屏改一欄；對比圖唔會鎖死上下捲動。

## 由 v2 升級去 v3

1. **先備份**：複製 `data/prompts.db` 同 `public/uploads/` 去安全嘅地方；最好順便喺站長工具撳「下載完整備份」，多一份提示詞＋留言嘅 JSON。
2. 停咗舊版伺服器（`pm2 stop photo-prompts`，或者按 `Ctrl+C`）
3. 將 v3 嘅檔案覆蓋去伺服器嗰個資料夾（**唔好覆蓋 `data/prompts.db`，你嘅題庫喺入面**；`public/uploads/` 入面嘅圖都唔好刪）
4. 喺資料夾入面跑：
   ```bash
   npm install
   pm2 restart photo-prompts
   ```
   （本地測試就用 `npm start`）
5. v1／v2 舊資料庫啟動嗰陣會自動遷移（補 `status` 欄，現有提示詞全部設為 `live`），唔會唔見資料
6. 檢查：開 `http://localhost:3000/api/health`，應該見到 `version: "1.2.0"`、`prompts` 數目同你之前一樣，`pending` 係 0
7. （可選）設定 `OWNER_PASSWORD` 鎖起站長工具，見上面「站長密碼」一節

## 由 v1 升級去 v2

1. **先備份**：複製 `data/prompts.db` 同 `public/uploads/` 去安全嘅地方
2. 停咗舊版伺服器（`pm2 stop photo-prompts`，或者按 `Ctrl+C`）
3. 將 v2 嘅檔案覆蓋去伺服器嗰個資料夾（**唔好覆蓋 `data/prompts.db`，你嘅題庫喺入面**）
4. 喺資料夾入面跑：
   ```bash
   npm install
   pm2 restart photo-prompts
   ```
   （本地測試就用 `npm start`）
5. 啟動嗰陣會自動幫舊資料庫補加 `status` 欄，現有提示詞全部自動設為 `live`，唔會唔見、唔會變待審核
6. 檢查：開 `http://localhost:3000/api/health`，應該見到 `prompts` 數目同你之前一樣，`pending` 係 0
- 唔提供生圖功能，淨係貼提示詞；唔做登入、唔做付款；全部介面用繁體中文

## 技術

- Node.js + Express（伺服器）
- SQLite（資料庫，用 Node.js 內置嘅 `node:sqlite`，唔使另外裝資料庫，唔使編譯原生模組）
- 得一個外部依賴：`express`

## 安裝

1. 先裝 Node.js，版本要 22 或以上，建議裝最新 LTS（24）。
   下載：https://nodejs.org
   裝好之後喺終端機打 `node --version`，見到 `v22` 或者 `v24` 開頭就得。
2. 入呢個資料夾，安裝依賴：
   ```bash
   cd photo-prompt-standalone-db
   npm install
   ```

## 啟動

```bash
npm start
```

之後用瀏覽器開 http://localhost:3000 就得。

第一次啟動會自動建立 `data/prompts.db`，並寫入 12 款種子風格。之後再啟動唔會重寫，唔會洗走你加咗嘅提示詞。

停止伺服器：喺終端機按 `Ctrl+C`。

改 port：啟動前設定環境變數，例如 `PORT=8080 npm start`，就會跑喺 8080。

## 資料庫檔案喺邊

- 資料庫：`data/prompts.db`（SQLite 單一檔案）
- 種子資料：`seed.json`（12 款風格嘅文字資料，第一次啟動用）
- 範例圖片：`public/images/seed/`（12 張效果圖加一張共用原相）
- 用戶上載嘅圖：`public/uploads/`

## 備份方法

成個網站嘅資料就係 `data/prompts.db` 一個檔案，加埋 `public/uploads/` 入面嘅圖。

- 備份：複製 `data/prompts.db` 同 `public/uploads/` 去安全嘅地方就得；另外可以喺站長工具撳「下載完整備份」，攞多一份提示詞＋留言嘅 JSON（`GET /api/backup`）。
- 還原：停咗伺服器之後，將備份嘅 `prompts.db` 蓋返入 `data/`，將 `uploads/` 蓋返入 `public/`，再啟動。或者唔停機都得：喺站長工具揀「還原備份檔」，上載返備份 JSON（`POST /api/backup/restore`）— 提示詞同留言會還原，但圖片檔唔喺 JSON 入面，`public/uploads/` 依然要手動複製返。
- 搬機：成個資料夾搬過去，新機 `npm install` 再 `npm start` 就得，資料庫檔案跟住去。

另外，站長工具入面有「匯出 JSON」，可以匯出全部提示詞做備份，或者搬去另一套系統。

## 點樣加提示詞（站長用）

1. 開網站，連撳頁底「照片提示詞網站 — 揀風格…」嗰行文字 5 下，或者喺網址尾加 `#/owner`，開站長工具
2. 用表單新增提示詞，連原相、效果圖上載，撳儲存
3. 加完即刻喺首頁見到，唔使重新啟動，因為係存入資料庫，唔係 localStorage

編輯、刪除都係同一個頁面做。留言管理都喺站長工具入面，可以刪除留言。

## 點樣放上自己伺服器

### 方法一：VPS / 雲端伺服器（公開俾人用）

1. 伺服器先裝 Node.js 22 或以上
2. 將成個資料夾上載去伺服器（唔使包括 `node_modules`，去到先裝）
3. 喺伺服器入面跑：
   ```bash
   npm install
   npm start
   ```
4. 想長期跑、唔使開住終端機，可以用 `pm2`：
   ```bash
   npm install -g pm2
   pm2 start server.js --name photo-prompts
   pm2 save
   ```
5. 再用 Nginx 或者 Caddy 做反向代理，將域名指向 `http://localhost:3000`，加埋 HTTPS 就完成

### 方法二：自己電腦長期開住

喺 Mac mini 或者 Windows 電腦用上面「啟動」嘅方法跑住，再配合內網穿透或者 Tailscale 俾其他人連入嚟。

### 方法三：GitHub Pages（淨係靜態版先得）

GitHub Pages 跑唔到 Node.js 後端，所以呢個有資料庫嘅版唔可以直接放上 GitHub Pages。如果淨係想公開俾人睇提示詞、唔使喺網上加，可以用返靜態版（一個 `index.html`）放上 GitHub Pages。

## 常見問題

- **啟動話要 Node.js 22 或以上**：你部機嘅 Node.js 太舊，去 https://nodejs.org 裝最新 LTS。
- **npm install 失敗**：檢查網絡，或者試下 `npm install --no-audit --no-fund`。
- **port 3000 俾人用咗**：用 `PORT=8080 npm start` 轉第二個 port。
- **題庫唔見咗**：檢查 `data/prompts.db` 仲喺唔喺度；如果唔見咗，刪咗佢再啟動，會由 `seed.json` 重新寫入 12 款（但係你後加嘅提示詞會冇埋，記得先備份）。
- **上載圖片唔見咗**：圖片存喺 `public/uploads/`，備份同搬機嗰陣要一齊帶走。

## 檔案清單

```
photo-prompt-standalone-db/
├── server.js            伺服器（Express + SQLite）
├── package.json         依賴同啟動指令（版本號喺呢度）
├── VERSION              版本號（得一行，伺服器同網站顯示都讀佢）
├── CHANGELOG.md         更新日誌（每次更新都要加新版本一節）
├── seed.json            12 款種子風格
├── README.md            呢份說明
├── data/
│   └── prompts.db       資料庫（第一次啟動自動建立）
└── public/
    ├── index.html       網站前端（首頁、詳情、留言板、站長工具）
    ├── images/seed/     12 張範例效果圖 + 共用原相
    └── uploads/         站長 / 訪客上載嘅圖
```
