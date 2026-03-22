const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "10mb" }));

// ── CORS ──────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

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

// ── 工具函式 ──────────────────────────────────
async function sendLine(userId, message) {
  if (!userId) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message }]
  }, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

function daysLeft(deadline) {
  const today = new Date().toISOString().slice(0, 10);
  return Math.ceil((new Date(deadline) - new Date(today)) / 86400000);
}

// ── Firebase Admin（讀取任務）────────────────
const https = require("https");

async function fetchTasksFromFirebase() {
  return new Promise((resolve) => {
    const url = "https://meetbot-ede53-default-rtdb.asia-southeast1.firebasedatabase.app/meetbot/tasks.json";
    https.get(url, (res) => {
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

// 反查 userId → 姓名
const ID_TO_NAME = {
  "U858b6b722d9a01e1a927d07f8ffc65ed": "黃琴茹",
  "Uc05e7076d830f4f75ecc14a07b697e5c": "蔡蕙芳",
  "U1307dd217e15b4ef777f8f0561c2e589": "吳承儒",
  "U7c71775e251051b61994eda22ddc2bec": "張鈺微",
  "Ue69dbd040159f69636c08dfd9568aa63": "吳亞璇",
  "U87efc2433f2ab838929cbfbdb2851748": "許雅淇",
  "Uece4baaf97cfab39ad79c6ed0ee55d03": "戴豐逸",
  "Uc8e074d50b3b20581945f5c6aca80d1d": "陳佩研",
};

const BOSS_IDS = [
  "Uc05e7076d830f4f75ecc14a07b697e5c", // 蔡蕙芳
  "Uece4baaf97cfab39ad79c6ed0ee55d03",  // 戴豐逸
];

// ── Webhook ───────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // 先回 200，再非同步處理
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;
    const userId = event.source.userId;
    const text   = event.message.text.trim();
    console.log(`👤 User ID: ${userId} 說：${text}`);

    // 指令：工作 → 回傳個人待辦
    if (text === "工作") {
      const name = ID_TO_NAME[userId];
      if (!name) { await sendLine(userId, "❌ 找不到你的帳號，請聯絡管理員"); continue; }
      const tasks = await fetchTasksFromFirebase();
      const mine = tasks.filter(t => t.assignee === name && !t.done);
      if (mine.length === 0) {
        await sendLine(userId, `✅ ${name}，你目前沒有待辦任務！繼續保持 💪`);
      } else {
        const lines = mine.map((t, i) => {
          const d = daysLeft(t.deadline);
          const urgTag = d < 0 ? "🚨 逾期" : d === 0 ? "⚡ 今天截止" : d <= 2 ? `⏰ 剩 ${d} 天` : `📅 ${t.deadline}`;
          return `${i+1}. ${t.title}\n   ${urgTag}`;
        }).join("\n\n");
        await sendLine(userId,
          `📋 ${name} 的待辦任務（共 ${mine.length} 項）\n\n${lines}\n\n請在期限前完成 ✓`
        );
      }
      continue;
    }

    // 指令：進度 → 蔡蕙芳 & 戴豐逸可用，回傳全團隊概況
    if (text === "進度") {
      if (!BOSS_IDS.includes(userId)) {
        await sendLine(userId, "❌ 此功能僅限管理員使用");
        continue;
      }
      const tasks = await fetchTasksFromFirebase();
      const total   = tasks.length;
      const done    = tasks.filter(t => t.done).length;
      const overdue = tasks.filter(t => !t.done && daysLeft(t.deadline) < 0).length;
      const pct     = total ? Math.round(done/total*100) : 0;

      const memberLines = TEAM.map(name => {
        const mine        = tasks.filter(t => t.assignee === name);
        const memberDone  = mine.filter(t => t.done).length;
        const memberPct   = mine.length ? Math.round(memberDone/mine.length*100) : 100;
        const pending     = mine.filter(t => !t.done);
        const doneList    = mine.filter(t => t.done);

        let lines = `👤 ${name}（${memberDone}/${mine.length} 完成）`;

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

      await sendLine(userId,
        `📊 全團隊任務進度報告\n` +
        `${"═".repeat(20)}\n` +
        `整體完成率：${pct}%（${done}/${total}）\n` +
        `逾期任務：${overdue} 項\n` +
        `${"═".repeat(20)}\n\n` +
        `${memberLines}\n\n` +
        `⏰ ${new Date().toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}`
      );
      continue;
    }
  }
});

// ── AI 解析代理（解決 CORS）────────────────────
app.post("/parse-meeting", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "缺少 text" });

  const today_str = new Date().toISOString().slice(0, 10);
  try {
    const response = await axios.post("https://api.anthropic.com/v1/messages", {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `你是會議記錄分析助理。從以下會議紀錄中，找出所有「任務/行動項目」。
每個任務需包含：負責人、任務描述、截止日期。今天是 ${today_str}。
若日期只說「本週五」請換算成實際日期。若無法確定截止日期，設定為 7 天後。
負責人請從以下名單選最接近的：${TEAM.join("、")}。若無法對應，填「待指派」。

請只回傳 JSON 陣列，格式如下，不要有任何說明文字：
[{"title":"任務描述","assignee":"負責人","deadline":"YYYY-MM-DD"}]

會議紀錄：
${text}`
      }]
    }, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      }
    });

    const raw = response.data.content?.find(b => b.type === "text")?.text || "[]";
    const items = JSON.parse(raw.replace(/```json|```/g, "").trim());
    res.json({ items });
  } catch (e) {
    console.error("AI 解析失敗:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── LINE 提醒 ─────────────────────────────────
app.post("/check-reminders", async (req, res) => {
  const { tasks, reminders } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "缺少參數" });

  const hour = new Date().getHours();
  let sent = 0;

  for (const task of tasks) {
    if (task.done) continue;
    const dl = daysLeft(task.deadline);
    const userId = MEMBERS[task.assignee];
    if (!userId) continue;

    if (reminders.dayBefore?.on && dl === reminders.dayBefore.days && hour === reminders.dayBefore.hour) {
      await sendLine(userId,
        `📋 任務提醒 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n截止日期：${task.deadline}（剩 ${dl} 天）\n\n請記得完成 ✓`
      );
      sent++;
    }

    if (reminders.hourBefore?.on && dl === 0 && hour === (23 - reminders.hourBefore.hours)) {
      await sendLine(userId,
        `⚡ 緊急提醒 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n今天截止！剩約 ${reminders.hourBefore.hours} 小時\n\n請盡快完成 🔥`
      );
      sent++;
    }

    if (reminders.overdueAlert?.on && dl < 0) {
      await sendLine(userId,
        `🚨 逾期警示 - MeetBot\n\n「${task.title}」\n\n負責人：${task.assignee}\n已逾期 ${Math.abs(dl)} 天！\n\n請盡快處理 ⚠️`
      );
      sent++;
    }
  }

  res.json({ ok: true, sent });
});

// ── 新增任務立即通知 ──────────────────────────
app.post("/notify-new-task", async (req, res) => {
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "缺少 task" });
  const userId = MEMBERS[task.assignee];
  if (!userId) return res.json({ ok: false, reason: "找不到成員" });
  try {
    await sendLine(userId,
      `📋 新任務指派 - MeetBot\n\n` +
      `你有一項新任務：\n「${task.title}」\n\n` +
      `截止日期：${task.deadline}\n` +
      `來源會議：${task.meeting}\n\n` +
      `請記得在期限前完成 ✓`
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 測試 ──────────────────────────────────────
app.get("/test-me", async (req, res) => {
  try {
    await sendLine("Uece4baaf97cfab39ad79c6ed0ee55d03", "📋 MeetBot 測試成功！LINE Bot 已正常連線 🎉");
    res.send("訊息已發送，請查看你的 LINE ✅");
  } catch (e) {
    res.status(500).send("發送失敗：" + e.message);
  }
});

app.get("/", (req, res) => res.send("MeetBot 後端運作中 ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MeetBot 後端啟動，port ${PORT}`));
