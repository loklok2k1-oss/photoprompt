// 照片提示詞網站 — 獨立版伺服器
// Node.js + Express + SQLite（Node 內置 node:sqlite，唔使裝原生模組）
// 啟動：npm install 之後 npm start，預設 http://localhost:3000
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
  console.error("啟動失敗：需要 Node.js 22 或以上版本（建議安裝 Node.js 24 LTS），因為要用內置的 node:sqlite。");
  console.error("請去 https://nodejs.org 下載最新 LTS 版本再試。");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
// v3：版本號單一來源 — VERSION 檔案，否則讀 package.json
const VERSION = (() => {
  try { return fs.readFileSync(path.join(__dirname, "VERSION"), "utf8").trim(); }
  catch (e) {
    try { return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || "1.2.0"; }
    catch (e2) { return "1.2.0"; }
  }
})();
// v3：可選站長密碼。未設定時沿用舊行為（任何人撳到入口都可改，站長工具會顯示警告）；
// 設定 OWNER_PASSWORD 後，所有寫入 API + 待審核清單 + 備份都要帶 X-Owner-Pin 標頭。
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "prompts.db");
const UPLOAD_DIR = path.join(ROOT, "public", "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cat TEXT NOT NULL DEFAULT '動畫',
    subjects TEXT NOT NULL DEFAULT '[]',
    tools TEXT NOT NULL DEFAULT '[]',
    tagline TEXT NOT NULL DEFAULT '',
    promptZh TEXT NOT NULL DEFAULT '',
    promptEn TEXT NOT NULL DEFAULT '',
    negative TEXT NOT NULL DEFAULT '',
    tip TEXT NOT NULL DEFAULT '',
    img TEXT NOT NULL DEFAULT '',
    orig TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    img TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

// ---------- v2 遷移：舊庫自動補 status 欄（live／pending，預設 live） ----------
try {
  const cols = db.prepare("PRAGMA table_info(prompts)").all();
  if (!cols.some((c) => c.name === "status")) {
    db.exec("ALTER TABLE prompts ADD COLUMN status TEXT NOT NULL DEFAULT 'live'");
    console.log("已為舊資料庫補加 status 欄，現有提示詞全部設為 live。");
  }
} catch (e) {
  console.log("補加 status 欄失敗（可能已存在）：" + e.message);
}

// ---------- 種子資料：第一次啟動、題庫為空時寫入 12 款 ----------
function seedIfEmpty() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM prompts").get();
  if (row.n > 0) return;
  const seedPath = path.join(ROOT, "seed.json");
  if (!fs.existsSync(seedPath)) {
    console.log("注意：搵唔到 seed.json，題庫會係空嘅，請用站長工具新增。");
    return;
  }
  let seed;
  try { seed = JSON.parse(fs.readFileSync(seedPath, "utf8")); }
  catch (e) { console.log("注意：seed.json 讀唔到（" + e.message + "），題庫會係空嘅，請用站長工具新增。"); return; }
  const now = new Date().toISOString();
  const ins = db.prepare(
    "INSERT INTO prompts (id,name,cat,subjects,tools,tagline,promptZh,promptEn,negative,tip,img,orig,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );
  const sharedOrig = "/images/seed/original.jpg";
  for (const s of seed) {
    ins.run(
      s.id, s.name, s.cat || "動畫",
      JSON.stringify(s.subjects || []), JSON.stringify(s.tools || []),
      s.tagline || "", s.promptZh || "", s.promptEn || "", s.negative || "", s.tip || "",
      s.img || "", s.orig || sharedOrig, s.status === "pending" ? "pending" : "live", now, now
    );
  }
  console.log(`已寫入種子題庫：${seed.length} 款風格。`);
}
seedIfEmpty();

// ---------- 小工具 ----------
function nowIso() { return new Date().toISOString(); }

function rowToPrompt(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, cat: r.cat,
    subjects: safeJson(r.subjects, []), tools: safeJson(r.tools, []),
    tagline: r.tagline, promptZh: r.promptZh, promptEn: r.promptEn,
    negative: r.negative, tip: r.tip, img: r.img, orig: r.orig,
    status: r.status || "live",
    created_at: r.created_at, updated_at: r.updated_at,
  };
}
function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}
function slugId(name) {
  return "p" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
}
function saveDataUrl(dataUrl, prefix) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return "";
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return "";
  // v3：唔接受 SVG（內含 script 風險），只接受 PNG／JPEG／WebP／GIF
  if (m[1] === "image/svg+xml") throw new Error("唔接受 SVG 圖片，請用 PNG／JPG／WebP。");
  const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : m[1] === "image/gif" ? "gif" : "jpg";
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) throw new Error("圖片太大（上限 8MB）。");
  const name = prefix + "-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return "/uploads/" + name;
}
// v3：刪除提示詞／換圖時，一併清走 public/uploads/ 入面嘅舊檔（淨係刪 /uploads/，唔郁種子圖）
function deleteUploadFile(url) {
  if (!url || typeof url !== "string" || !url.startsWith("/uploads/")) return;
  const name = path.basename(url);
  if (!name || name === ".gitkeep" || name.includes("..")) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch (e) { /* 檔已唔見，唔使理 */ }
}
function splitList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  // CSV 用 | 分隔，亦接受逗號、頓號
  return String(v || "").split(/[|,、]/).map((x) => x.trim()).filter(Boolean);
}
function normPrompt(body, isNew) {
  const b = body || {};
  const cap = (v, n) => String(v || "").trim().slice(0, n);
  return {
    id: (b.id || "").trim().slice(0, 80) || (isNew ? slugId() : ""),
    name: cap(b.name, 60),
    cat: (b.cat || "動畫").trim(),
    subjects: splitList(b.subjects),
    tools: splitList(b.tools),
    tagline: cap(b.tagline, 120),
    promptZh: cap(b.promptZh, 20000),
    promptEn: cap(b.promptEn, 20000),
    negative: cap(b.negative, 5000),
    tip: cap(b.tip, 200),
    img: (b.img || "").trim(),
    orig: (b.orig || "").trim(),
    status: b.status === "pending" ? "pending" : "live",
    imgData: b.imgData || "",
    origData: b.origData || "",
  };
}

// ---------- Express ----------
const app = express();
app.use(express.json({ limit: "15mb" }));
// v3：基本安全標頭（唔使加依賴）
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// v3：簡易限流（記憶體內，每 IP 計）— 防留言洗版、匯入濫用
const rateBuckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = (req.ip || "?") + ":" + req.path;
    const now = Date.now();
    let b = rateBuckets.get(key);
    if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; rateBuckets.set(key, b); }
    b.count++;
    if (b.count > max) return res.status(429).json({ error: "請求太密，請稍後再試。" });
    next();
  };
}
// v3：站長驗證中介層（未設 OWNER_PASSWORD 時直接放行，保持向後相容）
function ownerAuth(req, res, next) {
  if (!OWNER_PASSWORD) return next();
  if (req.headers["x-owner-pin"] === OWNER_PASSWORD) return next();
  return res.status(401).json({ error: "需要站長密碼。", needPin: true });
}
app.use(express.static(path.join(ROOT, "public")));

// ----- 提示詞 API -----
app.get("/api/prompts", (req, res) => {
  const q = (req.query.q || "").trim();
  const cat = (req.query.cat || "").trim();
  const tool = (req.query.tool || "").trim();
  const statusQ = (req.query.status || "live").trim(); // live（預設，前台只顯示 live）/ pending / all
  // v3：設咗站長密碼嗰陣，pending／all 清單要驗證，唔可以畀訪客直接拎走未上架內容
  if ((statusQ === "pending" || statusQ === "all") && OWNER_PASSWORD && req.headers["x-owner-pin"] !== OWNER_PASSWORD)
    return res.status(401).json({ error: "需要站長密碼。", needPin: true });
  let rows = db.prepare("SELECT * FROM prompts ORDER BY created_at ASC, id ASC").all();
  let list = rows.map(rowToPrompt);
  if (statusQ === "live" || statusQ === "pending") list = list.filter((p) => p.status === statusQ);
  if (cat && cat !== "全部") list = list.filter((p) => p.cat === cat);
  if (tool && tool !== "全部") list = list.filter((p) => p.tools.includes(tool));
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((p) =>
      [p.name, p.tagline, p.promptZh, p.promptEn, p.cat, ...p.tools, ...p.subjects]
        .join(" ").toLowerCase().includes(needle));
  }
  res.json(list);
});

app.get("/api/prompts/export", ownerAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM prompts ORDER BY created_at ASC, id ASC").all();
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="prompts-export-${d}.json"`);
  res.send(JSON.stringify(rows.map(rowToPrompt), null, 2));
});

// 待審核清單（等同 ?status=pending）
app.get("/api/prompts/pending", ownerAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM prompts WHERE status = 'pending' ORDER BY created_at ASC, id ASC").all();
  res.json(rows.map(rowToPrompt));
});

app.get("/api/prompts/:id", (req, res) => {
  const r = db.prepare("SELECT * FROM prompts WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "搵唔到呢款風格。" });
  // v3：待審核風格唔可以靠估網址直接睇到；站長工具會帶 ?status=all 拎
  // 設咗站長密碼嗰陣，?status=all 都要驗證
  if (req.query.status === "all" && OWNER_PASSWORD && req.headers["x-owner-pin"] !== OWNER_PASSWORD)
    return res.status(404).json({ error: "搵唔到呢款風格。" });
  if (r.status === "pending" && req.query.status !== "all")
    return res.status(404).json({ error: "搵唔到呢款風格。" });
  res.json(rowToPrompt(r));
});

app.post("/api/prompts", ownerAuth, (req, res) => {
  try {
    const p = normPrompt(req.body, true);
    if (!p.name) return res.status(400).json({ error: "請填風格名稱。" });
    if (!p.promptZh && !p.promptEn) return res.status(400).json({ error: "中文提示詞同英文提示詞最少要填一個。" });
    if (p.imgData) p.img = saveDataUrl(p.imgData, "img");
    if (p.origData) p.orig = saveDataUrl(p.origData, "orig");
    const now = nowIso();
    db.prepare(
      "INSERT INTO prompts (id,name,cat,subjects,tools,tagline,promptZh,promptEn,negative,tip,img,orig,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(p.id, p.name, p.cat, JSON.stringify(p.subjects), JSON.stringify(p.tools), p.tagline, p.promptZh, p.promptEn, p.negative, p.tip, p.img, p.orig, p.status, now, now);
    res.status(201).json(rowToPrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(p.id)));
  } catch (e) {
    res.status(400).json({ error: e.message || "新增失敗。" });
  }
});

app.put("/api/prompts/:id", ownerAuth, (req, res) => {
  try {
    const old = db.prepare("SELECT * FROM prompts WHERE id = ?").get(req.params.id);
    if (!old) return res.status(404).json({ error: "搵唔到呢款風格。" });
    const p = normPrompt(req.body, false);
    if (!p.name) return res.status(400).json({ error: "請填風格名稱。" });
    let img = p.img || old.img;
    let orig = p.orig || old.orig;
    // v3：換咗新圖，清走舊嘅上載檔，唔好留孤兒檔食空間
    if (p.imgData) { const ni = saveDataUrl(p.imgData, "img"); if (ni !== img) deleteUploadFile(img); img = ni; }
    if (p.origData) { const no = saveDataUrl(p.origData, "orig"); if (no !== orig) deleteUploadFile(orig); orig = no; }
    const status = (req.body && req.body.status) ? (p.status === "pending" ? "pending" : "live") : (old.status || "live");
    db.prepare(
      "UPDATE prompts SET name=?,cat=?,subjects=?,tools=?,tagline=?,promptZh=?,promptEn=?,negative=?,tip=?,img=?,orig=?,status=?,updated_at=? WHERE id=?"
    ).run(p.name, p.cat, JSON.stringify(p.subjects), JSON.stringify(p.tools), p.tagline, p.promptZh, p.promptEn, p.negative, p.tip, img, orig, status, nowIso(), req.params.id);
    res.json(rowToPrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(req.params.id)));
  } catch (e) {
    res.status(400).json({ error: e.message || "儲存失敗。" });
  }
});

app.delete("/api/prompts/:id", ownerAuth, (req, res) => {
  const old = db.prepare("SELECT * FROM prompts WHERE id = ?").get(req.params.id);
  if (!old) return res.status(404).json({ error: "搵唔到呢款風格。" });
  const info = db.prepare("DELETE FROM prompts WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "搵唔到呢款風格。" });
  deleteUploadFile(old.img);
  deleteUploadFile(old.orig);
  res.json({ ok: true });
});

// ---------- 匯入 v2：預覽／CSV／網址／待審核 ----------
// CSV 解析：支援引號、引號內逗號、換行、BOM
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((x) => x.trim() !== "")) rows.push(row); }
  return rows;
}
// v3：加埋 id／status／orig（選填），匯出再匯入可以保住原有編號同狀態
const CSV_HEADERS = ["id", "name", "cat", "promptZh", "promptEn", "negative", "tools", "subjects", "tagline", "tip", "img", "orig", "status"];
function csvToItems(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error("CSV 係空嘅，請檢查檔案。");
  const header = rows[0].map((h) => h.trim().replace(/^\ufeff/, ""));
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  if (!("name" in idx)) throw new Error("CSV 缺少 name 欄（第一行必須係欄位名：name、cat、promptZh、promptEn、negative、tools、subjects、tagline、tip、img）。");
  return rows.slice(1).map((r) => {
    const get = (k) => (k in idx ? (r[idx[k]] || "").trim() : "");
    return { id: get("id"), name: get("name"), cat: get("cat") || "動畫", promptZh: get("promptZh"), promptEn: get("promptEn"),
      negative: get("negative"), tools: get("tools"), subjects: get("subjects"),
      tagline: get("tagline"), tip: get("tip"), img: get("img"), orig: get("orig"), status: get("status") };
  });
}
function itemsFromBody(body) {
  // 支援：JSON 陣列 / {items:[...]} / {csv:"..."} / {text:"..."}（自動判斷 JSON 定 CSV）
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.items)) return body.items;
  const text = (body.csv || body.text || "").trim();
  if (!text) return null;
  return parseImportText(text);
}
// v3：擋內網／本機地址（SSRF），只准公開 http／https；跟隨跳轉最多 3 次，每次再驗地址
function isPublicHost(host) {
  const h = String(host || "").toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0" || h === "[::1]" || h === "::1") return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h.startsWith("169.254.") || h.startsWith("::ffff:127.") || h.startsWith("::ffff:10.") || h.startsWith("::ffff:192.168.")) return false;
  return true;
}
function parseImportText(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let parsed;
    try { parsed = JSON.parse(trimmed); }
    catch (e) { throw new Error("JSON 格式唔啱（" + e.message + "）。"); }
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.items)) return parsed.items;
    throw new Error("JSON 格式唔啱，要係提示詞嘅陣列。");
  }
  return csvToItems(text);
}
async function fetchUrlItems(url) {
  let u;
  try { u = new URL(url); } catch (e) { throw new Error("網址格式唔啱。"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("只支援 http／https 網址。");
  if (!isPublicHost(u.hostname)) throw new Error("唔可以抓內網／本機地址，只支援公開網址。");
  const MAX = 5 * 1024 * 1024;
  let current = u;
  for (let hop = 0; hop <= 3; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let r;
    try { r = await fetch(current.toString(), { signal: ctrl.signal, redirect: "manual", headers: { "User-Agent": "photo-prompt-import/3.0" } }); }
    catch (e) { throw new Error("抓唔到呢個網址（網絡錯誤或逾時 15 秒）。"); }
    finally { clearTimeout(timer); }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new Error("抓網址失敗（跳轉無目標）。");
      try { current = new URL(loc, current); } catch (e) { throw new Error("跳轉網址格式唔啱。"); }
      if (current.protocol !== "http:" && current.protocol !== "https:") throw new Error("只支援 http／https 網址。");
      if (!isPublicHost(current.hostname)) throw new Error("唔可以抓內網／本機地址，只支援公開網址。");
      continue;
    }
    if (!r.ok) throw new Error(`抓網址失敗（HTTP ${r.status}）。`);
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX) throw new Error("網址返嚟嘅檔案太大（上限 5MB）。");
    // 逐塊讀，超過 5MB 即停，唔好一次過讀晒入記憶體
    const reader = r.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX) { try { await reader.cancel(); } catch (e) {} throw new Error("網址返嚟嘅檔案太大（上限 5MB）。"); }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return parseImportText(text);
  }
  throw new Error("跳轉太多次（超過 3 次）。");
}
async function resolveImportItems(body) {
  if (body && body.url) return fetchUrlItems(String(body.url).trim());
  const items = itemsFromBody(body || {});
  if (!items) throw new Error("冇匯入內容：請揀檔案、貼上文字或貼網址。");
  if (!Array.isArray(items)) throw new Error("匯入格式唔啱，要係提示詞嘅 JSON 陣列或 CSV。");
  return items;
}
// 逐行分類（唔寫入）：add / update / skip / error
function classifyItems(items, overwrite) {
  const seenNames = new Set();
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    let p;
    try { p = normPrompt(raw, true); } catch (e) { rows.push({ index: i + 1, action: "error", name: (raw && raw.name) || "", reason: "格式錯誤" }); continue; }
    if (!p.name || (!p.promptZh && !p.promptEn)) {
      rows.push({ index: i + 1, action: "error", name: p.name || "", reason: "缺少名稱，或中文／英文提示詞兩個都冇" });
      continue;
    }
    const key = p.name.trim().toLowerCase();
    const byId = p.id ? db.prepare("SELECT id FROM prompts WHERE id = ?").get(p.id) : null;
    const byName = db.prepare("SELECT id FROM prompts WHERE lower(name) = ?").get(key);
    const exists = byId || byName;
    if (exists) {
      if (overwrite) rows.push({ index: i + 1, action: "update", name: p.name, id: exists.id, reason: "已存在，會覆蓋" });
      else rows.push({ index: i + 1, action: "skip", name: p.name, id: exists.id, reason: "已存在（相同名稱），會跳過" });
    } else if (seenNames.has(key)) {
      rows.push({ index: i + 1, action: "skip", name: p.name, reason: "呢批入面重複出現，會跳過" });
    } else {
      seenNames.add(key);
      rows.push({ index: i + 1, action: "add", name: p.name, reason: "新增" });
    }
  }
  const summary = { add: 0, update: 0, skip: 0, error: 0 };
  rows.forEach((r) => summary[r.action]++);
  return { total: items.length, rows, summary };
}
// 逐行寫入（一行錯唔會令成批失敗）
// status：指定就全部用呢個狀態；傳 null 就保留每項本身嘅 status（備份還原用）
function writeItems(items, overwrite, status) {
  const now = nowIso();
  let added = 0, updated = 0, skipped = 0;
  const errors = [];
  const seenNames = new Set();
  for (let i = 0; i < items.length; i++) {
    try {
      const p = normPrompt(items[i], true);
      if (!p.name || (!p.promptZh && !p.promptEn)) { skipped++; errors.push({ index: i + 1, name: p.name || "", reason: "缺少名稱，或中文／英文提示詞兩個都冇" }); continue; }
      const key = p.name.trim().toLowerCase();
      const byId = p.id ? db.prepare("SELECT id FROM prompts WHERE id = ?").get(p.id) : null;
      const byName = db.prepare("SELECT id FROM prompts WHERE lower(name) = ?").get(key);
      const exists = byId || byName;
      const itemStatus = status || p.status || "live";
      if (exists) {
        if (!overwrite) { skipped++; continue; }
        const oldRow = db.prepare("SELECT * FROM prompts WHERE id = ?").get(exists.id);
        const newImg = p.img || oldRow.img, newOrig = p.orig || oldRow.orig;
        db.prepare("UPDATE prompts SET name=?,cat=?,subjects=?,tools=?,tagline=?,promptZh=?,promptEn=?,negative=?,tip=?,img=?,orig=?,status=?,updated_at=? WHERE id=?")
          .run(p.name, p.cat, JSON.stringify(p.subjects), JSON.stringify(p.tools), p.tagline, p.promptZh, p.promptEn, p.negative, p.tip, newImg, newOrig, itemStatus, now, exists.id);
        if (p.img && p.img !== oldRow.img) deleteUploadFile(oldRow.img);
        if (p.orig && p.orig !== oldRow.orig) deleteUploadFile(oldRow.orig);
        updated++;
      } else if (seenNames.has(key)) { skipped++; continue; }
      else {
        seenNames.add(key);
        db.prepare("INSERT INTO prompts (id,name,cat,subjects,tools,tagline,promptZh,promptEn,negative,tip,img,orig,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(p.id, p.name, p.cat, JSON.stringify(p.subjects), JSON.stringify(p.tools), p.tagline, p.promptZh, p.promptEn, p.negative, p.tip, p.img, p.orig, itemStatus, now, now);
        added++;
      }
    } catch (e) {
      skipped++;
      errors.push({ index: i + 1, name: (items[i] && items[i].name) || "", reason: e.message || "寫入失敗" });
    }
  }
  return { ok: true, added, updated, skipped, errors };
}

// 舊版匯入（格式不變：JSON 陣列／{items}，按 id 去重，overwrite 選項）
app.post("/api/prompts/import", ownerAuth, rateLimit(20, 60 * 1000), (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body.items;
    if (!Array.isArray(items)) return res.status(400).json({ error: "匯入檔案格式唔啱，要係提示詞嘅 JSON 陣列。" });
    const overwrite = !!req.body.overwrite;
    const status = req.body.status === "pending" ? "pending" : "live";
    res.json(writeItems(items, overwrite, status));
  } catch (e) {
    res.status(400).json({ error: e.message || "匯入失敗。" });
  }
});

// v2 預覽：檔案／貼上／網址 → 分類表，唔寫入
app.post("/api/prompts/import/preview", ownerAuth, rateLimit(20, 60 * 1000), async (req, res) => {
  try {
    const items = await resolveImportItems(req.body || {});
    const overwrite = !!(req.body && req.body.overwrite);
    res.json({ ok: true, ...classifyItems(items, overwrite) });
  } catch (e) {
    res.status(400).json({ error: e.message || "預覽失敗。" });
  }
});

// v2 確認寫入：同預覽一樣嘅輸入，加 status（live 直接上架／pending 先放待審核）
app.post("/api/prompts/import/confirm", ownerAuth, rateLimit(20, 60 * 1000), async (req, res) => {
  try {
    const items = await resolveImportItems(req.body || {});
    const overwrite = !!(req.body && req.body.overwrite);
    const status = req.body && req.body.status === "pending" ? "pending" : "live";
    res.json(writeItems(items, overwrite, status));
  } catch (e) {
    res.status(400).json({ error: e.message || "匯入失敗。" });
  }
});

// 批准一項待審核 → live
app.post("/api/prompts/:id/approve", ownerAuth, (req, res) => {
  const info = db.prepare("UPDATE prompts SET status='live', updated_at=? WHERE id=? AND status='pending'").run(nowIso(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "搵唔到呢款待審核風格（可能已經批准或刪除）。" });
  res.json(rowToPrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(req.params.id)));
});

// ----- 留言 API -----
app.get("/api/messages", (req, res) => {
  // v3：預設最多返 100 則，?limit= 可改（上限 500），留言多咗唔會一次過塞爆頁面
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const rows = db.prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?").all(limit);
  res.json(rows);
});

app.post("/api/messages", rateLimit(10, 60 * 1000), (req, res) => {
  try {
    const b = req.body || {};
    const content = String(b.content || "").trim().slice(0, 2000);
    if (!content) return res.status(400).json({ error: "請填寫留言內容。" });
    let img = "";
    if (b.imgData) img = saveDataUrl(b.imgData, "msg");
    const info = db.prepare("INSERT INTO messages (name,content,img,created_at) VALUES (?,?,?,?)")
      .run(String(b.name || "").trim().slice(0, 30), content, img, nowIso());
    res.status(201).json(db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message || "留言失敗。" });
  }
});

app.delete("/api/messages/:id", ownerAuth, (req, res) => {
  const old = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.id);
  if (!old) return res.status(404).json({ error: "搵唔到呢則留言。" });
  const info = db.prepare("DELETE FROM messages WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "搵唔到呢則留言。" });
  deleteUploadFile(old.img);
  res.json({ ok: true });
});

// ---------- v3：完整備份／還原（提示詞 + 留言） ----------
// 注意：備份 JSON 唔包括圖片檔本身，上載圖片要另外複製 public/uploads/ 先算完整備份。
app.get("/api/backup", ownerAuth, (req, res) => {
  const prompts = db.prepare("SELECT * FROM prompts ORDER BY created_at ASC, id ASC").all().map(rowToPrompt);
  const messages = db.prepare("SELECT * FROM messages ORDER BY id ASC").all();
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="photo-prompt-backup-${d}.json"`);
  res.send(JSON.stringify({ version: VERSION, exported_at: new Date().toISOString(), prompts, messages }, null, 2));
});
app.post("/api/backup/restore", ownerAuth, rateLimit(10, 60 * 1000), (req, res) => {
  try {
    const body = req.body || {};
    const promptItems = Array.isArray(body.prompts) ? body.prompts : (Array.isArray(body.items) ? body.items : null);
    const overwrite = !!body.overwrite;
    const result = { ok: true, prompts: null, messagesAdded: 0, messagesSkipped: 0, errors: [] };
    if (promptItems) result.prompts = writeItems(promptItems, overwrite, null);
    if (Array.isArray(body.messages)) {
      const now = nowIso();
      for (const m of body.messages) {
        const content = String((m && m.content) || "").trim().slice(0, 2000);
        if (!content) { result.messagesSkipped++; continue; }
        const created = (m && m.created_at) || now;
        const dup = db.prepare("SELECT id FROM messages WHERE content = ? AND created_at = ?").get(content, created);
        if (dup) { result.messagesSkipped++; continue; }
        db.prepare("INSERT INTO messages (name,content,img,created_at) VALUES (?,?,?,?)")
          .run(String((m && m.name) || "").trim().slice(0, 30), content, String((m && m.img) || ""), created);
        result.messagesAdded++;
      }
    }
    if (!promptItems && !Array.isArray(body.messages))
      return res.status(400).json({ error: "備份檔格式唔啱，要有 prompts 或 messages。" });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message || "還原失敗。" });
  }
});

// ----- 其他 -----
app.get("/api/health", (req, res) => {
  const n = db.prepare("SELECT COUNT(*) AS n FROM prompts").get().n;
  const m = db.prepare("SELECT COUNT(*) AS n FROM messages").get().n;
  const pend = db.prepare("SELECT COUNT(*) AS n FROM prompts WHERE status='pending'").get().n;
  res.json({ ok: true, version: VERSION, prompts: n, pending: pend, messages: m,
    uptime: Math.floor(process.uptime()), ownerAuth: !!OWNER_PASSWORD, db: "data/prompts.db" });
});

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));

app.listen(PORT, () => {
  const n = db.prepare("SELECT COUNT(*) AS n FROM prompts").get().n;
  console.log(`照片提示詞網站 v${VERSION} 已啟動：http://localhost:${PORT}`);
  console.log(`題庫現有 ${n} 款風格，資料庫：${DB_PATH}`);
  console.log("按 Ctrl+C 停止伺服器。");
});
