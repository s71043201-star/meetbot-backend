const express = require("express");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(express.json());

const TOKEN = process.env.LINE_TOKEN;
const STORAGE_KEY = "meetbot-tasks-v1";
const REMINDER_KEY = "meetbot-reminders-v1";

// 成員對應 LINE User ID（之後填入）
const MEMBER_LINE_IDS = {
  "小明": process.env.LINE_ID_小明 || "",
  "怡君": process.env.LINE_ID_怡君 || "",
  "阿偉": process.env.LINE_ID_阿偉 || "",
  "美玲": process.env.LINE_ID_美玲 || "",
  "志豪": process.env.LINE_ID_志豪 || "",
  "逸":   process.env.LINE_ID_逸   || "",
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

// 每小時檢查一次是否需要提醒
cron.schedule("0 * * * *", async () => {
  console.log("🔍 檢查提醒中...");
  try {
    // 這裡之後會從 Storage 讀取任務
    console.log("✅ 提醒檢查完成");
  } catch (e) {
    console.error("提醒失敗:", e.message);
  }
});

app.get("/", (req, res) => res.send("MeetBot 後端運作中 ✅"));

// 手動觸發提醒測試
app.post("/test-notify", async (req, res) => {
  const { userId, message } = req.body;
  try {
    await sendLine(userId, message || "📋 MeetBot 測試訊息，後端連線成功！");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MeetBot 後端啟動，port ${PORT}`));
