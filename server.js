const http = require("http");
const fs = require("fs");
const path = require("path");
const { MongoClient, ServerApiVersion } = require("mongodb");

const root = __dirname;
const port = Number(process.env.PORT || 3000);

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex < 1) return;
    const key = normalized.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) return;
    let value = normalized.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  });
};

loadEnvFile(path.join(root, ".env"));

const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const telegramAdminPassword = (process.env.TELEGRAM_ADMIN_PASSWORD || "IamAmal").trim();
const mongodbUri = (process.env.MONGODB_URI || "").trim();
const mongodbDatabaseName = (process.env.MONGODB_DATABASE || "amal_wedding").trim();
const telegramConfigured = Boolean(telegramBotToken && mongodbUri);
let mongoClient;
let databasePromise;
let telegramUpdateOffset = 0;

const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const mediaExtensions = new Set([".mp3", ".mp4", ".webm"]);

const serveStaticFile = (request, response, filePath) => {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = types[extension] || "application/octet-stream";
    const baseHeaders = {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Accept-Ranges": "bytes",
    };
    const rangeHeader = mediaExtensions.has(extension) ? request.headers.range : undefined;

    if (!rangeHeader) {
      response.writeHead(200, baseHeaders);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(filePath).pipe(response);
      return;
    }

    const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!rangeMatch) {
      response.writeHead(416, { ...baseHeaders, "Content-Range": `bytes */${stats.size}`, "Content-Length": 0 });
      response.end();
      return;
    }

    let start;
    let end;
    if (rangeMatch[1] === "") {
      const suffixLength = Number(rangeMatch[2]);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        response.writeHead(416, { ...baseHeaders, "Content-Range": `bytes */${stats.size}`, "Content-Length": 0 });
        response.end();
        return;
      }
      start = Math.max(stats.size - suffixLength, 0);
      end = stats.size - 1;
    } else {
      start = Number(rangeMatch[1]);
      end = rangeMatch[2] === "" ? stats.size - 1 : Math.min(Number(rangeMatch[2]), stats.size - 1);
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stats.size) {
      response.writeHead(416, { ...baseHeaders, "Content-Range": `bytes */${stats.size}`, "Content-Length": 0 });
      response.end();
      return;
    }

    const contentLength = end - start + 1;
    response.writeHead(206, {
      ...baseHeaders,
      "Content-Length": contentLength,
      "Content-Range": `bytes ${start}-${end}/${stats.size}`,
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(filePath, { start, end }).pipe(response);
  });
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > 32 * 1024) { tooLarge = true; return; }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (tooLarge) { reject(Object.assign(new Error("Payload too large"), { statusCode: 413 })); return; }
    try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
    catch { reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 })); }
  });
  request.on("error", reject);
});

const getDatabase = async () => {
  if (!mongodbUri) throw Object.assign(new Error("MongoDB is not configured"), { statusCode: 503 });
  if (!databasePromise) {
    databasePromise = (async () => {
      mongoClient = new MongoClient(mongodbUri, {
        appName: "amal-wedding-invitation",
        serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
        serverSelectionTimeoutMS: 10000,
      });
      await mongoClient.connect();
      const database = mongoClient.db(mongodbDatabaseName);
      await database.command({ ping: 1 });
      await database.collection("bot_admins").createIndex({ chatId: 1 }, { unique: true });
      await database.collection("guests").createIndex({ createdAt: -1 });
      console.log(`MongoDB connected: ${mongodbDatabaseName}`);
      return database;
    })().catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
};

const readGuests = async () => {
  const database = await getDatabase();
  return database.collection("guests").find({}).sort({ createdAt: 1 }).toArray();
};

const saveGuest = async (guest) => {
  const database = await getDatabase();
  return database.collection("guests").insertOne(guest);
};

const authorizeTelegramChat = async (message) => {
  const database = await getDatabase();
  const chatId = String(message.chat.id);
  await database.collection("bot_admins").updateOne(
    { chatId },
    { $set: {
      chatId,
      username: message.from?.username || "",
      displayName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" "),
      authenticatedAt: new Date(),
    } },
    { upsert: true }
  );
};

const isTelegramChatAuthorized = async (chatId) => {
  const database = await getDatabase();
  return Boolean(await database.collection("bot_admins").findOne({ chatId }));
};

const getAuthorizedChatIds = async () => {
  const database = await getDatabase();
  const admins = await database.collection("bot_admins").find({}, { projection: { _id: 0, chatId: 1 } }).toArray();
  return admins.map((admin) => admin.chatId);
};

const telegramApi = async (method, payload) => {
  if (!telegramBotToken) throw new Error("Telegram bot token is not configured");
  const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error ${response.status}`);
  return result.result;
};

const splitTelegramMessage = (text, limit = 3800) => {
  const chunks = [];
  let remainder = text;
  while (remainder.length > limit) {
    let splitAt = remainder.lastIndexOf("\n", limit);
    if (splitAt < limit / 2) splitAt = limit;
    chunks.push(remainder.slice(0, splitAt));
    remainder = remainder.slice(splitAt).replace(/^\n+/, "");
  }
  if (remainder) chunks.push(remainder);
  return chunks;
};

const sendTelegramText = async (chatId, text) => {
  for (const chunk of splitTelegramMessage(text)) {
    await telegramApi("sendMessage", { chat_id: chatId, text: chunk, disable_web_page_preview: true });
  }
};

const attendanceText = (attending) => attending === "accept" ? "✅ Придёт" : "❌ Не придёт";

const guestNotification = (guest) => [
  "💌 Новый ответ на приглашение", "", `Имя: ${guest.name}`,
  `Телефон: ${guest.phone || "не указан"}`, `Ответ: ${attendanceText(guest.attending)}`,
  `Пожелание: ${guest.message || "—"}`,
].join("\n");

const guestListMessage = (guests) => {
  if (!guests.length) return "Список гостей пока пуст.";
  const accepted = guests.filter((guest) => guest.attending === "accept").length;
  const rows = guests.map((guest, index) => [
    `${index + 1}. ${attendanceText(guest.attending)} — ${guest.name}`,
    `Телефон: ${guest.phone || "не указан"}`,
    `Пожелание: ${guest.message || "—"}`,
  ].join("\n"));
  return [`👥 Список гостей: ${guests.length}`, `✅ Придут: ${accepted} · ❌ Не придут: ${guests.length - accepted}`, "", ...rows].join("\n");
};

const statsMessage = (guests) => {
  const accepted = guests.filter((guest) => guest.attending === "accept").length;
  return ["📊 Статистика RSVP", `Всего ответов: ${guests.length}`, `✅ Придут: ${accepted}`, `❌ Не придут: ${guests.length - accepted}`].join("\n");
};

const handleTelegramMessage = async (message) => {
  const chatId = String(message?.chat?.id || "");
  if (!chatId) return;
  const text = String(message.text || "").trim();

  if (text === telegramAdminPassword) {
    await authorizeTelegramChat(message);
    await sendTelegramText(chatId, "✅ Авторизация успешна. Ниже вся база гостей.");
    await sendTelegramText(chatId, guestListMessage(await readGuests()));
    return;
  }

  const authorized = await isTelegramChatAuthorized(chatId);
  if (!authorized) {
    await sendTelegramText(chatId, "Для доступа отправьте пароль администратора.");
    return;
  }

  const command = text.split(/\s+/)[0].toLowerCase().split("@")[0];
  if (command === "/guests" || command === "/database") await sendTelegramText(chatId, guestListMessage(await readGuests()));
  else if (command === "/stats") await sendTelegramText(chatId, statsMessage(await readGuests()));
  else if (command === "/start" || command === "/help") {
    await sendTelegramText(chatId, "Бот свадебного приглашения готов.\n\n/guests — вся база гостей\n/stats — статистика RSVP");
  }
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const startTelegramPolling = async () => {
  if (!telegramConfigured) {
    console.log("Telegram RSVP bot is disabled: add TELEGRAM_BOT_TOKEN and MONGODB_URI to .env");
    return;
  }
  try {
    const webhook = await telegramApi("getWebhookInfo", {});
    if (webhook?.url) { console.warn("Telegram bot has an active webhook; long polling was not started."); return; }
    await getDatabase();
    await telegramApi("setMyCommands", { commands: [
      { command: "guests", description: "Список гостей" }, { command: "stats", description: "Статистика RSVP" },
    ] });
    console.log("Telegram RSVP bot polling started");
  } catch (error) {
    console.error("Telegram bot setup failed:", error.message);
    return;
  }
  while (true) {
    try {
      const updates = await telegramApi("getUpdates", { offset: telegramUpdateOffset, timeout: 25, allowed_updates: ["message"] });
      for (const update of updates) {
        telegramUpdateOffset = update.update_id + 1;
        if (update.message) await handleTelegramMessage(update.message);
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await delay(5000);
    }
  }
};

const rsvpAttempts = new Map();
const isRateLimited = (request) => {
  const address = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const existing = rsvpAttempts.get(address);
  if (!existing || now - existing.startedAt > 10 * 60 * 1000) {
    rsvpAttempts.set(address, { startedAt: now, count: 1 });
    return false;
  }
  existing.count += 1;
  return existing.count > 10;
};

const validateRsvp = (body) => {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const attending = body.attending;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const language = body.language === "ru" ? "ru" : "uz";
  if (name.length < 2 || name.length > 120) return { error: "Введите имя" };
  if (phone.length > 40) return { error: "Номер телефона слишком длинный" };
  if (!["accept", "decline"].includes(attending)) return { error: "Выберите, придёте вы или нет" };
  if (message.length > 1000) return { error: "Пожелание слишком длинное" };
  return { name, phone, attending, message, language };
};

const server = http.createServer(async (request, response) => {
  const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
  if (urlPath === "/api/config" && request.method === "GET") {
    const latitude = Number(process.env.YANDEX_MAPS_LAT || 41.311151);
    const longitude = Number(process.env.YANDEX_MAPS_LNG || 69.279737);
    sendJson(response, 200, { yandexMapsApiKey: process.env.YANDEX_MAPS_API_KEY || "", yandexMapsCenter: [
      Number.isFinite(latitude) ? latitude : 41.311151, Number.isFinite(longitude) ? longitude : 69.279737,
    ] });
    return;
  }
  if (urlPath === "/api/rsvp") {
    if (request.method !== "POST") { sendJson(response, 405, { ok: false, error: "Method not allowed" }); return; }
    if (isRateLimited(request)) { sendJson(response, 429, { ok: false, error: "Too many requests" }); return; }
    try {
      const validated = validateRsvp(await readJsonBody(request));
      if (validated.error) { sendJson(response, 400, { ok: false, error: validated.error }); return; }
      const guest = { ...validated, createdAt: new Date() };
      await saveGuest(guest);
      let telegramSent = false;
      if (telegramConfigured) {
        try {
          const chatIds = await getAuthorizedChatIds();
          const deliveries = await Promise.allSettled(chatIds.map((chatId) => sendTelegramText(chatId, guestNotification(guest))));
          telegramSent = deliveries.some((delivery) => delivery.status === "fulfilled");
        }
        catch (error) { console.error("Telegram RSVP notification failed:", error.message); }
      }
      sendJson(response, 201, { ok: true, telegramSent });
    } catch (error) {
      console.error("RSVP submission failed:", error.message);
      sendJson(response, error.statusCode || 500, { ok: false, error: "Unable to save RSVP" });
    }
    return;
  }

  const hasPrivateSegment = urlPath.split("/").some((segment) => segment.startsWith("."));
  const isPublicFile = urlPath === "/"
    || urlPath === "/index.html"
    || urlPath === "/src/styles.css"
    || urlPath === "/dist/index.js"
    || urlPath.startsWith("/assets/")
    || urlPath.startsWith("/public/");
  if (hasPrivateSegment || !isPublicFile || urlPath === "/data" || urlPath.startsWith("/data/")) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found"); return;
  }
  const safePath = path.normalize(urlPath).replace(/^([/\\])+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath === "" ? "index.html" : safePath);
  if (!filePath.startsWith(root)) { response.writeHead(403); response.end("Forbidden"); return; }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }
  serveStaticFile(request, response, filePath);
});

server.listen(port, () => {
  console.log(`Wedding invitation running at http://localhost:${port}`);
  void startTelegramPolling();
});

const closeServer = async () => {
  if (mongoClient) await mongoClient.close().catch(() => undefined);
  server.close(() => process.exit(0));
};

process.once("SIGINT", closeServer);
process.once("SIGTERM", closeServer);
