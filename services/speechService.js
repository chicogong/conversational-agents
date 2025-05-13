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
  logger.speech.info(`[${ws.connectionId}] Starting speech synthesis, text: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
  
  // Clean up existing synthesizer if present
  if (ws.currentSynthesizer) {
    try {
      ws.currentSynthesizer.close();
    } catch (error) {
      logger.speech.warn(`[${ws.connectionId}] Error closing previous synthesizer: ${error.message}`);
    }
    ws.currentSynthesizer = null;
  }
  
  try {
    // Build SSML
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${config.speech.language}">
      <voice name="${config.speech.voice}">${text}</voice>
    </speak>`;
    
    // Set up request headers
    const headers = {
      'Ocp-Apim-Subscription-Key': config.speech.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-16khz-16bit-mono-pcm',
      'Accept': 'audio/wav'
    };
    
    // Construct the correct endpoint URL for Azure China
    // China regions use the format: https://{region}.tts.speech.azure.cn/cognitiveservices/v1
    const endpoint = `https://${config.speech.region}.tts.speech.azure.cn/cognitiveservices/v1`;
    
    logger.speech.debug(`[${ws.connectionId}] Using TTS endpoint: ${endpoint}`);
    
    // Perform streaming HTTP request
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: ssml,
      timeout: 10000 // 10 second timeout
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[${ws.connectionId}] TTS request failed, status: ${response.status}, error: ${errorText}`);
      
      if (ws.connectionActive) {
        try {
          ws.send(JSON.stringify({
            error: `Speech synthesis failed`,
            details: `Status ${response.status}: ${errorText}`
          }));
        } catch (sendError) {
          logger.error(`[${ws.connectionId}] Error sending TTS error to client: ${sendError.message}`);
        }
      }
      return;
    }
    
    // Get response as ArrayBuffer
    const buffer = await response.arrayBuffer();
    
    // No audio data returned
    if (!buffer || buffer.byteLength === 0) {
      logger.speech.warn(`[${ws.connectionId}] TTS response returned no audio data for text: "${text}"`);
      if (ws.connectionActive) {
        try {
          ws.send(JSON.stringify({
            error: 'Speech synthesis returned empty response',
            details: 'No audio data received'
          }));
        } catch (sendError) {
          logger.error(`[${ws.connectionId}] Error sending empty TTS notification: ${sendError.message}`);
        }
      }
      return;
    }
    
    // Create a Blob from the buffer and send it directly
    // The client expects a Blob object for audio data
    if (ws.connectionActive) {
      try {
        // For Node.js, we simply send the buffer directly
        // WebSocket implementation will handle it correctly
        ws.send(Buffer.from(buffer));
      } catch (error) {
        logger.error(`[${ws.connectionId}] Error sending TTS audio: ${error.message}`);
      }
    }
    
    const endTime = Date.now();
    logger.speech.info(`[${ws.connectionId}] TTS streaming complete, audio size: ${buffer.byteLength} bytes, latency: ${endTime - startTime}ms`);
    
  } catch (error) {
    logger.error(`[${ws.connectionId}] TTS streaming error: ${error.message}`);
    
    if (ws.connectionActive) {
      try {
        ws.send(JSON.stringify({
          error: 'Speech synthesis error',
          details: error.message
        }));
      } catch (sendError) {
        logger.error(`[${ws.connectionId}] Error sending TTS error to client: ${sendError.message}`);
      }
    }
  }
} 