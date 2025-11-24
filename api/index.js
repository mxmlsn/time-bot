const { Bot, webhookCallback } = require("grammy");

// Инициализация бота
const bot = new Bot(process.env.BOT_TOKEN);

// 1. СЛОВАРЬ СООТВЕТСТВИЙ (Алиасы)
// Здесь мы указываем, какая буква к какому городу относится
const CITY_KEYS = {
    // Москва (м, m, v)
    'м': 'moscow', 
    'm': 'moscow', 
    'v': 'moscow',
    
    // Париж (п, p, з)
    'п': 'paris', 
    'p': 'paris', 
    'з': 'paris',
    
    // Буэнос-Айрес (б, b, запятая)
    'б': 'buenos', 
    'b': 'buenos', 
    ',': 'buenos',
    
    // Ереван (е, e, y, t)
    'е': 'yerevan', // кириллица
    'e': 'yerevan', // латиница
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
// Ищем число, затем (опционально) минуты, затем одну из разрешенных букв или символов
// Список букв: м, m, v, п, p, з, б, b, ,, е, e, y, t
const regex = /(\d{1,2})(?:[:\.](\d{2}))?\s*([мmvпpзбb,еeyt])/i;

bot.on("message", async (ctx) => {
    const text = ctx.message.text;
    
    // Проверка на совпадение
    const match = text.match(regex);
    if (!match) return;

    let hours = parseInt(match[1]);
    let minutes = match[2] ? parseInt(match[2]) : 0;
    
    // Получаем введенную букву и переводим в нижний регистр
    const inputChar = match[3].toLowerCase();

    // Проверяем валидность времени
    if (hours > 23 || minutes > 59) return;

    // Определяем ключ города (moscow, paris...) по введенной букве
    const cityKey = CITY_KEYS[inputChar];
    if (!cityKey) return; // Если буква не найдена в словаре

    const sourceCity = CITIES[cityKey];
    if (!sourceCity) return;

    // --- Блок вычисления времени ---
    
    // Получаем текущее время в строке ISO для исходного города
    const nowISO = new Date().toLocaleString("en-US", { timeZone: sourceCity.zone, hour12: false });
    const cityDateCurrent = new Date(nowISO); 
    
    // Создаем дату "цели"
    const targetDate = new Date(nowISO);
    targetDate.setHours(hours, minutes, 0, 0);
    
    // Вычисляем абсолютное время (timestamp)
    const diff = targetDate.getTime() - cityDateCurrent.getTime();
    const absoluteTargetTime = new Date().getTime() + diff;

    // Функция форматирования
    const getTimeInCity = (timestamp, timeZone) => {
        return new Date(timestamp).toLocaleTimeString("ru-RU", {
            timeZone: timeZone,
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // --- Формирование текста ответа ---
    let resultLines = [];

    for (let key in CITIES) {
        const city = CITIES[key];
        const timeString = getTimeInCity(absoluteTargetTime, city.zone);
        
        resultLines.push({
            sort: city.sort,
            text: `\`${timeString}\` — ${city.name}`
        });
    }

    // Сортировка
    resultLines.sort((a, b) => a.sort - b.sort);
    let replyText = resultLines.map(line => line.text).join('\n');

    // --- Ссылка на Google Calendar ---
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

    await ctx.reply(replyText, { 
        parse_mode: "Markdown", 
        disable_web_page_preview: true 
    });
});

module.exports = webhookCallback(bot, "http");
