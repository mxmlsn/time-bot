# ⏰ Telegram Time Bot

Time zone converter for distributed teams with customizable cities per chat.

## Features

- 🌍 **Customizable cities** — each chat can configure its own city list
- 🔍 **Auto timezone detection** — just type city name, bot finds timezone via OpenStreetMap
- 📅 **Google Calendar links** — instant meeting scheduling
- 🔒 **Code validation** — prevents duplicate city codes
- ⚡️ **Serverless** — runs on Vercel with KV storage

## Quick Start

### Public Bot (Shared Instance)

Add [@your_bot_name](https://t.me/your_bot_name) to your chat.

### Deploy Your Own Copy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmxmlsn%2Ftime-bot&env=BOT_TOKEN&envDescription=Telegram%20Bot%20Token%20from%20%40BotFather&project-name=time-bot&repository-name=time-bot&demo-title=Time%20Bot&demo-description=Time%20zone%20converter%20for%20distributed%20teams&stores=%5B%7B%22type%22%3A%22kv%22%7D%5D)

**Setup:**

1. Create bot via [@BotFather](https://t.me/BotFather)
2. Click **Deploy with Vercel** button above
3. Add `BOT_TOKEN` environment variable
4. Enable **Vercel KV** storage in project settings
5. Set webhook: `https://your-project.vercel.app/api`

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-project.vercel.app/api"
```

## Usage

### Time Conversion

Just type time + city code in chat:

```
20м      → 20:00 Moscow time, converted to all cities
15:30п   → 15:30 Paris time
10ba     → 10:00 Buenos Aires
```

**Default cities:**
- Париж (codes: `п`, `p`, `g`, `з`)
- Ереван (codes: `е`, `e`, `y`, `t`)
- Буэнос-Айрес (codes: `б`, `b`, `,`, `и`, `ба`, `ba`)
- Москва (codes: `м`, `m`, `v`, `ь`)

### Commands

#### `/cities`
Show current cities for this chat

```
/cities
```

#### `/addcity`
Add custom city (auto timezone detection)

```
/addcity Лондон л l ld lon
```

Bot will search "Лондон" via OpenStreetMap and:
- If 1 result → add immediately
- If multiple → ask you to choose
- If not found → suggest manual timezone

**Code validation:**
- ❌ Can't use code already taken by another city
- ✅ Bot will show conflict and suggest choosing different codes

#### `/addcity_tz`
Add city with manual timezone (for precise control)

```
/addcity_tz Лондон Europe/London л l ld
```

Find timezone: [List of tz database time zones](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)

#### `/removecity`
Remove city by code

```
/removecity л
```

#### `/reset`
Restore default 4 cities

```
/reset
```

## Architecture

- **Framework:** [grammY](https://grammy.dev/) (Telegram Bot API)
- **Storage:** [Vercel KV](https://vercel.com/docs/storage/vercel-kv) (per-chat settings)
- **Geocoding:** [Nominatim](https://nominatim.org/) (OpenStreetMap, no API key)
- **Timezone API:** [TimeAPI.io](https://timeapi.io/) (coordinates → timezone)
- **Hosting:** Vercel (serverless functions)

## Data Storage

Cities are stored per chat in Vercel KV:

```
chat:<chatId>:cities → [
  { name: "Лондон", zone: "Europe/London", codes: ["л", "l"], sort: 1 }
]
```

Pending choices (when multiple cities found):

```
pending:<chatId>:<userId> → { type: "addcity", ... }
```

TTL: 5 minutes

## Development

```bash
npm install
vercel dev
```

Set webhook to ngrok/localhost:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-ngrok-url.ngrok.io/api"
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BOT_TOKEN` | Telegram bot token from @BotFather | ✅ |

## License

MIT

## Support

Issues: [GitHub Issues](https://github.com/mxmlsn/time-bot/issues)
