require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 服务静态文件
app.use(express.static(path.join(__dirname, 'public')));

// Azure Speech 配置
console.log('正在初始化Azure语音服务...');
const speechConfig = sdk.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY,
    process.env.AZURE_SPEECH_REGION
);
speechConfig.speechRecognitionLanguage = 'zh-CN';
speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "5000");
speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "500");
speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EnableAudioLogging, "true");

// WebSocket连接处理
wss.on('connection', (ws) => {
    console.log('新的WebSocket连接');
    let pushStream = null;
    let audioConfig = null;
    let recognizer = null;

    // 创建新的识别器
    const setupRecognizer = () => {
        console.log('正在设置语音识别器...');
        pushStream = sdk.AudioInputStream.createPushStream();
        audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        recognizer.recognized = (s, e) => {
            if (e.result.text) {
                console.log('识别结果:', e.result.text);
                ws.send(JSON.stringify({
                    transcription: e.result.text
                }));
            }
        };

        recognizer.canceled = (s, e) => {
            console.log('识别被取消:', e.errorDetails);
        };

        recognizer.sessionStarted = (s, e) => {
            console.log('识别会话开始');
        };

        recognizer.sessionStopped = (s, e) => {
            console.log('识别会话结束');
        };

        recognizer.startContinuousRecognitionAsync(
            () => console.log('开始连续识别'),
            error => console.error('识别错误:', error)
        );
    };

    setupRecognizer();

    // 处理接收到的音频数据
    ws.on('message', (data) => {
        if (pushStream) {
            try {
                // 确保数据是Buffer类型
                let buffer;
                if (data instanceof Buffer) {
                    buffer = data;
                } else if (data instanceof ArrayBuffer) {
                    buffer = Buffer.from(data);
                } else if (data instanceof Uint8Array) {
                    buffer = Buffer.from(data);
                } else {
                    console.error('不支持的音频数据格式:', typeof data);
                    return;
                }
                
                console.log('收到音频数据，大小:', buffer.length, 'bytes');
                pushStream.write(buffer);
            } catch (error) {
                console.error('处理音频数据时出错:', error);
            }
        } else {
            console.error('pushStream未初始化');
        }
    });

    // 处理连接关闭
    ws.on('close', () => {
        console.log('WebSocket连接关闭');
        if (recognizer) {
            recognizer.stopContinuousRecognitionAsync(
                () => {
                    console.log('识别器已停止');
                    recognizer.close();
                    pushStream = null;
                    audioConfig = null;
                    recognizer = null;
                },
                error => console.error('停止识别错误:', error)
            );
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log('Azure语音识别服务已启用');
    console.log('使用的区域:', process.env.AZURE_SPEECH_REGION);
}); 