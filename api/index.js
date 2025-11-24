const { Bot, webhookCallback } = require("grammy");

const bot = new Bot(process.env.BOT_TOKEN);

// 1. СЛОВАРЬ СООТВЕТСТВИЙ (Алиасы и ошибки раскладки)
const CITY_KEYS = {
    // МОСКВА (м, m, v, ь)
    'м': 'moscow', 
    'm': 'moscow', 
    'v': 'moscow',  // кнопка М на англ раскладке
    'ь': 'moscow',  // кнопка M на рус раскладке
    
    // ПАРИЖ (п, p, g, з)
    'п': 'paris', 
    'p': 'paris',   
    'g': 'paris',   // кнопка П на англ раскладке
    'з': 'paris',   // кнопка P на рус раскладке
    
    // БУЭНОС-АЙРЕС (б, b, запятая, и)
    'б': 'buenos', 
    'b': 'buenos',  
    ',': 'buenos',  // кнопка Б на англ раскладке
    'и': 'buenos',  // кнопка B на рус раскладке
    
    // ЕРЕВАН (е, e, y, t) — оставили как было
    'е': 'yerevan', 
    'e': 'yerevan', 
    'y': 'yerevan', 
    't': 'yerevan'  
};

// 2. ДАННЫЕ ГОРОДОВ
const CITIES = {
    'moscow': { name: 'Москва', zone: 'Europe/Moscow', sort: 4 },
    'paris': { name: 'Париж', zone: 'Europe/Paris', sort: 1 },
    'yerevan': { name: 'Ереван', zone: 'Asia/Yerevan', sort: 2 },
    'buenos': { name: 'Буэнос-Айрес', zone: 'America/Argentina/Buenos_Aires', sort: 3 }
};

// 3. РЕГУЛЯРНОЕ ВЫРАЖЕНИЕ
// Добавил в поиск новые буквы: ь, g, и
const regex = /(\d{1,2})(?:[:\.](\d{2}))?\s*([мmvьпpgзбb,иеeyt])/i;

bot.on("message", async (ctx) => {
    // ЗАЩИТА: Игнорируем сообщения без текста
    if (!ctx.message || !ctx.message.text) {
        return;
    }

    const text = ctx.message.text;
    
    // Проверка на совпадение
    const match = text.match(regex);
    if (!match) return;

    let hours = parseInt(match[1]);
    let minutes = match[2] ? parseInt(match[2]) : 0;
    
    // Приводим букву к нижнему регистру
    const inputChar = match[3].toLowerCase();

    // Валидация времени
    if (hours > 23 || minutes > 59) return;

    // Определяем город по букве
    const cityKey = CITY_KEYS[inputChar];
    if (!cityKey) return;

    const sourceCity = CITIES[cityKey];
    if (!sourceCity) return;

    // --- Вычисления времени ---
    const nowISO = new Date().toLocaleString("en-US", { timeZone: sourceCity.zone, hour12: false });
    const cityDateCurrent = new Date(nowISO); 
    
    const targetDate = new Date(nowISO);
    targetDate.setHours(hours, minutes, 0, 0);
    
    const diff = targetDate.getTime() - cityDateCurrent.getTime();
    const absoluteTargetTime = new Date().getTime() + diff;

    const getTimeInCity = (timestamp, timeZone) => {
        return new Date(timestamp).toLocaleTimeString("ru-RU", {
            timeZone: timeZone,
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // --- Формирование ответа ---
    let resultLines = [];

    for (let key in CITIES) {
        const city = CITIES[key];
        const timeString = getTimeInCity(absoluteTargetTime, city.zone);
        
        resultLines.push({
            sort: city.sort,
            text: `\`${timeString}\` — ${city.name}`
        });
    }

    resultLines.sort((a, b) => a.sort - b.sort);
    let replyText = resultLines.map(line => line.text).join('\n');

    // --- Ссылка на календарь ---
    const startDateObj = new Date(absoluteTargetTime);
    const endDateObj = new Date(absoluteTargetTime + 60 * 60 * 1000); 

    const formatGoogleDate = (date) => {
        return date.toISOString().replace(/-|:|\.\d\d\d/g, "");
    };

    const startStr = formatGoogleDate(startDateObj);
    const endStr = formatGoogleDate(endDateObj);

    const eventTitle = encodeURIComponent("Встреча");
    const googleUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${eventTitle}&dates=${startStr}/${endStr}`;

    replyText += `\n\n[+ в календарь](${googleUrl})`;

    try {
        await ctx.reply(replyText, { 
            parse_mode: "Markdown", 
            disable_web_page_preview: true 
        });
    } catch (e) {
        console.error("Error sending message:", e);
    }
});

module.exports = webhookCallback(bot, "http");
