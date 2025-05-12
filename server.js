import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import sdk from 'microsoft-cognitiveservices-speech-sdk';
import path from 'path';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';

// 常量和配置
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.SERVER_PORT || 8080;
const HOST = process.env.SERVER_HOST || 'localhost';
const SENTENCE_END_PATTERN = /[！。？：，]/;
const VOICE_DETECTION_THRESHOLD = 300;

// Express和WebSocket设置
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
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
// 恢复较长的超时设置以适应WebM格式
// speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "5000");
// speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "500");
// speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EnableAudioLogging, "true");
// // 设置更积极的识别模式
// speechConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_PostProcessingOption, "TrueText");
// // 启用语言检测
// speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguages, "zh-CN");
// // 启用混合识别
// speechConfig.enableAudioLogging();
console.log('[初始化] Azure语音服务配置完成');

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
 * 取消当前进行中的所有活动
 * @param {WebSocket} ws - WebSocket连接实例
 * @param {boolean} sendInterrupt - 是否发送中断信号到前端
 */
function cancelOngoingActivities(ws, sendInterrupt = true) {
    // 取消LLM
    if (ws.llmStream) {
        ws.llmStream.controller.abort();
        ws.llmStream = null;
    }
    
    // 取消TTS
    if (ws.currentSynthesizer) {
        ws.currentSynthesizer.close();
        ws.currentSynthesizer = null;
    }
    
    // 清空TTS队列
    if (ws.ttsPendingSentences) {
        ws.ttsPendingSentences.length = 0;
    }
    ws.processingTTS = false;
    
    // 发送中断信号
    if (sendInterrupt) {
        ws.send(JSON.stringify({ interrupt: true }));
    }
}

/**
 * 调用大语言模型处理用户输入
 * @param {string} text - 用户输入的文本
 * @param {WebSocket} ws - WebSocket连接实例
 */
async function callLLM(text, ws) {
    try {
        const startTime = Date.now();
        let llmFirstTokenTime = null;
        
        // 取消所有进行中的活动
        cancelOngoingActivities(ws, false);
        
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
                
                // 更新前端显示的完整响应
                ws.send(JSON.stringify({ llmResponse: fullResponse }));
                
                // 检查是否遇到句子结束的标点符号
                if (SENTENCE_END_PATTERN.test(content)) {
                    // 添加句子到TTS队列并处理
                    ws.ttsPendingSentences.push(currentSentence);
                    if (ws.ttsPendingSentences.length === 1 && !ws.processingTTS) {
                        processNextTTS(ws);
                    }
                    currentSentence = '';
                }
            }
        }
        
        // 处理最后一个不完整的句子
        if (currentSentence.trim()) {
            ws.ttsPendingSentences.push(currentSentence);
            if (ws.ttsPendingSentences.length === 1 && !ws.processingTTS) {
                processNextTTS(ws);
            }
        }

        // 清除stream引用
        ws.llmStream = null;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[LLM] 响应被取消');
            return;
        }
        console.error('[错误] 调用LLM出错:', error);
        ws.send(JSON.stringify({ error: '调用大模型时出错' }));
    }
}

/**
 * 处理下一个TTS请求
 * @param {WebSocket} ws - WebSocket连接实例
 */
async function processNextTTS(ws) {
    // 如果队列为空或已经被中断，则退出
    if (!ws.ttsPendingSentences || ws.ttsPendingSentences.length === 0 || !ws.llmStream) {
        ws.processingTTS = false;
        return;
    }
    
    ws.processingTTS = true;
    const text = ws.ttsPendingSentences[0];
    
    try {
        await textToSpeech(text, ws);
        
        // 移除已处理的句子
        ws.ttsPendingSentences.shift();
        
        // 处理下一个句子
        if (ws.ttsPendingSentences.length > 0) {
            processNextTTS(ws);
        } else {
            ws.processingTTS = false;
        }
    } catch (error) {
        console.error('[错误] 处理TTS队列错误:', error);
        ws.processingTTS = false;
        ws.ttsPendingSentences.length = 0; // 出错时清空队列，避免卡死
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
                result => resolve(result),
                error => reject(error)
            );
        });

        // 检查合成是否被取消
        if (!ws.currentSynthesizer) {
            console.log('[TTS] 合成被取消');
            return;
        }

        if (result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            // 发送音频数据
            ws.send(result.audioData);
        } else {
            const errorDetails = result ? 
                `原因: ${result.reason}, 错误: ${result.errorDetails}` : 
                '未知错误';
            console.error('[错误] 语音合成失败:', errorDetails);
            ws.send(JSON.stringify({ error: `语音合成失败: ${errorDetails}` }));
        }
        
        synthesizer.close();
        if (ws.currentSynthesizer === synthesizer) {
            ws.currentSynthesizer = null;
        }
    } catch (error) {
        console.error('[错误] TTS错误:', error);
        ws.send(JSON.stringify({ error: `语音合成出错: ${error.message}` }));
    }
}

/**
 * 检测音频数据中是否有声音活动
 * @param {Buffer} buffer - 音频数据
 * @returns {boolean} 是否检测到声音活动
 */
function detectVoiceActivity(buffer) {
    let sum = 0;
    for (let i = 0; i < Math.min(buffer.length, 100); i += 2) {
        const sample = buffer.readInt16LE(i);
        sum += Math.abs(sample);
    }
    
    const avgMagnitude = sum / (Math.min(buffer.length, 100) / 2);
    return avgMagnitude > VOICE_DETECTION_THRESHOLD;
}

/**
 * WebSocket连接处理
 */
wss.on('connection', async (ws) => {
    console.log('[WebSocket] 新的WebSocket连接');
    let pushStream = null;
    let audioConfig = null;
    let recognizer = null;
    let audioDataReceived = false;
    
    // 初始化客户端状态
    ws.ttsPendingSentences = [];
    ws.processingTTS = false;
    ws.isUserSpeaking = false;

    /**
     * 处理音频数据
     */
    async function processAudioData(data) {
        try {
            if (!data || data.length === 0) {
                return false;
            }
            
            const buffer = Buffer.from(data);
            
            // 确保是有效的PCM数据
            if (buffer.length >= 2 && buffer.length % 2 === 0) {
                // 检测声音活动
                const hasVoiceActivity = detectVoiceActivity(buffer);
                if (hasVoiceActivity && !ws.isUserSpeaking) {
                    console.log('[语音识别] 检测到用户开始说话');
                    ws.isUserSpeaking = true;
                    
                    // 中断当前响应
                    cancelOngoingActivities(ws);
                }
                
                // 发送数据到语音识别服务
                pushStream.write(buffer);
                return true;
            } else {
                console.log('[语音识别] 无效的音频格式，长度:', buffer.length);
                return false;
            }
        } catch (error) {
            console.error('[错误] 处理音频数据时出错:', error);
            return false;
        }
    }

    /**
     * 设置语音识别器
     */
    async function setupRecognizer() {
        console.log('[语音识别] 正在设置语音识别器...');
        try {
            // 创建音频流和识别器
            const pushFormat = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
            pushStream = sdk.AudioInputStream.createPushStream(pushFormat);
            audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
            recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
            
            console.log('[语音识别] 成功创建语音识别器和音频流');

            // 配置识别事件处理
            recognizer.recognizing = (s, e) => {
                if (e.result.text) {
                    console.log('[语音识别] 正在识别:', e.result.text);
                    
                    // 中断当前AI响应
                    cancelOngoingActivities(ws);
                    
                    // 发送中间结果
                    ws.send(JSON.stringify({ partialTranscription: e.result.text }));
                }
            };

            recognizer.recognized = (s, e) => {
                if (e.result.text) {
                    console.log('[语音识别] 识别结果:', e.result.text);
                    
                    // 取消进行中的响应
                    cancelOngoingActivities(ws);
                    
                    // 发送最终识别结果
                    ws.send(JSON.stringify({ transcription: e.result.text }));
                    
                    // 调用大模型
                    callLLM(e.result.text, ws);
                } else {
                    console.log('[语音识别] 识别完成但没有文本结果');
                }
            };

            recognizer.sessionStarted = () => {
                console.log('[语音识别] 识别会话开始');
                ws.isUserSpeaking = true;
            };

            recognizer.sessionStopped = () => {
                console.log('[语音识别] 识别会话结束');
                ws.isUserSpeaking = false;
            };

            recognizer.canceled = (s, e) => {
                console.error('[语音识别] 取消原因:', e.errorDetails);
            };

            // 开始连续识别
            await new Promise((resolve, reject) => {
                recognizer.startContinuousRecognitionAsync(
                    () => {
                        console.log('[语音识别] 开始连续识别');
                        resolve();
                    },
                    error => {
                        console.error('[错误] 识别错误:', error);
                        reject(error);
                    }
                );
            });
        } catch (error) {
            console.error('[错误] 设置语音识别器时出错:', error);
            ws.send(JSON.stringify({ error: '设置语音识别器失败: ' + error.message }));
            throw error; // 重新抛出以便上层处理
        }
    }

    /**
     * 清理资源
     */
    async function cleanup() {
        try {
            if (recognizer) {
                await new Promise((resolve, reject) => {
                    recognizer.stopContinuousRecognitionAsync(
                        () => {
                            console.log('[语音识别] 识别器已停止');
                            recognizer.close();
                            resolve();
                        },
                        error => {
                            console.error('[错误] 停止识别错误:', error);
                            reject(error);
                        }
                    );
                });
            }
            
            // 重置所有资源
            pushStream = null;
            audioConfig = null;
            recognizer = null;
            
            // 清理TTS资源
            cancelOngoingActivities(ws, false);
        } catch (error) {
            console.error('[错误] 清理资源时出错:', error);
        }
    }

    try {
        // 初始化识别器
        await setupRecognizer();
        
        // 发送就绪状态
        ws.send(JSON.stringify({
            status: 'ready',
            message: '服务器已准备好，可以开始对话'
        }));

        // 处理接收到的音频数据
        ws.on('message', async (data) => {
            if (!audioDataReceived) {
                audioDataReceived = true;
                console.log('[WebSocket] 首次接收到音频数据，大小:', data.length, 'bytes');
            }
            
            await processAudioData(data);
        });

        // 处理连接关闭
        ws.on('close', async () => {
            console.log('[WebSocket] 连接关闭');
            await cleanup();
        });

        // 处理错误
        ws.on('error', (error) => {
            console.error('[WebSocket] 连接错误:', error);
        });
    } catch (error) {
        console.error('[错误] WebSocket连接处理失败:', error);
    }
});

// 启动服务器
server.listen(PORT, HOST, () => {
    console.log(`[服务器] 服务器运行在 http://${HOST}:${PORT}`);
    console.log('[服务器] WebSocket服务已启用在同一端口');
    console.log('[服务器] Azure语音识别服务已启用');
    console.log('[服务器] 使用的区域:', process.env.AZURE_SPEECH_REGION);
});