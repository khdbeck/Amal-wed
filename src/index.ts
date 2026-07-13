const invite = document.querySelector<HTMLElement>(".invite");
const cover = document.querySelector<HTMLElement>(".cover");
const coverTrigger = document.querySelector<HTMLButtonElement>(".cover-trigger");
const coverVideo = document.querySelector<HTMLVideoElement>(".cover-video");
const heroVideo = document.querySelector<HTMLVideoElement>(".hero-video");
const languageButton = document.querySelector<HTMLButtonElement>(".language-pill");
const music = document.querySelector<HTMLAudioElement>("#weddingMusic");
const soundToggle = document.querySelector<HTMLButtonElement>(".sound-toggle");
const accordion = document.querySelector<HTMLButtonElement>(".accordion");
const accordionPanel = document.querySelector<HTMLElement>(".accordion-panel");
const form = document.querySelector<HTMLFormElement>(".rsvp form");
const statusOutput = document.querySelector<HTMLOutputElement>(".form-status");
const mapContainer = document.querySelector<HTMLElement>("#yandex-map");
const mapShell = document.querySelector<HTMLElement>(".map-shell");
const mapStatus = document.querySelector<HTMLElement>(".map-status");

let musicStarted = false;
let invitationOpened = false;
let invitationTransitionFinished = false;
let coverSafetyTimeout: number | undefined;
let currentLanguage: "uz" | "ru" = "uz";
let musicEnabled = false;
let yandexMapState: "idle" | "loading" | "ready" | "error" = "idle";
let yandexMapErrorKind: "key" | "load" | null = null;
let yandexMapsScriptPromise: Promise<void> | null = null;

const copy = {
  uz: {
    htmlLang: "uz",
    title: "Amal va Parizoda to'y taklifnomasi",
    languageLabel: "Tilni rus tiliga o'zgartirish",
    soundLabel: "Musiqani yoqish yoki o'chirish",
    musicOn: "Musiqa bilan",
    musicOff: "Musiqasiz",
    coverLabel: "To'y taklifnomasini ochish",
    coverScript: "Siz takliflisiz",
    openCue: "Ochish uchun bosing",
    inviteLabel: "Amal va Parizoda to'y taklifnomasi",
    coverSectionLabel: "Taklifnoma muqovasi",
    heroSectionLabel: "To'y e'loni",
    heroEyebrow: "Biz turmush qurmoqdamiz",
    date: "15 avgust 2026",
    heroRsvp: "Ishtirokni tasdiqlash",
    storyLabel: "Sevgi hikoyasi",
    storyKicker: "Bizning yo'limiz",
    storyTitle: "Sevgi hikoyamiz",
    timeline: [
      ["Qanday tanishdik", "Yo'llarimiz eng kutilmagan paytda kesishdi. Tasodifiy uchrashuv chiroyli hikoyamizning boshlanishiga aylandi."],
      ["Birinchi sarguzasht", "Sayohatga va samimiy suhbatlarga bo'lgan mehrimizni kashf etdik, har bir sokin lahza bizni yanada yaqinlashtirdi."],
      ["Oldinga qadam", "Bu sevgi abadiy ekanini angladik. Birga hayot qurish har kunimizni iliqroq va mustahkamroq qildi."],
      ["Taklif", "Yuraklarimiz muhabbat va kelajak orzulariga to'lib, savol berildi va quvonch ko'z yoshlari bilan javob olindi."]
    ],
    programLabel: "Kun dasturi",
    programTitle: "Kun dasturi",
    programIntro: "Siz uchun tayyorlaganlarimiz",
    program: [
      ["16:30", "Mehmonlar kelishi", "Kutib olish va reception"],
      ["17:00", "Marosim", "Nikoh marosimi"],
      ["18:00", "Kokteyl", "Ichimliklar va yengil tamaddilar"],
      ["20:00", "Kechki ovqat", "To'y ziyofati"],
      ["23:00", "Bazm", "Raqsga tushamiz!"],
      ["02:30", "Yakun", "Xayrlashuv"]
    ],
    giftsLabel: "Sovg'alar",
    giftsTitle: "Sovg'alar",
    giftsText: "Biz uchun eng muhim sovg'a - sizning ishtirokingiz. Agar sovg'a ulashmoqchi bo'lsangiz, buni o'zingizga qulay usulda qilishingiz mumkin.",
    contribution: "Hissa",
    bankCard: "Bank karta: 8600 0000 0000 0000",
    cardName: "Ism: Amal va Parizoda",
    detailsLabel: "Tadbir tafsilotlari",
    joinUs: "Bizga qo'shiling",
    detailsTitle: "Tadbir tafsilotlari",
    detailsIntro: "Ushbu maxsus kunni siz bilan nishonlashni intiqlik bilan kutyapmiz. Kerakli barcha ma'lumotlar shu yerda.",
    ceremonyTitle: "To'y marosimi",
    ceremonyTime: "◷ 16:00",
    ceremonyPlace: "⌖ Hotel Uzbekistan",
    ceremonyAddress: "Mahtumquli ko'chasi, 45, Toshkent, O'zbekiston",
    mapLabel: "Marosim belgisi qo'yilgan xarita",
    mapLoading: "Xarita yuklanmoqda…",
    mapKeyMissing: "Yandex Maps API kaliti sozlanmagan. .env fayliga YANDEX_MAPS_API_KEY ni qo'shing.",
    mapError: "Xaritani yuklab bo'lmadi. API kaliti va domen cheklovlarini tekshiring.",
    openMaps: "⌁ Xarita orqali ochish",
    addCalendar: "▣ Kalendarga qo'shish",
    dressTitle: "Dress-kod",
    dressCode: "Rasmiy / qora galstuk ixtiyoriy",
    dressText: "Bayramimizga mehmonlardan nafis va did bilan kiyinib kelishlarini so'raymiz.",
    rsvpLabel: "Ishtirokni tasdiqlash formasi",
    rsvpEyebrow: "Mehmonimiz bo'ling",
    rsvpTitle: "Javob",
    rsvpIntro: "Iltimos, 2026-yil 15-iyulgacha bizga kelishingizni xabar qiling.",
    fullName: "To'liq ism *",
    fullNamePlaceholder: "To'liq ismingiz",
    phone: "Telefon raqami (ixtiyoriy)",
    phonePlaceholder: "+998 90 123 45 67",
    attending: "Ishtirok etasizmi? *",
    accept: "Ha, boraman",
    decline: "Yo'q, bora olmayman",
    message: "Juftlik uchun tilak",
    messagePlaceholder: "Samimiy tilaklaringizni yozing...",
    submit: "Javobni yuborish",
    formSending: "Javob yuborilmoqda…",
    formStatus: "Rahmat! Javobingiz yuborildi.",
    formError: "Javobni yuborib bo'lmadi. Iltimos, yana urinib ko'ring."
  },
  ru: {
    htmlLang: "ru",
    title: "Свадебное приглашение Амала и Паризоды",
    languageLabel: "Переключить язык на узбекский",
    soundLabel: "Включить или выключить музыку",
    musicOn: "С музыкой",
    musicOff: "Без музыки",
    coverLabel: "Открыть свадебное приглашение",
    coverScript: "Вы приглашены",
    openCue: "Нажмите, чтобы открыть",
    inviteLabel: "Свадебное приглашение Амала и Паризоды",
    coverSectionLabel: "Обложка приглашения",
    heroSectionLabel: "Свадебное объявление",
    heroEyebrow: "Мы женимся",
    date: "15 августа 2026",
    heroRsvp: "Подтвердить участие",
    storyLabel: "История любви",
    storyKicker: "Наш путь",
    storyTitle: "Наша история любви",
    timeline: [
      ["Как мы встретились", "Наши пути пересеклись самым неожиданным образом. Случайная встреча стала началом нашей красивой истории."],
      ["Первое приключение", "Мы открыли общую любовь к путешествиям и долгим разговорам, а каждый тихий момент делал нас ближе."],
      ["Движение вперед", "Мы поняли, что это навсегда. Совместная жизнь с каждым днем становилась теплее и крепче."],
      ["Предложение", "С сердцами, полными любви и мечтаний о будущем, был задан главный вопрос и получен ответ со слезами радости."]
    ],
    programLabel: "Программа дня",
    programTitle: "Программа дня",
    programIntro: "Что мы подготовили для вас",
    program: [
      ["16:30", "Прибытие гостей", "Встреча и прием"],
      ["17:00", "Церемония", "Свадебная церемония"],
      ["18:00", "Коктейль", "Напитки и легкие закуски"],
      ["20:00", "Ужин", "Свадебный банкет"],
      ["23:00", "Вечеринка", "Танцуем!"],
      ["02:30", "Завершение", "До свидания"]
    ],
    giftsLabel: "Подарки",
    giftsTitle: "Подарки",
    giftsText: "Самый важный подарок для нас - ваше присутствие. Если вы захотите сделать подарок, вы можете выбрать удобный для себя способ.",
    contribution: "Вклад",
    bankCard: "Банковская карта: 8600 0000 0000 0000",
    cardName: "Имя: Амал и Паризода",
    detailsLabel: "Детали мероприятия",
    joinUs: "Присоединяйтесь к нам",
    detailsTitle: "Детали мероприятия",
    detailsIntro: "Мы с нетерпением ждем возможности разделить с вами этот особенный день. Здесь вся нужная информация.",
    ceremonyTitle: "Свадебная церемония",
    ceremonyTime: "◷ 16:00",
    ceremonyPlace: "⌖ Отель Uzbekistan",
    ceremonyAddress: "улица Махтумкули, 45, Ташкент, Узбекистан",
    mapLabel: "Карта с отметкой места церемонии",
    mapLoading: "Карта загружается…",
    mapKeyMissing: "Ключ Yandex Maps API не настроен. Добавьте YANDEX_MAPS_API_KEY в файл .env.",
    mapError: "Не удалось загрузить карту. Проверьте API-ключ и ограничения домена.",
    openMaps: "⌁ Открыть в картах",
    addCalendar: "▣ Добавить в календарь",
    dressTitle: "Дресс-код",
    dressCode: "Формальный / Black Tie по желанию",
    dressText: "Мы будем рады, если гости придут на наш праздник в элегантных образах.",
    rsvpLabel: "Форма подтверждения участия",
    rsvpEyebrow: "Будьте нашим гостем",
    rsvpTitle: "Ответ",
    rsvpIntro: "Пожалуйста, сообщите нам до 15 июля 2026 года, сможете ли вы присоединиться.",
    fullName: "Полное имя *",
    fullNamePlaceholder: "Ваше полное имя",
    phone: "Номер телефона (необязательно)",
    phonePlaceholder: "+998 90 123 45 67",
    attending: "Вы будете присутствовать? *",
    accept: "Да, приду",
    decline: "Нет, не приду",
    message: "Пожелание для пары",
    messagePlaceholder: "Напишите ваши теплые пожелания...",
    submit: "Отправить ответ",
    formSending: "Отправляем ответ…",
    formStatus: "Спасибо! Ваш ответ отправлен.",
    formError: "Не удалось отправить ответ. Пожалуйста, попробуйте ещё раз."
  }
};

const setText = (selector: string, value: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
};

const setInput = (selector: string, placeholder: string) => {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (element) element.placeholder = placeholder;
};

const setLabelStart = (selector: string, value: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  const textNode = Array.from(element?.childNodes ?? []).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = `\n              ${value}\n              `;
};

const setLabelEnd = (selector: string, value: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  const textNode = Array.from(element?.childNodes ?? []).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = ` ${value}`;
};

type YandexMapInstance = {
  geoObjects: { add: (geoObject: unknown) => void };
  behaviors: { disable: (behavior: string) => void };
};

type YandexMapsApi = {
  ready: (callback: () => void) => void;
  Map: new (
    container: string | HTMLElement,
    state: { center: number[]; zoom: number; controls: string[] },
    options?: Record<string, unknown>
  ) => YandexMapInstance;
  Placemark: new (
    coordinates: number[],
    properties?: Record<string, string>,
    options?: Record<string, string | boolean>
  ) => unknown;
};

type PublicConfig = {
  yandexMapsApiKey?: string;
  yandexMapsCenter?: number[];
};

const getYandexMapsApi = () => (
  window as typeof window & { ymaps?: YandexMapsApi }
).ymaps;

const loadYandexMapsApi = (apiKey: string, language: "uz" | "ru") => {
  if (getYandexMapsApi()) return Promise.resolve();
  if (yandexMapsScriptPromise) return yandexMapsScriptPromise;

  yandexMapsScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const apiLanguage = language === "ru" ? "ru_RU" : "en_US";
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=${apiLanguage}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("yandex-maps-load-error"));
    document.head.append(script);
  });

  return yandexMapsScriptPromise;
};

const initializeYandexMap = async () => {
  if (!mapContainer || !mapShell || yandexMapState !== "idle") return;

  yandexMapState = "loading";
  setText(".map-status", copy[currentLanguage].mapLoading);

  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("config-load-error");

    const config = await response.json() as PublicConfig;
    const apiKey = config.yandexMapsApiKey?.trim();
    if (!apiKey) {
      yandexMapErrorKind = "key";
      throw new Error("yandex-maps-key-missing");
    }

    const configuredCenter = config.yandexMapsCenter;
    const center = Array.isArray(configuredCenter)
      && configuredCenter.length === 2
      && configuredCenter.every(Number.isFinite)
      ? configuredCenter
      : [41.311151, 69.279737];

    await loadYandexMapsApi(apiKey, currentLanguage);
    const yandexMaps = getYandexMapsApi();
    if (!yandexMaps) throw new Error("yandex-maps-global-missing");

    await new Promise<void>((resolve) => yandexMaps.ready(resolve));

    const map = new yandexMaps.Map(mapContainer, {
      center,
      zoom: 15,
      controls: ["zoomControl", "fullscreenControl"],
    });

    const text = copy[currentLanguage];
    const placemark = new yandexMaps.Placemark(center, {
      balloonContentHeader: text.ceremonyTitle,
      balloonContentBody: `${text.ceremonyPlace}<br>${text.ceremonyAddress}`,
      hintContent: text.ceremonyPlace,
    }, {
      preset: "islands#redDotIcon",
      hideIconOnBalloonOpen: false,
    });

    map.geoObjects.add(placemark);
    map.behaviors.disable("scrollZoom");
    yandexMapState = "ready";
    mapShell.classList.add("is-ready");
  } catch (error) {
    yandexMapState = "error";
    mapShell.classList.add("has-error");
    const message = yandexMapErrorKind === "key"
      ? copy[currentLanguage].mapKeyMissing
      : copy[currentLanguage].mapError;
    if (mapStatus) mapStatus.textContent = message;
    console.error("Yandex Maps initialization failed:", error);
  }
};

const primeCoverVideoFirstFrame = () => {
  if (!coverVideo || invitationOpened) return;

  const showFirstFrame = () => {
    if (invitationOpened) return;
    coverVideo.pause();
    coverVideo.currentTime = 0.001;
  };

  if (coverVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    showFirstFrame();
    return;
  }

  coverVideo.addEventListener("loadeddata", showFirstFrame, { once: true });
};

const setCoverVideoLanguage = (language: "uz" | "ru") => {
  if (!coverVideo || invitationOpened) return;

  const nextSource = language === "uz"
    ? coverVideo.dataset.videoUz
    : coverVideo.dataset.videoRu;

  if (!nextSource || coverVideo.getAttribute("src") === nextSource) return;

  coverVideo.src = nextSource;
  coverVideo.load();
  primeCoverVideoFirstFrame();
};

const applyLanguage = (language: "uz" | "ru") => {
  const text = copy[language];
  currentLanguage = language;
  setCoverVideoLanguage(language);
  document.documentElement.lang = text.htmlLang;
  document.title = text.title;

  languageButton?.setAttribute("aria-label", text.languageLabel);
  soundToggle?.setAttribute("aria-label", text.soundLabel);
  coverTrigger?.setAttribute("aria-label", text.coverLabel);
  invite?.setAttribute("aria-label", text.inviteLabel);
  cover?.setAttribute("aria-label", text.coverSectionLabel);
  document.querySelector(".hero")?.setAttribute("aria-label", text.heroSectionLabel);
  document.querySelector(".story")?.setAttribute("aria-label", text.storyLabel);
  document.querySelector(".program")?.setAttribute("aria-label", text.programLabel);
  document.querySelector(".gifts")?.setAttribute("aria-label", text.giftsLabel);
  document.querySelector(".details")?.setAttribute("aria-label", text.detailsLabel);
  document.querySelector(".rsvp")?.setAttribute("aria-label", text.rsvpLabel);
  document.querySelector(".map")?.setAttribute("aria-label", text.mapLabel);
  if (yandexMapState === "idle" || yandexMapState === "loading") {
    setText(".map-status", text.mapLoading);
  } else if (yandexMapState === "error") {
    setText(".map-status", yandexMapErrorKind === "key" ? text.mapKeyMissing : text.mapError);
  }

  languageButton?.querySelectorAll<HTMLElement>("[data-lang-option]").forEach((option) => {
    option.classList.toggle("is-active", option.dataset.langOption === language);
  });

  setText(".cover-script", text.coverScript);
  setText(".sound-choice-label", musicEnabled ? text.musicOn : text.musicOff);
  setText(".open-cue", text.openCue);
  setText(".hero .eyebrow", text.heroEyebrow);
  setText(".date", text.date);
  setText(".hero-rsvp", text.heroRsvp);
  setText(".script-kicker", text.storyKicker);
  setText(".story h2", text.storyTitle);

  document.querySelectorAll<HTMLElement>(".timeline article").forEach((article, index) => {
    setText(`.timeline article:nth-child(${index + 1}) h3`, text.timeline[index][0]);
    setText(`.timeline article:nth-child(${index + 1}) p`, text.timeline[index][1]);
  });

  setText(".program h2", text.programTitle);
  setText(".program > p", text.programIntro);
  document.querySelectorAll<HTMLElement>(".program-list article").forEach((article, index) => {
    setText(`.program-list article:nth-child(${index + 1}) time`, text.program[index][0]);
    setText(`.program-list article:nth-child(${index + 1}) h3`, text.program[index][1]);
    setText(`.program-list article:nth-child(${index + 1}) p`, text.program[index][2]);
  });

  setText(".gifts h2", text.giftsTitle);
  setText(".gifts > p", text.giftsText);
  setText(".accordion span", text.contribution);
  setText(".accordion-panel p:nth-child(1)", text.bankCard);
  setText(".accordion-panel p:nth-child(2)", text.cardName);

  setText(".details > .eyebrow", text.joinUs);
  setText(".details h2", text.detailsTitle);
  setText(".details-intro", text.detailsIntro);
  setText(".detail-card h3", text.ceremonyTitle);
  setText(".detail-card .meta:nth-of-type(1)", text.ceremonyTime);
  setText(".detail-card .meta:nth-of-type(2)", text.ceremonyPlace);
  setText(".detail-card > p:not(.meta)", text.ceremonyAddress);
  setText(".outline-btn:nth-of-type(1)", text.openMaps);
  setText(".outline-btn:nth-of-type(2)", text.addCalendar);
  setText(".dress h3", text.dressTitle);
  setText(".dress p", text.dressCode);
  setText(".dress span", text.dressText);

  setText(".rsvp > .eyebrow", text.rsvpEyebrow);
  setText(".rsvp h2", text.rsvpTitle);
  setText(".rsvp > p:not(.eyebrow)", text.rsvpIntro);
  setLabelStart(".rsvp form > label:nth-of-type(1)", text.fullName);
  setInput("input[name='name']", text.fullNamePlaceholder);
  setLabelStart(".rsvp form > label:nth-of-type(2)", text.phone);
  setInput("input[name='phone']", text.phonePlaceholder);
  setText(".rsvp legend", text.attending);
  setLabelEnd("fieldset label:nth-of-type(1)", text.accept);
  setLabelEnd("fieldset label:nth-of-type(2)", text.decline);
  setLabelStart(".rsvp form > label:nth-of-type(3)", text.message);
  setInput("textarea[name='message']", text.messagePlaceholder);
  setText(".rsvp form button", text.submit);
};

languageButton?.addEventListener("click", () => {
  if (invitationOpened && !invitationTransitionFinished) return;
  applyLanguage(currentLanguage === "uz" ? "ru" : "uz");
});

applyLanguage(currentLanguage);
void initializeYandexMap();

const startMusic = async () => {
  if (!music || !music.paused) return;

  try {
    music.volume = 0.45;
    await music.play();
    musicStarted = true;
    soundToggle?.classList.remove("is-muted");
    soundToggle?.setAttribute("aria-pressed", "true");
  } catch {
    soundToggle?.classList.add("is-muted");
  }
};

const updateMusicChoice = () => {
  soundToggle?.classList.toggle("is-muted", !musicEnabled);
  soundToggle?.setAttribute("aria-pressed", String(musicEnabled));
  setText(
    ".sound-choice-label",
    musicEnabled ? copy[currentLanguage].musicOn : copy[currentLanguage].musicOff
  );
};

const pauseMusic = () => {
  if (!music) return;

  music.pause();
  musicStarted = false;
  soundToggle?.classList.add("is-muted");
  soundToggle?.setAttribute("aria-pressed", "false");
};

document.body.classList.add("cover-locked");

const finishOpeningTransition = () => {
  if (!cover || !invite || invitationTransitionFinished) return;

  invitationTransitionFinished = true;
  if (coverSafetyTimeout !== undefined) {
    window.clearTimeout(coverSafetyTimeout);
  }

  cover.classList.add("is-opened");
  invite.classList.add("is-opened");
  document.body.classList.remove("cover-locked");
  if (heroVideo) {
    heroVideo.currentTime = 0;
    void heroVideo.play().catch(() => undefined);
  }
};

const openInvitation = () => {
  if (!cover || !invite || invitationOpened) return;

  invitationOpened = true;
  cover.classList.add("is-opening");
  coverTrigger?.setAttribute("disabled", "true");
  if (musicEnabled) void startMusic();

  let fallbackStarted = false;
  const playFrameFallback = () => {
    if (fallbackStarted || invitationTransitionFinished) return;

    fallbackStarted = true;
    coverVideo?.pause();
    cover.classList.add("video-fallback");
    window.setTimeout(finishOpeningTransition, 1150);
  };

  if (!coverVideo) {
    playFrameFallback();
    return;
  }

  coverVideo.currentTime = 0;
  coverVideo.addEventListener("ended", finishOpeningTransition, { once: true });
  coverVideo.addEventListener("error", playFrameFallback, { once: true });
  const safetyDelay = Number.isFinite(coverVideo.duration)
    ? coverVideo.duration * 1000 + 3000
    : 8000;
  coverSafetyTimeout = window.setTimeout(playFrameFallback, safetyDelay);
  void coverVideo.play().catch(playFrameFallback);
};

coverTrigger?.addEventListener("click", openInvitation);

soundToggle?.addEventListener("click", async () => {
  if (!music) return;

  musicEnabled = !musicEnabled;
  updateMusicChoice();

  if (!invitationOpened) {
    return;
  }

  if (musicEnabled) {
    await startMusic();
  } else {
    pauseMusic();
  }
});

accordion?.addEventListener("click", () => {
  const isOpen = accordionPanel?.classList.toggle("is-open") ?? false;
  accordion.setAttribute("aria-expanded", String(isOpen));
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit']");
  const formData = new FormData(form);
  if (statusOutput) statusOutput.value = copy[currentLanguage].formSending;
  if (submitButton) submitButton.disabled = true;

  try {
    const response = await fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        phone: formData.get("phone"),
        attending: formData.get("attending"),
        message: formData.get("message"),
        language: currentLanguage,
      }),
    });

    if (!response.ok) throw new Error(`RSVP request failed with ${response.status}`);
    if (statusOutput) statusOutput.value = copy[currentLanguage].formStatus;
    form.reset();
  } catch (error) {
    console.error("RSVP submission failed:", error);
    if (statusOutput) statusOutput.value = copy[currentLanguage].formError;
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

const revealTargets = document.querySelectorAll<HTMLElement>(
  ".timeline article, .program-list article, .detail-card, .dress, .rsvp form"
);

revealTargets.forEach((target) => target.classList.add("reveal"));

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      }
    });
  },
  { threshold: 0.16 }
);

revealTargets.forEach((target) => observer.observe(target));
