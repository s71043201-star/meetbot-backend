const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(express.json());

const TOKEN = process.env.LINE_TOKEN;

// 接收 LINE 訊息，印出 User ID
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

app.get("/", (req, res) => res.send("MeetBot 後端運作中 ✅"));

app.post("/test-notify", async (req, res) => {
  const { userId, message } = req.body;
  try {
    await sendLine(userId, message || "📋 MeetBot 測試訊息成功！");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MeetBot 後端啟動，port ${PORT}`));
