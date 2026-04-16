# simultaneous-translator

一个本地运行的开源同声传译初始版本。

当前链路：

- 浏览器采集麦克风音频
- Web Audio API 将 16k PCM 音频流发送到本地 Vosk WebSocket
- Node 服务接收识别文本并调用 LibreTranslate 翻译
- Piper 或 VOICEVOX 负责目标语言语音合成
- 浏览器播放目标语言语音

当前已支持的重点能力：

- 目标语言切换，默认英语
- 输出语音男女声切换，默认男声
- 日语输出走 VOICEVOX
- 德语、法语、英语、中文输出走 Piper
- 输入口音支持自动 / 北方 / 南方修正

## 当前本地服务部署

本项目当前按下面的本地目录部署：

- Vosk: `D:\software\vosk-server`
- Vosk 中文模型: `D:\software\vosk-model-small-cn-0.22`
- LibreTranslate 源码: `D:\software\LibreTranslate-src`
- LibreTranslate 数据: `D:\software\LibreTranslate-data`
- Piper: `D:\software\piper`
- VOICEVOX Engine: `D:\software\voicevox-engine\0.25.1\windows-cpu`

## 默认端口

- App: `3004`
- Vosk WebSocket: `2700`
- LibreTranslate: `5000`
- Piper HTTP: `5001`
- VOICEVOX HTTP: `50021`

## 一键启动与停止

在项目根目录打开 PowerShell：

```powershell
cd C:\Users\Administrator\.codex\worktrees\7110\simultaneous-translator
```

启动全部服务：

```powershell
.\start-all.ps1
```

重启全部服务：

```powershell
.\start-all.ps1 -RestartExisting
```

指定应用端口启动：

```powershell
.\start-all.ps1 -AppPort 3005 -RestartExisting
```

停止全部服务：

```powershell
.\stop-all.ps1
```

停止脚本默认会清理这些端口：

```text
2700, 5000, 5001, 50021, 3004, 3005
```

## 启动脚本位置

- 启动脚本: [start-all.ps1](C:\Users\Administrator\.codex\worktrees\7110\simultaneous-translator\start-all.ps1)
- 停止脚本: [stop-all.ps1](C:\Users\Administrator\.codex\worktrees\7110\simultaneous-translator\stop-all.ps1)

## 启动后访问地址

默认启动后打开：

```text
http://localhost:3004
```

如果使用了 `-AppPort 3005`，则访问：

```text
http://localhost:3005
```

## 日志目录

脚本会把输出写到项目本地 `logs` 目录：

```text
.\logs\
```

常见日志文件：

- `vosk.out.log`
- `vosk.err.log`
- `libretranslate.out.log`
- `libretranslate.err.log`
- `piper.out.log`
- `piper.err.log`
- `voicevox.out.log`
- `voicevox.err.log`
- `app.out.log`
- `app.err.log`

## 手动启动命令

如果你不想用脚本，也可以分别启动。

### 1. 启动 Vosk

```powershell
D:\software\vosk-server\.venv\Scripts\python.exe `
  D:\software\vosk-server\websocket\asr_server.py `
  D:\software\vosk-model-small-cn-0.22
```

### 2. 启动 LibreTranslate

```powershell
$env:XDG_DATA_HOME="D:\software\LibreTranslate-data\share"
$env:XDG_CONFIG_HOME="D:\software\LibreTranslate-data\config"
$env:XDG_CACHE_HOME="D:\software\LibreTranslate-data\cache"
$env:ARGOS_PACKAGES_DIR="D:\software\LibreTranslate-data\packages"
D:\software\libretranslate\.venv\Scripts\libretranslate.exe `
  --host 0.0.0.0 `
  --port 5000 `
  --load-only zh,en,de,fr,ja
```

### 3. 启动 Piper

```powershell
D:\software\piper\.venv\Scripts\python.exe `
  -m piper.http_server `
  --host 0.0.0.0 `
  --port 5001 `
  --data-dir D:\software\piper\voices `
  -m D:\software\piper\voices\en_US-lessac-medium.onnx
```

### 4. 启动 VOICEVOX

```powershell
D:\software\voicevox-engine\0.25.1\windows-cpu\run.exe `
  --host 0.0.0.0 `
  --port 50021
```

### 5. 启动当前项目

```powershell
$env:PORT="3004"
$env:VOICEVOX_URL="http://localhost:50021"
node .\server.js
```

## 当前输出语音

Piper 当前已部署的重点音色：

- 英语男声: `en_US-hfc_male-medium`
- 英语女声: `en_US-hfc_female-medium`
- 中文男声: `zh_CN-chaowen-medium`
- 中文女声: `zh_CN-huayan-x_low`
- 德语男声: `de_DE-thorsten-medium`
- 德语女声: `de_DE-eva_k-x_low`
- 法语男声: `fr_FR-tom-medium`
- 法语女声: `fr_FR-siwis-medium`

日语输出使用 VOICEVOX。

## 注意

- 首次启动前请确认 `D:` 盘相关依赖目录都存在
- LibreTranslate 若未成功启动，翻译接口会不可用
- 浏览器播放语音时，页面会短暂停止收音以减少回声回灌
- 如果端口已被占用，优先执行 `.\stop-all.ps1` 后再重启
