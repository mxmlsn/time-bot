const { Bot, webhookCallback } = require("grammy");

// Инициализация бота
// Токен будет браться из переменных среды Vercel
const bot = new Bot(process.env.BOT_TOKEN);

// Названия городов и их часовые пояса (IANA)
const CITIES = {
    'м': { name: 'Москва', zone: 'Europe/Moscow', sort: 4 },
    'п': { name: 'Париж', zone: 'Europe/Paris', sort: 1 },
    'е': { name: 'Ереван', zone: 'Asia/Yerevan', sort: 2 },
    'б': { name: 'Буэнос-Айрес', zone: 'America/Argentina/Buenos_Aires', sort: 3 }
};

// Регулярное выражение для поиска времени и города
// Ищет: число (часы), опционально :минуты, опционально пробел, буква города
const regex = /(\d{1,2})(?:[:\.](\d{2}))?\s*([мМпПеЕбБ])/i;

bot.on("message", async (ctx) => {
    const text = ctx.message.text;
    // Проверяем, есть ли в сообщении нужный паттерн
    const match = text.match(regex);

    if (!match) return;

    // Разбираем то, что нашли
    let hours = parseInt(match[1]);
    let minutes = match[2] ? parseInt(match[2]) : 0;
    const cityCode = match[3].toLowerCase(); // приводим к нижнему регистру

    // Валидация времени
    if (hours > 23 || minutes > 59) return;

    // Определяем исходный город
    const sourceCity = CITIES[cityCode];
    if (!sourceCity) return;

    // Создаем объект даты с учетом часового пояса ИСХОДНОГО города
    // Мы берем текущую дату и подставляем введенное время
    const now = new Date();
    // Формируем строку времени в ISO формате для правильного парсинга, но это сложно из-за поясов.
    // Проще использовать toLocaleString для конвертации.
    
    // 1. Создаем дату, предполагая что это UTC, чтобы потом сдвинуть
    let date = new Date();
    date.setUTCHours(hours, minutes, 0, 0);

    // Нам нужно найти момент времени (Timestamp), который соответствует введенным часам в этом городе.
    // Это немного хитро, так как JS работает в локальном времени сервера.
    // Используем Intl.DateTimeFormat для получения смещения.
    
    const getTimeInCity = (timestamp, timeZone) => {
        return new Date(timestamp).toLocaleTimeString("ru-RU", {
            timeZone: timeZone,
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Чтобы найти абсолютное время, нам нужно "подогнать" timestamp.
    // Самый простой способ без тяжелых библиотек:
    // Берем текущее время, переводим в строку в нужном поясе, сравниваем разницу часов и корректируем.
    
    // Но есть способ надежнее: библиотека Luxon (но мы не хотим усложнять package.json), 
    // поэтому сделаем через нативный Date и перебор.
    
    // Алгоритм:
    // 1. Берем текущее время UTC.
    // 2. Получаем часы/минуты в целевом городе.
    // 3. Вычисляем разницу между "сейчас" в городе и "введенным временем".
    // 4. Корректируем текущий timestamp на эту разницу.
    
    const nowISO = new Date().toLocaleString("en-US", { timeZone: sourceCity.zone, hour12: false });
    const cityDateCurrent = new Date(nowISO); 
    const targetDate = new Date(nowISO);
    targetDate.setHours(hours, minutes, 0, 0);
    
    // Разница в миллисекундах, которую нужно прибавить к "сейчас"
    const diff = targetDate.getTime() - cityDateCurrent.getTime();
    const absoluteTargetTime = new Date().getTime() + diff;

    // Формируем ответ
    let resultLines = [];

    for (let code in CITIES) {
        const city = CITIES[code];
        const timeString = getTimeInCity(absoluteTargetTime, city.zone);
        
        // Формат: `HH:MM` - Название
        resultLines.push({
            sort: city.sort,
            text: `\`${timeString}\` — ${city.name}`
        });
    }

    // Сортируем (Москва внизу)
    resultLines.sort((a, b) => a.sort - b.sort);

    // Собираем итоговое сообщение (только 4 строки)
    const replyText = resultLines.map(line => line.text).join('\n');

    await ctx.reply(replyText, { parse_mode: "Markdown" });
});

module.exports = webhookCallback(bot, "http");
