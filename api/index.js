const { Bot, webhookCallback } = require("grammy");

// Инициализация бота
const bot = new Bot(process.env.BOT_TOKEN);

// Названия городов и их часовые пояса (IANA)
const CITIES = {
    'м': { name: 'Москва', zone: 'Europe/Moscow', sort: 4 },
    'п': { name: 'Париж', zone: 'Europe/Paris', sort: 1 },
    'е': { name: 'Ереван', zone: 'Asia/Yerevan', sort: 2 },
    'б': { name: 'Буэнос-Айрес', zone: 'America/Argentina/Buenos_Aires', sort: 3 }
};

// Регулярное выражение для поиска времени
const regex = /(\d{1,2})(?:[:\.](\d{2}))?\s*([мМпПеЕбБ])/i;

bot.on("message", async (ctx) => {
    const text = ctx.message.text;
    const match = text.match(regex);

    if (!match) return;

    let hours = parseInt(match[1]);
    let minutes = match[2] ? parseInt(match[2]) : 0;
    const cityCode = match[3].toLowerCase();

    if (hours > 23 || minutes > 59) return;

    const sourceCity = CITIES[cityCode];
    if (!sourceCity) return;

    // --- Блок вычисления времени ---
    
    // Получаем текущее время в строке ISO для исходного города
    const nowISO = new Date().toLocaleString("en-US", { timeZone: sourceCity.zone, hour12: false });
    const cityDateCurrent = new Date(nowISO); 
    
    // Создаем дату "цели" (введенное время) для исходного города
    const targetDate = new Date(nowISO);
    targetDate.setHours(hours, minutes, 0, 0);
    
    // Если введенное время уже прошло сегодня (например, сейчас 18:00, а ввели 10:00),
    // то, возможно, стоит оставить на сегодня (прошедшее) или перенести на завтра.
    // Обычно в таких ботах оставляют ближайшее время. Оставим "сегодня", даже если прошло.

    // Вычисляем абсолютное время (timestamp)
    const diff = targetDate.getTime() - cityDateCurrent.getTime();
    const absoluteTargetTime = new Date().getTime() + diff; // Это точное время события в UTC ms

    // Функция форматирования времени для вывода
    const getTimeInCity = (timestamp, timeZone) => {
        return new Date(timestamp).toLocaleTimeString("ru-RU", {
            timeZone: timeZone,
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // --- Формирование текста ответа ---
    let resultLines = [];

    for (let code in CITIES) {
        const city = CITIES[code];
        const timeString = getTimeInCity(absoluteTargetTime, city.zone);
        
        resultLines.push({
            sort: city.sort,
            text: `\`${timeString}\` — ${city.name}`
        });
    }

    resultLines.sort((a, b) => a.sort - b.sort);
    let replyText = resultLines.map(line => line.text).join('\n');

    // --- Блок создания ссылки на Google Calendar ---
    
    // Нам нужна дата в формате YYYYMMDDTHHMMSSZ (UTC)
    // toISOString() дает формат 2023-10-05T14:48:00.000Z
    // Нам нужно убрать лишние символы
    const startDateObj = new Date(absoluteTargetTime);
    const endDateObj = new Date(absoluteTargetTime + 60 * 60 * 1000); // Встреча на 1 час

    const formatGoogleDate = (date) => {
        return date.toISOString().replace(/-|:|\.\d\d\d/g, "");
    };

    const startStr = formatGoogleDate(startDateObj);
    const endStr = formatGoogleDate(endDateObj);

    // Ссылка
    const eventTitle = encodeURIComponent("qw meet"); // Название события
    const googleUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${eventTitle}&dates=${startStr}/${endStr}`;

    // Добавляем ссылку к тексту
    replyText += `\n\n[+ в календарь](${googleUrl})`;

    await ctx.reply(replyText, { 
        parse_mode: "Markdown", 
        disable_web_page_preview: true // Чтобы не было картинки-превью ссылки
    });
});

module.exports = webhookCallback(bot, "http");
