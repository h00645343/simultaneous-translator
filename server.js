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

const PIPER_VOICE_PROFILE_CANDIDATES = {
  en: [
    { gender: "female", label: "女生", voice: "en_US-hfc_female-medium" },
    { gender: "male", label: "男生", voice: "en_US-hfc_male-medium" },
    { gender: "neutral", label: "默认", voice: "en_US-lessac-medium" }
  ],
  zh: [
    { gender: "female", label: "女生", voice: "zh_CN-huayan-x_low" },
    { gender: "male", label: "男生", voice: "zh_CN-chaowen-medium" }
  ]
};

const LIBRETRANSLATE_CODE_MAP = {
  zh: "zh-Hans"
};

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

async function synthesizeSpeech(text, targetLanguageCode, requestedVoice = "", requestedGender = "") {
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

  return {
    defaults: {
      targetLanguageCode: "en",
      voiceGender: "female"
    },
    services: {
      vosk: {
        ok: true,
        url: VOSK_WS_URL,
        modelLabel: VOSK_MODEL_LABEL
      },
      libreTranslate: libre,
      piper
    },
    targetLanguages: SUPPORTED_TARGET_LANGUAGES
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

      if (!text) {
        sendJson(res, 400, { error: "Missing text" });
        return;
      }

      const result = await translateText(text, targetLanguageCode, sourceLanguageCode);
      sendJson(res, 200, result);
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
