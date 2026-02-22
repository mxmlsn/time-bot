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
    { name: 'Стамбул', zone: 'Europe/Istanbul', codes: ['с', 'ist', 'стамбик'], sort: 1 },
    { name: 'Бангкок', zone: 'Asia/Bangkok', codes: ['б', 'bkk', 'бкк'], sort: 2 },
    { name: 'Париж', zone: 'Europe/Paris', codes: ['п', 'p'], sort: 3 },
    { name: 'Нью-Йорк', zone: 'America/New_York', codes: ['н', 'ny', 'ню'], sort: 4 }
];

// Welcome animation URL
const WELCOME_ANIMATION = "https://raw.githubusercontent.com/mxmlsn/time-bot/main/welcome.mp4?v=3";

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

async function getCalendarSettings(chatId) {
    if (!redis) return { enabled: true, title: "QW meet" };
    try {
        await redis.connect().catch(() => {});
        const data = await redis.get(`chat:${chatId}:calendar`);
        return data ? JSON.parse(data) : { enabled: true, title: "QW meet" };
    } catch (e) {
        console.error('Redis get calendar error:', e.message);
        return { enabled: true, title: "QW meet" };
    }
}

async function saveCalendarSettings(chatId, settings) {
    if (!redis) return false;
    try {
        await redis.connect().catch(() => {});
        await redis.set(`chat:${chatId}:calendar`, JSON.stringify(settings));
        return true;
    } catch (e) {
        console.error('Redis set calendar error:', e.message);
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
    return new RegExp(`\\b(\\d{1,2})(?:[:\.](\\d{2}))?\\s*(${allCodes})(?![a-zа-яёA-ZА-ЯЁ0-9])`, 'i');
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
        "QW time bot — самый быстрый способ собрать все часовые пояса вместе внутри телеграм.",
        "",
        "Жми /addcity, чтобы добавить нужный город.",
        "",
        `Сейчас уже добавлены ${cityNames}.`,
        "Жми на /removecity, если хочешь что-то удалить.",
        "",
        "Актуальный список /list",
        "Настрой календарь /calendar",
        "За инструкцией /help",
        "",
        "Добавляй @qwtimebot в чат команды!"
    ].join("\n");

    try {
        await ctx.replyWithAnimation(WELCOME_ANIMATION, { caption });
    } catch (e) {
        await ctx.reply(caption);
    }
});

bot.command("help", async (ctx) => {
    const chatId = ctx.chat.id;
    const cities = await getChatCities(chatId);
    const cityNames = cities.map(c => c.name).join(', ');

    const caption = [
        "QW time bot — самый быстрый способ собрать все часовые пояса вместе внутри телеграм.",
        "",
        "Жми /addcity, чтобы добавить нужный город.",
        "",
        `Сейчас уже добавлены ${cityNames}.`,
        "Жми на /removecity, если хочешь что-то удалить.",
        "",
        "Актуальный список /list",
        "Настрой календарь /calendar",
        "За инструкцией /help",
        "",
        "Добавляй @qwtimebot в чат команды!"
    ].join("\n");

    try {
        await ctx.replyWithAnimation(WELCOME_ANIMATION, { caption });
    } catch (e) {
        await ctx.reply(caption);
    }
});

bot.command("list", async (ctx) => {
    const chatId = ctx.chat.id;
    const cities = await getChatCities(chatId);

    const now = Date.now();
    let cityTimes = [];
    
    // Get time for each city
    for (const city of cities) {
        const time = getTimeInCity(now, city.zone);
        const tags = city.codes.join(' ');
        const [hours, minutes] = time.split(':').map(n => parseInt(n));
        cityTimes.push({ time, city: city.name, tags, hours, minutes });
    }
    
    // Sort by time (hours then minutes)
    cityTimes.sort((a, b) => {
        if (a.hours !== b.hours) return a.hours - b.hours;
        return a.minutes - b.minutes;
    });
    
    let lines = [];
    for (const ct of cityTimes) {
        lines.push(`<code>${ct.time}</code> — ${esc(ct.city)} — ${ct.tags}`);
    }
    lines.push("");
    lines.push("/help");
    lines.push("/addcity");
    lines.push("/removecity");
    lines.push("/calendar");
    lines.push("/list");

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

bot.command("addcity", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const args = ctx.message.text.split(/\s+/).slice(1);

    if (args.length === 0) {
        await setPending(chatId, userId, { step: 'ask_city' });
        await ctx.reply("Какой город хочешь добавить?\n\nЖми /exit чтобы отменить добавление.");
        return;
    }

    const cityName = args[0];
    
    // Check if city already exists
    const currentCities = await getChatCities(chatId);
    const existingCity = currentCities.find(c => c.name.toLowerCase() === capitalizeCity(cityName).toLowerCase());
    if (existingCity) {
        await ctx.reply(`Город ${existingCity.name} уже добавлен.\nТеги — ${existingCity.codes.join(' ')}`);
        return;
    }
    
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
            "Перечисли через пробел.\n\n" +
            "Жми /exit чтобы отменить добавление."
        );
        return;
    }

    // Multiple results
    let choiceText = `${capitalizeCity(cityName)} — не один такой. Какой из них?\nОтветь цифрой.\n\n`;
    results.forEach((r, i) => {
        choiceText += `${i + 1}. ${r.name}\n`;
    });
    choiceText += '\n\nЖми /exit чтобы отменить добавление.';

    await setPending(chatId, userId, {
        step: 'choose_city',
        cityName: capitalizeCity(cityName),
        results: results
    });
    await ctx.reply(choiceText);
});

bot.command("no", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const pending = await getPending(chatId, userId);

    if (!pending || pending.step !== 'ask_tags' || !pending.savedCodes) {
        return; // No pending add city flow or no saved codes
    }

    if (pending.savedCodes.length === 0) {
        await deletePending(chatId, userId);
        await ctx.reply("Не указано ни одного тега. Добавление отменено.");
        return;
    }

    const currentCities = await getChatCities(chatId);
    
    // Check if city already exists
    const existingCity = currentCities.find(c => c.name.toLowerCase() === pending.cityName.toLowerCase());
    if (existingCity) {
        await deletePending(chatId, userId);
        await ctx.reply(`Город ${existingCity.name} уже добавлен.\nТеги — ${existingCity.codes.join(' ')}`);
        return;
    }
    
    const newCity = {
        name: pending.cityName,
        zone: pending.zone,
        codes: pending.savedCodes,
        sort: currentCities.length + 1
    };
    currentCities.push(newCity);
    await saveChatCities(chatId, currentCities);
    await deletePending(chatId, userId);
    await ctx.reply(`Добавлен город ${newCity.name}.\nТеги — ${pending.savedCodes.join(' ')}`);
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

bot.command("calendar", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const args = ctx.message.text.split(/\s+/).slice(1);
    const settings = await getCalendarSettings(chatId);

    if (args.length === 0) {
        // Show current status
        if (settings.enabled) {
            await setPending(chatId, userId, { step: 'rename_calendar' });
            await ctx.reply(
                `Ссылка на Google Calendar активна.\nНазвание: <b>${esc(settings.title)}</b>\n\nНапиши новое название чтобы переименовать.\nНажми /off если ссылка не нужна.\n\nНичего не менять? Жми /skip`,
                { parse_mode: "HTML" }
            );
        } else {
            await ctx.reply(
                `Календарная ссылка выключена.\n\nЧтобы включить, нажми /on`
            );
        }
        return;
    }

    // Set new title and enable
    const newTitle = args.join(' ');
    await saveCalendarSettings(chatId, { enabled: true, title: newTitle });
    await ctx.reply(`Ссылка на Google Calendar активна.\nНазвание: <b>${esc(newTitle)}</b>\n\nНапиши новое название чтобы переименовать.\nНажми /off если ссылка не нужна.\n\nНичего не менять? Жми /skip`, { parse_mode: "HTML" });
});

bot.command("off", async (ctx) => {
    const chatId = ctx.chat.id;
    const settings = await getCalendarSettings(chatId);
    await saveCalendarSettings(chatId, { ...settings, enabled: false });
    await ctx.reply(`Календарная ссылка выключена.\n\nЧтобы включить, нажми /on и напиши название встречи.`);
});

bot.command("on", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const args = ctx.message.text.split(/\s+/).slice(1);

    if (args.length === 0) {
        await setPending(chatId, userId, { step: 'ask_calendar_title' });
        await ctx.reply("Какое название встречи использовать по умолчанию?");
        return;
    }

    const newTitle = args.join(' ');
    await saveCalendarSettings(chatId, { enabled: true, title: newTitle });
    await ctx.reply(`Ссылка на Google Calendar активна.\nНазвание: <b>${esc(newTitle)}</b>\n\nНапиши новое название чтобы переименовать.\nНажми /off если ссылка не нужна.\n\nНичего не менять? Жми /skip`, { parse_mode: "HTML" });
});

bot.command("skip", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const settings = await getCalendarSettings(chatId);
    await deletePending(chatId, userId);
    await ctx.reply(`Ок, название осталось прежним — <b>${esc(settings.title)}</b>`, { parse_mode: "HTML" });
});

bot.command("exit", async (ctx) => {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const pending = await getPending(chatId, userId);
    
    // Silently cancel if in addcity flow
    if (pending && (pending.step === 'ask_city' || pending.step === 'choose_city' || pending.step === 'ask_tags')) {
        await deletePending(chatId, userId);
        // No reply - silent exit
    }
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
            
            // Check if city already exists
            const currentCities = await getChatCities(chatId);
            const existingCity = currentCities.find(c => c.name.toLowerCase() === capitalizeCity(cityName).toLowerCase());
            if (existingCity) {
                await deletePending(chatId, userId);
                await ctx.reply(`Город ${existingCity.name} уже добавлен.\nТеги — ${existingCity.codes.join(' ')}`);
                return;
            }
            
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
                    "Перечисли через пробел.\n\n" +
                    "Жми /exit чтобы отменить добавление."
                );
                return;
            }

            let choiceText = `${capitalizeCity(cityName)} — не один такой. Какой из них?\nОтветь цифрой.\n\n`;
            results.forEach((r, i) => {
                choiceText += `${i + 1}. ${r.name}\n`;
            });
            choiceText += '\n\nЖми /exit чтобы отменить добавление.';

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

            // Check if city already exists
            const currentCities = await getChatCities(chatId);
            const existingCity = currentCities.find(c => c.name.toLowerCase() === pending.cityName.toLowerCase());
            if (existingCity) {
                await deletePending(chatId, userId);
                await ctx.reply(`Город ${existingCity.name} уже добавлен.\nТеги — ${existingCity.codes.join(' ')}`);
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
                "Перечисли через пробел.\n\n" +
                "Жми /exit чтобы отменить добавление."
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

                const nonConflictCodes = codes.filter(code => !existingCodes.includes(code));
                
                // Save non-conflict codes in pending
                await setPending(chatId, userId, {
                    step: 'ask_tags',
                    cityName: pending.cityName,
                    zone: pending.zone,
                    savedCodes: nonConflictCodes
                });

                const plural = conflicts.length > 1;
                await ctx.reply(
                    `${conflictDetails}\n\n${plural ? 'Эти теги уже заняты' : 'Этот тег уже занят'}.\nЧто-нибудь другое?\n\nНажми /no, если замена не нужна.\nЖми /exit чтобы отменить добавление.`
                );
                return;
            }

            // Check if city already exists (race condition protection)
            const existingCity = currentCities.find(c => c.name.toLowerCase() === pending.cityName.toLowerCase());
            if (existingCity) {
                await deletePending(chatId, userId);
                await ctx.reply(`Город ${existingCity.name} уже добавлен.\nТеги — ${existingCity.codes.join(' ')}`);
                return;
            }

            // Merge with saved codes if any
            const allCodes = pending.savedCodes ? [...pending.savedCodes, ...codes] : codes;

            const newCity = {
                name: pending.cityName,
                zone: pending.zone,
                codes: allCodes,
                sort: currentCities.length + 1
            };
            currentCities.push(newCity);
            await saveChatCities(chatId, currentCities);
            await deletePending(chatId, userId);
            await ctx.reply(`Добавлен город ${newCity.name}.\nТеги — ${allCodes.join(' ')}`);
            return;
        }

        if (pending.step === 'remove_city_choice') {
            const indices = text.split(/\s+/).map(s => parseInt(s) - 1);
            const validIndices = indices.filter(i => !isNaN(i) && i >= 0 && i < pending.cities.length);
            
            if (validIndices.length === 0) {
                // Silently cancel if input is invalid
                await deletePending(chatId, userId);
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

        if (pending.step === 'ask_calendar_title') {
            const newTitle = text.trim();
            if (newTitle.length === 0) {
                await ctx.reply("Укажи название встречи.");
                return;
            }
            
            await saveCalendarSettings(chatId, { enabled: true, title: newTitle });
            // Keep pending state active to allow multiple renames
            await setPending(chatId, userId, { step: 'rename_calendar' });
            await ctx.reply(`Ссылка на Google Calendar активна.\nНазвание: <b>${esc(newTitle)}</b>\n\nНапиши новое название чтобы переименовать.\nНажми /off если ссылка не нужна.\n\nНичего не менять? Жми /skip`, { parse_mode: "HTML" });
            return;
        }

        if (pending.step === 'rename_calendar') {
            const newTitle = text.trim();
            if (newTitle.length === 0) {
                await ctx.reply("Укажи название встречи.");
                return;
            }
            
            await saveCalendarSettings(chatId, { enabled: true, title: newTitle });
            // Keep pending state active to allow multiple renames
            // No need to call setPending again - state is already 'rename_calendar'
            await ctx.reply(`Ссылка на Google Calendar активна.\nНазвание: <b>${esc(newTitle)}</b>\n\nНапиши новое название чтобы переименовать.\nНажми /off если ссылка не нужна.\n\nНичего не менять? Жми /skip`, { parse_mode: "HTML" });
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

    // Get source city date for comparison (YYYY-MM-DD string)
    const sourceCityDateStr = new Date(absoluteTargetTime).toLocaleDateString("en-CA", { 
        timeZone: sourceCity.zone
    });

    let resultLines = [];
    for (let city of cities) {
        const timeString = getTimeInCity(absoluteTargetTime, city.zone);
        const [hours, minutes] = timeString.split(':').map(n => parseInt(n));
        
        // Get date in this city (YYYY-MM-DD string)
        const cityDateStr = new Date(absoluteTargetTime).toLocaleDateString("en-CA", { 
            timeZone: city.zone
        });
        
        // Compare dates
        let dayLabel = '';
        if (cityDateStr > sourceCityDateStr) {
            dayLabel = ' →';
        } else if (cityDateStr < sourceCityDateStr) {
            dayLabel = ' ←';
        }
        
        resultLines.push({ 
            hours, 
            minutes, 
            text: `<code>${timeString}</code> — ${esc(city.name)}${dayLabel}` 
        });
    }
    // Sort by time (hours then minutes)
    resultLines.sort((a, b) => {
        if (a.hours !== b.hours) return a.hours - b.hours;
        return a.minutes - b.minutes;
    });
    let replyText = resultLines.map(line => line.text).join('\n');

    const calendarSettings = await getCalendarSettings(chatId);
    
    if (calendarSettings.enabled) {
        const startDateObj = new Date(absoluteTargetTime);
        const endDateObj = new Date(absoluteTargetTime + 60 * 60 * 1000);
        const startStr = formatGoogleDate(startDateObj);
        const endStr = formatGoogleDate(endDateObj);
        const eventTitle = encodeURIComponent(calendarSettings.title);
        const googleUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${eventTitle}&dates=${startStr}/${endStr}`;

        replyText += `\n\n<a href="${googleUrl}">⨁ в календарь</a>`;
    }

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
