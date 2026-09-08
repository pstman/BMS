export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Smart Building BMS is online[cite: 1].", { status: 200 });
    }

    try {
      const update = await request.json();
      
      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        if (text.startsWith("/start")) {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "سلام استاد! سیستم مدیریت هوشمند ساختمان آماده‌ست[cite: 1]. فرمان خود را صادر کنید.");
        } else if (text.startsWith("/units")) {
          // نمونه خواندن از دیتابیس D1
          const { results } = await env.DB.prepare("SELECT * FROM units").all();
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `تعداد واحدهای ثبت شده: ${results.length}`);
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `دستور دریافت شد: ${text}`);
        }
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }
};

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown"
    })
  });
}