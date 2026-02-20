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
    { name: 'Москва', zone: 'Europe/Moscow', codes: ['м', 'm', 'msk', 'мск'], sort: 1 },
    { name: 'Бангкок', zone: 'Asia/Bangkok', codes: ['б', 'b', 'bkk', 'бкк'], sort: 2 },
    { name: 'Ереван', zone: 'Asia/Yerevan', codes: ['е', 'e', 'evn', 'ерв'], sort: 3 }
];

// Welcome image URL
const WELCOME_IMAGE = "https://raw.githubusercontent.com/mxmlsn/time-bot/main/welcome%20img.png";

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
    return JSON.parse(JSON.stringify(DEFAULT_CITIES));
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

async function getPending(chatId, userId) {
    if (!redis) return null;
    try {
        await redis.connect().catch(() => {});
        const data = await redis.get(`pending:${chatId}:${userId}`);
        return data ? JSON.parse(data) : null;
    } catch (e) {
        console.error('Redis get pending error:', e.message);
        return null;
    }
}

async function setPending(chatId, userId, data, ttlSeconds = 300) {
    if (!redis) return false;
    try {
        await redis.connect().catch(() => {});
        await redis.setex(`pending:${chatId}:${userId}`, ttlSeconds, JSON.stringify(data));
        return true;
    } catch (e) {
        console.error('Redis set pending error:', e.message);
        return false;
    }
}

async function deletePending(chatId, userId) {
    if (!redis) return false;
    try {
        await redis.connect().catch(() => {});
        await redis.del(`pending:${chatId}:${userId}`);
        return true;
    } catch (e) {
        console.error('Redis del pending error:', e.message);
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

function capitalizeCity(name) {
    // Capitalize first letter, keep rest as-is (handles Буэнос-Айрес correctly)
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function buildRegex(cities) {
    const allCodes = cities.flatMap(c => c.codes).map(code =>
        code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('|');
    return new RegExp(`(\\d{1,2})(?:[:\.](\\d{2}))?\\s*(${allCodes})(?![a-zа-яёA-ZА-ЯЁ])`, 'i');
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

// /start or when bot added to chat
bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    const cities = await getChatCities(chatId);
    const cityNames = cities.map(c => c.name).join(', ');

    const caption = [
        "QW time bot — самый быстрый способ собрать все часовые пояса вместе внутри Телеграм.",
        "",
        `Жми /addcity, чтобы добавить нужный город.`,
        "",
        `Сейчас уже добавлены ${cityNames}.`,
        "Жми на /removecity, если хочешь что-то удалить.",
        "",
        "Актуальный список /list",
        "За инструкцией /help"
    ].join("\n");

    try {
        await ctx.replyWithPhoto(WELCOME_IMAGE, { caption });
    } catch (e) {
        await ctx.reply(caption);
    }
});

bot.command("help", async (ctx) => {
    const caption = [
        "QW time bot — самый быстрый способ собрать все часовые пояса вместе внутри Телеграм.",
        "",
        "Пишешь время и код города — бот покажет это время во всех городах чата.",
        "",
        "Пример:",
        "18п — покажет 18:00 по Парижу и сколько это в каждом городе чата.",
        "",
        "Код — сокращение, которое задаётся при добавлении города (п, ba, lon — что угодно).",
        "",
        "Команды:",
        "/list — города и их коды",
        "/addcity название код код — добавить (пишите просто слова через пробел)",
        "/removecity код — удалить"
    ].join("\n");

    try {
        await ctx.replyWithPhoto(WELCOME_IMAGE, { caption });
    } catch (e) {
        await ctx.reply(caption);
    }
});

bot.command("list", async (ctx) => {
    const chatId = ctx.chat.id;
    const cities = await getChatCities(chatId);
    cities.sort((a, b) => a.sort - b.sort);

    const now = Date.now();
    let lines = [];
    
    // Current times
    for (const city of cities) {
        const time = getTimeInCity(now, city.zone);
        lines.push(`${time} ${city.name}`);
    }
    lines.push("");
    
    // Tags
    for (const city of cities) {
        const tags = city.codes.join(' ');
        lines.push(`${tags} │ ${city.name}`);
    }
    lines.push("");
    lines.push("/help");
    lines.push("/addcity");
    lines.push("/removecity");

    await ctx.reply(lines.join("\n"));
});

bot.command("addcity", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const args = ctx.message.text.split(/\s+/).slice(1);

    if (args.length === 0) {
        await setPending(chatId, userId, { step: 'ask_city' });
        await ctx.reply("Какой город хочешь добавить?");
        return;
    }

    const cityName = args[0];
    await ctx.reply(`Ищу ${capitalizeCity(cityName)}...`);
    const results = await searchCityTimezone(cityName);

    if (!results || results.length === 0) {
        await ctx.reply(`Город "${capitalizeCity(cityName)}" не найден. Попробуй другое название.`);
        return;
    }

    if (results.length === 1) {
        await setPending(chatId, userId, {
            step: 'ask_tags',
            cityName: capitalizeCity(cityName),
            zone: results[0].zone
        });
        await ctx.reply(
            "По каким тегам запомнить город?\n" +
            "Например, для Стамбула удобно\n" +
            "с  ст  ist  стамбик\n\n" +
            "Перечисли через пробел."
        );
        return;
    }

    // Multiple results
    let choiceText = `${capitalizeCity(cityName)} — не один такой. Какой из них?\nОтветь цифрой.\n\n`;
    results.forEach((r, i) => {
        choiceText += `${i + 1}. ${r.name}\n`;
    });

    await setPending(chatId, userId, {
        step: 'choose_city',
        cityName: capitalizeCity(cityName),
        results: results
    });
    await ctx.reply(choiceText);
});

bot.command("removecity", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const args = ctx.message.text.split(/\s+/).slice(1);
    const currentCities = await getChatCities(chatId);

    if (args.length === 0) {
        // Show list for selection
        let text = "Какой город удалить?\n\n";
        currentCities.forEach((city, i) => {
            text += `${i + 1}. ${city.name}\n`;
        });
        text += "\nОтветь цифрой или несколькими через пробел.";

        await setPending(chatId, userId, {
            step: 'remove_city_choice',
            cities: currentCities
        });
        await ctx.reply(text);
        return;
    }

    const input = args.join(' ').toLowerCase();
    
    // Search by code first, then by name
    let cityToRemove = findCityByCode(currentCities, input);
    if (!cityToRemove) {
        cityToRemove = currentCities.find(c => c.name.toLowerCase() === input);
    }

    if (!cityToRemove) {
        await ctx.reply(`Город "${capitalizeCity(input)}" не найден (ни по коду, ни по названию).`);
        return;
    }

    const filtered = currentCities.filter(c => c !== cityToRemove);
    if (filtered.length === 0) {
        await ctx.reply("Нельзя удалить последний город.");
        return;
    }

    await saveChatCities(chatId, filtered);
    await ctx.reply(`Город ${cityToRemove.name} удалён.`);
});

// ============================================
// MESSAGE HANDLER (pending states + time conversion)
// ============================================

bot.on("message", async (ctx) => {
    if (!ctx.message || !ctx.message.text) return;

    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;

    // Check for pending state
    const pending = await getPending(chatId, userId);

    if (pending) {
        // Handle pending workflows
        if (pending.step === 'ask_city') {
            const cityName = text;
            await ctx.reply(`Ищу ${capitalizeCity(cityName)}...`);
            const results = await searchCityTimezone(cityName);

            if (!results || results.length === 0) {
                await deletePending(chatId, userId);
                await ctx.reply(`Город "${capitalizeCity(cityName)}" не найден. Попробуй другое название.`);
                return;
            }

            if (results.length === 1) {
                await setPending(chatId, userId, {
                    step: 'ask_tags',
                    cityName: capitalizeCity(cityName),
                    zone: results[0].zone
                });
                await ctx.reply(
                    "По каким тегам запомнить город?\n" +
                    "Например, для Стамбула удобно\n" +
                    "с  ст  ist  стамбик\n\n" +
                    "Перечисли через пробел."
                );
                return;
            }

            let choiceText = `${capitalizeCity(cityName)} — не один такой. Какой из них?\nОтветь цифрой.\n\n`;
            results.forEach((r, i) => {
                choiceText += `${i + 1}. ${r.name}\n`;
            });

            await setPending(chatId, userId, {
                step: 'choose_city',
                cityName: capitalizeCity(cityName),
                results: results
            });
            await ctx.reply(choiceText);
            return;
        }

        if (pending.step === 'choose_city') {
            const choice = parseInt(text) - 1;
            if (isNaN(choice) || choice < 0 || choice >= pending.results.length) {
                await ctx.reply("Выбери номер из списка.");
                return;
            }

            const selected = pending.results[choice];
            await setPending(chatId, userId, {
                step: 'ask_tags',
                cityName: pending.cityName,
                zone: selected.zone
            });
            await ctx.reply(
                "По каким тегам запомнить город?\n" +
                "Например, для Стамбула удобно\n" +
                "с  ст  ist  стамбик\n\n" +
                "Перечисли через пробел."
            );
            return;
        }

        if (pending.step === 'ask_tags') {
            const codes = text.split(/\s+/).map(c => c.toLowerCase()).filter(c => c.length > 0);
            
            if (codes.length === 0) {
                await ctx.reply("Укажи хотя бы один тег.");
                return;
            }

            const currentCities = await getChatCities(chatId);
            const existingCodes = currentCities.flatMap(c => c.codes.map(code => code.toLowerCase()));
            const conflicts = codes.filter(code => existingCodes.includes(code));

            if (conflicts.length > 0) {
                const conflictDetails = conflicts.map(code => {
                    const city = currentCities.find(c =>
                        c.codes.map(c => c.toLowerCase()).includes(code)
                    );
                    return `✖ ${code} — ${city.name}`;
                }).join('\n');

                const plural = conflicts.length > 1;
                await ctx.reply(
                    `${conflictDetails}\n\n${plural ? 'Эти теги уже заняты' : 'Этот тег уже занят'}.\nЧто-нибудь другое?\n\nНажми /по, если замена не нужна.`
                );
                return;
            }

            const newCity = {
                name: pending.cityName,
                zone: pending.zone,
                codes: codes,
                sort: currentCities.length + 1
            };
            currentCities.push(newCity);
            await saveChatCities(chatId, currentCities);
            await deletePending(chatId, userId);
            await ctx.reply(`Добавлен город ${newCity.name}.\nТеги — ${codes.join(' ')}`);
            return;
        }

        if (pending.step === 'remove_city_choice') {
            const indices = text.split(/\s+/).map(s => parseInt(s) - 1);
            const validIndices = indices.filter(i => !isNaN(i) && i >= 0 && i < pending.cities.length);
            
            if (validIndices.length === 0) {
                await ctx.reply("Выбери номер из списка.");
                return;
            }

            const currentCities = await getChatCities(chatId);
            const toRemove = validIndices.map(i => pending.cities[i].name);
            const filtered = currentCities.filter(c => !toRemove.includes(c.name));

            if (filtered.length === 0) {
                await ctx.reply("Нельзя удалить все города.");
                return;
            }

            await saveChatCities(chatId, filtered);
            await deletePending(chatId, userId);
            
            const plural = toRemove.length > 1;
            await ctx.reply(`${plural ? 'Города' : 'Город'} ${toRemove.join(', ')} ${plural ? 'удалены' : 'удалён'}.`);
            return;
        }
    }

    // Time conversion
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
