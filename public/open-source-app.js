const sourceTranscriptEl = document.getElementById("sourceTranscript");
const interimTranscriptEl = document.getElementById("interimTranscript");
const targetTranscriptEl = document.getElementById("targetTranscript");
const recognitionStatusEl = document.getElementById("recognitionStatus");
const translationStatusEl = document.getElementById("translationStatus");
const speechStatusEl = document.getElementById("speechStatus");
const listenButton = document.getElementById("listenButton");
const targetLanguageSelect = document.getElementById("targetLanguage");
const voiceGenderSelect = document.getElementById("voiceGender");
const targetLanguageHintEl = document.getElementById("targetLanguageHint");
const serviceSummaryEl = document.getElementById("serviceSummary");
const serviceDetailsEl = document.getElementById("serviceDetails");
const sourceModelEl = document.getElementById("sourceModel");

const SAMPLE_RATE = 16000;

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

function setRecognitionStatus(text) {
  recognitionStatusEl.textContent = text;
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

function currentTargetLanguage() {
  const value = targetLanguageSelect.value;
  return bootstrapData.targetLanguages.find((item) => item.code === value) || bootstrapData.targetLanguages[0];
}

function currentVoiceProfiles() {
  return bootstrapData.services.piper.voiceProfiles?.[currentTargetLanguage().code] || [];
}

function currentVoiceGender() {
  return voiceGenderSelect.value || bootstrapData.defaults.voiceGender || "female";
}

function renderVoiceOptions() {
  const profiles = currentVoiceProfiles();
  const fallbackOptions = [
    { gender: "female", label: "女生" },
    { gender: "male", label: "男生" }
  ];
  const options = profiles.length > 0 ? profiles : fallbackOptions;
  const preferredGender = currentVoiceGender();
  const selectedGender = options.some((profile) => profile.gender === preferredGender)
    ? preferredGender
    : options[0].gender;

  voiceGenderSelect.innerHTML = options
    .map((profile) => {
      const selected = profile.gender === selectedGender ? "selected" : "";
      return `<option value="${profile.gender}" ${selected}>${profile.label}</option>`;
    })
    .join("");

  voiceGenderSelect.disabled = profiles.length === 0;
}

function renderTargetLanguages() {
  const libreCodes = new Set(
    (bootstrapData.services.libreTranslate.languages || []).map((item) => String(item.code || ""))
  );
  const voiceProfiles = bootstrapData.services.piper.voiceProfiles || {};

  const options = bootstrapData.targetLanguages.filter((language) => {
    const hasTranslation = libreCodes.size === 0 || libreCodes.has(language.code);
    const hasVoice = Object.keys(voiceProfiles).length === 0 || (voiceProfiles[language.code] || []).length > 0;
    return hasTranslation && hasVoice;
  });

  const languages = options.length > 0 ? options : bootstrapData.targetLanguages;
  bootstrapData.targetLanguages = languages;

  targetLanguageSelect.innerHTML = languages
    .map((language) => {
      const selected = language.code === bootstrapData.defaults.targetLanguageCode ? "selected" : "";
      return `<option value="${language.code}" ${selected}>${language.label}</option>`;
    })
    .join("");

  targetLanguageHintEl.textContent = `当前输出: ${currentTargetLanguage().label}`;
  renderVoiceOptions();
}

function renderServices() {
  const libre = bootstrapData.services.libreTranslate;
  const piper = bootstrapData.services.piper;
  const vosk = bootstrapData.services.vosk;

  const summaryParts = [
    `Vosk: ${vosk.url}`,
    libre.ok ? "LibreTranslate 已连接" : "LibreTranslate 未连接",
    piper.ok ? "Piper 已连接" : "Piper 未连接"
  ];

  serviceSummaryEl.textContent = summaryParts.join(" | ");

  const detailLines = [];
  detailLines.push(`识别模型: ${vosk.modelLabel}`);
  detailLines.push(libre.ok ? `翻译语言数: ${libre.languages.length}` : `翻译服务错误: ${libre.error || "未启动"}`);
  detailLines.push(piper.ok ? `可用音色数: ${piper.voices.length}` : `播报服务错误: ${piper.error || "未启动"}`);
  detailLines.push(piper.ok ? `当前语言可选音色: ${currentVoiceProfiles().map((profile) => profile.label).join(" / ") || "未匹配"}` : "");
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
    interimTranscriptEl.textContent = payload.partial;
  }

  if (payload.text) {
    const text = String(payload.text).trim();
    if (!text) {
      return;
    }

    interimTranscriptEl.textContent = "";
    appendSourceText(text);
    queueTranslation(text);
  }
}

async function requestTranslation(text) {
  setTranslationStatus(`正在翻译为${currentTargetLanguage().label}`);

  const response = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      targetLanguageCode: currentTargetLanguage().code,
      sourceLanguageCode: "auto"
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "翻译失败");
  }

  return payload.translation;
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

function queueTranslation(text) {
  translationQueue = translationQueue
    .then(async () => {
      const translation = await requestTranslation(text);
      appendTargetText(translation);
      setTranslationStatus("翻译完成");

      isSpeaking = true;
      if (isListening) {
        shouldResumeAfterSpeech = true;
        await stopListening(false);
      }

      const { audioBlob, voice } = await requestSpeech(translation);
      await playAudioBlob(audioBlob, voice);
    })
    .catch((error) => {
      console.error(error);
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
}

async function loadBootstrapData() {
  const response = await fetch("/api/health");
  bootstrapData = await response.json();
  renderTargetLanguages();
  renderServices();

  if (!bootstrapData.services.libreTranslate.ok) {
    setTranslationStatus("请先启动 LibreTranslate");
  }

  if (!bootstrapData.services.piper.ok) {
    setSpeechStatus("请先启动 Piper");
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
    targetLanguageHintEl.textContent = `当前输出: ${currentTargetLanguage().label}`;
    renderVoiceOptions();
    renderServices();
  });

  voiceGenderSelect.addEventListener("change", () => {
    const selected = currentVoiceProfiles().find((profile) => profile.gender === currentVoiceGender());
    if (selected) {
      setSpeechStatus(`当前音色: ${selected.label}`);
    }
  });
}

bootstrap();
