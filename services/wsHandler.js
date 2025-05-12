import sdk from 'microsoft-cognitiveservices-speech-sdk';
import { createSpeechConfig, detectVoiceActivity } from './speechService.js';
import { callLLM, cancelOngoingActivities } from './llmService.js';
import logger from './logger.js';

/**
 * 处理新的WebSocket连接
 */
export function handleConnection(ws) {
  logger.info('[WebSocket] 新的WebSocket连接');
  let pushStream = null;
  let audioConfig = null;
  let recognizer = null;
  let audioDataReceived = false;
  
  // 初始化客户端状态
  ws.ttsPendingSentences = [];
  ws.processingTTS = false;
  ws.isUserSpeaking = false;
  ws.connectionActive = true; // 标记连接是否活跃

  /**
   * 处理音频数据
   */
  async function processAudioData(data) {
    try {
      if (!data || data.length === 0 || !ws.connectionActive) return false;
      
      const buffer = Buffer.from(data);
      
      // 确保是有效的PCM数据
      if (buffer.length >= 2 && buffer.length % 2 === 0) {
        // 检测声音活动
        const hasVoiceActivity = detectVoiceActivity(buffer);
        if (hasVoiceActivity && !ws.isUserSpeaking) {
          logger.debug('[语音识别] 检测到用户开始说话');
          ws.isUserSpeaking = true;
          
          // 中断当前响应
          cancelOngoingActivities(ws);
        }
        
        // 发送数据到语音识别服务
        if (pushStream) {
          pushStream.write(buffer);
          return true;
        }
      } else {
        logger.warn('[语音识别] 无效的音频格式，长度:', buffer.length);
      }
      return false;
    } catch (error) {
      logger.error('[错误] 处理音频数据时出错:', error);
      return false;
    }
  }

  /**
   * 设置语音识别器
   */
  async function setupRecognizer() {
    logger.info('[语音识别] 正在设置语音识别器...');
    try {
      // 创建音频流和识别器
      const pushFormat = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      pushStream = sdk.AudioInputStream.createPushStream(pushFormat);
      audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
      recognizer = new sdk.SpeechRecognizer(createSpeechConfig(), audioConfig);
      
      logger.info('[语音识别] 成功创建语音识别器和音频流');

      // 配置识别事件处理
      recognizer.recognizing = (s, e) => {
        if (e.result.text && ws.connectionActive) {
          logger.debug('[语音识别] 正在识别:', e.result.text);
          
          // 中断当前AI响应
          cancelOngoingActivities(ws);
          
          // 发送中间结果
          ws.send(JSON.stringify({ partialTranscription: e.result.text }));
        }
      };

      recognizer.recognized = (s, e) => {
        if (e.result.text && ws.connectionActive) {
          logger.info('[语音识别] 识别结果:', e.result.text);
          
          // 取消进行中的响应
          cancelOngoingActivities(ws);
          
          // 发送最终识别结果
          ws.send(JSON.stringify({ transcription: e.result.text }));
          
          // 调用大模型
          callLLM(e.result.text, ws);
        } else {
          logger.debug('[语音识别] 识别完成但没有文本结果');
        }
      };

      recognizer.sessionStarted = () => {
        logger.info('[语音识别] 识别会话开始');
        ws.isUserSpeaking = true;
      };

      recognizer.sessionStopped = () => {
        logger.info('[语音识别] 识别会话结束');
        ws.isUserSpeaking = false;
      };

      recognizer.canceled = (s, e) => {
        logger.error('[语音识别] 取消原因:', e.errorDetails);
      };

      // 开始连续识别
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("启动语音识别超时"));
        }, 5000);
        
        recognizer.startContinuousRecognitionAsync(
          () => {
            clearTimeout(timeoutId);
            logger.info('[语音识别] 开始连续识别');
            resolve();
          },
          error => {
            clearTimeout(timeoutId);
            logger.error('[错误] 识别错误:', error);
            reject(error);
          }
        );
      });
    } catch (error) {
      logger.error('[错误] 设置语音识别器时出错:', error);
      if (ws.connectionActive) {
        ws.send(JSON.stringify({ error: '设置语音识别器失败: ' + error.message }));
      }
      throw error;
    }
  }

  /**
   * 清理资源
   */
  async function cleanupResources() {
    try {
      // 标记连接已关闭
      ws.connectionActive = false;
      
      if (recognizer) {
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            logger.warn('[语音识别] 停止识别超时，强制关闭');
            if (recognizer) {
              try { recognizer.close(); } catch (e) { }
            }
            resolve();
          }, 3000);
          
          recognizer.stopContinuousRecognitionAsync(
            () => {
              clearTimeout(timeoutId);
              logger.info('[语音识别] 识别器已停止');
              recognizer.close();
              resolve();
            },
            error => {
              clearTimeout(timeoutId);
              logger.error('[错误] 停止识别错误:', error);
              try { recognizer.close(); } catch (e) { }
              resolve(); // 即使出错也继续清理
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
      logger.error('[错误] 清理资源时出错:', error);
    }
  }

  // 添加心跳检测
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.ping();
      } catch (e) {
        logger.error('[WebSocket] 心跳检测失败:', e);
      }
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  // 初始化并设置处理器
  (async () => {
    try {
      // 初始化识别器
      await setupRecognizer();
      
      // 发送就绪状态
      if (ws.connectionActive) {
        ws.send(JSON.stringify({
          status: 'ready',
          message: '服务器已准备好，可以开始对话'
        }));
      }

      // 处理接收到的音频数据
      ws.on('message', async (data) => {
        if (!audioDataReceived && ws.connectionActive) {
          audioDataReceived = true;
          logger.info('[WebSocket] 首次接收到音频数据，大小:', data.length, 'bytes');
        }
        
        await processAudioData(data);
      });

      // 处理连接关闭
      ws.on('close', async () => {
        logger.info('[WebSocket] 连接关闭');
        clearInterval(pingInterval);
        await cleanupResources();
      });

      // 处理错误
      ws.on('error', (error) => {
        logger.error('[WebSocket] 连接错误:', error);
        clearInterval(pingInterval);
      });
    } catch (error) {
      logger.error('[错误] WebSocket连接处理失败:', error);
      clearInterval(pingInterval);
    }
  })();
} 