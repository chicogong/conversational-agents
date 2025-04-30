# 实时语音识别应用

这是一个使用WebSocket和Azure语音服务的实时语音识别Web应用。

## 功能特点

- 实时音频采集
- WebSocket实时传输
- Azure语音服务识别
- 实时文字显示

## 前置要求

- Node.js (v12.0.0 或更高版本)
- Azure语音服务账号
- 现代浏览器（支持WebSocket和MediaRecorder API）

## 安装步骤

1. 克隆仓库：
```bash
git clone <repository-url>
cd <repository-directory>
```

2. 安装依赖：
```bash
npm install
```

3. 配置环境变量：
   - 复制 `.env.example` 文件为 `.env`
   - 在 `.env` 文件中填入你的Azure语音服务凭证：
```
AZURE_SPEECH_KEY=your_azure_speech_key_here
AZURE_SPEECH_REGION=your_azure_region_here
```

## 运行应用

1. 启动服务器：
```bash
npm start
```

2. 打开浏览器访问：
```
http://localhost:8080
```

## 使用说明

1. 点击"开始录音"按钮开始录制音频
2. 说话时，语音将被实时识别并显示在页面上
3. 点击"停止录音"按钮结束录制

## 注意事项

- 确保麦克风权限已启用
- 建议使用有线网络以获得更好的识别效果
- 支持中文语音识别

## 技术栈

- 前端：HTML5, JavaScript (WebSocket, MediaRecorder API)
- 后端：Node.js, Express
- 实时通信：WebSocket
- 语音识别：Azure Cognitive Services Speech SDK 