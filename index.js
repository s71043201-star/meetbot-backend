const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(express.json());

const TOKEN = process.env.LINE_TOKEN;

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

// 前端每小時呼叫這個，自動檢查並發送提醒
app.post("/check-reminders", async (req, res) => {
  const { tasks, reminders } = req.body;
  if (!tasks || !reminders) return res.status(400).json({ error: "缺少參數" });

  const now = new Date();
  const hour = now.getHours();
  const todayStr = now.toISOString().slice(0, 10);
  let sent = 0;

  for (const task of tasks) {
    if (task.done) continue;
    const dl = daysLeft(task.deadline);
    const userId = MEMBERS[task.assignee];
    if (!userId) continue;

    // 截止前 N 天提醒
    if (reminders.dayBefore?.on && dl === reminders.dayBefore.days && hour === reminders.dayBefore.hour) {
      await sendLine(userId,
        `📋 任務提醒 - MeetBot\n\n` +
        `「${task.title}」\n\n` +
        `負責人：${task.assignee}\n` +
        `截止日期：${task.deadline}（剩 ${dl} 天）\n\n` +
        `請記得完成 ✓`
      );
      console.log(`✅ 已提醒 ${task.assignee}：${task.title}`);
      sent++;
    }

    // 截止前 N 小時提醒
    if (reminders.hourBefore?.on && dl === 0) {
      const fireHour = 23 - reminders.hourBefore.hours;
      if (hour === fireHour) {
        await sendLine(userId,
          `⚡ 緊急提醒 - MeetBot\n\n` +
          `「${task.title}」\n\n` +
          `負責人：${task.assignee}\n` +
          `今天截止！剩約 ${reminders.hourBefore.hours} 小時\n\n` +
          `請盡快完成 🔥`
        );
        console.log(`⚡ 緊急提醒 ${task.assignee}：${task.title}`);
        sent++;
      }
    }

    // 逾期提醒
    if (reminders.overdueAlert?.on && dl < 0) {
      await sendLine(userId,
        `🚨 逾期警示 - MeetBot\n\n` +
        `「${task.title}」\n\n` +
        `負責人：${task.assignee}\n` +
        `已逾期 ${Math.abs(dl)} 天！\n\n` +
        `請盡快處理 ⚠️`
      );
      console.log(`🚨 逾期警示 ${task.assignee}：${task.title}`);
      sent++;
    }
  }

  res.json({ ok: true, sent, hour, checked: tasks.length });
});

// 測試用
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
