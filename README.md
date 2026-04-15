# simultaneous-translator

一个开源本地同声翻译初始版：

- 浏览器麦克风采集音频
- Web Audio API 直接把 PCM 音频流送到本地 Vosk WebSocket
- LibreTranslate 负责目标语言翻译
- Piper 负责目标语言语音播报
- 界面支持切换目标语言，默认英语

## 当前架构

1. 浏览器采集麦克风
2. 浏览器把 16k PCM 流发送给 Vosk
3. Vosk 返回分段识别文本
4. Node 服务把文本转给 LibreTranslate
5. Node 服务再向 Piper 请求 WAV 音频
6. 浏览器播放返回的目标语言语音

## 启动项

先复制 `.env.example` 为 `.env`。

### 1. 启动 Vosk

Vosk WebSocket 服务默认使用 `ws://localhost:2700`。

如果你说中文：

```bash
docker run -d -p 2700:2700 alphacep/kaldi-cn:latest
```

如果你说英文：

```bash
docker run -d -p 2700:2700 alphacep/kaldi-en:latest
```

参考：

- https://alphacephei.com/vosk/server
- https://github.com/alphacep/vosk-server

### 2. 启动 LibreTranslate

本地默认地址是 `http://localhost:5000`：

```bash
pip install libretranslate
libretranslate
```

参考：

- https://docs.libretranslate.com/
- https://github.com/LibreTranslate/LibreTranslate

### 3. 启动 Piper

建议把 Piper 改到 `5001` 端口，避免和 LibreTranslate 冲突：

```bash
pip install "piper-tts[http]"
python -m piper.download_voices en_US-lessac-medium
python -m piper.http_server -m en_US-lessac-medium --port 5001
```

如果要播报中文或其他目标语言，请再下载对应音色。

参考：

- https://github.com/OHF-Voice/piper1-gpl

### 4. 启动当前项目

```bash
npm run dev
```

打开：

```text
http://localhost:3000
```

## 默认端口

- 当前项目: `3000`
- Vosk WebSocket: `2700`
- LibreTranslate: `5000`
- Piper HTTP: `5001`

## 注意

- 这是一个初始版本，重点是把开源链路打通
- Vosk 的识别语言由你启动的模型决定，不是前端自动切换
- LibreTranslate 需要安装相应语言模型后，目标语言才能真正可用
- Piper 需要存在对应目标语言音色，否则无法播报
- 为了避免扬声器回声重新被识别，播放期间会暂时停止收音，播报完成后自动恢复
