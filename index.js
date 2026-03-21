const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(express.json());

const TOKEN = process.env.LINE_TOKEN;

// ── 成員 LINE User ID ──
const MEMBERS = {
  "逸":   "Uece4baaf97cfab39ad79c6ed0ee55d03",
  "怡君": "Ue69dbd040159f69636c08dfd9568aa63",
  "阿偉": "U1307dd217e15b4ef777f8f0561c2e589",
  "美玲": "Uc8e074d50b3b20581945f5c6aca80d1d",
  "志豪": "U7c71775e251051b61994eda22ddc2bec",
};

// 發送 LINE 訊息
async function sendLine(userId, message) {
  if (!userId) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message }]
  }, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
}

// 計算天數差
function daysLeft(deadline) {
  const today = new Date().toISOString().slice(0, 10);
  return Math.ceil((new Date(deadline) - new Date(today)) / 86400000);
}

// 接收 LINE 訊息
app.post("/webhook", (req, res) => {
  const events = req.body.events || [];
  events.forEach(event => {
    if (event.type === "message") {
      const userId = event.source.userId;
      const text = event.message.text;
      console.log(`👤 User ID: ${userId} 說：${text}`);
    }
  });
  res.sendStatus(200);
});

// 前端呼叫：發送提醒
app.post("/notify", async (req, res) => {
  const { tasks, reminders } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "缺少參數" });

  const now = new Date();
  const hour = now.getHours();
  let sent = 0;

  for (const task of tasks) {
    if (task.done) continue;
    const dl = daysLeft(task.deadline);
    const userId = MEMBERS[task.assignee];
    if (!userId) continue;

    // 截止前 N 天提醒
    if (reminders.dayBefore.on && dl === reminders.dayBefore.days && hour === reminders.dayBefore.hour) {
      await sendLine(userId,
        `📋 任務提醒 - MeetBot\n\n` +
        `「${task.title}」\n\n` +
        `負責人：${task.assignee}\n` +
        `截止日期：${task.deadline}（剩 ${dl} 天）\n\n` +
        `請記得完成 ✓`
      );
      sent++;
    }

    // 截止前 N 小時提醒
    if (reminders.hourBefore.on && dl === 0) {
      const dlHour = 23 - reminders.hourBefore.hours;
      if (hour === dlHour) {
        await sendLine(userId,
          `⚡ 緊急提醒 - MeetBot\n\n` +
          `「${task.title}」\n\n` +
          `負責人：${task.assignee}\n` +
          `今天截止！剩約 ${reminders.hourBefore.hours} 小時\n\n` +
          `請盡快完成 🔥`
        );
        sent++;
      }
    }
  }

  res.json({ ok: true, sent });
});

// 測試用：瀏覽器直接觸發
app.get("/test-me", async (req, res) => {
  try {
    await sendLine(
      "Uece4baaf97cfab39ad79c6ed0ee55d03",
      "📋 MeetBot 測試成功！LINE Bot 已正常連線 🎉"
    );
    res.send("訊息已發送，請查看你的 LINE ✅");
  } catch (e) {
    res.status(500).send("發送失敗：" + e.message);
  }
});

app.get("/", (req, res) => res.send("MeetBot 後端運作中 ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MeetBot 後端啟動，port ${PORT}`));
```

存檔 Commit，等部署完成後開啟：
```
https://meetbot-backend.onrender.com/test-me
