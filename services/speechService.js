import sdk from 'microsoft-cognitiveservices-speech-sdk';
import config from '../config.js';

/**
 * 初始化语音识别配置
 */
export function createSpeechConfig() {
  const speechConfig = sdk.SpeechConfig.fromSubscription(
    config.speech.key,
    config.speech.region
  );
  speechConfig.speechRecognitionLanguage = config.speech.language;
  return speechConfig;
}

/**
 * 初始化语音合成配置
 */
export function createTTSConfig() {
  const ttsConfig = sdk.SpeechConfig.fromSubscription(
    config.speech.key,
    config.speech.region
  );
  ttsConfig.speechSynthesisLanguage = config.speech.language;
  ttsConfig.speechSynthesisVoiceName = config.speech.voice;
  ttsConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_SynthOutputFormat, 
    config.speech.outputFormat
  );
  return ttsConfig;
}

/**
 * 检测音频数据中是否有声音活动
 */
export function detectVoiceActivity(buffer) {
  let sum = 0;
  for (let i = 0; i < Math.min(buffer.length, 100); i += 2) {
    const sample = buffer.readInt16LE(i);
    sum += Math.abs(sample);
  }
  
  const avgMagnitude = sum / (Math.min(buffer.length, 100) / 2);
  return avgMagnitude > config.speech.voiceDetectionThreshold;
}

/**
 * 文本转语音处理
 */
export async function textToSpeech(text, ws) {
  const startTime = Date.now(); // 开始时间
  console.log('[TTS] 开始语音合成，文本:', text);
  
  try {
    if (ws.currentSynthesizer) {
      ws.currentSynthesizer.close();
      ws.currentSynthesizer = null;
    }
    
    const synthesizer = new sdk.SpeechSynthesizer(createTTSConfig());
    ws.currentSynthesizer = synthesizer;
    
    const result = await new Promise((resolve, reject) => {
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
      const endTime = Date.now(); // 音频数据准备好的时间
      console.log(`[性能] TTS首帧耗时: ${endTime - startTime}ms`);
      
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