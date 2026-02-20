const { Bot, webhookCallback } = require("grammy");
const Redis = require("ioredis");

const bot = new Bot(process.env.BOT_TOKEN);

// Redis connection optimized for serverless
let redis;
try {
    redis = new Redis(process.env.REDIS_URL, {
        tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        connectTimeout: 5000
    });
    redis.on('error', (err) => console.error('Redis error:', err.message));
} catch (e) {
    console.error('Redis init failed:', e.message);
    redis = null;
}

// DEFAULT CITIES (used when chat has no custom settings)
const DEFAULT_CITIES = [
    { name: 'Париж', zone: 'Europe/Paris', codes: ['п', 'p', 'g', 'з'], sort: 1 },
    { name: 'Ереван', zone: 'Asia/Yerevan', codes: ['е', 'e', 'y', 't'], sort: 2 },
    { name: 'Буэнос-Айрес', zone: 'America/Argentina/Buenos_Aires', codes: ['б', 'b', ',', 'и', 'ба', 'ba'], sort: 3 },
    { name: 'Москва', zone: 'Europe/Moscow', codes: ['м', 'm', 'v', 'ь'], sort: 4 }
];

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getChatCities(chatId) {
    if (!redis) return DEFAULT_CITIES;
    try {
        await redis.connect().catch(() => {});
        const stored = await redis.get(`chat:${chatId}:cities`);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (e) {
        console.error('Redis get error:', e.message);
    }
    return DEFAULT_CITIES;
}

async function saveChatCities(chatId, cities) {
    if (!redis) return false;
    try {
        await redis.connect().catch(() => {});
        await redis.set(`chat:${chatId}:cities`, JSON.stringify(cities));
        return true;
    } catch (e) {
        console.error('Redis set error:', e.message);
        return false;
    }
}

async function searchCityTimezone(cityName) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=5`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'TelegramTimeBot/2.0' }
        });
        if (!response.ok) return null;
        const results = await response.json();
        if (!results || results.length === 0) return null;

        const cities = [];
        for (const result of results) {
            const tzUrl = `https://timeapi.io/api/TimeZone/coordinate?latitude=${result.lat}&longitude=${result.lon}`;
            const tzResponse = await fetch(tzUrl);
            if (tzResponse.ok) {
                const tzData = await tzResponse.json();
                cities.push({
                    name: result.display_name,
                    zone: tzData.timeZone,
                    lat: result.lat,
                    lon: result.lon
                });
            }
        }
        return cities.length > 0 ? cities : null;
    } catch (e) {
        console.error('Nominatim API error:', e);
        return null;
    }
}

function buildRegex(cities) {
    const allCodes = cities.flatMap(c => c.codes).map(code =>
        code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('|');
    return new RegExp(`(\\d{1,2})(?:[:\.](\\d{2}))?\\s*(${allCodes})(?!\\s*[a-zа-яёA-ZА-ЯЁ])`, 'i');
}

function findCityByCode(cities, code) {
    const lowerCode = code.toLowerCase();
    return cities.find(city => city.codes.map(c => c.toLowerCase()).includes(lowerCode));
}

function getTimeInCity(timestamp, timeZone) {
    return new Date(timestamp).toLocaleTimeString("ru-RU", {
        timeZone, hour: '2-digit', minute: '2-digit'
    });
}

function formatGoogleDate(date) {
    return date.toISOString().replace(/-|:|\.\d\d\d/g, "");
}

// Escape HTML special chars
function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================
// COMMAND HANDLERS
// ============================================

bot.command("info", async (ctx) => {
    const text = [
        "Time Bot — конвертер времени",
        "",
        "Как работает:",
        "Пишешь время + код города — бот конвертирует для всех городов чата",
        "",
        "Примеры:",
        "  20м — 20:00 по Москве",
        "  15:30п — 15:30 по Парижу",
        "  10ba — 10:00 по Буэнос-Айресу",
        "",
        "Команды:",
        "  /cities — показать города чата",
        "  /addcity название код1 код2 — добавить город",
        "  /removecity код — удалить город",
        "  /info — эта справка",
        "",
        "Добавить город:",
        "  /addcity Лондон л l ld lon",
        "",
        "Бот сам найдёт таймзону. Если несколько вариантов — попросит выбрать.",
        "Коды не могут повторяться."
    ].join("\n");

    await ctx.reply(text);
});

bot.command("cities", async (ctx) => {
    const chatId = ctx.chat.id;
    const cities = await getChatCities(chatId);
    cities.sort((a, b) => a.sort - b.sort);

    let text = "Города этого чата:\n\n";
    for (const city of cities) {
        text += `${city.name} (${city.zone})\n`;
        text += `  коды: ${city.codes.join(', ')}\n\n`;
    }
    text += "Команды:\n";
    text += "  /addcity название коды — добавить\n";
    text += "  /removecity код — удалить\n";
    text += "  /info — справка";

    await ctx.reply(text);
});

bot.command("addcity", async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.message.text.split(/\s+/).slice(1);

    if (args.length < 2) {
        await ctx.reply(
            "Неправильный формат\n\n" +
            "Используй:\n" +
            "/addcity название код1 код2 ...\n\n" +
            "Пример:\n" +
            "/addcity Лондон л l ld lon"
        );
        return;
    }

    const cityName = args[0];
    const codes = args.slice(1).map(c => c.toLowerCase());

    const currentCities = await getChatCities(chatId);
    const existingCodes = currentCities.flatMap(c => c.codes.map(code => code.toLowerCase()));
    const conflicts = codes.filter(code => existingCodes.includes(code));

    if (conflicts.length > 0) {
        const conflictDetails = conflicts.map(code => {
            const city = currentCities.find(c =>
                c.codes.map(c => c.toLowerCase()).includes(code)
            );
            return `${code} — ${city.name}`;
        }).join('\n');

        await ctx.reply(
            `Ошибка: коды уже заняты\n\n${conflictDetails}\n\nВыбери другие коды для ${cityName}`
        );
        return;
    }

    await ctx.reply(`Ищу ${cityName}...`);
    const results = await searchCityTimezone(cityName);

    if (!results || results.length === 0) {
        await ctx.reply(`Не нашёл город "${cityName}"\nПопробуй другое название`);
        return;
    }

    if (results.length === 1) {
        const newCity = {
            name: cityName,
            zone: results[0].zone,
            codes: codes,
            sort: currentCities.length + 1
        };
        currentCities.push(newCity);
        await saveChatCities(chatId, currentCities);
        await ctx.reply(
            `Добавлен город:\n\n${cityName} (${results[0].zone})\nКоды: ${codes.join(', ')}`
        );
        return;
    }

    let choiceText = `Найдено несколько вариантов для "${cityName}":\n\n`;
    results.forEach((r, i) => {
        choiceText += `${i + 1}. ${r.name}\n   (${r.zone})\n\n`;
    });
    choiceText += `Ответь цифрой (1-${results.length}) чтобы выбрать`;

    if (redis) {
        try {
            await redis.connect().catch(() => {});
            await redis.setex(
                `pending:${chatId}:${ctx.from.id}`,
                300,
                JSON.stringify({ type: 'addcity', cityName, codes, results })
            );
        } catch (e) {
            console.error('Redis pending set error:', e.message);
        }
    }

    await ctx.reply(choiceText);
});

bot.command("removecity", async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.message.text.split(/\s+/).slice(1);

    if (args.length === 0) {
        await ctx.reply("Используй:\n/removecity код\n\nПример:\n/removecity м");
        return;
    }

    const code = args[0].toLowerCase();
    const currentCities = await getChatCities(chatId);
    const cityToRemove = findCityByCode(currentCities, code);

    if (!cityToRemove) {
        await ctx.reply(`Город с кодом "${code}" не найден`);
        return;
    }

    const filtered = currentCities.filter(c => c !== cityToRemove);
    if (filtered.length === 0) {
        await ctx.reply("Нельзя удалить последний город");
        return;
    }

    await saveChatCities(chatId, filtered);
    await ctx.reply(`Удалён город: ${cityToRemove.name}`);
});

// ============================================
// TIME CONVERSION + PENDING CHOICE HANDLER
// ============================================

bot.on("message", async (ctx) => {
    if (!ctx.message || !ctx.message.text) return;

    const text = ctx.message.text;
    const chatId = ctx.chat.id;

    // Check for pending choice (number reply)
    if (/^\d+$/.test(text.trim()) && redis) {
        try {
            await redis.connect().catch(() => {});
            const pendingStr = await redis.get(`pending:${chatId}:${ctx.from.id}`);
            const pending = pendingStr ? JSON.parse(pendingStr) : null;

            if (pending && pending.type === 'addcity') {
                const choice = parseInt(text.trim()) - 1;
                if (choice >= 0 && choice < pending.results.length) {
                    const selected = pending.results[choice];
                    const currentCities = await getChatCities(chatId);
                    const newCity = {
                        name: pending.cityName,
                        zone: selected.zone,
                        codes: pending.codes,
                        sort: currentCities.length + 1
                    };
                    currentCities.push(newCity);
                    await saveChatCities(chatId, currentCities);
                    await redis.del(`pending:${chatId}:${ctx.from.id}`);
                    await ctx.reply(
                        `Добавлен город:\n\n${pending.cityName} (${selected.zone})\nКоды: ${pending.codes.join(', ')}`
                    );
                    return;
                }
            }
        } catch (e) {
            // Not a pending choice, continue
        }
    }

    // Get chat cities and build regex
    const cities = await getChatCities(chatId);
    const regex = buildRegex(cities);
    const match = text.match(regex);
    if (!match) return;

    let hours = parseInt(match[1]);
    let minutes = match[2] ? parseInt(match[2]) : 0;
    const inputCode = match[3].toLowerCase();

    if (hours > 23 || minutes > 59) return;

    const sourceCity = findCityByCode(cities, inputCode);
    if (!sourceCity) return;

    const nowISO = new Date().toLocaleString("en-US", { timeZone: sourceCity.zone, hour12: false });
    const cityDateCurrent = new Date(nowISO);
    const targetDate = new Date(nowISO);
    targetDate.setHours(hours, minutes, 0, 0);
    const diff = targetDate.getTime() - cityDateCurrent.getTime();
    const absoluteTargetTime = new Date().getTime() + diff;

    let resultLines = [];
    for (let city of cities) {
        const timeString = getTimeInCity(absoluteTargetTime, city.zone);
        resultLines.push({ sort: city.sort, text: `<code>${timeString}</code> — ${esc(city.name)}` });
    }
    resultLines.sort((a, b) => a.sort - b.sort);
    let replyText = resultLines.map(line => line.text).join('\n');

    const startDateObj = new Date(absoluteTargetTime);
    const endDateObj = new Date(absoluteTargetTime + 60 * 60 * 1000);
    const startStr = formatGoogleDate(startDateObj);
    const endStr = formatGoogleDate(endDateObj);
    const eventTitle = encodeURIComponent("qw meet");
    const googleUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${eventTitle}&dates=${startStr}/${endStr}`;

    replyText += `\n\n<a href="${googleUrl}">⨁ в календарь</a>`;

    try {
        await ctx.reply(replyText, {
            parse_mode: "HTML",
            disable_web_page_preview: true
        });
    } catch (e) {
        console.error("Error sending message:", e);
    }
});

module.exports = webhookCallback(bot, "http");
