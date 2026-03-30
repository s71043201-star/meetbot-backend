const express = require("express");
const axios   = require("axios");
const ExcelJS = require("exceljs");
const https   = require("https");
const path    = require("path");
const zlib    = require("zlib");
const fs      = require("fs");
// 課程記錄暫存（記憶體，不限期）
const docStore = new Map();
function storeDoc(html, fileName) {
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2);
  docStore.set(uid, { html, fileName });
  return uid;
}

function generateRecordHtml(data) {
  const row = (label, value) =>
    `<tr><th>${label}</th><td>${value || "-"}</td></tr>`;
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>課程記錄 - ${data.name}</title>
<style>
  body{font-family:"Noto Sans TC",sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#333}
  h1{font-size:18px;text-align:center;margin-bottom:4px}
  h2{font-size:14px;text-align:center;color:#555;margin-bottom:24px;font-weight:normal}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #ccc;padding:10px 14px;font-size:14px}
  th{background:#f0f4f9;width:35%;font-weight:600;text-align:left}
  td{text-align:left}
  .print-btn{display:block;margin:24px auto;padding:10px 28px;background:#1a73e8;color:#fff;border:none;border-radius:4px;font-size:15px;cursor:pointer}
  @media print{.print-btn{display:none}}
</style></head><body>
<h1>台北市醫師公會健康台灣深耕計畫</h1>
<h2>臺北市慢性病防治全人健康智慧整合照護計畫・處方課程開課紀錄表</h2>
<table>
  ${row("填表人", data.name)}
  ${row("課程日期", data.date)}
  ${row("課程開始時間", data.checkinStr)}
  ${row("課程結束時間", data.checkoutStr)}
  ${row("課程預計時數", data.plannedHours)}
  ${row("實際工作時數", data.hours + " 小時")}
  ${row("課程屬性", data.courseType)}
  ${row("課程名稱", data.course)}
  ${row("課程老師", data.teacher)}
  ${row("系統報名人數", data.registeredCount ?? "-")}
  ${row("線上報名實到人數", data.actualCount ?? "-")}
  ${row("無報名現場候補人數", data.walkInCount ?? "-")}
  ${row("簡述上課內容或回報狀況", data.summary)}
</table>
<button class="print-btn" onclick="window.print()">列印 / 另存 PDF</button>
</body></html>`;
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── CORS ──────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── 常數 ──────────────────────────────────────
const TOKEN = process.env.LINE_TOKEN;
const TEAM  = ["黃琴茹","蔡蕙芳","吳承儒","張鈺微","吳亞璇","許雅淇","戴豐逸","陳佩研"];

const MEMBERS = {
  "黃琴茹": "U858b6b722d9a01e1a927d07f8ffc65ed",
  "蔡蕙芳": "Uc05e7076d830f4f75ecc14a07b697e5c",
  "吳承儒": "U1307dd217e15b4ef777f8f0561c2e589",
  "張鈺微": "U7c71775e251051b61994eda22ddc2bec",
  "吳亞璇": "Ue69dbd040159f69636c08dfd9568aa63",
  "許雅淇": "U87efc2433f2ab838929cbfbdb2851748",
  "戴豐逸": "Uece4baaf97cfab39ad79c6ed0ee55d03",
  "陳佩研": "Uc8e074d50b3b20581945f5c6aca80d1d",
};

const ID_TO_NAME = Object.fromEntries(Object.entries(MEMBERS).map(([k, v]) => [v, k]));

const BOSS_IDS = [
  "Uc05e7076d830f4f75ecc14a07b697e5c", // 蔡蕙芳
  "Uece4baaf97cfab39ad79c6ed0ee55d03", // 戴豐逸
];

// 臨時人員系統：陳佩研、戴豐逸
const SYSTEMS = {
  "週報":     { name: "週報統計系統",             url: "https://s71043201-star.github.io/tpma-statistics/" },
  "會議":     { name: "meetbot 會議任務追蹤系統",  url: "https://s71043201-star.github.io/meetbot-app/" },
  "歷次列管": { name: "會議歷次列管事項生成系統",  url: "https://s71043201-star.github.io/meeting-system/" },
  "簽到":     { name: "臨時人員簽到系統",          url: "https://meetbot-check-in-system.onrender.com/checkin.html" },
  "後台":     { name: "出缺勤後台管理",            url: "https://meetbot-check-in-system.onrender.com/admin.html" },
};

const ATT_BOSS_IDS = [
  "Uc8e074d50b3b20581945f5c6aca80d1d",
  "Uece4baaf97cfab39ad79c6ed0ee55d03",
];
// 測試中：暫時只通知戴豐逸，測試完畢後再加回陳佩研
const ATT_NOTIFY_IDS = [
  "Uece4baaf97cfab39ad79c6ed0ee55d03", // 戴豐逸
];

const TASKS_FB = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/tasks.json";
const ATT_FB   = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/attendance";
const MEETINGS_FB = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/meetings";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const SLACK_MEMBERS = {
  "許雅淇": "U0AEEJQNG2G",
  "蔡蕙芳": "U0AEV9KQ9D1",
  "張鈺微": "U0AE4K3EAQ3",
  "吳承儒": "U0AE8UE5HFG",
  "吳亞璇": "U0AE4HWF4RH",
  "黃琴茹": "U0AEEHXHDSQ",
  "陳佩研": "U0ADVGJG0MV",
  "彭琦雅": "U0AJRNSRE04",
  "戴豐逸": "U0AE8UA3RU6",
};

// ── 工具函式 ──────────────────────────────────
function slackMention(name) {
  const id = SLACK_MEMBERS[name];
  return id ? `<@${id}>` : name;
}

async function sendSlack(text) {
  if (!SLACK_WEBHOOK_URL) return;
  await axios.post(SLACK_WEBHOOK_URL, { text }).catch(e => console.error("Slack 發送失敗:", e.message));
}

async function sendLine(userId, message) {
  if (!userId || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

async function sendLineWithQuickReply(userId, message, quickItems) {
  if (!userId || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message, quickReply: { items: quickItems } }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

async function replyLine(replyToken, message) {
  if (!replyToken || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages: [{ type: "text", text: message }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

async function replyLineWithQuickReply(replyToken, message, quickItems) {
  if (!replyToken || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages: [{ type: "text", text: message, quickReply: { items: quickItems } }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

async function replyLineMulti(replyToken, messages) {
  if (!replyToken || !TOKEN) return;
  await axios.post("https://api.line.me/v2/bot/message/reply", {
    replyToken,
    messages
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

function daysLeft(deadline) {
  const today = new Date().toISOString().slice(0, 10);
  return Math.ceil((new Date(deadline) - new Date(today)) / 86400000);
}

function toTaipei(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function toROCYear(date) {
  return date.getFullYear() - 1911;
}

// ── Firebase：任務 ─────────────────────────────
async function fetchTasksFromFirebase() {
  return new Promise((resolve) => {
    https.get(TASKS_FB, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const obj = JSON.parse(data);
          resolve(obj ? Object.values(obj) : []);
        } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

// ── Firebase：出缺勤 ──────────────────────────
async function fbGet(subPath) {
  const { data } = await axios.get(`${ATT_FB}${subPath || ""}.json`);
  return data;
}
async function fbPost(record) {
  const { data } = await axios.post(`${ATT_FB}.json`, record);
  return data;
}
async function fbPut(subPath, record) {
  const { data } = await axios.put(`${ATT_FB}${subPath}.json`, record);
  return data;
}

async function fetchAttendance() {
  return new Promise((resolve) => {
    https.get(`${ATT_FB}.json`, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const obj = JSON.parse(data);
          resolve(obj ? Object.values(obj) : []);
        } catch { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

function buildAttendanceReport(records, month) {
  const filtered = records.filter(r => r.month === month && r.status === "checked-out");
  if (filtered.length === 0) return `📭 ${month} 月無臨時人員出勤記錄`;

  const byName = {};
  filtered.forEach(r => {
    if (!byName[r.name]) byName[r.name] = { count: 0, hours: 0, list: [] };
    byName[r.name].count++;
    byName[r.name].hours += r.hours || 0;
    byName[r.name].list.push(r);
  });

  const total = filtered.reduce((s, r) => s + (r.hours || 0), 0);
  let msg = `📊 ${month} 月臨時人員出勤記錄\n${"═".repeat(22)}\n`;
  msg += `出勤人次：${filtered.length} 筆　總時數：${Math.round(total * 10) / 10} 小時\n${"─".repeat(22)}\n`;

  Object.entries(byName).forEach(([name, info]) => {
    msg += `\n👤 ${name}　出勤 ${info.count} 次　合計 ${Math.round(info.hours * 10) / 10} 時\n`;
    info.list.sort((a, b) => a.day - b.day).forEach(r => {
      msg += `   • ${month}/${r.day}（${r.course}）${r.hours} 時\n`;
    });
  });

  return msg.trim();
}

// ── webhook 診斷紀錄 ──────────────────────────
let lastWebhook = null;
app.get("/debug-webhook", (req, res) => {
  res.json(lastWebhook || { message: "尚未收到任何 webhook" });
});

// ══════════════════════════════════════════════
// MeetBot Webhook
// ══════════════════════════════════════════════
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  lastWebhook = { time: new Date().toISOString(), body: req.body };
  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;
    const userId     = event.source.userId;
    const text       = event.message.text.trim();
    const replyToken = event.replyToken;
    console.log(`👤 ${userId} 說：${text}`);

    // ── 指令說明 ──
    if (["指令", "說明", "help", "Help", "?", "？"].includes(text)) {
      const isBoss = BOSS_IDS.includes(userId);
      const isAttBoss = ATT_BOSS_IDS.includes(userId);
      const sysLines = Object.entries(SYSTEMS)
        .filter(([kw]) => !['後台','簽到'].includes(kw) || isAttBoss)
        .map(([kw, s]) => `• ${kw} — ${s.name}`).join("\n");
      let msg = `📋 MeetBot 可用指令\n${"═".repeat(20)}\n\n👤 個人功能\n• 工作 — 查看我的待辦任務\n\n🖥 系統連結（輸入關鍵字取得網址）\n${sysLines}`;
      if (isBoss) msg += `\n\n🔑 管理員功能\n• 進度 — 查看全團隊任務進度\n• 下載 — 下載任務進度報告（PDF）\n• 臨時人員 3 — 查看某月出勤記錄\n• 提醒 姓名 — 向指定成員發出工作提醒`;
      await replyLine(replyToken, msg);
      continue;
    }

    // ── 系統網址 ──
    if (SYSTEMS[text]) {
      const s = SYSTEMS[text];
      const restricted = ['後台', '簽到'].includes(text);
      if (restricted && !ATT_BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, `❌ 此功能僅限管理員與佩研使用\n\n你可以使用：\n• 工作 — 查看我的待辦任務\n• 會議 — 會議任務系統\n• 週報 — 週報統計系統\n• 歷次列管 — 會議列管事項系統`);
      } else if (text === "簽到") {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(s.url)}`;
        await replyLineMulti(replyToken, [
          { type: "text", text: `🖥 ${s.name}\n\n🔗 ${s.url}` },
          { type: "image", originalContentUrl: qrUrl, previewImageUrl: qrUrl }
        ]);
      } else {
        await replyLine(replyToken, `🖥 ${s.name}\n\n🔗 ${s.url}`);
      }
      continue;
    }

    // ── 提醒（圖文選單按鈕，無姓名 → 快速選人） ──
    if (text === "提醒") {
      if (!BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "❌ 此功能僅限管理員使用");
        continue;
      }
      const senderName  = ID_TO_NAME[userId] || "";
      const targets     = TEAM.filter(n => n !== senderName);
      const quickItems  = targets.map(name => ({
        type: "action",
        action: { type: "message", label: name, text: `提醒 ${name}` }
      }));
      await replyLineWithQuickReply(replyToken, "請選擇要提醒的成員：", quickItems);
      continue;
    }

    // ── 提醒指定成員（蔡蕙芳/戴豐逸，含姓名） ──
    const remindMatch = text.match(/^提醒\s*(.+)$/);
    if (remindMatch) {
      if (!BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "❌ 此功能僅限管理員使用");
        continue;
      }
      const targetName = remindMatch[1].trim();
      const targetId   = MEMBERS[targetName];
      if (!targetId) {
        await replyLine(replyToken, `❌ 找不到成員「${targetName}」`);
        continue;
      }
      const remindMsg = `📌 工作進度提醒\n\n蔡蕙芳 希望你查看今日工作進度，並在系統中勾選已完成的任務。\n\n🔗 meetbot 系統：https://s71043201-star.github.io/meetbot-app/`;
      await sendLine(targetId, remindMsg).catch(() => {});
      await sendSlack(`📌 工作進度提醒\n\n${slackMention(targetName)} 請查看今日工作進度，並在系統中勾選已完成的任務。\n\n🔗 meetbot 系統：https://s71043201-star.github.io/meetbot-app/`);
      await replyLine(replyToken, `✅ 已向 ${targetName} 發出提醒`);
      continue;
    }

    // ── 臨時人員 ──
    if (text === "臨時人員") {
      if (!ATT_BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "❌ 此功能僅限管理員使用");
        continue;
      }
      const monthItems = Array.from({ length: 12 }, (_, i) => ({
        type: "action",
        action: { type: "message", label: `${i + 1}月`, text: `臨時人員 ${i + 1}` }
      }));
      await replyLineWithQuickReply(replyToken, "📋 臨時人員查詢\n\n請選擇要查詢的月份：", monthItems);
      continue;
    }

    const tempMatch = text.match(/^臨時人員\s*(\d+)月?$/);
    if (tempMatch) {
      if (!ATT_BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "❌ 此功能僅限管理員使用");
        continue;
      }
      const month   = parseInt(tempMatch[1]);
      const records = await fetchAttendance();
      await replyLine(replyToken, buildAttendanceReport(records, month));
      continue;
    }

    // ── 下載 → 推送 PDF 報告連結（蔡蕙芳/戴豐逸）──
    if (text === "下載") {
      if (!BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "❌ 此功能僅限管理員使用");
        continue;
      }
      await replyLine(replyToken,
        `📄 MeetBot 任務報告 PDF\n\n` +
        `點以下連結開啟報告，再點「另存 PDF」即可下載：\n\n` +
        `https://meetbot-backend.onrender.com/export-pdf\n\n` +
        `⚠️ 初次載入可能需稍等 10 秒（冷啟動）`
      );
      continue;
    }

    // ── 工作 ──
    if (text === "工作") {
      const name = ID_TO_NAME[userId];
      if (!name) { await replyLine(replyToken, "❌ 找不到你的帳號，請聯絡管理員"); continue; }
      const tasks = await fetchTasksFromFirebase();
      const mine  = tasks.filter(t => t.assignee === name && !t.done);
      if (mine.length === 0) {
        await replyLine(replyToken, `✅ ${name}，你目前沒有待辦任務！繼續保持 💪`);
      } else {
        const lines = mine.map((t, i) => {
          const d = daysLeft(t.deadline);
          const tag = d < 0 ? "🚨 逾期" : d === 0 ? "⚡ 今天截止" : d <= 2 ? `⏰ 剩 ${d} 天` : `📅 ${t.deadline}`;
          return `${i+1}. ${t.title}\n   ${tag}`;
        }).join("\n\n");
        await replyLine(replyToken, `📋 ${name} 的待辦任務（共 ${mine.length} 項）\n\n${lines}\n\n請在期限前完成 ✓`);
      }
      continue;
    }

    // ── 進度 ──
    if (text === "進度") {
      if (!BOSS_IDS.includes(userId)) {
        await replyLine(replyToken, "❌ 此功能僅限管理員使用");
        continue;
      }
      const tasks   = await fetchTasksFromFirebase();
      const total   = tasks.length;
      const done    = tasks.filter(t => t.done).length;
      const overdue = tasks.filter(t => !t.done && daysLeft(t.deadline) < 0).length;
      const pct     = total ? Math.round(done / total * 100) : 0;

      const memberLines = TEAM.map(name => {
        const mine      = tasks.filter(t => t.assignee === name);
        const mDone     = mine.filter(t => t.done).length;
        const pending   = mine.filter(t => !t.done);
        const doneList  = mine.filter(t => t.done);
        let lines = `👤 ${name}（${mDone}/${mine.length} 完成）`;
        if (pending.length > 0) {
          lines += "\n📌 待辦：";
          pending.forEach(t => {
            const d = daysLeft(t.deadline);
            const tag = d < 0 ? `🚨逾期${Math.abs(d)}天` : d === 0 ? "⚡今天截止" : d <= 2 ? `⏰剩${d}天` : `📅${t.deadline}`;
            lines += `\n  • ${t.title}\n    ${tag}`;
          });
        }
        if (doneList.length > 0) {
          lines += "\n✅ 已完成：";
          doneList.forEach(t => { lines += `\n  • ${t.title}`; });
        }
        if (mine.length === 0) lines += "\n  （尚無指派任務）";
        return lines;
      }).join("\n\n" + "─".repeat(18) + "\n\n");

      await replyLine(replyToken,
        `📊 全團隊任務進度報告\n${"═".repeat(20)}\n整體完成率：${pct}%（${done}/${total}）\n逾期任務：${overdue} 項\n${"═".repeat(20)}\n\n${memberLines}\n\n⏰ ${new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}`
      );
      continue;
    }
  }
});

// ── AI 解析會議記錄 ────────────────────────────
app.post("/parse-meeting", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "缺少 text" });
  const today_str = new Date().toISOString().slice(0, 10);
  try {
    const response = await axios.post("https://api.anthropic.com/v1/messages", {
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{ role: "user", content: `你是會議記錄分析助理。從以下會議紀錄中，找出所有「任務/行動項目」。\n每個任務需包含：負責人、任務描述、截止日期。今天是 ${today_str}。\n若日期只說「本週五」請換算成實際日期。若無法確定截止日期，設定為 7 天後。\n負責人請從以下名單選最接近的：${TEAM.join("、")}。若無法對應，填「待指派」。\n\n請只回傳 JSON 陣列，格式如下，不要有任何說明文字：\n[{"title":"任務描述","assignee":"負責人","deadline":"YYYY-MM-DD"}]\n\n會議紀錄：\n${text}` }]
    }, { headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } });
    const raw   = response.data.content?.find(b => b.type === "text")?.text || "[]";
    const items = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 任務提醒 ──────────────────────────────────
app.post("/check-reminders", async (req, res) => {
  const { tasks, reminders } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "缺少參數" });
  const hour = new Date().getHours();
  let sent = 0;
  const slackByPerson = {};
  for (const task of tasks) {
    if (task.done) continue;
    const dl     = daysLeft(task.deadline);
    const userId = MEMBERS[task.assignee];
    if (!userId) continue;
    if (reminders.dayBefore?.on && dl === reminders.dayBefore.days && hour === reminders.dayBefore.hour) {
      await sendLine(userId, `📋 任務提醒 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n截止日期：${task.deadline}（剩 ${dl} 天）\n\n請記得完成 ✓`).catch(() => {});
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push(`📋 「${task.title}」— 截止：${task.deadline}（剩 ${dl} 天）`);
      sent++;
    }
    if (reminders.hourBefore?.on && dl === 0 && hour === (23 - reminders.hourBefore.hours)) {
      await sendLine(userId, `⚡ 緊急提醒 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n今天截止！剩約 ${reminders.hourBefore.hours} 小時\n\n請盡快完成 🔥`).catch(() => {});
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push(`⚡ 「${task.title}」— 今天截止！`);
      sent++;
    }
    if (reminders.overdueAlert?.on && dl < 0) {
      await sendLine(userId, `🚨 逾期警示 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n已逾期 ${Math.abs(dl)} 天！\n\n請盡快處理 ⚠️`).catch(() => {});
      if (!slackByPerson[task.assignee]) slackByPerson[task.assignee] = [];
      slackByPerson[task.assignee].push(`🚨 「${task.title}」— 已逾期 ${Math.abs(dl)} 天！`);
      sent++;
    }
  }
  for (const [name, items] of Object.entries(slackByPerson)) {
    await sendSlack(`📬 任務提醒 - MeetBot\n\n${slackMention(name)} 你有 ${items.length} 項任務需注意：\n\n${items.join("\n")}\n\n請盡快處理 ✓`);
  }
  res.json({ ok: true, sent });
});

// ── 新任務通知 ────────────────────────────────
app.post("/notify-new-task", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "缺少 task" });
  const userId = MEMBERS[task.assignee];
  if (!userId) return res.json({ ok: false, reason: "找不到成員" });
  try {
    const lineMsg = `📋 新任務指派 - MeetBot\n\n你有一項新任務：\n「${task.title}」\n\n負責人：${task.assignee}\n截止日期：${task.deadline}\n來源會議：${task.meeting}\n\n請記得在期限前完成 ✓`;
    await sendLine(userId, lineMsg).catch(() => {});
    await sendSlack(`📋 新任務指派 - MeetBot\n\n${slackMention(task.assignee)} 有一項新任務：\n「${task.title}」\n\n截止日期：${task.deadline}\n來源會議：${task.meeting}\n\n請記得在期限前完成 ✓`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════
// 出缺勤系統
// ══════════════════════════════════════════════

// ── 簽到 ──────────────────────────────────────
app.post("/checkin", async (req, res) => {
  const { name, course } = req.body;
  if (!name || !course) return res.status(400).json({ error: "缺少姓名或課程名稱" });

  const now    = new Date();
  const taipei = toTaipei(now);

  const record = {
    name, course,
    checkinTime: now.toISOString(),
    year:  toROCYear(taipei),
    month: taipei.getMonth() + 1,
    day:   taipei.getDate(),
    status: "checked-in"
  };

  try {
    const result    = await fbPost(record);
    const sessionId = result.name;
    const timeStr   = taipei.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const msg = `✅ 臨時人員簽到\n\n👤 姓名：${name}\n📚 課程：${course}\n⏰ 簽到時間：${timeStr}`;
    for (const uid of ATT_NOTIFY_IDS) await sendLine(uid, msg).catch(() => {});
    await sendSlack(msg);
    res.json({ ok: true, sessionId });
  } catch (e) {
    console.error("checkin:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 簽退 ──────────────────────────────────────
app.post("/checkout", async (req, res) => {
  const { sessionId, shift, workContent, note } = req.body;
  if (!sessionId) return res.status(400).json({ error: "缺少 sessionId" });

  const now    = new Date();
  const taipei = toTaipei(now);

  try {
    const record      = await fbGet(`/${sessionId}`);
    if (!record) return res.status(404).json({ error: "找不到簽到記錄" });
    const checkinTime = new Date(record.checkinTime);
    const hours       = Math.round((now - checkinTime) / 3600000 * 10) / 10;
    const { courseType, teacher, plannedHours, registeredCount, actualCount, walkInCount, summary } = req.body;
    const checkinStr  = toTaipei(checkinTime).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const checkoutStr = taipei.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
    const dateStr     = `${record.year}/${record.month}/${record.day}`;

    const updated = {
      ...record,
      checkoutTime:     now.toISOString(),
      courseType:       courseType || "",
      teacher:          teacher || "",
      plannedHours:     plannedHours || "",
      registeredCount:  registeredCount ?? "",
      actualCount:      actualCount ?? "",
      walkInCount:      walkInCount ?? "",
      summary:          summary || "",
      hours,
      status: "checked-out"
    };
    await fbPut(`/${sessionId}`, updated);

    // 產生課程記錄頁
    const recordHtml = generateRecordHtml({
      name: record.name, course: record.course, date: dateStr,
      checkinStr, checkoutStr, hours, plannedHours, courseType,
      teacher, registeredCount, actualCount, walkInCount, summary
    });
    const uid = storeDoc(recordHtml, `課程記錄_${record.name}`);
    const downloadUrl = `${process.env.BASE_URL || "https://meetbot-check-in-system.onrender.com"}/download/${uid}`;

    const msg = `🔚 臨時人員簽退\n\n👤 姓名：${record.name}\n📚 課程：${record.course}\n🏷 屬性：${courseType || "-"}\n⏰ 簽到：${checkinStr}　簽退：${checkoutStr}\n⏱ 時數：${hours} 小時\n👥 實到：${actualCount ?? "-"} 人\n\n📄 課程記錄（可列印/存PDF）：\n${downloadUrl}`;
    for (const notifyId of ATT_NOTIFY_IDS) await sendLine(notifyId, msg).catch(() => {});
    await sendSlack(msg);
    res.json({ ok: true, hours });
  } catch (e) {
    console.error("checkout:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢單一 session ──────────────────────────
app.get("/session/:id", async (req, res) => {
  try {
    const record = await fbGet(`/${req.params.id}`);
    if (!record) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, record, sessionId: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢姓名是否有進行中的簽到 ────────────────
app.get("/active-session", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "缺少 name" });
  try {
    const data = await fbGet();
    if (!data) return res.json({ found: false });
    const entry = Object.entries(data).find(
      ([, r]) => r.name === name && r.status === "checked-in"
    );
    if (!entry) return res.json({ found: false });
    res.json({ found: true, sessionId: entry[0], record: entry[1] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 查詢記錄 ──────────────────────────────────
app.get("/records", async (req, res) => {
  try {
    const data    = await fbGet();
    const records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    res.json(records);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 刪除記錄 ──────────────────────────────────
app.delete("/records/:id", async (req, res) => {
  try {
    await axios.delete(`${ATT_FB}/${req.params.id}.json`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 匯出 Excel ────────────────────────────────
function safeSheetName(wb, name) {
  // 移除 Excel 不允許的字元，限制 31 字
  let base = (name || '無名').replace(/[\\/?*[\]:]/g, '').slice(0, 31).trim() || '無名';
  // 避免與已存在的工作表名稱衝突（不分大小寫）
  const exists = () => wb.worksheets.some(ws => ws.name.toLowerCase() === base.toLowerCase());
  let i = 2;
  const orig = base;
  while (exists()) base = orig.slice(0, 29) + '_' + (i++);
  return base;
}

function buildPersonSheet(wb, personName, records) {
  const ws = wb.addWorksheet(safeSheetName(wb, personName));

  const bdr  = { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} };
  const mid  = { horizontal:"center", vertical:"middle" };
  const lmid = { horizontal:"left",   vertical:"middle", wrapText:true };
  const tk   = { name:"DFKai-SB", size:12, charset:136 };

  // 欄寬：A(1) B(2)編號 C(3)年 D(4)月 E(5)日 F(6)課程名稱 G(7)時分 H(8)至時分 I(9)共計
  [5, 8, 8, 12, 12, 32, 13, 13, 13].forEach((w, i) => { ws.getColumn(i+1).width = w; });

  // Row 1 大標題
  ws.mergeCells("B1:I1");
  ws.getRow(1).height = 42;
  ws.getCell("B1").value = "健康台灣深耕計畫專職人員出勤記錄表";
  ws.getCell("B1").style = { font:{...tk, size:14, bold:true}, alignment:mid };

  // Row 2 副標題
  ws.mergeCells("B2:I2");
  ws.getRow(2).height = 36;
  ws.getCell("B2").value = "臨時人員出勤記錄與工作內容說明";
  ws.getCell("B2").style = { font:{...tk, size:13, bold:true}, alignment:mid };

  // Row 3 姓名 + 工作內容
  ws.mergeCells("C3:D3");
  ws.mergeCells("F3:I3");
  ws.getRow(3).height = 90;
  ws.getCell("B3").value = "姓名";
  ws.getCell("B3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("C3").value = personName;
  ws.getCell("C3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("E3").value = "工作內容";
  ws.getCell("E3").style = { font:tk, alignment:mid, border:bdr };
  ws.getCell("F3").value = "協助處方課執行期間\n場地協助、報到協助、出席紀錄、活動影像紀錄、課後滿意度調查提醒等";
  ws.getCell("F3").style = { font:tk, alignment:lmid, border:bdr };

  // Row 4 欄位標題
  ws.getRow(4).height = 30;
  ["", "編號", "年", "月", "日", "課程名稱", "時　分", "至時分", "共計（時）"].forEach((h, i) => {
    if (i === 0) return;
    const cell = ws.getCell(4, i+1);
    cell.value = h;
    cell.style = { font:tk, alignment:mid, border:bdr };
  });

  // 資料列
  let totalHours = 0;
  const dataStart = 5;
  records.forEach((r, idx) => {
    const rn  = dataStart + idx;
    ws.getRow(rn).height = 30;
    const ci  = toTaipei(new Date(r.checkinTime)).toLocaleTimeString("zh-TW",  { hour:"2-digit", minute:"2-digit" });
    const co  = toTaipei(new Date(r.checkoutTime)).toLocaleTimeString("zh-TW", { hour:"2-digit", minute:"2-digit" });
    const row = ["", idx+1, r.year, r.month, r.day, r.course||"", ci, co, r.hours];
    row.forEach((v, i) => {
      if (i === 0) return;
      const cell = ws.getCell(rn, i+1);
      cell.value = v;
      cell.style = { font:tk, alignment: i === 5 ? lmid : mid, border:bdr };
    });
    totalHours += r.hours || 0;
  });

  // 合計列
  const tr = dataStart + records.length;
  ws.getRow(tr).height = 30;
  // 不使用 mergeCells，改為逐格設定邊線確保底線完整
  for (let c = 2; c <= 9; c++) {
    const cell = ws.getCell(tr, c);
    if (c === 2) {
      cell.value = "累計";
      cell.style = { font:{...tk, bold:true}, alignment:mid, border:bdr };
    } else if (c === 9) {
      cell.value = Math.round(totalHours * 10) / 10;
      cell.style = { font:{...tk, bold:true}, alignment:mid, border:bdr };
    } else {
      cell.style = { border:bdr };
    }
  }
}

app.get("/export", async (req, res) => {
  const { name: nameFilter, month: monthFilter, year: yearFilter } = req.query;
  try {
    const data = await fbGet();
    let records = data ? Object.entries(data).map(([id, r]) => ({ id, ...r })) : [];
    if (nameFilter)  records = records.filter(r => r.name  === nameFilter);
    if (monthFilter) records = records.filter(r => r.month === parseInt(monthFilter));
    if (yearFilter)  records = records.filter(r => r.year  === parseInt(yearFilter));
    records = records.filter(r => r.status === "checked-out");
    records.sort((a, b) => new Date(a.checkinTime) - new Date(b.checkinTime));

    // 按人分組
    const byPerson = {};
    records.forEach(r => {
      if (!byPerson[r.name]) byPerson[r.name] = [];
      byPerson[r.name].push(r);
    });

    const wb = new ExcelJS.Workbook();
    if (Object.keys(byPerson).length === 0) {
      buildPersonSheet(wb, nameFilter || "無記錄", []);
    } else {
      for (const [pname, pRecords] of Object.entries(byPerson)) {
        buildPersonSheet(wb, pname, pRecords);
      }
    }

    const fileName = `臨時人員出勤記錄_${yearFilter||""}年${monthFilter ? monthFilter+"月" : ""}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("export:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 下載 Word 檔 ──────────────────────────────
app.get("/download/:uid", (req, res) => {
  const item = docStore.get(req.params.uid);
  if (!item) return res.status(404).send("頁面不存在（伺服器重啟後連結會失效，請重新簽到簽退產生新記錄）");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(item.html);
});

// ── 任務完成通知 ──────────────────────────────
app.post("/notify-task-done", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "缺少 task" });
  const userId = MEMBERS[task.assignee];
  if (!userId) return res.json({ ok: false, reason: "找不到成員" });
  try {
    const lineMsg = `🎉 恭喜 ${task.assignee}！\n\n「${task.title}」已完成！\n\n辛苦了，繼續保持 💪`;
    await sendLine(userId, lineMsg).catch(() => {});
    await sendSlack(`🎉 恭喜 ${slackMention(task.assignee)}！\n\n「${task.title}」已完成！\n\n辛苦了，繼續保持 💪`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 匯出 PDF 任務報告 ────────────────────────
app.get("/export-pdf", async (req, res) => {
  try {
    let tasks = await fetchTasksFromFirebase();
    const { from, to } = req.query;
    if (from || to) {
      tasks = tasks.filter(t => {
        const dateStr = t.createdAt || new Date(t.id).toISOString().slice(0,10);
        if (from && dateStr < from) return false;
        if (to   && dateStr > to)   return false;
        return true;
      });
    }
    const now = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
    const total = tasks.length;
    const doneCount = tasks.filter(t => t.done).length;
    const pct = total ? Math.round(doneCount / total * 100) : 0;

    const statusOf = (t) => {
      if (t.done) return "✅ 已完成";
      const today = new Date().toISOString().slice(0, 10);
      const d = Math.ceil((new Date(t.deadline) - new Date(today)) / 86400000);
      if (d < 0) return `🚨 逾期 ${Math.abs(d)} 天`;
      if (d === 0) return "⚡ 今天截止";
      if (d <= 2) return `⏰ 剩 ${d} 天`;
      return `📅 ${t.deadline} 截止`;
    };

    let rows = "";
    TEAM.forEach(name => {
      const mine = tasks.filter(t => t.assignee === name);
      if (mine.length === 0) return;
      const done = mine.filter(t => t.done).length;
      rows += `<tr><td colspan="4" class="member-header">👤 ${name}　${done}/${mine.length} 完成</td></tr>`;
      mine.forEach((t, i) => {
        const bg = i % 2 === 0 ? "#f5f7ff" : "#ffffff";
        const noteHtml = t.progressNote
          ? `<br><span class="note">📝 ${t.progressNote}${t.progressNoteTime ? `（${t.progressNoteTime}）` : ""}</span>`
          : "";
        rows += `<tr style="background:${bg};"><td class="td-main">${t.title}${noteHtml}</td><td class="td-cell">${t.assignee}</td><td class="td-cell">${t.deadline}</td><td class="td-cell">${statusOf(t)}</td></tr>`;
      });
    });

    const html = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>MeetBot 任務進度報告</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:"Microsoft JhengHei","微軟正黑體","Noto Sans TC",sans-serif;color:#1a1a2e;padding:24px;}
  h1{font-size:20px;color:#4f8cff;margin-bottom:6px;}
  .sub{font-size:13px;color:#5a6285;margin-bottom:20px;}
  .save-btn{display:inline-block;margin-bottom:20px;padding:10px 24px;background:#4f8cff;color:#fff;border:none;border-radius:6px;font-size:15px;cursor:pointer;font-family:inherit;}
  table{border-collapse:collapse;width:100%;font-size:13px;}
  th{background:#2a3560;color:#fff;padding:8px 10px;text-align:left;}
  td{border-bottom:1px solid #e0e4f0;vertical-align:top;padding:7px 10px;}
  .member-header{background:#1a2240;color:#7eb3ff;font-weight:bold;font-size:14px;padding:8px 10px;}
  .td-main{width:50%;}
  .td-cell{width:17%;white-space:nowrap;}
  .note{color:#4f8cff;font-size:12px;}
  .footer{margin-top:18px;font-size:11px;color:#8890aa;}
  @media print{
    .save-btn{display:none;}
    body{padding:12px;}
  }
</style></head>
<body>
<button class="save-btn" onclick="window.print()">另存 PDF</button>
<h1>📋 MeetBot 任務進度報告</h1>
<div class="sub">匯出時間：${now}${from||to ? `　新增日期：${from||'起始'}～${to||'結束'}` : ''}　整體完成率：${pct}%（${doneCount}/${total}）</div>
<table>
  <tr><th class="td-main">任務</th><th class="td-cell">負責人</th><th class="td-cell">截止日期</th><th class="td-cell">狀態</th></tr>
  ${rows}
</table>
<div class="footer">此報告由 MeetBot 系統自動生成</div>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    console.error("匯出失敗:", e.message);
    res.status(500).send("匯出失敗：" + e.message);
  }
});

// 舊連結相容
app.get("/export-word", (req, res) => res.redirect("/export-pdf"));

// ── 圖文選單設定 ───────────────────────────────

// 產生 4 色分區 PNG（2×2，白色分隔線）
function makeRichMenuPNG(w, h, colors) {
  const midX = Math.floor(w / 2);
  const midY = Math.floor(h / 2);
  const bd = 4; // border pixels

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function crc32(buf) {
    let v = 0xFFFFFFFF;
    for (const b of buf) v = crcTable[(v ^ b) & 0xFF] ^ (v >>> 8);
    return (v ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length);
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([lb, t, data, cb]);
  }

  function makeLine(y) {
    const line = Buffer.alloc(1 + w * 3); line[0] = 0;
    const isBorderY = y >= midY - bd && y < midY + bd;
    for (let x = 0; x < w; x++) {
      const isBorderX = x >= midX - bd && x < midX + bd;
      let c;
      if (isBorderX || isBorderY) c = { r: 255, g: 255, b: 255 };
      else {
        const q = (y < midY ? 0 : 2) + (x < midX ? 0 : 1);
        c = colors[q];
      }
      line[1 + x * 3] = c.r; line[2 + x * 3] = c.g; line[3 + x * 3] = c.b;
    }
    return line;
  }

  // Only 3 unique scanlines (top, border, bottom)
  const topLine = makeLine(0);
  const borderLine = makeLine(midY);
  const botLine = makeLine(h - 1);
  const lines = [];
  for (let y = 0; y < h; y++) {
    if (y >= midY - bd && y < midY + bd) lines.push(borderLine);
    else lines.push(y < midY ? topLine : botLine);
  }
  const compressed = zlib.deflateSync(Buffer.concat(lines));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))
  ]);
}

// 圖文選單：只有蔡蕙芳、陳佩研保留管理選單，其餘（含戴豐逸）用一般選單
const RICHMENU_ADMIN_IDS = new Set([
  "Uc05e7076d830f4f75ecc14a07b697e5c", // 蔡蕙芳
  "Uc8e074d50b3b20581945f5c6aca80d1d", // 陳佩研
]);

// POST /setup-richmenu → 建立選單並綁定使用者（需帶 secret 參數）
app.get("/setup-richmenu", async (req, res) => {
  const secret = process.env.SETUP_SECRET || "meetbot2024";
  if (req.query.secret !== secret) return res.status(403).send("Forbidden");

  const log = [];
  const lineHdr = { Authorization: `Bearer ${TOKEN}` };

  try {
    // 建立一般成員選單
    const menuDef = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "regular-user-menu",
      chatBarText: "功能選單",
      areas: [
        { bounds: { x: 0,    y: 0,    width: 1250, height: 843 },
          action: { type: "message", label: "週報", text: "週報" } },
        { bounds: { x: 1250, y: 0,    width: 1250, height: 843 },
          action: { type: "message", label: "工作", text: "工作" } },
        { bounds: { x: 0,    y: 843,  width: 1250, height: 843 },
          action: { type: "uri", label: "meetbot",
                    uri: "https://s71043201-star.github.io/meetbot-app/" } },
        { bounds: { x: 1250, y: 843,  width: 1250, height: 843 },
          action: { type: "message", label: "指令說明", text: "指令" } },
      ]
    };
    const { data: created } = await axios.post(
      "https://api.line.me/v2/bot/richmenu", menuDef,
      { headers: { ...lineHdr, "Content-Type": "application/json" } }
    );
    const richMenuId = created.richMenuId;
    log.push(`✅ 建立選單: ${richMenuId}`);

    // 上傳圖片（public/richmenu-regular.jpg）
    const imgPath = path.join(__dirname, "public", "richmenu-regular.jpg");
    const imgBuf = fs.readFileSync(imgPath);
    await axios.post(
      `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      imgBuf, { headers: { ...lineHdr, "Content-Type": "image/jpeg" } }
    );
    log.push(`✅ 上傳圖片 (${(imgBuf.length / 1024).toFixed(0)} KB)`);

    // 綁定一般成員
    const regularUsers = Object.entries(MEMBERS).filter(([, id]) => !RICHMENU_ADMIN_IDS.has(id));
    for (const [name, uid] of regularUsers) {
      await axios.post(
        `https://api.line.me/v2/bot/user/${uid}/richmenu/${richMenuId}`,
        {}, { headers: lineHdr }
      );
      log.push(`✅ 綁定 ${name}`);
    }

    res.send(log.join("\n") + "\n\n✅ 完成！請至 LINE OA Manager 更新選單圖片文字。");
  } catch (e) {
    const errMsg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    res.status(500).send(log.join("\n") + "\n\n❌ 錯誤: " + errMsg);
  }
});

// ── 佩研+戴豐逸 管理員選單（6格）────────────────────
app.get("/setup-admin-menu", async (req, res) => {
  const secret = process.env.SETUP_SECRET || "meetbot2024";
  if (req.query.secret !== secret) return res.status(403).send("Forbidden");
  const log = [];
  const lineHdr = { Authorization: `Bearer ${TOKEN}` };
  try {
    const menuDef = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "admin-menu-6",
      chatBarText: "功能選單",
      areas: [
        { bounds: { x: 0,    y: 0,    width: 833, height: 843 }, action: { type: "message", label: "簽到",   text: "簽到" } },
        { bounds: { x: 833,  y: 0,    width: 833, height: 843 }, action: { type: "message", label: "後台",   text: "後台" } },
        { bounds: { x: 1666, y: 0,    width: 834, height: 843 }, action: { type: "message", label: "工作",   text: "工作" } },
        { bounds: { x: 0,    y: 843,  width: 833, height: 843 }, action: { type: "uri",     label: "Meetbot", uri: "https://s71043201-star.github.io/meetbot-app/" } },
        { bounds: { x: 833,  y: 843,  width: 833, height: 843 }, action: { type: "message", label: "臨時人員", text: "臨時人員" } },
        { bounds: { x: 1666, y: 843,  width: 834, height: 843 }, action: { type: "message", label: "指令說明", text: "指令" } },
      ]
    };
    const { data: created } = await axios.post("https://api.line.me/v2/bot/richmenu", menuDef,
      { headers: { ...lineHdr, "Content-Type": "application/json" } });
    const richMenuId = created.richMenuId;
    log.push(`✅ 建立選單: ${richMenuId}`);
    const imgBuf = fs.readFileSync(path.join(__dirname, "public", "richmenu-admin.jpg"));
    await axios.post(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      imgBuf, { headers: { ...lineHdr, "Content-Type": "image/jpeg" } });
    log.push(`✅ 上傳圖片 (${(imgBuf.length / 1024).toFixed(0)} KB)`);
    const targets = [
      ["陳佩研", "Uc8e074d50b3b20581945f5c6aca80d1d"],
      ["戴豐逸", "Uece4baaf97cfab39ad79c6ed0ee55d03"],
    ];
    for (const [name, uid] of targets) {
      await axios.post(`https://api.line.me/v2/bot/user/${uid}/richmenu/${richMenuId}`, {}, { headers: lineHdr });
      log.push(`✅ 綁定 ${name}`);
    }
    res.send(log.join("\n") + "\n\n✅ 完成！");
  } catch (e) {
    res.status(500).send(log.join("\n") + "\n\n❌ 錯誤: " + (e.response?.data ? JSON.stringify(e.response.data) : e.message));
  }
});

// ── 蔡蕙芳專屬選單（6格）────────────────────────────
app.get("/setup-huifang-menu", async (req, res) => {
  const secret = process.env.SETUP_SECRET || "meetbot2024";
  if (req.query.secret !== secret) return res.status(403).send("Forbidden");
  const log = [];
  const lineHdr = { Authorization: `Bearer ${TOKEN}` };
  try {
    const menuDef = {
      size: { width: 2500, height: 1686 },
      selected: true,
      name: "huifang-menu-6",
      chatBarText: "功能選單",
      areas: [
        { bounds: { x: 0,    y: 0,    width: 833, height: 843 }, action: { type: "uri",     label: "週報",        uri: "https://s71043201-star.github.io/tpma-statistics/" } },
        { bounds: { x: 833,  y: 0,    width: 833, height: 843 }, action: { type: "message", label: "進度",        text: "進度" } },
        { bounds: { x: 1666, y: 0,    width: 834, height: 843 }, action: { type: "message", label: "下載",        text: "下載" } },
        { bounds: { x: 0,    y: 843,  width: 833, height: 843 }, action: { type: "message", label: "提醒",        text: "提醒" } },
        { bounds: { x: 833,  y: 843,  width: 833, height: 843 }, action: { type: "message", label: "工作",        text: "工作" } },
        { bounds: { x: 1666, y: 843,  width: 834, height: 843 }, action: { type: "uri",     label: "Meetbot",    uri: "https://s71043201-star.github.io/meetbot-app/" } },
      ]
    };
    const { data: created } = await axios.post("https://api.line.me/v2/bot/richmenu", menuDef,
      { headers: { ...lineHdr, "Content-Type": "application/json" } });
    const richMenuId = created.richMenuId;
    log.push(`✅ 建立選單: ${richMenuId}`);
    const imgBuf = fs.readFileSync(path.join(__dirname, "public", "richmenu-huifang.jpg"));
    await axios.post(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      imgBuf, { headers: { ...lineHdr, "Content-Type": "image/jpeg" } });
    log.push(`✅ 上傳圖片 (${(imgBuf.length / 1024).toFixed(0)} KB)`);
    const huifangId = "Uc05e7076d830f4f75ecc14a07b697e5c";
    await axios.post(`https://api.line.me/v2/bot/user/${huifangId}/richmenu/${richMenuId}`, {}, { headers: lineHdr });
    log.push(`✅ 綁定 蔡蕙芳`);
    res.send(log.join("\n") + "\n\n✅ 完成！");
  } catch (e) {
    res.status(500).send(log.join("\n") + "\n\n❌ 錯誤: " + (e.response?.data ? JSON.stringify(e.response.data) : e.message));
  }
});

// ── 將戴豐逸綁定為蕙芳同款選單 ────────────────────
app.get("/link-boss-menu", async (req, res) => {
  const secret = process.env.SETUP_SECRET || "meetbot2024";
  if (req.query.secret !== secret) return res.status(403).send("Forbidden");
  const lineHdr = { Authorization: `Bearer ${TOKEN}` };
  try {
    const huifangId = "Uc05e7076d830f4f75ecc14a07b697e5c";
    const daifengyi = "Uece4baaf97cfab39ad79c6ed0ee55d03";
    const { data } = await axios.get(`https://api.line.me/v2/bot/user/${huifangId}/richmenu`, { headers: lineHdr });
    const menuId = data.richMenuId;
    await axios.post(`https://api.line.me/v2/bot/user/${daifengyi}/richmenu/${menuId}`, {}, { headers: lineHdr });
    res.send(`✅ 已將戴豐逸綁定至蕙芳的選單 (${menuId})`);
  } catch (e) {
    res.status(500).send("❌ 失敗：" + (e.response?.data ? JSON.stringify(e.response.data) : e.message));
  }
});

// ── LINE 額度查詢 ──────────────────────────────
app.get("/line-quota", async (req, res) => {
  try {
    const [quota, consumption] = await Promise.all([
      axios.get("https://api.line.me/v2/bot/message/quota", { headers: { Authorization: `Bearer ${TOKEN}` } }),
      axios.get("https://api.line.me/v2/bot/message/quota/consumption", { headers: { Authorization: `Bearer ${TOKEN}` } }),
    ]);
    const limit = quota.data.value ?? "無限制";
    const used  = consumption.data.totalUsage;
    res.send(`📊 LINE 訊息額度\n本月已用：${used} 則\n上限：${limit} 則\n剩餘：${limit === "無限制" ? "無限制" : limit - used} 則`);
  } catch (e) {
    res.status(500).send("查詢失敗：" + (e.response?.data ? JSON.stringify(e.response.data) : e.message));
  }
});

// ── 測試 ──────────────────────────────────────
app.get("/test-me", async (req, res) => {
  try {
    await sendLine("Uece4baaf97cfab39ad79c6ed0ee55d03", "📋 MeetBot 測試成功！LINE Bot 已正常連線 🎉");
    res.send("訊息已發送 ✅");
  } catch (e) {
    res.status(500).send("發送失敗：" + e.message);
  }
});

// ── Slack 會議提醒 ──────────────────────────────
app.post("/send-slack", async (req, res) => {
  const { webhookUrl, message } = req.body;
  if (!webhookUrl || !message) return res.status(400).json({ error: "Missing params" });
  try {
    await axios.post(webhookUrl, { text: message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/check-meeting-reminders", async (req, res) => {
  const { webhookUrl } = req.body;
  if (!webhookUrl) return res.status(400).json({ error: "Missing webhookUrl" });
  try {
    const meetingsRes = await axios.get(`${MEETINGS_FB}.json`);
    const meetingsObj = meetingsRes.data;
    if (!meetingsObj) return res.json({ ok: true, sent: 0 });
    const meetings = Object.values(meetingsObj);
    // 用台北時區計算今天日期
    const taipei = toTaipei(new Date());
    const todayStr = `${taipei.getFullYear()}-${String(taipei.getMonth()+1).padStart(2,'0')}-${String(taipei.getDate()).padStart(2,'0')}`;
    let sent = 0;

    for (const m of meetings) {
      if (!m.date) continue;
      const dl = Math.ceil((new Date(m.date + "T00:00:00+08:00") - new Date(todayStr + "T00:00:00+08:00")) / 86400000);
      const checks = [
        { key: "day7", days: 7, label: "7 天" },
        { key: "day3", days: 3, label: "3 天" },
        { key: "day1", days: 1, label: "1 天" },
      ];

      for (const check of checks) {
        if (dl === check.days && !(m.slackSent && m.slackSent[check.key])) {
          const participants = (m.participants || []).join("、") || "全員";
          const msg = `📅 *會議提醒（${check.label}前）*\n\n` +
            `📌 *${m.title}*\n` +
            `🗓 日期：${m.date}\n` +
            `⏰ 時間：${m.time || "未定"}\n` +
            `📍 地點：${m.location || "未定"}\n` +
            `👥 參加者：${participants}\n` +
            (m.description ? `\n📝 ${m.description}\n` : "") +
            `\n請提前準備！`;
          try {
            await axios.post(webhookUrl, { text: msg });
            // 更新 Firebase 已發送標記
            await axios.patch(`${MEETINGS_FB}/${m.id}.json`, {
              [`slackSent/${check.key}`]: true
            });
            sent++;
          } catch (e) { console.error("Slack send error:", e.message); }
        }
      }
    }
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.redirect("/checkin.html"));
app.get("/ping", (req, res) => res.send("pong"));

app.get("/test-slack", async (req, res) => {
  const hasUrl = !!SLACK_WEBHOOK_URL;
  if (!hasUrl) return res.json({ ok: false, reason: "SLACK_WEBHOOK_URL 未設定", envKeys: Object.keys(process.env).filter(k => k.includes("SLACK")) });
  try {
    await axios.post(SLACK_WEBHOOK_URL, { text: "✅ Slack 連線測試成功！" });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── 排程器：平日提醒 ──────────────────────────
let lastRun430 = "";
let lastRun450 = "";

setInterval(async () => {
  const taipei  = toTaipei(new Date());
  const day     = taipei.getDay();   // 0=Sun, 6=Sat
  const hour    = taipei.getHours();
  const min     = taipei.getMinutes();
  const dateKey = taipei.toISOString().slice(0, 10);

  if (day === 0 || day === 6) return;

  // 16:30 — 除蔡蕙芳以外所有人：請至 meetbot 勾選完成項目
  if (hour === 16 && min === 30 && lastRun430 !== dateKey) {
    lastRun430 = dateKey;
    const targets = Object.entries(MEMBERS)
      .filter(([name]) => name !== "蔡蕙芳")
      .map(([, id]) => id);
    const msg = `📌 下午工作進度提醒\n\n現在是 16:30，請至 meetbot 系統查看您的待辦任務，並勾選今日已完成的項目。\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
    for (const id of targets) await sendLine(id, msg).catch(() => {});
    console.log("排程 16:30 提醒已發送");
  }

  // 16:50 — 蔡蕙芳：查看進度並可選擇向誰發提醒
  if (hour === 16 && min === 50 && lastRun450 !== dateKey) {
    lastRun450 = dateKey;
    const memberNames = TEAM.filter(n => n !== "蔡蕙芳");
    const quickItems  = memberNames.map(name => ({
      type: "action",
      action: { type: "message", label: name, text: `提醒 ${name}` }
    }));
    const msg = `📊 下午進度追蹤提醒\n\n現在是 16:50，請查看今日全員工作進度。\n\n如需向特定成員補發提醒，請點選下方姓名：\n\n🔗 https://s71043201-star.github.io/meetbot-app/`;
    for (const bossId of BOSS_IDS) {
      await sendLineWithQuickReply(bossId, msg, quickItems).catch(() => {});
    }
    console.log("排程 16:50 提醒已發送");
  }
}, 60000);

// ── 排程器：會議 Slack 自動提醒（每小時檢查）──
const FB_BASE = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot";
let lastMeetingCheck = "";
let meetingCheckRunning = false; // 防重複執行鎖

async function autoCheckMeetingReminders() {
  if (meetingCheckRunning) { console.log("[會議提醒] 上次檢查尚未結束，跳過"); return; }
  meetingCheckRunning = true;
  try {
    // 從 Firebase 讀取 Slack webhook URL
    let webhookUrl = SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      const whRes = await axios.get(`${FB_BASE}/slackWebhook.json`);
      webhookUrl = whRes.data;
    }
    if (!webhookUrl) { console.log("[會議提醒] 無 Slack webhook，跳過"); return; }

    const meetingsRes = await axios.get(`${MEETINGS_FB}.json`);
    const meetingsObj = meetingsRes.data;
    if (!meetingsObj) { console.log("[會議提醒] 無會議資料"); return; }
    const meetings = Object.values(meetingsObj);

    // 用台北時區計算今天（避免 toISOString 轉回 UTC）
    const taipei = toTaipei(new Date());
    const todayStr = `${taipei.getFullYear()}-${String(taipei.getMonth()+1).padStart(2,'0')}-${String(taipei.getDate()).padStart(2,'0')}`;
    let sent = 0;

    for (const m of meetings) {
      if (!m.date) continue;
      const dl = Math.ceil((new Date(m.date + "T00:00:00+08:00") - new Date(todayStr + "T00:00:00+08:00")) / 86400000);
      const checks = [
        { key: "day7", days: 7, label: "7 天" },
        { key: "day3", days: 3, label: "3 天" },
        { key: "day1", days: 1, label: "1 天" },
      ];
      for (const check of checks) {
        if (dl === check.days && !(m.slackSent && m.slackSent[check.key])) {
          const participants = (m.participants || []).join("、") || "全員";
          const msg = `📅 *會議提醒（${check.label}前）*\n\n` +
            `📌 *${m.title}*\n` +
            `🗓 日期：${m.date}\n` +
            `⏰ 時間：${m.time || "未定"}\n` +
            `📍 地點：${m.location || "未定"}\n` +
            `👥 參加者：${participants}\n` +
            (m.description ? `\n📝 ${m.description}\n` : "") +
            `\n請提前準備！`;
          try {
            await axios.post(webhookUrl, { text: msg });
            await axios.patch(`${MEETINGS_FB}/${m.id}.json`, {
              [`slackSent/${check.key}`]: true
            });
            sent++;
          } catch (e) { console.error("[會議提醒] Slack 發送失敗:", e.message); }
        }
      }
    }
    if (sent > 0) console.log(`[會議提醒] 已發送 ${sent} 則 Slack 提醒`);
    else console.log("[會議提醒] 本次檢查無需發送");
  } catch (e) {
    console.error("[會議提醒] 自動檢查失敗:", e.message);
  } finally {
    meetingCheckRunning = false;
  }
}

// 每小時整點檢查（每分鐘偵測，整點時觸發）
setInterval(async () => {
  const taipei = toTaipei(new Date());
  const hour = taipei.getHours();
  const min = taipei.getMinutes();
  const dateKey = taipei.toISOString().slice(0, 10);
  const checkKey = `${dateKey}-${hour}`;

  // 每小時的第 0 分鐘觸發（8:00~20:00 之間）
  if (min === 0 && hour >= 8 && hour <= 20 && lastMeetingCheck !== checkKey) {
    lastMeetingCheck = checkKey;
    console.log(`[會議提醒] ${hour}:00 自動檢查中...`);
    await autoCheckMeetingReminders();
  }
}, 60000);

// 啟動時也立即檢查一次
setTimeout(() => autoCheckMeetingReminders(), 5000);

// ── 自動保活（防止 Render 免費版休眠）──
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
setInterval(() => {
  axios.get(`${SELF_URL}/ping`).catch(() => {});
}, 14 * 60 * 1000); // 每 14 分鐘 ping 一次

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`MeetBot + 出缺勤系統啟動，port ${PORT}`));
