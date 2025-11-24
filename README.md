> **Note:** English version is below / Английская версия внизу

# ⏰ Telegram Time Converter Bot

Простой и удобный бот для конвертации времени в Telegram-чатах. Идеально подходит для распределенных команд и друзей.

**✨ Бота не обязательно тегать (@)!** Он читает все сообщения и отвечает, только если находит время с кодом города.

### 🚀 Как это работает
Напишите время с первой буквой города, и бот автоматически переведет его для **Москвы, Парижа, Еревана и Буэнос-Айреса**.

В конце сообщения бот генерирует ссылку **[+ в календарь]**, которая позволяет мгновенно создать встречу в Google Календаре.

### 📝 Формат команд
Вы пишете время и букву города (с пробелом или без). Бот устойчив к опечаткам и **понимает неправильную раскладку** клавиатуры.

* **м** — Москва
* **п** — Париж
* **е** — Ереван
* **б** — Буэнос-Айрес

**Примеры (сработают даже при неверной раскладке):**
* `20 м` (или `20 m`, `20 v`) → 20:00 по Москве
* `18:30п` (или `18:30g`, `18:30p`) → 18:30 по Парижу
* `14 б` (или `14,`) → 14:00 по Буэнос-Айресу

### 🛠 Технологии
* **Node.js**
* **grammY** (Telegram Bot Framework)
* **Vercel** (Serverless hosting)

---

<a name="english-version"></a>
# ⏰ Telegram Time Converter Bot (English Version)

A simple and handy bot for time conversion in Telegram chats. Perfect for distributed teams and friends.

**✨ You don't need to tag (@) the bot!** It reads messages and only replies when it detects a time with a city code.

### 🚀 How it works
Simply type the time with a city code, and the bot automatically converts it for **Moscow, Paris, Yerevan, and Buenos Aires**.

It also generates a **[+ add to calendar]** link to instantly create a Google Calendar event.

### 📝 Command Format
Type the time followed by the city letter (space is optional). The bot is resilient to typos and **understands wrong keyboard layouts**.

* **м** — Moscow
* **п** — Paris
* **е** — Yerevan
* **б** — Buenos Aires

**Examples (work even with wrong layout):**
* `20 м` (or `20 m`, `20 v`) → 20:00 Moscow time
* `18:30п` (or `18:30g`, `18:30p`) → 18:30 Paris time
* `14 б` (or `14,`) → 14:00 Buenos Aires time

### 🛠 Tech Stack
* **Node.js**
* **grammY** (Telegram Bot Framework)
* **Vercel** (Serverless hosting)
