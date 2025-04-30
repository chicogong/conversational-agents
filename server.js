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

/**
 * 配置静态文件服务
 */
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Azure Speech 语音识别配置
 */
console.log('[初始化] 正在初始化Azure语音服务...');
const speechConfig = sdk.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY,
    process.env.AZURE_SPEECH_REGION
);
speechConfig.speechRecognitionLanguage = 'zh-CN';
speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "5000");
speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "500");
speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EnableAudioLogging, "true");

/**
 * Azure TTS 语音合成配置
 */
const ttsConfig = sdk.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY,
    process.env.AZURE_SPEECH_REGION
);
ttsConfig.speechSynthesisLanguage = 'zh-CN';
ttsConfig.speechSynthesisVoiceName = 'zh-CN-XiaochenMultilingualNeural';
ttsConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_SynthOutputFormat, "audio-16khz-128kbitrate-mono-mp3");

/**
 * OpenAI API 配置
 */
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
});

/**
 * 调用大语言模型处理用户输入
 * @param {string} text - 用户输入的文本
 * @param {WebSocket} ws - WebSocket连接实例
 */
async function callLLM(text, ws) {
    try {
        const startTime = Date.now();
        let llmFirstTokenTime = null;
        
        // 如果已经有正在进行的LLM调用，先取消它
        if (ws.llmStream) {
            ws.llmStream.controller.abort();
            ws.llmStream = null;
            console.log('[LLM] 取消之前的LLM请求');
        }

        const stream = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
            messages: [
                {
                    role: "system",
                    content: "你是一个智能语音助手小蕊，请用口语化、简短的回答客户问题，不要回复任何表情符号"
                },
                {
                    role: "user",
                    content: text
                }
            ],
            stream: true
        });

        // 保存stream引用以便后续取消
        ws.llmStream = stream;

        let fullResponse = '';
        let currentSentence = '';
        
        for await (const chunk of stream) {
            // 检查是否被取消
            if (!ws.llmStream) {
                console.log('[LLM] 响应被取消');
                return;
            }

            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                // 记录第一个token的时间
                if (!llmFirstTokenTime) {
                    llmFirstTokenTime = Date.now();
                    console.log(`[性能] LLM首token耗时: ${llmFirstTokenTime - startTime}ms`);
                }

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

        // 清除stream引用
        ws.llmStream = null;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[LLM] 响应被取消');
            return;
        }
        console.error('[错误] 调用LLM出错:', error);
        ws.send(JSON.stringify({
            error: '调用大模型时出错'
        }));
    }
}

/**
 * 文本转语音处理
 * @param {string} text - 需要转换为语音的文本
 * @param {WebSocket} ws - WebSocket连接实例
 */
async function textToSpeech(text, ws) {
    try {
        const startTime = Date.now();
        console.log('[TTS] 开始语音合成，文本:', text);
        
        if (ws.currentSynthesizer) {
            console.log('[TTS] 取消之前的TTS合成');
            ws.currentSynthesizer.close();
            ws.currentSynthesizer = null;
        }
        
        const synthesizer = new sdk.SpeechSynthesizer(ttsConfig);
        ws.currentSynthesizer = synthesizer;
        
        const result = await new Promise((resolve, reject) => {
            let firstFrameTime = null;
            
            synthesizer.synthesizing = (s, e) => {
                if (!firstFrameTime) {
                    firstFrameTime = Date.now();
                    console.log(`[性能] TTS首帧耗时: ${firstFrameTime - startTime}ms`);
                }
            };
            
            synthesizer.speakTextAsync(
                text,
                result => {
                    console.log('[TTS] 语音合成结果:', result);
                    resolve(result);
                },
                error => {
                    console.error('[错误] 语音合成错误:', error);
                    reject(error);
                }
            );
        });

        if (!ws.currentSynthesizer) {
            console.log('[TTS] 合成被取消');
            return;
        }

        if (result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            console.log('[TTS] 语音合成成功，音频数据大小:', result.audioData ? result.audioData.length : 0);
            
            // Send binary data directly without JSON serialization
            ws.send(result.audioData);
        } else {
            const errorDetails = result ? 
                `原因: ${result.reason}, 错误: ${result.errorDetails}` : 
                '未知错误';
            console.error('[错误] 语音合成失败:', errorDetails);
            ws.send(JSON.stringify({
                error: `语音合成失败: ${errorDetails}`
            }));
        }
        
        synthesizer.close();
        if (ws.currentSynthesizer === synthesizer) {
            ws.currentSynthesizer = null;
        }
    } catch (error) {
        console.error('[错误] TTS错误:', error);
        ws.send(JSON.stringify({
            error: `语音合成出错: ${error.message}`
        }));
    }
}

/**
 * WebSocket连接处理
 */
wss.on('connection', (ws) => {
    console.log('[WebSocket] 新的WebSocket连接');
    let pushStream = null;
    let audioConfig = null;
    let recognizer = null;
    let currentText = '';
    let isUserSpeaking = false;

    /**
     * 创建新的语音识别器
     */
    const setupRecognizer = () => {
        console.log('[语音识别] 正在设置语音识别器...');
        pushStream = sdk.AudioInputStream.createPushStream();
        audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        recognizer.recognized = (s, e) => {
            if (e.result.text) {
                console.log('[语音识别] 识别结果:', e.result.text);
                currentText = e.result.text;
                
                // 如果用户正在说话，取消当前的LLM响应和TTS
                if (isUserSpeaking) {
                    if (ws.llmStream) {
                        ws.llmStream.controller.abort();
                        ws.llmStream = null;
                    }
                    if (ws.currentSynthesizer) {
                        ws.currentSynthesizer.close();
                        ws.currentSynthesizer = null;
                    }
                    // 发送中断信号到前端
                    ws.send(JSON.stringify({
                        interrupt: true
                    }));
                }
                
                ws.send(JSON.stringify({
                    transcription: e.result.text
                }));
                // 调用大模型
                callLLM(e.result.text, ws);
            }
        };

        recognizer.sessionStarted = (s, e) => {
            console.log('[语音识别] 识别会话开始');
            isUserSpeaking = true;
        };

        recognizer.sessionStopped = (s, e) => {
            console.log('[语音识别] 识别会话结束');
            isUserSpeaking = false;
        };

        recognizer.startContinuousRecognitionAsync(
            () => console.log('[语音识别] 开始连续识别'),
            error => console.error('[错误] 识别错误:', error)
        );
    };

    setupRecognizer();

    /**
     * 处理接收到的音频数据
     */
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
                    console.error('[错误] 不支持的音频数据格式:', typeof data);
                    return;
                }
                
                console.log('[音频] 收到音频数据，大小:', buffer.length, 'bytes');
                pushStream.write(buffer);
            } catch (error) {
                console.error('[错误] 处理音频数据时出错:', error);
            }
        } else {
            console.error('[错误] pushStream未初始化');
        }
    });

    /**
     * 处理连接关闭
     */
    ws.on('close', () => {
        console.log('[WebSocket] 连接关闭');
        if (recognizer) {
            recognizer.stopContinuousRecognitionAsync(
                () => {
                    console.log('[语音识别] 识别器已停止');
                    recognizer.close();
                    pushStream = null;
                    audioConfig = null;
                    recognizer = null;
                },
                error => console.error('[错误] 停止识别错误:', error)
            );
        }
        // 清理TTS资源
        if (ws.currentSynthesizer) {
            ws.currentSynthesizer.close();
            ws.currentSynthesizer = null;
        }
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`[服务器] 服务器运行在 http://localhost:${PORT}`);
    console.log('[服务器] Azure语音识别服务已启用');
    console.log('[服务器] 使用的区域:', process.env.AZURE_SPEECH_REGION);
});