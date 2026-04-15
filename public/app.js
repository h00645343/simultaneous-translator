const languageOptions = [
  { value: "en-US", label: "英语", speechLabel: "English", voiceLang: "en-US" },
  { value: "zh-CN", label: "简体中文", speechLabel: "Simplified Chinese", voiceLang: "zh-CN" },
  { value: "ja-JP", label: "日语", speechLabel: "Japanese", voiceLang: "ja-JP" },
  { value: "ko-KR", label: "韩语", speechLabel: "Korean", voiceLang: "ko-KR" },
  { value: "fr-FR", label: "法语", speechLabel: "French", voiceLang: "fr-FR" },
  { value: "de-DE", label: "德语", speechLabel: "German", voiceLang: "de-DE" },
  { value: "es-ES", label: "西班牙语", speechLabel: "Spanish", voiceLang: "es-ES" },
  { value: "pt-PT", label: "葡萄牙语", speechLabel: "Portuguese", voiceLang: "pt-PT" },
  { value: "it-IT", label: "意大利语", speechLabel: "Italian", voiceLang: "it-IT" },
  { value: "ru-RU", label: "俄语", speechLabel: "Russian", voiceLang: "ru-RU" },
  { value: "ar-SA", label: "阿拉伯语", speechLabel: "Arabic", voiceLang: "ar-SA" },
  { value: "hi-IN", label: "印地语", speechLabel: "Hindi", voiceLang: "hi-IN" }
];

const sourceTranscriptEl = document.getElementById("sourceTranscript");
const interimTranscriptEl = document.getElementById("interimTranscript");
const targetTranscriptEl = document.getElementById("targetTranscript");
const recognitionStatusEl = document.getElementById("recognitionStatus");
const translationStatusEl = document.getElementById("translationStatus");
const speechStatusEl = document.getElementById("speechStatus");
const listenButton = document.getElementById("listenButton");
const targetLanguageSelect = document.getElementById("targetLanguage");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isListening = false;
let shouldResumeAfterSpeech = false;
let finalSourceText = "";
let finalTargetText = "";
let translationQueue = Promise.resolve();
let availableVoices = [];

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

function renderLanguageOptions() {
  const markup = languageOptions
    .map((option) => {
      const selected = option.value === "en-US" ? "selected" : "";
      return `<option value="${option.value}" ${selected}>${option.label}</option>`;
    })
    .join("");

  targetLanguageSelect.innerHTML = markup;
}

function currentTargetLanguage() {
  return (
    languageOptions.find((item) => item.value === targetLanguageSelect.value) ||
    languageOptions[0]
  );
}

function appendSourceText(text) {
  finalSourceText = finalSourceText ? `${finalSourceText}\n${text}` : text;
  sourceTranscriptEl.textContent = finalSourceText;
}

function appendTargetText(text) {
  finalTargetText = finalTargetText ? `${finalTargetText}\n${text}` : text;
  targetTranscriptEl.textContent = finalTargetText;
}

function getBestVoice(langCode) {
  const exact = availableVoices.find((voice) => voice.lang === langCode);
  if (exact) {
    return exact;
  }

  const family = availableVoices.find((voice) => voice.lang.startsWith(langCode.split("-")[0]));
  return family || null;
}

function loadVoices() {
  availableVoices = window.speechSynthesis.getVoices();
}

function speakTranslation(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      setSpeechStatus("当前浏览器不支持语音播报");
      resolve();
      return;
    }

    const targetLanguage = currentTargetLanguage();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = targetLanguage.voiceLang;
    utterance.voice = getBestVoice(targetLanguage.voiceLang);
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onstart = () => {
      setSpeechStatus(`正在播报 ${targetLanguage.label}`);
    };

    utterance.onend = () => {
      setSpeechStatus("播报完成");

      if (shouldResumeAfterSpeech) {
        shouldResumeAfterSpeech = false;
        startListening();
      }

      resolve();
    };

    utterance.onerror = () => {
      setSpeechStatus("播报失败");

      if (shouldResumeAfterSpeech) {
        shouldResumeAfterSpeech = false;
        startListening();
      }

      resolve();
    };

    if (isListening && recognition) {
      shouldResumeAfterSpeech = true;
      stopListening(false);
    }

    window.speechSynthesis.speak(utterance);
  });
}

async function requestTranslation(text) {
  const targetLanguage = currentTargetLanguage();
  setTranslationStatus(`正在翻译为${targetLanguage.label}`);

  const response = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      targetLanguageLabel: targetLanguage.speechLabel
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "翻译失败");
  }

  return payload.translation;
}

function queueTranslation(text) {
  translationQueue = translationQueue
    .then(async () => {
      const translation = await requestTranslation(text);
      appendTargetText(translation);
      setTranslationStatus("翻译完成");
      await speakTranslation(translation);
    })
    .catch((error) => {
      console.error(error);
      setTranslationStatus(error.message || "翻译失败");
    });
}

function createRecognition() {
  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    setRecognitionStatus(`收音中 (${recognition.lang})`);
  };

  recognition.onresult = (event) => {
    let interimText = "";

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0].transcript.trim();

      if (!transcript) {
        continue;
      }

      if (result.isFinal) {
        appendSourceText(transcript);
        interimTranscriptEl.textContent = "";
        queueTranslation(transcript);
      } else {
        interimText += `${transcript} `;
      }
    }

    interimTranscriptEl.textContent = interimText.trim();
  };

  recognition.onerror = (event) => {
    setRecognitionStatus(`识别异常: ${event.error}`);
    if (event.error === "not-allowed") {
      isListening = false;
      updateListenButton();
    }
  };

  recognition.onend = () => {
    if (isListening) {
      recognition.start();
      return;
    }

    setRecognitionStatus("待机");
  };
}

function startListening() {
  if (!recognition) {
    createRecognition();
  }

  if (isListening) {
    return;
  }

  isListening = true;
  updateListenButton();

  try {
    recognition.start();
  } catch (error) {
    setRecognitionStatus(error.message || "无法启动语音识别");
    isListening = false;
    updateListenButton();
  }
}

function stopListening(cancelSpeech = true) {
  if (!recognition || !isListening) {
    return;
  }

  isListening = false;
  updateListenButton();
  recognition.stop();

  if (cancelSpeech && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function bootstrap() {
  renderLanguageOptions();
  loadVoices();

  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  if (!SpeechRecognition) {
    listenButton.disabled = true;
    setRecognitionStatus("当前浏览器不支持语音识别");
    setTranslationStatus("请使用 Chrome 或 Edge");
    return;
  }

  listenButton.addEventListener("click", () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  targetLanguageSelect.addEventListener("change", () => {
    setSpeechStatus(`目标语言已切换为${currentTargetLanguage().label}`);
  });
}

bootstrap();
