const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TOKEN = process.env.LINE_TOKEN;

const MEMBERS = {
  "逸":   "Uece4baaf97cfab39ad79c6ed0ee55d03",
  "怡君": "Ue69dbd040159f69636c08dfd9568aa63",
  "阿偉": "U1307dd217e15b4ef777f8f0561c2e589",
  "美玲": "Uc8e074d50b3b20581945f5c6aca80d1d",
  "志豪": "U7c71775e251051b61994eda22ddc2bec",
};

async function sendLine(userId, message) {
  if (!userId) return;
  await axios.post("https://api.line.me/v2/bot/message/push", {
    to: userId,
    messages: [{ type: "text", text: message }]
  }, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
}

function daysLeft(deadline) {
  const today = new Date().toISOString().slice(0, 10);
  return Math.ceil((new Date(deadline) - new Date(today)) / 86400000);
}
app.post("/webhook", (req, res) => {
  const events = req.body.events || [];
  events.forEach(event => {
    if (event.type === "message") {
      console.log(`👤 User ID: ${event.source.userId} 說：${event.message.text}`);
    }
  });
  res.sendStatus(200);
});

app.post("/notify", async (req, res) => {
  const { tasks, reminders } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "缺少參數" });
  const hour = new Date().getHours();
  let sent = 0;
  for (const task of tasks) {
    if (task.done) continue;
    const dl = daysLeft(task.deadline);
    const userId = MEMBERS[task.assignee];
    if (!userId) continue;
    if (reminders.dayBefore.on && dl === reminders.dayBefore.days && hour === reminders.dayBefore.hour) {
      await sendLine(userId, `📋 任務提醒\n\n「${task.title}」\n負責人：${task.assignee}\n截止：${task.deadline}（剩 ${dl} 天）\n\n請記得完成 ✓`);
      sent++;
    }
    if (reminders.hourBefore.on && dl === 0 && hour === (23 - reminders.hourBefore.hours)) {
      await sendLine(userId, `⚡ 緊急提醒\n\n「${task.title}」\n負責人：${task.assignee}\n今天截止！剩約 ${reminders.hourBefore.hours} 小時\n\n請盡快完成 🔥`);
      sent++;
    }
  }
  res.json({ ok: true, sent });
});

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
