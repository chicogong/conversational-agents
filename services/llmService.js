import OpenAI from 'openai';
import config from '../config.js';
import { textToSpeech } from './speechService.js';
import logger from './logger.js';

// OpenAI API 客户端
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  baseURL: config.openai.baseURL
});

/**
 * 取消当前进行中的所有活动
 */
export function cancelOngoingActivities(ws, sendInterrupt = true) {
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
 * 处理下一个TTS请求
 */
export async function processNextTTS(ws) {
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
    logger.error('[错误] 处理TTS队列错误:', error);
    ws.processingTTS = false;
    ws.ttsPendingSentences.length = 0; // 出错时清空队列，避免卡死
  }
}

/**
 * 调用大语言模型处理用户输入
 */
export async function callLLM(text, ws) {
  try {
    const startTime = Date.now();
    let llmFirstTokenTime = null;
    
    // 取消所有进行中的活动
    cancelOngoingActivities(ws, false);
    
    const stream = await openai.chat.completions.create({
      model: config.openai.model,
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
        logger.info('[LLM] 响应被取消');
        return;
      }

      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        // 记录第一个token的时间
        if (!llmFirstTokenTime) {
          llmFirstTokenTime = Date.now();
          logger.info(`[性能] LLM首token耗时: ${llmFirstTokenTime - startTime}ms`);
        }

        fullResponse += content;
        currentSentence += content;
        
        // 更新前端显示的完整响应
        ws.send(JSON.stringify({ llmResponse: fullResponse }));
        
        // 检查是否遇到句子结束的标点符号
        if (config.patterns.sentenceEnd.test(content)) {
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
      logger.info('[LLM] 响应被取消');
      return;
    }
    logger.error('[错误] 调用LLM出错:', error);
    ws.send(JSON.stringify({ error: '调用大模型时出错' }));
  }
} 