const { Bot, webhookCallback } = require("grammy");
const { kv } = require("@vercel/kv");

const bot = new Bot(process.env.BOT_TOKEN);

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

// Get chat cities from KV or return defaults
async function getChatCities(chatId) {
    try {
        const stored = await kv.get(`chat:${chatId}:cities`);
        if (stored && Array.isArray(stored) && stored.length > 0) {
            return stored;
        }
    } catch (e) {
        console.error('KV get error:', e);
    }
    return DEFAULT_CITIES;
}

// Save chat cities to KV
async function saveChatCities(chatId, cities) {
    try {
        await kv.set(`chat:${chatId}:cities`, cities);
        return true;
    } catch (e) {
        console.error('KV set error:', e);
        return false;
    }
}

// Search city timezone via Nominatim API
async function searchCityTimezone(cityName) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=5`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'TelegramTimeBot/2.0' }
        });
        
        if (!response.ok) return null;
        
        const results = await response.json();
        if (!results || results.length === 0) return null;
        
        // Get timezone for each result
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

// Build regex from city codes
function buildRegex(cities) {
    const allCodes = cities.flatMap(c => c.codes).map(code => 
        code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex chars
    ).join('|');
    
    return new RegExp(`(\\d{1,2})(?:[:\.](\\d{2}))?\\s*(${allCodes})(?!\\s*[a-zа-яёA-ZА-ЯЁ])`, 'i');
}

// Find city by code
function findCityByCode(cities, code) {
    const lowerCode = code.toLowerCase();
    return cities.find(city => 
        city.codes.map(c => c.toLowerCase()).includes(lowerCode)
    );
}

// Format time in specific timezone
function getTimeInCity(timestamp, timeZone) {
    return new Date(timestamp).toLocaleTimeString("ru-RU", {
        timeZone: timeZone,
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Format Google Calendar date
function formatGoogleDate(date) {
    return date.toISOString().replace(/-|:|\.\d\d\d/g, "");
}

// ============================================
// COMMAND HANDLERS
// ============================================

// /cities - show current cities for chat
bot.command("cities", async (ctx) => {
    const chatId = ctx.chat.id;
    const cities = await getChatCities(chatId);
    
    let text = "🌍 **Города этого чата:**\n\n";
    
    cities.sort((a, b) => a.sort - b.sort);
    
    for (const city of cities) {
        const codes = city.codes.map(c => `\`${c}\``).join(', ');
        text += `• **${city.name}** (${city.zone})\n  коды: ${codes}\n\n`;
    }
    
    text += "Команды:\n";
    text += "`/addcity <название> <коды>` — добавить город\n";
    text += "`/removecity <код>` — удалить город\n";
    text += "`/reset` — вернуть дефолтные города";
    
    await ctx.reply(text, { parse_mode: "Markdown" });
});

// /addcity - add custom city
bot.command("addcity", async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.message.text.split(/\s+/).slice(1);
    
    if (args.length < 2) {
        await ctx.reply(
            "❌ Неправильный формат\n\n" +
            "Используй:\n" +
            "`/addcity <название> <код1> <код2> ...`\n\n" +
            "Пример:\n" +
            "`/addcity Лондон л l ld lon`",
            { parse_mode: "Markdown" }
        );
        return;
    }
    
    const cityName = args[0];
    const codes = args.slice(1).map(c => c.toLowerCase());
    
    // Validate codes uniqueness
    const currentCities = await getChatCities(chatId);
    const existingCodes = currentCities.flatMap(c => c.codes.map(code => code.toLowerCase()));
    
    const conflicts = codes.filter(code => existingCodes.includes(code));
    
    if (conflicts.length > 0) {
        const conflictDetails = conflicts.map(code => {
            const city = currentCities.find(c => 
                c.codes.map(c => c.toLowerCase()).includes(code)
            );
            return `\`${code}\` → ${city.name}`;
        }).join('\n');
        
        await ctx.reply(
            `❌ **Ошибка: коды уже заняты**\n\n${conflictDetails}\n\n` +
            `Выбери другие коды для ${cityName}`,
            { parse_mode: "Markdown" }
        );
        return;
    }
    
    // Search timezone via Nominatim
    await ctx.reply(`🔍 Ищу ${cityName}...`);
    
    const results = await searchCityTimezone(cityName);
    
    if (!results || results.length === 0) {
        await ctx.reply(
            `❌ Не нашёл город "${cityName}"\n\n` +
            `Попробуй другое название или укажи таймзону вручную:\n` +
            "`/addcity_tz <название> <timezone> <коды>`",
            { parse_mode: "Markdown" }
        );
        return;
    }
    
    if (results.length === 1) {
        // Single result - add immediately
        const newCity = {
            name: cityName,
            zone: results[0].zone,
            codes: codes,
            sort: currentCities.length + 1
        };
        
        currentCities.push(newCity);
        await saveChatCities(chatId, currentCities);
        
        await ctx.reply(
            `✅ **Добавлен город:**\n\n` +
            `${cityName} (${results[0].zone})\n` +
            `Коды: ${codes.map(c => `\`${c}\``).join(', ')}`,
            { parse_mode: "Markdown" }
        );
        return;
    }
    
    // Multiple results - ask user to choose
    let choiceText = `Найдено несколько вариантов для "${cityName}":\n\n`;
    
    results.forEach((r, i) => {
        choiceText += `${i + 1}. ${r.name}\n   (${r.zone})\n\n`;
    });
    
    choiceText += `Ответь цифрой (1-${results.length}) чтобы выбрать`;
    
    // Store pending choice in KV
    await kv.set(`pending:${chatId}:${ctx.from.id}`, {
        type: 'addcity',
        cityName: cityName,
        codes: codes,
        results: results
    }, { ex: 300 }); // expire in 5 minutes
    
    await ctx.reply(choiceText);
});

// /addcity_tz - add city with manual timezone
bot.command("addcity_tz", async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.message.text.split(/\s+/).slice(1);
    
    if (args.length < 3) {
        await ctx.reply(
            "❌ Неправильный формат\n\n" +
            "Используй:\n" +
            "`/addcity_tz <название> <timezone> <код1> <код2> ...`\n\n" +
            "Пример:\n" +
            "`/addcity_tz Лондон Europe/London л l ld`",
            { parse_mode: "Markdown" }
        );
        return;
    }
    
    const cityName = args[0];
    const timezone = args[1];
    const codes = args.slice(2).map(c => c.toLowerCase());
    
    // Validate codes uniqueness
    const currentCities = await getChatCities(chatId);
    const existingCodes = currentCities.flatMap(c => c.codes.map(code => code.toLowerCase()));
    
    const conflicts = codes.filter(code => existingCodes.includes(code));
    
    if (conflicts.length > 0) {
        const conflictDetails = conflicts.map(code => {
            const city = currentCities.find(c => 
                c.codes.map(c => c.toLowerCase()).includes(code)
            );
            return `\`${code}\` → ${city.name}`;
        }).join('\n');
        
        await ctx.reply(
            `❌ **Ошибка: коды уже заняты**\n\n${conflictDetails}\n\n` +
            `Выбери другие коды для ${cityName}`,
            { parse_mode: "Markdown" }
        );
        return;
    }
    
    // Add city
    const newCity = {
        name: cityName,
        zone: timezone,
        codes: codes,
        sort: currentCities.length + 1
    };
    
    currentCities.push(newCity);
    await saveChatCities(chatId, currentCities);
    
    await ctx.reply(
        `✅ **Добавлен город:**\n\n` +
        `${cityName} (${timezone})\n` +
        `Коды: ${codes.map(c => `\`${c}\``).join(', ')}`,
        { parse_mode: "Markdown" }
    );
});

// /removecity - remove city by code
bot.command("removecity", async (ctx) => {
    const chatId = ctx.chat.id;
    const args = ctx.message.text.split(/\s+/).slice(1);
    
    if (args.length === 0) {
        await ctx.reply(
            "❌ Неправильный формат\n\n" +
            "Используй:\n" +
            "`/removecity <код>`\n\n" +
            "Пример:\n" +
            "`/removecity м`",
            { parse_mode: "Markdown" }
        );
        return;
    }
    
    const code = args[0].toLowerCase();
    const currentCities = await getChatCities(chatId);
    
    const cityToRemove = findCityByCode(currentCities, code);
    
    if (!cityToRemove) {
        await ctx.reply(`❌ Город с кодом \`${code}\` не найден`, { parse_mode: "Markdown" });
        return;
    }
    
    const filtered = currentCities.filter(c => c !== cityToRemove);
    
    if (filtered.length === 0) {
        await ctx.reply(
            "❌ Нельзя удалить последний город\n\n" +
            "Должен остаться хотя бы один"
        );
        return;
    }
    
    await saveChatCities(chatId, filtered);
    
    await ctx.reply(`✅ Удалён город: **${cityToRemove.name}**`, { parse_mode: "Markdown" });
});

// /reset - restore default cities
bot.command("reset", async (ctx) => {
    const chatId = ctx.chat.id;
    
    await saveChatCities(chatId, DEFAULT_CITIES);
    
    await ctx.reply(
        "✅ **Восстановлены дефолтные города:**\n\n" +
        DEFAULT_CITIES.map(c => `• ${c.name}`).join('\n'),
        { parse_mode: "Markdown" }
    );
});

// ============================================
// TIME CONVERSION HANDLER
// ============================================

bot.on("message", async (ctx) => {
    // Ignore messages without text
    if (!ctx.message || !ctx.message.text) {
        return;
    }

    const text = ctx.message.text;
    const chatId = ctx.chat.id;
    
    // Check for pending choice (number reply)
    if (/^\d+$/.test(text.trim())) {
        try {
            const pending = await kv.get(`pending:${chatId}:${ctx.from.id}`);
            
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
                    
                    await kv.del(`pending:${chatId}:${ctx.from.id}`);
                    
                    await ctx.reply(
                        `✅ **Добавлен город:**\n\n` +
                        `${pending.cityName} (${selected.zone})\n` +
                        `Коды: ${pending.codes.map(c => `\`${c}\``).join(', ')}`,
                        { parse_mode: "Markdown" }
                    );
                    return;
                }
            }
        } catch (e) {
            // Not a pending choice, continue to time parsing
        }
    }
    
    // Get chat cities
    const cities = await getChatCities(chatId);
    const regex = buildRegex(cities);
    
    // Check for time match
    const match = text.match(regex);
    if (!match) return;

    let hours = parseInt(match[1]);
    let minutes = match[2] ? parseInt(match[2]) : 0;
    const inputCode = match[3].toLowerCase();

    // Validate time
    if (hours > 23 || minutes > 59) return;

    // Find source city
    const sourceCity = findCityByCode(cities, inputCode);
    if (!sourceCity) return;

    // Calculate target time
    const nowISO = new Date().toLocaleString("en-US", { timeZone: sourceCity.zone, hour12: false });
    const cityDateCurrent = new Date(nowISO); 
    
    const targetDate = new Date(nowISO);
    targetDate.setHours(hours, minutes, 0, 0);
    
    const diff = targetDate.getTime() - cityDateCurrent.getTime();
    const absoluteTargetTime = new Date().getTime() + diff;

    // Format response
    let resultLines = [];

    for (let city of cities) {
        const timeString = getTimeInCity(absoluteTargetTime, city.zone);
        
        resultLines.push({
            sort: city.sort,
            text: `\`${timeString}\` — ${city.name}`
        });
    }

    resultLines.sort((a, b) => a.sort - b.sort);
    let replyText = resultLines.map(line => line.text).join('\n');

    // Google Calendar link
    const startDateObj = new Date(absoluteTargetTime);
    const endDateObj = new Date(absoluteTargetTime + 60 * 60 * 1000); 

    const startStr = formatGoogleDate(startDateObj);
    const endStr = formatGoogleDate(endDateObj);

    const eventTitle = encodeURIComponent("qw meet");
    const googleUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${eventTitle}&dates=${startStr}/${endStr}`;

    replyText += `\n\n[⨁ в календарь](${googleUrl})`;

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
