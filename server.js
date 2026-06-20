/**
 * Railway Coordinator Server
 * - Giao diện web để cập nhật JobID (có đăng nhập mật khẩu)
 * - Phân phối JobID tuần tự không trùng lặp cho nhiều client Lua
 */

const express = require("express");
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Config ───────────────────────────────────────────────────────────────────
const API_KEY   = process.env.API_KEY || "admin123"; // Đặt biến môi trường API_KEY trên Railway
const DATA_DIR  = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, "data.json");

// ─── Persistent storage ───────────────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (Array.isArray(parsed.servers)) {
        console.log(`📂 [LOAD] Đọc ${parsed.servers.length} server từ file`);
        return parsed;
      }
    }
  } catch (err) {
    console.error("❌ [LOAD] Lỗi đọc data.json:", err.message);
  }
  return { servers: [] };
}

function saveData(servers) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ servers }, null, 2), "utf8");
    console.log(`💾 [SAVE] Đã lưu ${servers.length} server`);
  } catch (err) {
    console.error("❌ [SAVE] Lỗi ghi data.json:", err.message);
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
let serverList    = loadData().servers;
let globalCounter = 0;
let skippedSet    = new Set();

function getNextValidIndex() {
  if (serverList.length === 0) return null;
  const activeCount = serverList.filter((id) => !skippedSet.has(id)).length;
  if (activeCount === 0) {
    console.log("[RESET] Hết vòng, reset skip set.");
    skippedSet.clear();
  }
  const total = serverList.length;
  for (let i = 0; i < total; i++) {
    const idx = (globalCounter + i) % total;
    const id  = serverList[idx];
    if (!skippedSet.has(id)) {
      globalCounter = (idx + 1) % total;
      return { index: idx, jobId: id };
    }
  }
  return null;
}

// ─── Middleware xác thực API Key (cho Lua client) ─────────────────────────────
function apiAuth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─── Giao diện Web ───────────────────────────────────────────────────────────

// Trang login
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Merchant Coordinator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 40px;
      width: 360px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    h1 { font-size: 20px; margin-bottom: 8px; color: #fff; }
    p  { font-size: 13px; color: #888; margin-bottom: 28px; }
    label { font-size: 13px; color: #aaa; display: block; margin-bottom: 6px; }
    input[type=password] {
      width: 100%;
      padding: 10px 14px;
      background: #111;
      border: 1px solid #444;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: border 0.2s;
    }
    input[type=password]:focus { border-color: #4f8ef7; }
    button {
      width: 100%;
      margin-top: 18px;
      padding: 11px;
      background: #4f8ef7;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #3a7ae0; }
    .error {
      margin-top: 14px;
      padding: 10px 14px;
      background: #2a1010;
      border: 1px solid #c0392b;
      border-radius: 8px;
      color: #e74c3c;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Merchant Coordinator</h1>
    <p>Đăng nhập để quản lý danh sách JobID</p>
    <form method="POST" action="/login">
      <label>Mật khẩu</label>
      <input type="password" name="password" placeholder="Nhập mật khẩu..." autofocus>
      <button type="submit">Đăng nhập</button>
    </form>
    ${req.query.err ? '<div class="error">❌ Mật khẩu không đúng!</div>' : ""}
  </div>
</body>
</html>`);
});

// Xử lý login — dùng redirect đơn giản với key trên URL (stateless)
app.post("/login", (req, res) => {
  const { password } = req.body;
  if (password !== API_KEY) {
    return res.redirect("/?err=1");
  }
  res.redirect("/dashboard?key=" + encodeURIComponent(API_KEY));
});

// Trang dashboard quản lý JobID
app.get("/dashboard", (req, res) => {
  const key = req.query.key;
  if (key !== API_KEY) return res.redirect("/");

  const total      = serverList.length;
  const skipCount  = skippedSet.size;
  const activeCount = total - serverList.filter(id => skippedSet.has(id)).length;

  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - Merchant Coordinator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      padding: 32px 16px;
    }
    .container { max-width: 700px; margin: 0 auto; }
    h1 { font-size: 22px; color: #fff; margin-bottom: 6px; }
    .sub { color: #666; font-size: 13px; margin-bottom: 28px; }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }
    .stat {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }
    .stat .num { font-size: 28px; font-weight: 700; color: #4f8ef7; }
    .stat .lbl { font-size: 12px; color: #666; margin-top: 4px; }

    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .card h2 { font-size: 15px; color: #fff; margin-bottom: 6px; }
    .card p  { font-size: 12px; color: #666; margin-bottom: 14px; }

    textarea {
      width: 100%;
      height: 220px;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 13px;
      font-family: monospace;
      padding: 12px;
      outline: none;
      resize: vertical;
      transition: border 0.2s;
    }
    textarea:focus { border-color: #4f8ef7; }

    .actions { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    button {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-primary { background: #4f8ef7; color: #fff; }
    .btn-primary:hover { background: #3a7ae0; }
    .btn-danger  { background: #c0392b; color: #fff; }
    .btn-danger:hover  { background: #a93226; }
    .btn-secondary { background: #2a2a2a; color: #aaa; border: 1px solid #444; }
    .btn-secondary:hover { background: #333; }

    .toast {
      display: none;
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #27ae60;
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      z-index: 999;
    }
    .toast.err { background: #c0392b; }

    .current-list {
      font-family: monospace;
      font-size: 12px;
      color: #888;
      background: #111;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 12px;
      max-height: 160px;
      overflow-y: auto;
      line-height: 1.8;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📦 Merchant Coordinator</h1>
    <div class="sub">Quản lý danh sách JobID server</div>

    <div class="stats">
      <div class="stat">
        <div class="num" id="stat-total">${total}</div>
        <div class="lbl">Tổng JobID</div>
      </div>
      <div class="stat">
        <div class="num" id="stat-active" style="color:#27ae60">${activeCount}</div>
        <div class="lbl">Đang hoạt động</div>
      </div>
      <div class="stat">
        <div class="num" id="stat-skip" style="color:#e67e22">${skipCount}</div>
        <div class="lbl">Đã skip (có NPC)</div>
      </div>
    </div>

    <div class="card">
      <h2>📝 Cập nhật danh sách JobID</h2>
      <p>Mỗi dòng 1 JobID — khi lưu sẽ <strong style="color:#e74c3c">thay thế hoàn toàn</strong> danh sách cũ và reset counter</p>
      <textarea id="jobInput" placeholder="Dán JobID vào đây, mỗi dòng 1 ID&#10;Ví dụ:&#10;98a8a07d-d2a0-4b59-b048-36def963cbc6&#10;862eb531-8985-49d9-8dcd-9ffcc112fe56"></textarea>
      <div class="actions">
        <button class="btn-primary" onclick="updateServers()">💾 Lưu & thay thế</button>
        <button class="btn-secondary" onclick="loadCurrent()">📋 Xem list hiện tại</button>
        <button class="btn-danger" onclick="resetCounter()">🔄 Reset counter</button>
      </div>
    </div>

    <div class="card" id="currentCard" style="display:none">
      <h2>📋 Danh sách JobID hiện tại</h2>
      <p id="currentMeta"></p>
      <div class="current-list" id="currentList"></div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const KEY = "${API_KEY}";

    function showToast(msg, isErr) {
      const t = document.getElementById("toast");
      t.textContent = msg;
      t.className = "toast" + (isErr ? " err" : "");
      t.style.display = "block";
      setTimeout(() => t.style.display = "none", 3000);
    }

    async function updateServers() {
      const raw = document.getElementById("jobInput").value.trim();
      if (!raw) return showToast("❌ Chưa nhập JobID!", true);

      const servers = raw.split("\\n")
        .map(s => s.trim())
        .filter(s => s.length > 0);

      if (servers.length === 0) return showToast("❌ Không có JobID hợp lệ!", true);

      const res = await fetch("/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": KEY },
        body: JSON.stringify({ servers })
      });
      const data = await res.json();

      if (res.ok) {
        showToast("✅ Đã cập nhật " + data.total + " JobID!");
        document.getElementById("stat-total").textContent  = data.total;
        document.getElementById("stat-active").textContent = data.total;
        document.getElementById("stat-skip").textContent   = 0;
        document.getElementById("jobInput").value = "";
        document.getElementById("currentCard").style.display = "none";
      } else {
        showToast("❌ " + (data.error || "Lỗi không xác định"), true);
      }
    }

    async function loadCurrent() {
      const res  = await fetch("/servers?key=" + KEY);
      const data = await res.json();
      const card = document.getElementById("currentCard");
      document.getElementById("currentMeta").textContent =
        "Tổng " + data.total + " JobID | Counter: " + data.counter;
      document.getElementById("currentList").innerHTML =
        data.servers.map((id, i) => \`<span style="color:#555">\${i+1}.</span> \${id}\`).join("<br>");
      card.style.display = "block";
    }

    async function resetCounter() {
      if (!confirm("Reset counter và skip set?")) return;
      const res = await fetch("/reset?key=" + KEY, { method: "POST" });
      if (res.ok) {
        showToast("✅ Đã reset counter và skip set!");
        document.getElementById("stat-skip").textContent = 0;
      }
    }
  </script>
</body>
</html>`);
});

// ─── API cho Lua client ───────────────────────────────────────────────────────

app.get("/claim", apiAuth, (req, res) => {
  const result = getNextValidIndex();
  if (!result) return res.status(503).json({ error: "Danh sách server trống!" });
  console.log(`[CLAIM] [${result.index + 1}/${serverList.length}]: ${result.jobId}`);
  res.json({ jobId: result.jobId, index: result.index + 1, total: serverList.length });
});

app.get("/servers", apiAuth, (req, res) => {
  res.json({ servers: serverList, total: serverList.length, counter: globalCounter });
});

app.post("/servers", apiAuth, (req, res) => {
  const { servers } = req.body;
  if (!Array.isArray(servers) || servers.length === 0) {
    return res.status(400).json({ error: 'Body phải có dạng: { "servers": [...] }' });
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalid   = servers.filter((s) => !uuidRegex.test(s));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `${invalid.length} JobID không đúng UUID`, examples: invalid.slice(0, 3) });
  }
  serverList    = [...new Set(servers)];
  globalCounter = 0;
  skippedSet.clear();
  saveData(serverList);
  res.json({ success: true, total: serverList.length });
});

app.post("/skip/:jobId", apiAuth, (req, res) => {
  skippedSet.add(req.params.jobId);
  res.json({ success: true, skipped: req.params.jobId, skipCount: skippedSet.size, total: serverList.length });
});

app.get("/status", apiAuth, (req, res) => {
  res.json({
    total:       serverList.length,
    counter:     globalCounter,
    skipCount:   skippedSet.size,
    activeCount: serverList.filter((id) => !skippedSet.has(id)).length,
  });
});

app.post("/reset", apiAuth, (req, res) => {
  globalCounter = 0;
  skippedSet.clear();
  res.json({ success: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server chạy trên port ${PORT}`);
  console.log(`📋 Tổng JobID: ${serverList.length}`);
  console.log(`🔑 API Key: ${API_KEY}`);
});
