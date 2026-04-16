const http = require("http");
const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "public");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const VOSK_WS_URL = process.env.VOSK_WS_URL || "ws://localhost:2700";
const VOSK_MODEL_LABEL = process.env.VOSK_MODEL_LABEL || "中文";
const LIBRETRANSLATE_URL = normalizeBaseUrl(
  process.env.LIBRETRANSLATE_URL || "http://localhost:5000"
);
const PIPER_URL = normalizeBaseUrl(process.env.PIPER_URL || "http://localhost:5001");
const PIPER_DEFAULT_VOICE = process.env.PIPER_DEFAULT_VOICE || "";
const VOICEVOX_URL = normalizeBaseUrl(process.env.VOICEVOX_URL || "http://localhost:50021");
const VOICEVOX_DEFAULT_SPEAKER = Number(process.env.VOICEVOX_DEFAULT_SPEAKER || 11);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const SUPPORTED_TARGET_LANGUAGES = [
  { code: "en", label: "英语", speechLabel: "English", piperPrefixes: ["en_US", "en_GB", "en"] },
  { code: "zh", label: "简体中文", speechLabel: "Chinese", piperPrefixes: ["zh_CN", "zh"] },
  { code: "ja", label: "日语", speechLabel: "Japanese", piperPrefixes: ["ja_JP", "ja"] },
  { code: "ko", label: "韩语", speechLabel: "Korean", piperPrefixes: ["ko_KR", "ko"] },
  { code: "fr", label: "法语", speechLabel: "French", piperPrefixes: ["fr_FR", "fr"] },
  { code: "de", label: "德语", speechLabel: "German", piperPrefixes: ["de_DE", "de"] },
  { code: "es", label: "西班牙语", speechLabel: "Spanish", piperPrefixes: ["es_ES", "es_MX", "es"] },
  { code: "ru", label: "俄语", speechLabel: "Russian", piperPrefixes: ["ru_RU", "ru"] },
  { code: "ar", label: "阿拉伯语", speechLabel: "Arabic", piperPrefixes: ["ar_JO", "ar"] }
];

const SOURCE_ACCENT_PROFILES = [
  {
    code: "auto",
    label: "自动判断",
    description: "按识别内容自动匹配北方或南方口音修正规则"
  },
  {
    code: "north",
    label: "北方口音",
    description: "强化儿化音、华北和东北常见口语的标准化"
  },
  {
    code: "south",
    label: "南方口音",
    description: "强化粤语、吴语和南方常见表达的标准化"
  }
];

const PIPER_VOICE_PROFILE_CANDIDATES = {
  en: [
    { gender: "female", label: "女生", voice: "en_US-hfc_female-medium" },
    { gender: "male", label: "男生", voice: "en_US-hfc_male-medium" },
    { gender: "neutral", label: "默认", voice: "en_US-lessac-medium" }
  ],
  zh: [
    { gender: "female", label: "女生", voice: "zh_CN-huayan-x_low" },
    { gender: "male", label: "男生", voice: "zh_CN-chaowen-medium" }
  ],
  de: [
    { gender: "male", label: "男生", voice: "de_DE-thorsten-medium" },
    { gender: "female", label: "女生", voice: "de_DE-eva_k-x_low" }
  ],
  fr: [
    { gender: "male", label: "男生", voice: "fr_FR-tom-medium" },
    { gender: "female", label: "女生", voice: "fr_FR-siwis-medium" }
  ]
};

const VOICEVOX_SPEAKER_PROFILE_CANDIDATES = {
  ja: [
    { gender: "male", label: "男生", speakerId: 11, speakerName: "VOICEVOX speaker 11" },
    { gender: "female", label: "女生", speakerId: 2, speakerName: "VOICEVOX speaker 2" }
  ]
};

const LIBRETRANSLATE_CODE_MAP = {
  zh: "zh-Hans"
};

const GENERIC_NORMALIZATION_RULES = [
  [/（/g, "("],
  [/）/g, ")"],
  [/，+/g, "，"],
  [/。+/g, "。"],
  [/！+/g, "！"],
  [/？+/g, "？"],
  [/[“”]/g, "\""],
  [/[‘’]/g, "'"],
  [/\s+/g, " "],
  [/(^|[，。！？、\s])(嗯|呃|额|啊|哎|欸|诶)(?=[，。！？、\s]|$)/g, "$1"],
  [/^(那个|这个|就是|然后)\s*/g, ""],
  [/([，。！？、])\s+/g, "$1"],
  [/\s+([，。！？、])/g, "$1"],
  [/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1"]
];

const NORTH_ACCENT_MARKERS = [
  /咋整/g,
  /咋办/g,
  /咋样/g,
  /咋/g,
  /嘎哈/g,
  /干哈/g,
  /唠嗑/g,
  /寻思/g,
  /埋汰/g,
  /倍儿/g,
  /忒/g,
  /俺们/g,
  /俺/g,
  /恁们/g,
  /恁/g,
  /这儿/g,
  /那儿/g,
  /哪儿/g,
  /搁这/g,
  /搁那/g
];

const SOUTH_ACCENT_MARKERS = [
  /而家/g,
  /依家/g,
  /冇/g,
  /喺/g,
  /系咪/g,
  /系唔系/g,
  /佢哋/g,
  /佢地/g,
  /佢/g,
  /嘅/g,
  /咗/g,
  /咩/g,
  /乜嘢/g,
  /边度/g,
  /呢度/g,
  /嗰度/g,
  /咁样/g,
  /咁/g,
  /唔/g,
  /食饭/g,
  /饮茶/g,
  /得闲/g,
  /阿拉/g,
  /侬/g,
  /歹势/g
];

const NORTH_ACCENT_RULES = [
  [/咋整/g, "怎么办"],
  [/咋办/g, "怎么办"],
  [/咋样/g, "怎么样"],
  [/咋回事/g, "怎么回事"],
  [/咋/g, "怎么"],
  [/嘎哈/g, "干什么"],
  [/干哈/g, "干什么"],
  [/唠嗑/g, "聊天"],
  [/寻思/g, "琢磨"],
  [/埋汰/g, "脏"],
  [/倍儿/g, "非常"],
  [/忒/g, "太"],
  [/老鼻子/g, "很多"],
  [/俺们/g, "我们"],
  [/俺/g, "我"],
  [/恁们/g, "你们"],
  [/恁/g, "你"],
  [/搁这儿/g, "在这里"],
  [/搁那儿/g, "在那里"],
  [/搁这/g, "在这里"],
  [/搁那/g, "在那里"],
  [/搁/g, "在"],
  [/这儿/g, "这里"],
  [/那儿/g, "那里"],
  [/哪儿/g, "哪里"],
  [/一会儿/g, "一会"],
  [/一点儿/g, "一点"],
  [/这嘎达/g, "这里"],
  [/那嘎达/g, "那里"],
  [/整明白/g, "弄明白"],
  [/整不了/g, "做不了"]
];

const SOUTH_ACCENT_RULES = [
  [/而家/g, "现在"],
  [/依家/g, "现在"],
  [/冇问题/g, "没问题"],
  [/冇/g, "没有"],
  [/喺/g, "在"],
  [/系唔系/g, "是不是"],
  [/系咪/g, "是不是"],
  [/佢哋/g, "他们"],
  [/佢地/g, "他们"],
  [/佢/g, "他"],
  [/嘅/g, "的"],
  [/咗/g, "了"],
  [/咩嘢/g, "什么"],
  [/乜嘢/g, "什么"],
  [/咩/g, "什么"],
  [/边度/g, "哪里"],
  [/呢度/g, "这里"],
  [/嗰度/g, "那里"],
  [/咁样/g, "这样"],
  [/咁/g, "这么"],
  [/唔该/g, "麻烦"],
  [/唔系/g, "不是"],
  [/唔/g, "不"],
  [/食饭/g, "吃饭"],
  [/饮水/g, "喝水"],
  [/饮茶/g, "喝茶"],
  [/得闲/g, "有空"],
  [/搞掂/g, "办妥"],
  [/阿拉/g, "我们"],
  [/侬/g, "你"],
  [/伊拉/g, "他们"],
  [/伊/g, "他"],
  [/歹势/g, "不好意思"],
  [/好伐/g, "好吗"],
  [/是伐/g, "是吗"]
];

function toLibreTranslateCode(code) {
  return LIBRETRANSLATE_CODE_MAP[code] || code;
}

function fromLibreTranslateCode(code) {
  if (code === "zh-Hans" || code === "zh_CN") {
    return "zh";
  }

  return code;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

function sendBinary(res, statusCode, buffer, contentType) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Content-Length": buffer.length
  });
  res.end(buffer);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(message);
}

function serveStaticFile(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (safePath !== "/index.html") {
        serveStaticFile(res, "/index.html");
        return;
      }

      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
    });
    res.end(content);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseJsonBody(body) {
  return JSON.parse(body || "{}");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.error || payload?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function fetchPiperVoices() {
  const payload = await fetchJson(`${PIPER_URL}/voices`);
  if (Array.isArray(payload)) {
    return payload.map((item) => String(item));
  }

  if (Array.isArray(payload?.voices)) {
    return payload.voices.map((item) => String(item));
  }

  return Object.keys(payload || {});
}

async function fetchVoicevoxSpeakers() {
  const payload = await fetchJson(`${VOICEVOX_URL}/speakers`);
  return Array.isArray(payload) ? payload : [];
}

function getAvailableVoiceProfiles(availableVoices) {
  const profiles = {};

  for (const [languageCode, candidates] of Object.entries(PIPER_VOICE_PROFILE_CANDIDATES)) {
    const available = candidates.filter((candidate) => availableVoices.includes(candidate.voice));
    if (available.length > 0) {
      profiles[languageCode] = available;
    }
  }

  return profiles;
}

function getAvailableVoicevoxProfiles(speakers) {
  const profiles = {};
  const availableSpeakerIds = new Set(
    speakers.flatMap((speaker) => (speaker.styles || []).map((style) => Number(style.id)))
  );

  for (const [languageCode, candidates] of Object.entries(VOICEVOX_SPEAKER_PROFILE_CANDIDATES)) {
    const available = candidates.filter((candidate) => availableSpeakerIds.has(candidate.speakerId));
    if (available.length > 0) {
      profiles[languageCode] = available;
    }
  }

  return profiles;
}

function mergeSpeechProfiles(...profileGroups) {
  return profileGroups.reduce((merged, group) => {
    for (const [languageCode, profiles] of Object.entries(group || {})) {
      merged[languageCode] = profiles;
    }
    return merged;
  }, {});
}

function pickPiperVoice(targetLanguageCode, availableVoices, requestedVoice, requestedGender = "") {
  if (requestedVoice && availableVoices.includes(requestedVoice)) {
    return requestedVoice;
  }

  const profiles = getAvailableVoiceProfiles(availableVoices)[targetLanguageCode] || [];
  if (requestedGender) {
    const matchingProfile = profiles.find((profile) => profile.gender === requestedGender);
    if (matchingProfile) {
      return matchingProfile.voice;
    }
  }

  const maleProfile = profiles.find((profile) => profile.gender === "male");
  if (maleProfile) {
    return maleProfile.voice;
  }

  const femaleProfile = profiles.find((profile) => profile.gender === "female");
  if (femaleProfile) {
    return femaleProfile.voice;
  }

  if (PIPER_DEFAULT_VOICE && availableVoices.includes(PIPER_DEFAULT_VOICE)) {
    return PIPER_DEFAULT_VOICE;
  }

  const language = SUPPORTED_TARGET_LANGUAGES.find((item) => item.code === targetLanguageCode);
  if (!language) {
    return "";
  }

  for (const prefix of language.piperPrefixes) {
    const exact = availableVoices.find((voice) => voice === prefix);
    if (exact) {
      return exact;
    }

    const startsWith = availableVoices.find((voice) => voice.startsWith(`${prefix}-`));
    if (startsWith) {
      return startsWith;
    }
  }

  return "";
}

function pickVoicevoxSpeaker(speakers, requestedSpeaker = "", requestedGender = "") {
  const requestedSpeakerId = Number(requestedSpeaker || 0);
  const flattened = speakers.flatMap((speaker) =>
    (speaker.styles || []).map((style) => ({
      id: Number(style.id),
      speakerName: String(speaker.name || ""),
      styleName: String(style.name || "")
    }))
  );

  if (requestedSpeakerId > 0) {
    const exact = flattened.find((style) => style.id === requestedSpeakerId);
    if (exact) {
      return exact;
    }
  }

  if (requestedGender) {
    const matchingProfile = (VOICEVOX_SPEAKER_PROFILE_CANDIDATES.ja || []).find(
      (profile) => profile.gender === requestedGender
    );
    if (matchingProfile) {
      const matchingSpeaker = flattened.find((style) => style.id === matchingProfile.speakerId);
      if (matchingSpeaker) {
        return matchingSpeaker;
      }
    }
  }

  const defaultSpeaker = flattened.find((style) => style.id === VOICEVOX_DEFAULT_SPEAKER);
  if (defaultSpeaker) {
    return defaultSpeaker;
  }

  return flattened[0] || { id: VOICEVOX_DEFAULT_SPEAKER, speakerName: "VOICEVOX", styleName: "Default" };
}

function getAccentProfile(code) {
  return SOURCE_ACCENT_PROFILES.find((profile) => profile.code === code) || SOURCE_ACCENT_PROFILES[0];
}

function countMatches(text, rules) {
  let count = 0;
  for (const rule of rules) {
    const matches = text.match(rule);
    count += matches ? matches.length : 0;
  }
  return count;
}

function applyRules(text, rules) {
  let result = text;
  for (const [pattern, replacement] of rules) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function finalizeNormalizedText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/([，。！？、]){2,}/g, "$1")
    .replace(/^[，。！？、\s]+/g, "")
    .replace(/[，。！？、\s]+$/g, "")
    .trim();
}

function detectAccentProfile(text) {
  const northScore = countMatches(text, NORTH_ACCENT_MARKERS);
  const southScore = countMatches(text, SOUTH_ACCENT_MARKERS);

  if (northScore === 0 && southScore === 0) {
    return "auto";
  }

  return northScore >= southScore ? "north" : "south";
}

function normalizeRecognizedText(text, requestedAccentCode = "auto") {
  const rawText = String(text || "").trim();
  if (!rawText) {
    return {
      rawText: "",
      normalizedText: "",
      accentProfileUsed: "auto",
      accentProfileLabel: getAccentProfile("auto").label,
      normalizationApplied: false
    };
  }

  const normalizedSurface = finalizeNormalizedText(applyRules(rawText, GENERIC_NORMALIZATION_RULES));
  const accentProfileUsed =
    requestedAccentCode === "auto" ? detectAccentProfile(normalizedSurface) : requestedAccentCode;

  let normalizedText = normalizedSurface;
  if (accentProfileUsed === "north") {
    normalizedText = applyRules(normalizedText, NORTH_ACCENT_RULES);
  }
  if (accentProfileUsed === "south") {
    normalizedText = applyRules(normalizedText, SOUTH_ACCENT_RULES);
  }

  normalizedText = finalizeNormalizedText(normalizedText);

  return {
    rawText,
    normalizedText: normalizedText || rawText,
    accentProfileUsed,
    accentProfileLabel: getAccentProfile(accentProfileUsed).label,
    normalizationApplied: (normalizedText || rawText) !== rawText
  };
}

async function translateText(text, targetLanguageCode, sourceLanguageCode = "auto") {
  const payload = await fetchJson(`${LIBRETRANSLATE_URL}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      q: text,
      source: sourceLanguageCode === "auto" ? "auto" : toLibreTranslateCode(sourceLanguageCode),
      target: toLibreTranslateCode(targetLanguageCode),
      format: "text"
    })
  });

  return {
    detectedLanguage: fromLibreTranslateCode(payload.detectedLanguage?.language || sourceLanguageCode),
    translation: String(payload.translatedText || "").trim()
  };
}

async function synthesizePiperSpeech(text, targetLanguageCode, requestedVoice = "", requestedGender = "") {
  const availableVoices = await fetchPiperVoices();
  const voice = pickPiperVoice(targetLanguageCode, availableVoices, requestedVoice, requestedGender);

  if (!voice) {
    throw new Error(`No Piper voice available for target language: ${targetLanguageCode}`);
  }

  const response = await fetch(`${PIPER_URL}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      voice
    })
  });

  if (!response.ok) {
    let message = `Piper request failed: ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch (_) {
      // Ignore JSON parsing failures for binary responses.
    }
    throw new Error(message);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuffer),
    voice
  };
}

async function synthesizeVoicevoxSpeech(text, requestedSpeaker = "", requestedGender = "") {
  const speakers = await fetchVoicevoxSpeakers();
  const selectedSpeaker = pickVoicevoxSpeaker(speakers, requestedSpeaker, requestedGender);
  const speakerId = selectedSpeaker.id;

  const audioQueryResponse = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
    { method: "POST" }
  );

  if (!audioQueryResponse.ok) {
    throw new Error(`VOICEVOX audio_query failed: ${audioQueryResponse.status}`);
  }

  const audioQuery = await audioQueryResponse.json();
  const synthesisResponse = await fetch(`${VOICEVOX_URL}/synthesis?speaker=${speakerId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(audioQuery)
  });

  if (!synthesisResponse.ok) {
    throw new Error(`VOICEVOX synthesis failed: ${synthesisResponse.status}`);
  }

  const arrayBuffer = await synthesisResponse.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuffer),
    voice: `VOICEVOX speaker ${speakerId}`
  };
}

async function synthesizeSpeech(text, targetLanguageCode, requestedVoice = "", requestedGender = "") {
  if (targetLanguageCode === "ja") {
    return synthesizeVoicevoxSpeech(text, requestedVoice, requestedGender);
  }

  return synthesizePiperSpeech(text, targetLanguageCode, requestedVoice, requestedGender);
}

async function buildBootstrapPayload() {
  const libre = {
    ok: false,
    url: LIBRETRANSLATE_URL,
    languages: [],
    error: ""
  };
  const piper = {
    ok: false,
    url: PIPER_URL,
    voices: [],
    error: ""
  };
  const voicevox = {
    ok: false,
    url: VOICEVOX_URL,
    speakers: [],
    voiceProfiles: {},
    error: ""
  };

  try {
    const payload = await fetchJson(`${LIBRETRANSLATE_URL}/languages`);
    libre.ok = true;
    libre.languages = (Array.isArray(payload) ? payload : []).map((language) => {
      const code = fromLibreTranslateCode(String(language.code || ""));
      const targets = Array.isArray(language.targets)
        ? language.targets.map((target) => fromLibreTranslateCode(String(target)))
        : [];

      return {
        ...language,
        code,
        targets
      };
    });
  } catch (error) {
    libre.error = error.message;
  }

  try {
    piper.voices = await fetchPiperVoices();
    piper.voiceProfiles = getAvailableVoiceProfiles(piper.voices);
    piper.ok = true;
  } catch (error) {
    piper.error = error.message;
    piper.voiceProfiles = {};
  }

  try {
    const speakers = await fetchVoicevoxSpeakers();
    voicevox.ok = true;
    voicevox.speakers = speakers.map((speaker) => ({
      name: String(speaker.name || ""),
      styles: (speaker.styles || []).map((style) => ({
        id: Number(style.id),
        name: String(style.name || "")
      }))
    }));
    voicevox.voiceProfiles = getAvailableVoicevoxProfiles(speakers);
  } catch (error) {
    voicevox.error = error.message;
    voicevox.voiceProfiles = {};
  }

  const speechProfiles = mergeSpeechProfiles(piper.voiceProfiles, voicevox.voiceProfiles);

  return {
    defaults: {
      targetLanguageCode: "en",
      voiceGender: "male",
      sourceAccentCode: "auto"
    },
    services: {
      vosk: {
        ok: true,
        url: VOSK_WS_URL,
        modelLabel: VOSK_MODEL_LABEL
      },
      libreTranslate: libre,
      piper,
      voicevox,
      voiceProfiles: speechProfiles
    },
    targetLanguages: SUPPORTED_TARGET_LANGUAGES,
    sourceAccentProfiles: SOURCE_ACCENT_PROFILES
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, await buildBootstrapPayload());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      voskWebsocketUrl: VOSK_WS_URL,
      voskModelLabel: VOSK_MODEL_LABEL
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/translate") {
    try {
      const data = parseJsonBody(await readRequestBody(req));
      const text = String(data.text || "").trim();
      const targetLanguageCode = String(data.targetLanguageCode || "en").trim();
      const sourceLanguageCode = String(data.sourceLanguageCode || "auto").trim();
      const sourceAccentCode = String(data.sourceAccentCode || "auto").trim();

      if (!text) {
        sendJson(res, 400, { error: "Missing text" });
        return;
      }

      const normalization = normalizeRecognizedText(text, sourceAccentCode);
      const result = await translateText(
        normalization.normalizedText,
        targetLanguageCode,
        sourceLanguageCode
      );

      sendJson(res, 200, {
        rawText: normalization.rawText,
        normalizedText: normalization.normalizedText,
        accentProfileUsed: normalization.accentProfileUsed,
        accentProfileLabel: normalization.accentProfileLabel,
        normalizationApplied: normalization.normalizationApplied,
        detectedLanguage: result.detectedLanguage,
        translation: result.translation
      });
      return;
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Translation failed" });
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/speak") {
    try {
      const data = parseJsonBody(await readRequestBody(req));
      const text = String(data.text || "").trim();
      const targetLanguageCode = String(data.targetLanguageCode || "en").trim();
      const requestedVoice = String(data.voice || "").trim();
      const requestedGender = String(data.voiceGender || "").trim();

      if (!text) {
        sendJson(res, 400, { error: "Missing text" });
        return;
      }

      const result = await synthesizeSpeech(text, targetLanguageCode, requestedVoice, requestedGender);
      res.setHeader("X-Piper-Voice", result.voice);
      sendBinary(res, 200, result.audio, "audio/wav");
      return;
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Speech synthesis failed" });
      return;
    }
  }

  if (req.method === "GET") {
    serveStaticFile(res, url.pathname);
    return;
  }

  sendText(res, 405, "Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Simultaneous translator running at http://localhost:${PORT}`);
});
