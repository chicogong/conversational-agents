require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const path = require('path');
const OpenAI = require('openai');

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

// Azure TTS 配置
const ttsConfig = sdk.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY,
    process.env.AZURE_SPEECH_REGION
);
ttsConfig.speechSynthesisLanguage = 'zh-CN';
ttsConfig.speechSynthesisVoiceName = 'zh-CN-XiaoxiaoNeural'; // 使用晓晓语音

// OpenAI配置
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
});

// 调用大模型
async function callLLM(text, ws) {
    try {
        const stream = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
            messages: [
                {
                    role: "user",
                    content: text
                }
            ],
            stream: true
        });

        let fullResponse = '';
        let currentSentence = '';
        
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                fullResponse += content;
                currentSentence += content;
                
                // 检查是否遇到句子结束的标点符号
                if (/[！。？：，]/.test(content)) {
                    // 发送当前句子到前端显示
                    ws.send(JSON.stringify({
                        llmResponse: currentSentence
                    }));
                    
                    // 对当前句子进行TTS
                    await textToSpeech(currentSentence, ws);
                    
                    // 清空当前句子
                    currentSentence = '';
                }
            }
        }
        
        // 处理最后一个不完整的句子
        if (currentSentence.trim()) {
            ws.send(JSON.stringify({
                llmResponse: currentSentence
            }));
            await textToSpeech(currentSentence, ws);
        }
    } catch (error) {
        console.error('调用LLM出错:', error);
        ws.send(JSON.stringify({
            error: '调用大模型时出错'
        }));
    }
}

// 文本转语音
async function textToSpeech(text, ws) {
    try {
        console.log('开始语音合成，文本:', text);
        
        // 创建新的语音合成器
        const synthesizer = new sdk.SpeechSynthesizer(ttsConfig);
        
        // 使用 speakTextAsync 方法
        const result = await new Promise((resolve, reject) => {
            synthesizer.speakTextAsync(
                text,
                result => {
                    console.log('语音合成结果:', result);
                    resolve(result);
                },
                error => {
                    console.error('语音合成错误:', error);
                    reject(error);
                }
            );
        });

        if (result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            console.log('语音合成成功，音频数据大小:', result.audioData ? result.audioData.length : 0);
            
            // 将音频数据转换为可序列化的格式
            const audioData = Array.from(new Uint8Array(result.audioData));
            ws.send(JSON.stringify({
                audioData: audioData
            }));
        } else {
            const errorDetails = result ? 
                `原因: ${result.reason}, 错误: ${result.errorDetails}` : 
                '未知错误';
            console.error('语音合成失败:', errorDetails);
            ws.send(JSON.stringify({
                error: `语音合成失败: ${errorDetails}`
            }));
        }
        
        synthesizer.close();
    } catch (error) {
        console.error('TTS错误:', error);
        ws.send(JSON.stringify({
            error: `语音合成出错: ${error.message}`
        }));
    }
}

// WebSocket连接处理
wss.on('connection', (ws) => {
    console.log('新的WebSocket连接');
    let pushStream = null;
    let audioConfig = null;
    let recognizer = null;
    let currentText = '';

    // 创建新的识别器
    const setupRecognizer = () => {
        console.log('正在设置语音识别器...');
        pushStream = sdk.AudioInputStream.createPushStream();
        audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        recognizer.recognized = (s, e) => {
            if (e.result.text) {
                console.log('识别结果:', e.result.text);
                currentText = e.result.text;
                ws.send(JSON.stringify({
                    transcription: e.result.text
                }));
                // 调用大模型
                callLLM(e.result.text, ws);
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