const sourceTranscriptEl = document.getElementById("sourceTranscript");
const lastRawTranscriptEl = document.getElementById("lastRawTranscript");
const interimTranscriptEl = document.getElementById("interimTranscript");
const targetTranscriptEl = document.getElementById("targetTranscript");
const recognitionStatusEl = document.getElementById("recognitionStatus");
const normalizationStatusEl = document.getElementById("normalizationStatus");
const translationStatusEl = document.getElementById("translationStatus");
const speechStatusEl = document.getElementById("speechStatus");
const listenButton = document.getElementById("listenButton");
const targetLanguageSelect = document.getElementById("targetLanguage");
const sourceAccentSelect = document.getElementById("sourceAccent");
const voiceGenderSelect = document.getElementById("voiceGender");
const targetLanguageHintEl = document.getElementById("targetLanguageHint");
const sourceAccentHintEl = document.getElementById("sourceAccentHint");
const serviceSummaryEl = document.getElementById("serviceSummary");
const serviceDetailsEl = document.getElementById("serviceDetails");
const sourceModelEl = document.getElementById("sourceModel");

const SAMPLE_RATE = 16000;
const BROWSER_TTS_LANG_MAP = {
  en: ["en-US", "en-GB", "en"],
  zh: ["zh-CN", "zh", "cmn-CN"],
  ja: ["ja-JP", "ja"],
  de: ["de-DE", "de"],
  fr: ["fr-FR", "fr"]
};

let bootstrapData = null;
let audioContext = null;
let microphoneStream = null;
let mediaSourceNode = null;
let processorNode = null;
let voskSocket = null;
let isListening = false;
let isSpeaking = false;
let shouldResumeAfterSpeech = false;
let finalSourceText = "";
let finalTargetText = "";
let translationQueue = Promise.resolve();
let currentAudio = null;
let browserVoices = [];

function setRecognitionStatus(text) {
  recognitionStatusEl.textContent = text;
}

function setNormalizationStatus(text) {
  normalizationStatusEl.textContent = text;
}

function setTranslationStatus(text) {
  translationStatusEl.textContent = text;
}

function setSpeechStatus(text) {
  speechStatusEl.textContent = text;
}

function updateListenButton() {
  listenButton.textContent = isListening ? "停止收音" : "开始收音";
  listenButton.classList.toggle("is-live", isListening);
}

function appendSourceText(text) {
  finalSourceText = finalSourceText ? `${finalSourceText}\n${text}` : text;
  sourceTranscriptEl.textContent = finalSourceText;
}

function appendTargetText(text) {
  finalTargetText = finalTargetText ? `${finalTargetText}\n${text}` : text;
  targetTranscriptEl.textContent = finalTargetText;
}

function setLatestRawText(text) {
  lastRawTranscriptEl.textContent = text ? `原始识别：${text}` : "";
}

function currentTargetLanguage() {
  const value = targetLanguageSelect.value;
  return bootstrapData.targetLanguages.find((item) => item.code === value) || bootstrapData.targetLanguages[0];
}

function currentAccentProfile() {
  const value = sourceAccentSelect.value;
  return (
    bootstrapData.sourceAccentProfiles.find((item) => item.code === value) ||
    bootstrapData.sourceAccentProfiles[0]
  );
}

function currentVoiceProfiles() {
  return (
    bootstrapData.services.voiceProfiles?.[currentTargetLanguage().code] ||
    bootstrapData.services.piper.voiceProfiles?.[currentTargetLanguage().code] ||
    []
  );
}

function currentVoiceGender() {
  return voiceGenderSelect.value || bootstrapData.defaults.voiceGender || "male";
}

function hasPiperVoiceForLanguage(language) {
  const voices = bootstrapData.services.piper.voices || [];
  const profiles = bootstrapData.services.piper.voiceProfiles?.[language.code] || [];

  if (profiles.length > 0) {
    return true;
  }

  return language.piperPrefixes.some((prefix) =>
    voices.some((voice) => voice === prefix || voice.startsWith(`${prefix}-`))
  );
}

function hasVoicevoxForLanguage(language) {
  return language.code === "ja" && Boolean(bootstrapData.services.voicevox?.ok);
}

function browserTtsTagsForLanguage(languageCode) {
  return BROWSER_TTS_LANG_MAP[languageCode] || [languageCode];
}

function getMatchingBrowserVoice(languageCode) {
  const tags = browserTtsTagsForLanguage(languageCode).map((tag) => tag.toLowerCase());
  return browserVoices.find((voice) => {
    const voiceLang = String(voice.lang || "").toLowerCase();
    return tags.some((tag) => voiceLang === tag || voiceLang.startsWith(`${tag}-`) || voiceLang.startsWith(tag));
  });
}

function hasBrowserVoiceForLanguage(languageCode) {
  return Boolean(getMatchingBrowserVoice(languageCode));
}

async function ensureBrowserVoicesLoaded() {
  if (!("speechSynthesis" in window)) {
    browserVoices = [];
    return;
  }

  browserVoices = window.speechSynthesis.getVoices();
  if (browserVoices.length > 0) {
    return;
  }

  await new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 1200);
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        browserVoices = window.speechSynthesis.getVoices();
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });

  browserVoices = window.speechSynthesis.getVoices();
}

function hasSpeechOutputForLanguage(language) {
  return (
    hasPiperVoiceForLanguage(language) ||
    hasVoicevoxForLanguage(language) ||
    hasBrowserVoiceForLanguage(language.code)
  );
}

function renderSourceAccentProfiles() {
  const profiles = bootstrapData.sourceAccentProfiles || [];
  sourceAccentSelect.innerHTML = profiles
    .map((profile) => {
      const selected = profile.code === bootstrapData.defaults.sourceAccentCode ? "selected" : "";
      return `<option value="${profile.code}" ${selected}>${profile.label}</option>`;
    })
    .join("");

  sourceAccentHintEl.textContent = currentAccentProfile().description || "";
}

function renderVoiceOptions() {
  const profiles = currentVoiceProfiles();

  if (profiles.length === 0) {
    const hint = hasVoicevoxForLanguage(currentTargetLanguage())
      ? "VOICEVOX 日语"
      : hasPiperVoiceForLanguage(currentTargetLanguage())
        ? "默认音色"
        : "浏览器语音";
    voiceGenderSelect.innerHTML = `<option value="">${hint}</option>`;
    voiceGenderSelect.disabled = true;
    return;
  }

  const preferredGender = currentVoiceGender();
  const selectedGender = profiles.some((profile) => profile.gender === preferredGender)
    ? preferredGender
    : profiles[0].gender;

  voiceGenderSelect.innerHTML = profiles
    .map((profile) => {
      const selected = profile.gender === selectedGender ? "selected" : "";
      return `<option value="${profile.gender}" ${selected}>${profile.label}</option>`;
    })
    .join("");

  voiceGenderSelect.disabled = false;
}

function renderTargetLanguages() {
  const libreCodes = new Set(
    (bootstrapData.services.libreTranslate.languages || []).map((item) => String(item.code || ""))
  );

  const options = bootstrapData.targetLanguages.filter((language) => {
    const hasTranslation = libreCodes.size === 0 || libreCodes.has(language.code);
    return hasTranslation;
  });

  const languages = options.length > 0 ? options : bootstrapData.targetLanguages;
  bootstrapData.targetLanguages = languages;

  targetLanguageSelect.innerHTML = languages
    .map((language) => {
      const selected = language.code === bootstrapData.defaults.targetLanguageCode ? "selected" : "";
      return `<option value="${language.code}" ${selected}>${language.label}</option>`;
    })
    .join("");

  targetLanguageHintEl.textContent = `当前输出：${currentTargetLanguage().label}`;
  renderVoiceOptions();
}

function renderServices() {
  const libre = bootstrapData.services.libreTranslate;
  const piper = bootstrapData.services.piper;
  const vosk = bootstrapData.services.vosk;
  const targetLanguage = currentTargetLanguage();
  const speechBackends = [];

  if (hasPiperVoiceForLanguage(targetLanguage)) {
    speechBackends.push("Piper");
  }
  if (hasVoicevoxForLanguage(targetLanguage)) {
    speechBackends.push("VOICEVOX");
  }
  if (hasBrowserVoiceForLanguage(targetLanguage.code)) {
    speechBackends.push("浏览器语音");
  }

  const summaryParts = [
    `Vosk: ${vosk.url}`,
    libre.ok ? "LibreTranslate 已连接" : "LibreTranslate 未连接",
    piper.ok ? "Piper 已连接" : "Piper 未连接",
    `输入口音：${currentAccentProfile().label}`
  ];

  serviceSummaryEl.textContent = summaryParts.join(" | ");

  const detailLines = [];
  detailLines.push(`识别模型：${vosk.modelLabel}`);
  detailLines.push(`口音修正：${currentAccentProfile().description || "已启用"}`);
  detailLines.push(
    libre.ok ? `翻译语言数：${libre.languages.length}` : `翻译服务错误：${libre.error || "未启动"}`
  );
  detailLines.push(
    piper.ok ? `可用音色数：${piper.voices.length}` : `播报服务错误：${piper.error || "未启动"}`
  );
  detailLines.push(`当前输出后端：${speechBackends.join(" / ") || "未就绪"}`);
  if (piper.ok && currentVoiceProfiles().length > 0) {
    detailLines.push(`当前语言可选音色：${currentVoiceProfiles().map((profile) => profile.label).join(" / ")}`);
  }

  serviceDetailsEl.textContent = detailLines.join("\n");
  sourceModelEl.textContent = vosk.modelLabel;
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function convertFloat32ToInt16(float32Buffer) {
  const int16Buffer = new Int16Array(float32Buffer.length);

  for (let i = 0; i < float32Buffer.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Buffer[i]));
    int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return int16Buffer;
}

function handleVoskMessage(rawMessage) {
  let payload = null;

  try {
    payload = JSON.parse(rawMessage);
  } catch (error) {
    console.error("Failed to parse Vosk message", error);
    return;
  }

  if (payload.partial) {
    interimTranscriptEl.textContent = `实时识别：${payload.partial}`;
  }

  if (payload.text) {
    const text = String(payload.text).trim();
    if (!text) {
      return;
    }

    interimTranscriptEl.textContent = "";
    setLatestRawText(text);
    queueTranslation(text);
  }
}

async function requestTranslation(text) {
  setTranslationStatus(`正在翻译成 ${currentTargetLanguage().label}`);
  setNormalizationStatus(`正在按 ${currentAccentProfile().label} 修正`);

  const response = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      targetLanguageCode: currentTargetLanguage().code,
      sourceLanguageCode: "auto",
      sourceAccentCode: currentAccentProfile().code
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "翻译失败");
  }

  return payload;
}

async function requestSpeech(text) {
  setSpeechStatus(`正在合成 ${currentTargetLanguage().label}`);

  const response = await fetch("/api/speak", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      targetLanguageCode: currentTargetLanguage().code,
      voiceGender: currentVoiceGender()
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "语音播报失败");
  }

  const audioBlob = await response.blob();
  const voice = response.headers.get("X-Piper-Voice") || "自动选择";
  return { audioBlob, voice };
}

function playAudioBlob(audioBlob, voice) {
  return new Promise((resolve, reject) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    audio.onplay = () => {
      setSpeechStatus(`正在播报 (${voice})`);
    };

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      setSpeechStatus("播报完成");
      resolve();
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      setSpeechStatus("播报失败");
      reject(new Error("音频播放失败"));
    };

    audio.play().catch(reject);
  });
}

async function speakWithBrowser(text) {
  await ensureBrowserVoicesLoaded();

  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("当前浏览器不支持本地语音合成"));
      return;
    }

    const voice = getMatchingBrowserVoice(currentTargetLanguage().code);
    if (!voice) {
      reject(new Error(`当前设备缺少 ${currentTargetLanguage().label} 浏览器语音`));
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang || browserTtsTagsForLanguage(currentTargetLanguage().code)[0];
    utterance.rate = 1;
    utterance.pitch = currentVoiceGender() === "male" ? 0.9 : 1;

    utterance.onstart = () => {
      setSpeechStatus(`正在播报 (${voice.name || utterance.lang})`);
    };

    utterance.onend = () => {
      setSpeechStatus("播报完成");
      resolve();
    };

    utterance.onerror = () => {
      setSpeechStatus("播报失败");
      reject(new Error("浏览器语音播报失败"));
    };

    window.speechSynthesis.speak(utterance);
  });
}

function queueTranslation(text) {
  translationQueue = translationQueue
    .then(async () => {
      const result = await requestTranslation(text);
      appendSourceText(result.normalizedText || result.rawText);
      appendTargetText(result.translation);

      const normalizedLabel = result.normalizationApplied
        ? `已按 ${result.accentProfileLabel} 标准化`
        : `${result.accentProfileLabel} 检查完成`;
      setNormalizationStatus(normalizedLabel);
      setTranslationStatus("翻译完成");

      isSpeaking = true;
      if (isListening) {
        shouldResumeAfterSpeech = true;
        await stopListening(false);
      }

      if (hasPiperVoiceForLanguage(currentTargetLanguage()) || hasVoicevoxForLanguage(currentTargetLanguage())) {
        try {
          const { audioBlob, voice } = await requestSpeech(result.translation);
          await playAudioBlob(audioBlob, voice);
          return;
        } catch (error) {
          console.warn("Piper playback failed, falling back to browser TTS.", error);
        }
      }

      await speakWithBrowser(result.translation);
    })
    .catch((error) => {
      console.error(error);
      setNormalizationStatus(error.message || "标准化失败");
      setTranslationStatus(error.message || "翻译失败");
      setSpeechStatus(error.message || "播报失败");
    })
    .finally(async () => {
      isSpeaking = false;
      if (shouldResumeAfterSpeech) {
        shouldResumeAfterSpeech = false;
        await startListening();
      }
    });
}

function closeVoskSocket() {
  if (!voskSocket) {
    return;
  }

  if (voskSocket.readyState === WebSocket.OPEN) {
    voskSocket.send(JSON.stringify({ eof: 1 }));
  }

  voskSocket.close();
  voskSocket = null;
}

async function cleanupAudioGraph() {
  if (processorNode) {
    processorNode.disconnect();
    processorNode.onaudioprocess = null;
    processorNode = null;
  }

  if (mediaSourceNode) {
    mediaSourceNode.disconnect();
    mediaSourceNode = null;
  }

  if (microphoneStream) {
    for (const track of microphoneStream.getTracks()) {
      track.stop();
    }
    microphoneStream = null;
  }

  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close();
    audioContext = null;
  }
}

async function startListening() {
  if (isListening || isSpeaking) {
    return;
  }

  setRecognitionStatus("正在连接 Vosk");
  setNormalizationStatus(`待按 ${currentAccentProfile().label} 修正`);
  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  mediaSourceNode = audioContext.createMediaStreamSource(microphoneStream);
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);
  voskSocket = new WebSocket(bootstrapData.services.vosk.url);
  voskSocket.binaryType = "arraybuffer";

  await new Promise((resolve, reject) => {
    voskSocket.onopen = () => {
      voskSocket.send(JSON.stringify({ config: { sample_rate: SAMPLE_RATE } }));
      setRecognitionStatus(`收音中 (${bootstrapData.services.vosk.modelLabel})`);
      resolve();
    };

    voskSocket.onerror = () => {
      reject(new Error("无法连接本地 Vosk 服务"));
    };
  });

  voskSocket.onmessage = (event) => {
    handleVoskMessage(event.data);
  };

  voskSocket.onclose = () => {
    if (isListening) {
      setRecognitionStatus("识别连接已断开");
    }
  };

  processorNode.onaudioprocess = (event) => {
    if (!voskSocket || voskSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(input, audioContext.sampleRate, SAMPLE_RATE);
    const pcm16 = convertFloat32ToInt16(downsampled);
    voskSocket.send(pcm16.buffer);
  };

  mediaSourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);

  isListening = true;
  updateListenButton();
}

async function stopListening(cancelPlayback = true) {
  isListening = false;
  updateListenButton();
  closeVoskSocket();
  await cleanupAudioGraph();
  setRecognitionStatus("待机");

  if (cancelPlayback && currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    setSpeechStatus("播报已停止");
  }

  if (cancelPlayback && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

async function loadBootstrapData() {
  const response = await fetch("/api/health");
  bootstrapData = await response.json();
  await ensureBrowserVoicesLoaded();
  renderSourceAccentProfiles();
  renderTargetLanguages();
  renderServices();

  if (!bootstrapData.services.libreTranslate.ok) {
    setTranslationStatus("请先启动 LibreTranslate");
  }

  if (!bootstrapData.services.piper.ok && browserVoices.length === 0) {
    setSpeechStatus("请先启动 Piper 或启用浏览器本地语音");
  }
}

async function bootstrap() {
  if (!navigator.mediaDevices?.getUserMedia) {
    listenButton.disabled = true;
    setRecognitionStatus("当前浏览器不支持麦克风采集");
    return;
  }

  try {
    await loadBootstrapData();
  } catch (error) {
    console.error(error);
    setRecognitionStatus("初始化失败");
    setTranslationStatus(error.message || "无法读取本地配置");
    listenButton.disabled = true;
    return;
  }

  listenButton.addEventListener("click", async () => {
    try {
      if (isListening) {
        await stopListening();
      } else {
        await startListening();
      }
    } catch (error) {
      console.error(error);
      await stopListening(false);
      setRecognitionStatus(error.message || "无法启动识别");
    }
  });

  targetLanguageSelect.addEventListener("change", () => {
    targetLanguageHintEl.textContent = `当前输出：${currentTargetLanguage().label}`;
    renderVoiceOptions();
    renderServices();
  });

  sourceAccentSelect.addEventListener("change", () => {
    sourceAccentHintEl.textContent = currentAccentProfile().description || "";
    setNormalizationStatus(`已切换到 ${currentAccentProfile().label}`);
    renderServices();
  });

  voiceGenderSelect.addEventListener("change", () => {
    const selected = currentVoiceProfiles().find((profile) => profile.gender === currentVoiceGender());
    if (selected) {
      setSpeechStatus(`当前音色：${selected.label}`);
      return;
    }

    setSpeechStatus("当前音色：自动选择");
  });
}

bootstrap();
