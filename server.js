const http = require("http");
const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

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
const pendingTelegramEdits = new Map();

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
      await database.collection("guests").createIndex({ side: 1, createdAt: -1 });
      await database.collection("guests").createIndex({ attending: 1 });
      console.log(`MongoDB connected: ${mongodbDatabaseName}`);
      return database;
    })().catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
};

const MANAGER_PAGE_SIZE = 10;
const MANAGER_FILTERS = new Set(["all", "groom", "bride", "unknown"]);
const normalizeManagerFilter = (value) => MANAGER_FILTERS.has(value) ? value : "all";
const managerFilterQuery = (filter) => {
  if (filter === "groom" || filter === "bride") return { side: filter };
  if (filter === "unknown") return { side: { $nin: ["groom", "bride"] } };
  return {};
};

const readGuestCounts = async () => {
  const database = await getDatabase();
  const guests = database.collection("guests");
  const [total, groom, bride, accepted] = await Promise.all([
    guests.countDocuments({}),
    guests.countDocuments({ side: "groom" }),
    guests.countDocuments({ side: "bride" }),
    guests.countDocuments({ attending: "accept" }),
  ]);
  return { total, groom, bride, unknown: total - groom - bride, accepted };
};

const readGuestPage = async (requestedFilter, requestedPage) => {
  const filter = normalizeManagerFilter(requestedFilter);
  const query = managerFilterQuery(filter);
  const database = await getDatabase();
  const guests = database.collection("guests");
  const total = await guests.countDocuments(query);
  const totalPages = Math.max(1, Math.ceil(total / MANAGER_PAGE_SIZE));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, totalPages - 1));
  const items = await guests.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .skip(page * MANAGER_PAGE_SIZE)
    .limit(MANAGER_PAGE_SIZE)
    .toArray();
  return { filter, page, total, totalPages, items };
};

const saveGuest = async (guest) => {
  const database = await getDatabase();
  return database.collection("guests").insertOne(guest);
};

const guestObjectId = (value) => ObjectId.isValid(String(value || ""))
  ? new ObjectId(String(value))
  : null;

const readGuest = async (guestId) => {
  const objectId = guestObjectId(guestId);
  if (!objectId) return null;
  const database = await getDatabase();
  return database.collection("guests").findOne({ _id: objectId });
};

const updateGuest = async (guestId, changes) => {
  const objectId = guestObjectId(guestId);
  if (!objectId) return null;
  const database = await getDatabase();
  const result = await database.collection("guests").updateOne(
    { _id: objectId },
    { $set: { ...changes, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return null;
  return database.collection("guests").findOne({ _id: objectId });
};

const deleteGuest = async (guestId) => {
  const objectId = guestObjectId(guestId);
  if (!objectId) return false;
  const database = await getDatabase();
  const result = await database.collection("guests").deleteOne({ _id: objectId });
  return result.deletedCount === 1;
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

const sendTelegramText = async (chatId, text, options = {}) => {
  const chunks = splitTelegramMessage(text);
  for (let index = 0; index < chunks.length; index += 1) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: chunks[index],
      disable_web_page_preview: true,
      ...(index === chunks.length - 1 ? options : {}),
    });
  }
};

const editTelegramText = async (chatId, messageId, text, replyMarkup) => {
  try {
    return await telegramApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  } catch (error) {
    if (!/message is not modified/i.test(error.message)) throw error;
    return null;
  }
};

const attendanceText = (attending) => attending === "accept" ? "✅ Придёт" : "❌ Не придёт";
const sideText = (side) => side === "groom"
  ? "🤵 Со стороны жениха"
  : side === "bride"
    ? "👰 Со стороны невесты"
    : "➖ Сторона не указана";

const guestCardMessage = (guest, title = "👤 Карточка гостя") => [
  title,
  "",
  `Имя: ${guest.name}`,
  `Телефон: ${guest.phone || "не указан"}`,
  `Ответ: ${attendanceText(guest.attending)}`,
  `Сторона: ${sideText(guest.side)}`,
  `Пожелание: ${guest.message || "—"}`,
].join("\n");

const guestNotification = (guest) => guestCardMessage(guest, "💌 Новый ответ на приглашение");

const guestActionKeyboard = (guestId, filter = "all", page = 0) => ({
  inline_keyboard: [
    [
      { text: "✏️ Редактировать", callback_data: `edit:${guestId}:${filter}:${page}` },
      { text: "🗑 Удалить", callback_data: `delete:${guestId}:${filter}:${page}` },
    ],
    [{ text: "⬅️ К списку", callback_data: `manage:${filter}:${page}` }],
  ],
});

const statsMessage = (counts) => {
  return [
    "📊 Статистика RSVP",
    `Всего ответов: ${counts.total}`,
    `✅ Придут: ${counts.accepted}`,
    `❌ Не придут: ${counts.total - counts.accepted}`,
    "",
    `🤵 Сторона жениха: ${counts.groom}`,
    `👰 Сторона невесты: ${counts.bride}`,
    ...(counts.unknown ? [`➖ Сторона не указана: ${counts.unknown}`] : []),
  ].join("\n");
};

const managerFilterTitle = (filter) => filter === "groom"
  ? "сторона жениха"
  : filter === "bride"
    ? "сторона невесты"
    : filter === "unknown"
      ? "сторона не указана"
      : "все гости";

const sendGuestManager = async (chatId, requestedFilter = "all", requestedPage = 0, messageId) => {
  const counts = await readGuestCounts();
  if (!counts.total) {
    const text = "👥 Список гостей пока пуст.";
    if (messageId) return editTelegramText(chatId, messageId, text, { inline_keyboard: [] });
    return sendTelegramText(chatId, text);
  }

  const { filter, page, total, totalPages, items } = await readGuestPage(requestedFilter, requestedPage);
  const inlineKeyboard = [
    [{ text: `👥 Все · ${counts.total}`, callback_data: "manage:all:0" }],
    [
      { text: `🤵 Жених · ${counts.groom}`, callback_data: "manage:groom:0" },
      { text: `👰 Невеста · ${counts.bride}`, callback_data: "manage:bride:0" },
    ],
  ];

  if (counts.unknown) {
    inlineKeyboard.push([{ text: `➖ Без стороны · ${counts.unknown}`, callback_data: "manage:unknown:0" }]);
  }

  items.forEach((guest) => {
    inlineKeyboard.push([{
      text: `${guest.attending === "accept" ? "✅" : "❌"} ${guest.side === "groom" ? "🤵" : guest.side === "bride" ? "👰" : "➖"} ${String(guest.name).slice(0, 34)}`,
      callback_data: `guest:${guest._id}:${filter}:${page}`,
    }]);
  });

  if (totalPages > 1) {
    const navigation = [];
    if (page > 0) navigation.push({ text: "⬅️", callback_data: `manage:${filter}:${page - 1}` });
    navigation.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
    if (page < totalPages - 1) navigation.push({ text: "➡️", callback_data: `manage:${filter}:${page + 1}` });
    inlineKeyboard.push(navigation);
  }

  const firstShown = total ? page * MANAGER_PAGE_SIZE + 1 : 0;
  const lastShown = Math.min((page + 1) * MANAGER_PAGE_SIZE, total);
  const text = [
    "👥 Управление гостями",
    `Фильтр: ${managerFilterTitle(filter)}`,
    `Показано ${firstShown}–${lastShown} из ${total} · страница ${page + 1}/${totalPages}`,
    "",
    "Выберите гостя:",
  ].join("\n");
  const replyMarkup = { inline_keyboard: inlineKeyboard };
  if (messageId) return editTelegramText(chatId, messageId, text, replyMarkup);
  return sendTelegramText(chatId, text, { reply_markup: replyMarkup });
};

const showGuestCard = async (chatId, guest, filter = "all", page = 0, messageId) => {
  const text = guestCardMessage(guest);
  const replyMarkup = guestActionKeyboard(guest._id, filter, page);
  if (messageId) return editTelegramText(chatId, messageId, text, replyMarkup);
  return sendTelegramText(chatId, text, { reply_markup: replyMarkup });
};

const telegramActorKey = (chatId, userId) => `${chatId}:${userId || "unknown"}`;

const handlePendingTelegramEdit = async (message, text) => {
  const chatId = String(message?.chat?.id || "");
  const actorKey = telegramActorKey(chatId, message?.from?.id);
  const pending = pendingTelegramEdits.get(actorKey);
  if (!pending) return false;

  if (text.toLowerCase() === "/cancel") {
    pendingTelegramEdits.delete(actorKey);
    await sendTelegramText(chatId, "Редактирование отменено.");
    return true;
  }

  if (text.startsWith("/")) {
    pendingTelegramEdits.delete(actorKey);
    return false;
  }

  const value = text === "-" ? "" : text;
  if (pending.field === "name" && (value.length < 2 || value.length > 120)) {
    await sendTelegramText(chatId, "Имя должно содержать от 2 до 120 символов. Попробуйте ещё раз или отправьте /cancel.");
    return true;
  }
  if (pending.field === "phone" && value.length > 40) {
    await sendTelegramText(chatId, "Номер телефона слишком длинный. Попробуйте ещё раз или отправьте /cancel.");
    return true;
  }
  if (pending.field === "message" && value.length > 1000) {
    await sendTelegramText(chatId, "Пожелание слишком длинное. Попробуйте ещё раз или отправьте /cancel.");
    return true;
  }

  const guest = await updateGuest(pending.guestId, { [pending.field]: value });
  pendingTelegramEdits.delete(actorKey);
  if (!guest) {
    await sendTelegramText(chatId, "Гость уже удалён или не найден.");
    return true;
  }

  await sendTelegramText(chatId, "✅ Данные гостя обновлены.");
  await showGuestCard(chatId, guest, pending.filter, pending.page);
  return true;
};

const handleTelegramMessage = async (message) => {
  const chatId = String(message?.chat?.id || "");
  if (!chatId) return;
  const text = String(message.text || "").trim();

  if (text === telegramAdminPassword) {
    await authorizeTelegramChat(message);
    await sendTelegramText(chatId, "✅ Авторизация успешна. Открываю список гостей.");
    await sendGuestManager(chatId, "all", 0);
    return;
  }

  const authorized = await isTelegramChatAuthorized(chatId);
  if (!authorized) {
    await sendTelegramText(chatId, "Для доступа отправьте пароль администратора.");
    return;
  }

  if (await handlePendingTelegramEdit(message, text)) return;

  const command = text.split(/\s+/)[0].toLowerCase().split("@")[0];
  if (command === "/guests" || command === "/database") {
    await sendGuestManager(chatId, "all", 0);
  } else if (command === "/manage") await sendGuestManager(chatId, "all", 0);
  else if (command === "/stats") await sendTelegramText(chatId, statsMessage(await readGuestCounts()));
  else if (command === "/start" || command === "/help") {
    await sendTelegramText(chatId, [
      "Бот свадебного приглашения готов.",
      "",
      "/guests — вся база гостей",
      "/manage — редактировать или удалить гостя",
      "/stats — статистика RSVP",
      "/cancel — отменить редактирование",
    ].join("\n"));
  }
};

const handleTelegramCallbackQuery = async (query) => {
  const chatId = String(query?.message?.chat?.id || "");
  const messageId = query?.message?.message_id;
  if (!chatId || !messageId || !query?.id) return;

  try {
    if (!(await isTelegramChatAuthorized(chatId))) {
      await telegramApi("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "Нет доступа. Сначала отправьте пароль администратора.",
        show_alert: true,
      });
      return;
    }

    await telegramApi("answerCallbackQuery", { callback_query_id: query.id });
    const data = String(query.data || "");
    const [action, ...parts] = data.split(":");

    if (action === "noop") return;

    if (action === "manage") {
      const filter = normalizeManagerFilter(parts[0]);
      await sendGuestManager(chatId, filter, Number(parts[1]), messageId);
      return;
    }

    if (action === "guest") {
      const [guestId, rawFilter, rawPage] = parts;
      const filter = normalizeManagerFilter(rawFilter);
      const page = Number(rawPage);
      const guest = await readGuest(guestId);
      if (!guest) {
        await sendTelegramText(chatId, "Гость уже удалён или не найден.");
        await sendGuestManager(chatId, filter, page, messageId);
        return;
      }
      await showGuestCard(chatId, guest, filter, page, messageId);
      return;
    }

    if (action === "edit") {
      const [guestId, rawFilter, rawPage] = parts;
      const filter = normalizeManagerFilter(rawFilter);
      const page = Number(rawPage);
      const guest = await readGuest(guestId);
      if (!guest) {
        await sendTelegramText(chatId, "Гость уже удалён или не найден.");
        await sendGuestManager(chatId, filter, page, messageId);
        return;
      }
      await editTelegramText(chatId, messageId, `${guestCardMessage(guest)}\n\nЧто изменить?`, {
        inline_keyboard: [
          [
            { text: "Имя", callback_data: `field:name:${guest._id}:${filter}:${page}` },
            { text: "Телефон", callback_data: `field:phone:${guest._id}:${filter}:${page}` },
          ],
          [
            { text: "Сторону", callback_data: `field:side:${guest._id}:${filter}:${page}` },
            { text: "Ответ", callback_data: `field:attending:${guest._id}:${filter}:${page}` },
          ],
          [{ text: "Пожелание", callback_data: `field:message:${guest._id}:${filter}:${page}` }],
          [{ text: "⬅️ Назад", callback_data: `guest:${guest._id}:${filter}:${page}` }],
        ],
      });
      return;
    }

    if (action === "field") {
      const [field, guestId, rawFilter, rawPage] = parts;
      const filter = normalizeManagerFilter(rawFilter);
      const page = Number(rawPage);
      const guest = await readGuest(guestId);
      if (!guest) {
        await sendTelegramText(chatId, "Гость уже удалён или не найден.");
        await sendGuestManager(chatId, filter, page, messageId);
        return;
      }

      if (field === "side") {
        await editTelegramText(chatId, messageId, `${guestCardMessage(guest)}\n\nВыберите сторону:`, {
          inline_keyboard: [
            [{ text: "🤵 Сторона жениха", callback_data: `set:side:groom:${guest._id}:${filter}:${page}` }],
            [{ text: "👰 Сторона невесты", callback_data: `set:side:bride:${guest._id}:${filter}:${page}` }],
            [{ text: "⬅️ Назад", callback_data: `edit:${guest._id}:${filter}:${page}` }],
          ],
        });
        return;
      }

      if (field === "attending") {
        await editTelegramText(chatId, messageId, `${guestCardMessage(guest)}\n\nИзмените ответ:`, {
          inline_keyboard: [
            [{ text: "✅ Придёт", callback_data: `set:attending:accept:${guest._id}:${filter}:${page}` }],
            [{ text: "❌ Не придёт", callback_data: `set:attending:decline:${guest._id}:${filter}:${page}` }],
            [{ text: "⬅️ Назад", callback_data: `edit:${guest._id}:${filter}:${page}` }],
          ],
        });
        return;
      }

      if (!["name", "phone", "message"].includes(field)) return;
      pendingTelegramEdits.set(telegramActorKey(chatId, query?.from?.id), { guestId, field, filter, page });
      const prompt = field === "name"
        ? "Введите новое имя гостя."
        : field === "phone"
          ? "Введите новый телефон. Отправьте «-», чтобы очистить поле."
          : "Введите новое пожелание. Отправьте «-», чтобы очистить поле.";
      await sendTelegramText(chatId, `${prompt}\nДля отмены отправьте /cancel.`, {
        reply_markup: { force_reply: true, selective: true },
      });
      return;
    }

    if (action === "set") {
      const [field, value, guestId, rawFilter, rawPage] = parts;
      const filter = normalizeManagerFilter(rawFilter);
      const page = Number(rawPage);
      const allowed = field === "side"
        ? ["groom", "bride"]
        : field === "attending"
          ? ["accept", "decline"]
          : [];
      if (!allowed.includes(value)) return;
      const guest = await updateGuest(guestId, { [field]: value });
      if (!guest) {
        await sendTelegramText(chatId, "Гость уже удалён или не найден.");
        await sendGuestManager(chatId, filter, page, messageId);
        return;
      }
      await showGuestCard(chatId, guest, filter, page, messageId);
      return;
    }

    if (action === "delete") {
      const [guestId, rawFilter, rawPage] = parts;
      const filter = normalizeManagerFilter(rawFilter);
      const page = Number(rawPage);
      const guest = await readGuest(guestId);
      if (!guest) {
        await sendTelegramText(chatId, "Гость уже удалён или не найден.");
        await sendGuestManager(chatId, filter, page, messageId);
        return;
      }
      await editTelegramText(chatId, messageId, `${guestCardMessage(guest)}\n\nУдалить этого гостя без возможности восстановления?`, {
        inline_keyboard: [
          [{ text: "🗑 Да, удалить", callback_data: `delete-confirm:${guest._id}:${filter}:${page}` }],
          [{ text: "Отмена", callback_data: `guest:${guest._id}:${filter}:${page}` }],
        ],
      });
      return;
    }

    if (action === "delete-confirm") {
      const [guestId, rawFilter, rawPage] = parts;
      const filter = normalizeManagerFilter(rawFilter);
      const page = Number(rawPage);
      const deleted = await deleteGuest(guestId);
      await sendTelegramText(chatId, deleted ? "✅ Гость удалён." : "Гость уже удалён или не найден.");
      await sendGuestManager(chatId, filter, page, messageId);
    }
  } catch (error) {
    console.error("Telegram callback error:", error.message);
    await sendTelegramText(chatId, "Не удалось выполнить действие. Попробуйте ещё раз через /manage.").catch(() => undefined);
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
      { command: "guests", description: "Список гостей" },
      { command: "manage", description: "Редактировать или удалить гостя" },
      { command: "stats", description: "Статистика RSVP" },
    ] });
    console.log("Telegram RSVP bot polling started");
  } catch (error) {
    console.error("Telegram bot setup failed:", error.message);
    return;
  }
  while (true) {
    try {
      const updates = await telegramApi("getUpdates", { offset: telegramUpdateOffset, timeout: 25, allowed_updates: ["message", "callback_query"] });
      for (const update of updates) {
        telegramUpdateOffset = update.update_id + 1;
        if (update.message) await handleTelegramMessage(update.message);
        if (update.callback_query) await handleTelegramCallbackQuery(update.callback_query);
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
  const side = body.side;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const language = body.language === "ru" ? "ru" : "uz";
  if (name.length < 2 || name.length > 120) return { error: "Введите имя" };
  if (phone.length > 40) return { error: "Номер телефона слишком длинный" };
  if (!["accept", "decline"].includes(attending)) return { error: "Выберите, придёте вы или нет" };
  if (!["groom", "bride"].includes(side)) return { error: "Выберите сторону жениха или невесты" };
  if (message.length > 1000) return { error: "Пожелание слишком длинное" };
  return { name, phone, attending, side, message, language };
};

const server = http.createServer(async (request, response) => {
  const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
  if (urlPath === "/api/rsvp") {
    if (request.method !== "POST") { sendJson(response, 405, { ok: false, error: "Method not allowed" }); return; }
    if (isRateLimited(request)) { sendJson(response, 429, { ok: false, error: "Too many requests" }); return; }
    try {
      const validated = validateRsvp(await readJsonBody(request));
      if (validated.error) { sendJson(response, 400, { ok: false, error: validated.error }); return; }
      const guest = { ...validated, createdAt: new Date() };
      const insertion = await saveGuest(guest);
      guest._id = insertion.insertedId;
      let telegramSent = false;
      if (telegramConfigured) {
        try {
          const chatIds = await getAuthorizedChatIds();
          const deliveries = await Promise.allSettled(chatIds.map((chatId) => sendTelegramText(
            chatId,
            guestNotification(guest),
            { reply_markup: guestActionKeyboard(guest._id) }
          )));
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
