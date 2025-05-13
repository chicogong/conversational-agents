import sdk from 'microsoft-cognitiveservices-speech-sdk';
import config from '../config.js';
import logger from './logger.js';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';

/**
 * Creates a speech recognition configuration
 * @returns {sdk.SpeechConfig} Configured speech recognition config
 */
export function createSpeechConfig() {
  try {
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      config.speech.key,
      config.speech.region
    );
    speechConfig.speechRecognitionLanguage = config.speech.language;
    
    // Add additional speech config settings
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '5000');
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, '1000');
    
    return speechConfig;
  } catch (error) {
    logger.error(`Error creating speech config: ${error.message}`);
    throw new Error(`Failed to initialize speech recognition: ${error.message}`);
  }
}

/**
 * Creates a text-to-speech configuration
 * @returns {sdk.SpeechConfig} Configured TTS config
 */
export function createTTSConfig() {
  try {
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
    
    // Add additional TTS settings
    ttsConfig.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestSentenceBoundary, 'true');
    
    return ttsConfig;
  } catch (error) {
    logger.error(`Error creating TTS config: ${error.message}`);
    throw new Error(`Failed to initialize speech synthesis: ${error.message}`);
  }
}

/**
 * Detects voice activity in audio data buffer
 * @param {Buffer} buffer - Audio data buffer
 * @returns {boolean} Whether voice activity is detected
 */
export function detectVoiceActivity(buffer) {
  try {
    if (!buffer || buffer.length < 2) {
      return false;
    }
    
    // Sample size for detecting voice activity
    const sampleSize = Math.min(buffer.length, 200);
    let sum = 0;
    
    for (let i = 0; i < sampleSize; i += 2) {
      const sample = buffer.readInt16LE(i);
      sum += Math.abs(sample);
    }
    
    const avgMagnitude = sum / (sampleSize / 2);
    return avgMagnitude > config.speech.voiceDetectionThreshold;
  } catch (error) {
    logger.error(`Error detecting voice activity: ${error.message}`);
    return false; // Default to no voice activity on error
  }
}

/**
 * Gets the appropriate TTS endpoint URL based on region configuration
 * @returns {string} TTS endpoint URL
 */
function getTTSEndpoint() {
  const isChina = config.speech.region.includes('china') || 
                 ['chinaeast', 'chinanorth', 'chinaeast2', 'chinanorth2'].includes(config.speech.region);
  
  return isChina 
    ? `https://${config.speech.region}.tts.speech.azure.cn/cognitiveservices/v1`
    : `https://${config.speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

/**
 * Builds SSML for text-to-speech
 * @param {string} text - Text to convert to speech
 * @returns {string} Formatted SSML
 */
function buildSSML(text) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${config.speech.language}">
    <voice name="${config.speech.voice}">${text}</voice>
  </speak>`;
}

/**
 * Sends error notification to client via WebSocket
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} message - Error message
 * @param {string} details - Error details
 */
function sendErrorToClient(ws, message, details) {
  if (!ws || !ws.connectionActive) return;
  
  try {
    ws.send(JSON.stringify({ error: message, details }));
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error sending error message to client: ${error.message}`);
  }
}

/**
 * Converts text to speech using streaming HTTP and sends audio chunks to client
 * @param {string} text - Text to synthesize
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Promise<void>}
 */
export async function textToSpeech(text, ws) {
  if (!text || !ws || !ws.connectionActive) {
    return;
  }
  
  const startTime = Date.now();
  const logText = text.length > 30 ? `${text.substring(0, 30)}...` : text;
  logger.speech.info(`[${ws.connectionId}] Starting speech synthesis, text: "${logText}"`);
  
  // Clean up existing synthesizer
  cleanupSynthesizer(ws);
  
  try {
    const ssml = buildSSML(text);
    const headers = {
      'Ocp-Apim-Subscription-Key': config.speech.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-16khz-16bit-mono-pcm',
      'Accept': 'audio/wav'
    };
    
    const endpoint = getTTSEndpoint();
    logger.speech.debug(`[${ws.connectionId}] Using TTS endpoint: ${endpoint}`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: ssml,
      timeout: 10000
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[${ws.connectionId}] TTS request failed, status: ${response.status}, error: ${errorText}`);
      sendErrorToClient(ws, `Speech synthesis failed`, `Status ${response.status}: ${errorText}`);
      return;
    }
    
    const buffer = await response.arrayBuffer();
    
    if (!buffer || buffer.byteLength === 0) {
      logger.speech.warn(`[${ws.connectionId}] TTS response returned no audio data for text: "${logText}"`);
      sendErrorToClient(ws, 'Speech synthesis returned empty response', 'No audio data received');
      return;
    }
    
    if (ws.connectionActive) {
      try {
        ws.send(Buffer.from(buffer));
      } catch (error) {
        logger.error(`[${ws.connectionId}] Error sending TTS audio: ${error.message}`);
      }
    }
    
    const endTime = Date.now();
    logger.speech.info(`[${ws.connectionId}] TTS streaming complete, audio size: ${buffer.byteLength} bytes, latency: ${endTime - startTime}ms`);
    
  } catch (error) {
    logger.error(`[${ws.connectionId}] TTS streaming error: ${error.message}`);
    sendErrorToClient(ws, 'Speech synthesis error', error.message);
  }
}

/**
 * Cleans up an existing synthesizer if present
 * @param {WebSocket} ws - WebSocket connection with synthesizer property
 */
function cleanupSynthesizer(ws) {
  if (ws.currentSynthesizer) {
    try {
      ws.currentSynthesizer.close();
    } catch (error) {
      logger.speech.warn(`[${ws.connectionId}] Error closing previous synthesizer: ${error.message}`);
    }
    ws.currentSynthesizer = null;
  }
} 