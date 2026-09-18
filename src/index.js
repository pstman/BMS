export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Smart Building BMS is online.", { status: 200 });
    }

    try {
      const update = await request.json();

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        if (text.startsWith("/start")) {
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            "سلام مهندس! سیستم مدیریت هوشمند ساختمان فعال است. دستور یا گزارش خود را بنویسید."
          );
        } else if (text.startsWith("/units")) {
          const { results } = await env.DB.prepare("SELECT * FROM units").all();
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            `تعداد واحدهای ثبت شده: ${results.length}`
          );
        } else if (text.trim() !== "") {
          // ارسال پیام ورودی به جمینای برای تحلیل یا پاسخ هوشمند
          const aiReply = await askGemini(env.GEMINI_API_KEY, text);
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, aiReply);
        }
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  }
};

async function askGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        parts: [
          {
            text: `تو دستیار مدیریت ساختمان BMS هستی. کوتاه، دقیق و بدون تعارف جواب بده:\n\n${prompt}`
          }
        ]
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  return "خطا در برقراری ارتباط با مدل هوش مصنوعی.";
}

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}
