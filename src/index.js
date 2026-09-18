export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Smart Building BMS is online.", { status: 200 });
    }

    try {
      const update = await request.json();
      const message = update.message;

      if (!message) {
        return new Response("OK", { status: 200 });
      }

      const chatId = message.chat.id;
      const text = (message.text || "").trim();

      // ۱. بررسی وضعیت کاربر در دیتابیس
      let currentUser = await env.DB.prepare("SELECT * FROM users WHERE chat_id = ?")
        .bind(chatId)
        .first();

      // ۲. دریافت کارت شماره تماس (Contact)
      if (message.contact) {
        let phone = message.contact.phone_number.replace(/\D/g, "");
        const rawLast10 = phone.slice(-10);
        const contactName = `${message.contact.first_name || ""} ${message.contact.last_name || ""}`.trim() || "کاربر";

        if (currentUser && currentUser.step === "waiting_phone_admin") {
          // ارتقای کاربر به مدیر و ورود به مرحله آنبوردینگ جمینای
          await env.DB.prepare(
            "UPDATE users SET phone = ?, full_name = ?, role = 'admin', step = 'gemini_onboarding' WHERE chat_id = ?"
          ).bind(phone, contactName, chatId).run();

          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            `درود جناب ${contactName}! شماره شما به عنوان مدیر تایید شد.\n\nاکنون مشخصات ساختمان را به زبان ساده بنویسید:\nنام ساختمان، تعداد واحدها (بزرگ، کوچک، تجاری) و شناسه‌های ثابت قبوض (گاز، برق، آب).`,
            removeKeyboard()
          );
        } else {
          // بررسی ساکن در دیتابیس
          const resident = await env.DB.prepare(
            "SELECT * FROM users WHERE phone LIKE ?"
          ).bind(`%${rawLast10}%`).first();

          if (resident) {
            await env.DB.prepare("UPDATE users SET chat_id = ?, step = 'active' WHERE phone = ?")
              .bind(chatId, resident.phone)
              .run();

            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              `سلام ${resident.full_name || "همسایه گرامی"}! هویت شما برای واحد ${resident.unit_number || "-"} تایید شد.`,
              removeKeyboard()
            );

            await sendResidentMenu(env.TELEGRAM_BOT_TOKEN, chatId, resident.unit_number);
          } else {
            // حذف وضعیت موقت
            if (currentUser) {
              await env.DB.prepare("DELETE FROM users WHERE chat_id = ?").bind(chatId).run();
            }
            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              "شماره شما در سیستم این ساختمان یافت نشد. لطفاً از مدیر ساختمان بخواهید ابتدا شماره و واحد شما را ثبت کند.",
              removeKeyboard()
            );
          }
        }
        return new Response("OK", { status: 200 });
      }

      // ۳. مدیریت دستور /start
      if (text === "/start") {
        if (currentUser && currentUser.role === "admin" && currentUser.step === "active") {
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            "سلام مهندس! پنل مدیریت ساختمان فعال است. دستور یا گزارش مد نظرت را بفرست."
          );
          return new Response("OK", { status: 200 });
        }

        if (currentUser && currentUser.role === "resident" && currentUser.step === "active") {
          await sendResidentMenu(env.TELEGRAM_BOT_TOKEN, chatId, currentUser.unit_number);
          return new Response("OK", { status: 200 });
        }

        // کاربر جدید یا ثبت‌نشده
        await sendMainMenu(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          "درود! به سامانه مدیریت هوشمند ساختمان خوش آمدید.\nلطفاً نقش خود را از گزینه‌های زیر انتخاب کنید:"
        );
        return new Response("OK", { status: 200 });
      }

      // ۴. انتخاب نقش از منوی متنی
      if (text === "🏢 ثبت‌نام به عنوان مدیر ساختمان") {
        await env.DB.prepare(
          "INSERT INTO users (phone, full_name, role, chat_id, step) VALUES (?, 'مدیر در حال ثبت', 'admin_pending', ?, 'waiting_phone_admin') ON CONFLICT(phone) DO UPDATE SET step='waiting_phone_admin', chat_id=?"
        ).bind(`temp_${chatId}`, chatId, chatId).run();

        await requestContact(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          "برای ثبت ساختمان به عنوان مدیر، لطفاً دکمه زیر را برای تایید شماره لمس کنید:"
        );
        return new Response("OK", { status: 200 });
      }

      if (text === "👤 من ساکن هستم") {
        await env.DB.prepare(
          "INSERT INTO users (phone, full_name, role, chat_id, step) VALUES (?, 'ساکن در حال ثبت', 'resident_pending', ?, 'waiting_phone_resident') ON CONFLICT(phone) DO UPDATE SET step='waiting_phone_resident', chat_id=?"
        ).bind(`temp_${chatId}`, chatId, chatId).run();

        await requestContact(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          "جهت ورود به پنل ساکن، لطفاً دکمه زیر را لمس کنید تا شماره همراه شما تایید شود:"
        );
        return new Response("OK", { status: 200 });
      }

      // ۵. منوی ساکنین
      if (text === "💰 صورت‌حساب و بدهی من") {
        await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          `📊 وضعیت حساب واحد ${currentUser?.unit_number || "-"}:\nکلیه حساب‌ها تا این لحظه تسویه است.`
        );
        return new Response("OK", { status: 200 });
      }

      if (text === "📩 پیام‌های اختصاصی مدیر") {
        const msgs = await env.DB.prepare(
          "SELECT message FROM announcements WHERE unit_number = ? ORDER BY id DESC LIMIT 5"
        ).bind(currentUser?.unit_number || "").all();

        if (msgs.results && msgs.results.length > 0) {
          const list = msgs.results.map(m => `📩 ${m.message}`).join("\n---\n");
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `پیام‌های اختصاصی مدیر:\n\n${list}`);
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "پیام جدیدی برای واحد شما ثبت نشده است.");
        }
        return new Response("OK", { status: 200 });
      }

      if (text === "📢 تابلو اعلانات ساختمان") {
        const board = await env.DB.prepare(
          "SELECT message FROM announcements WHERE unit_number IS NULL OR unit_number = '' ORDER BY id DESC LIMIT 5"
        ).all();

        if (board.results && board.results.length > 0) {
          const list = board.results.map(b => `📢 ${b.message}`).join("\n---\n");
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `تابلو اعلانات عمومی:\n\n${list}`);
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, "تابلو اعلانات عمومی خالی است.");
        }
        return new Response("OK", { status: 200 });
      }

      // ۶. مسیر مکالمه جمینای با مدیر (Onboarding)
      if (currentUser && currentUser.role === "admin" && currentUser.step === "gemini_onboarding") {
        const prompt = `
تو دستیار ثبت ساختمان هستی.
اطلاعات مورد نیاز: نام ساختمان، تفکیک واحدها (بزرگ، کوچک، تجاری)، شناسه‌های ثابت قبوض (گاز، برق، آب).
پیام مدیر: "${text}"

اگر اطلاعات ناقص است، خیلی کوتاه و خودمانی موارد باقی‌مانده را بپرس.
اگر کامل بود، دقیقاً در خط اول بنویس: "COMPLETED"
و در خط بعد این JSON را بده:
{"building_name": "...", "details": "..."}
`;
        const aiResponse = await askGemini(env.GEMINI_API_KEY, prompt);

        if (aiResponse.includes("COMPLETED")) {
          const jsonStr = aiResponse.split("COMPLETED")[1].trim();
          try {
            const bData = JSON.parse(jsonStr);
            const res = await env.DB.prepare(
              "INSERT INTO buildings (building_name, details) VALUES (?, ?) RETURNING id"
            ).bind(bData.building_name, bData.details).first();

            await env.DB.prepare(
              "UPDATE users SET step = 'active', building_id = ? WHERE chat_id = ?"
            ).bind(res.id, chatId).run();

            await sendTelegramMessage(
              env.TELEGRAM_BOT_TOKEN,
              chatId,
              `اطلاعات ساختمان "${bData.building_name}" با موفقیت ذخیره شد. پنل مدیریت شما فعال است.`
            );
          } catch (e) {
            await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, aiResponse);
          }
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, aiResponse);
        }
        return new Response("OK", { status: 200 });
      }

      // ۷. پیام‌های پیش‌فرض
      if (currentUser && currentUser.role === "admin") {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `دستور دریافت شد: ${text}`);
      } else {
        await sendMainMenu(env.TELEGRAM_BOT_TOKEN, chatId, "گزینه مورد نظر را انتخاب کنید:");
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 200 });
    }
  }
};

// کیبورد متنی استاندارد منوی اصلی
async function sendMainMenu(token, chatId, text) {
  const keyboard = {
    keyboard: [
      [{ text: "🏢 ثبت‌نام به عنوان مدیر ساختمان" }],
      [{ text: "👤 من ساکن هستم" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
  await sendTelegramMessage(token, chatId, text, keyboard);
}

// کیبورد درخواست شماره تماس
async function requestContact(token, chatId, text) {
  const keyboard = {
    keyboard: [
      [{ text: "📱 تایید و ارسال شماره همراه", request_contact: true }]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };
  await sendTelegramMessage(token, chatId, text, keyboard);
}

// کیبورد پنل ساکنین
async function sendResidentMenu(token, chatId, unitNumber) {
  const keyboard = {
    keyboard: [
      [{ text: "💰 صورت‌حساب و بدهی من" }],
      [{ text: "📩 پیام‌های اختصاصی مدیر" }],
      [{ text: "📢 تابلو اعلانات ساختمان" }]
    ],
    resize_keyboard: true
  };
  await sendTelegramMessage(token, chatId, `پنل واحد ${unitNumber || "-"} فعال شد:`, keyboard);
}

function removeKeyboard() {
  return { remove_keyboard: true };
}

async function sendTelegramMessage(token, chatId, text, replyMarkup = null) {
  const payload = { chat_id: chatId, text: text };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function askGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "خطا در برقراری ارتباط با هوش مصنوعی.";
}
