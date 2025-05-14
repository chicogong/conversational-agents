import sdk from 'microsoft-cognitiveservices-speech-sdk';
import config from '../config.js';
import logger from './logger.js';
import { wsService } from './wsHandler.js';

/**
 * Creates a speech recognition configuration
 * @returns {sdk.SpeechConfig} Configured speech recognition config
 */
function createSpeechConfig() {
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
 * Detects voice activity in audio data buffer
 * @param {Buffer} buffer - Audio data buffer
 * @returns {boolean} Whether voice activity is detected
 */
function detectVoiceActivity(buffer) {
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
 * Process incoming audio data
 * @param {Buffer} buffer - Audio data buffer
 * @param {WebSocket} ws - WebSocket connection
 * @returns {boolean} - Whether processing was successful
 */
function processAudioData(buffer, ws) {
  try {
    if (!buffer || buffer.length === 0 || !ws.connectionActive) return false;
    
    // Ensure valid PCM data
    if (buffer.length >= 2 && buffer.length % 2 === 0) {
      // Check for voice activity
      const hasVoiceActivity = detectVoiceActivity(buffer);
      if (hasVoiceActivity && !ws.isUserSpeaking) {
        logger.speech.debug(`[${ws.connectionId}] Voice activity detected`);
        ws.isUserSpeaking = true;
        
        // Interrupt current response
        wsService.cancelOngoingActivities(ws);
      }
      
      // Send data to speech recognition service
      if (ws.context.speech.pushStream) {
        ws.context.speech.pushStream.write(buffer);
        return true;
      }
    } else {
      logger.speech.warn(`[${ws.connectionId}] Invalid audio format, length: ${buffer.length}`);
    }
    return false;
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error processing audio data: ${error.message}`);
    return false;
  }
}

/**
 * Set up speech recognizer with events and error handling
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function setupRecognizer(ws) {
  logger.speech.info(`[${ws.connectionId}] Setting up speech recognizer...`);
  try {
    // Create audio stream and recognizer
    const pushFormat = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
    ws.context.speech.pushStream = sdk.AudioInputStream.createPushStream(pushFormat);
    ws.context.speech.audioConfig = sdk.AudioConfig.fromStreamInput(ws.context.speech.pushStream);
    ws.context.speech.recognizer = new sdk.SpeechRecognizer(createSpeechConfig(), ws.context.speech.audioConfig);
    
    logger.speech.info(`[${ws.connectionId}] Successfully created speech recognizer and audio stream`);

    // Set up event handlers
    setupRecognizerEvents(ws);
    
    // Start continuous recognition with timeout
    await startContinuousRecognition(ws);
    
    return true;
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error setting up speech recognizer: ${error.message}`);
    wsService.sendToClient(
      ws,
      wsService.createMessage('error', 'Failed to set up speech recognizer', { details: error.message })
    );
    throw error;
  }
}

/**
 * Configure recognizer event handlers
 * @param {WebSocket} ws - WebSocket connection
 */
function setupRecognizerEvents(ws) {
  const recognizer = ws.context.speech.recognizer;
  if (!recognizer) return;
  
  recognizer.recognizing = (s, e) => {
    if (e.result.text && ws.connectionActive) {
      logger.speech.debug(`[${ws.connectionId}] Recognizing: ${e.result.text}`);
      
      // Interrupt current AI response
      wsService.cancelOngoingActivities(ws);
      
      // Send intermediate results
      wsService.sendToClient(ws, wsService.createMessage('partialTranscription', e.result.text));
    }
  };

  recognizer.recognized = (s, e) => {
    if (e.result.text && ws.connectionActive) {
      logger.speech.info(`[${ws.connectionId}] Recognition result: ${e.result.text}`);
      
      // Cancel ongoing responses
      wsService.cancelOngoingActivities(ws);
      
      // Send final recognition result
      wsService.sendToClient(ws, wsService.createMessage('transcription', e.result.text));
      
      // Import dynamically to avoid circular dependency
      import('./llmService.js').then(({ llmService }) => {
        // Call language model
        llmService.processUserInput(e.result.text, ws);
      });
    } else {
      logger.speech.debug(`[${ws.connectionId}] Recognition completed but no text result`);
    }
  };

  recognizer.sessionStarted = () => {
    logger.speech.info(`[${ws.connectionId}] Recognition session started`);
    ws.isUserSpeaking = true;
  };

  recognizer.sessionStopped = () => {
    logger.speech.info(`[${ws.connectionId}] Recognition session ended`);
    ws.isUserSpeaking = false;
  };

  recognizer.canceled = (s, e) => {
    logger.speech.error(`[${ws.connectionId}] Recognition canceled: ${e.errorDetails}`);
  };
}

/**
 * Start continuous recognition with timeout
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function startContinuousRecognition(ws) {
  const recognizer = ws.context.speech.recognizer;
  if (!recognizer) {
    throw new Error('Recognizer not initialized');
  }
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Speech recognition startup timeout"));
    }, 5000);
    
    recognizer.startContinuousRecognitionAsync(
      () => {
        clearTimeout(timeoutId);
        logger.speech.info(`[${ws.connectionId}] Continuous recognition started`);
        resolve();
      },
      error => {
        clearTimeout(timeoutId);
        logger.error(`[${ws.connectionId}] Recognition error: ${error.message}`);
        reject(error);
      }
    );
  });
}

/**
 * Stop the recognizer with timeout
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function stopRecognition(ws) {
  const recognizer = ws.context.speech.recognizer;
  if (!recognizer) return;
  
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      logger.speech.warn(`[${ws.connectionId}] Stop recognition timeout, forcing close`);
      closeRecognizer(ws);
      resolve();
    }, 3000);
    
    recognizer.stopContinuousRecognitionAsync(
      () => {
        clearTimeout(timeoutId);
        logger.speech.info(`[${ws.connectionId}] Recognizer stopped`);
        closeRecognizer(ws);
        resolve();
      },
      error => {
        clearTimeout(timeoutId);
        logger.error(`[${ws.connectionId}] Error stopping recognition: ${error.message}`);
        closeRecognizer(ws);
        resolve(); // Continue cleanup even if error occurs
      }
    );
  });
}

/**
 * Start recognition manually
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function startRecognition(ws) {
  if (!ws || !ws.connectionActive) return;
  
  try {
    // Check if recognizer exists
    if (!ws.context.speech.recognizer) {
      await setupRecognizer(ws);
    } else {
      await startContinuousRecognition(ws);
    }
    
    wsService.sendToClient(ws, wsService.createMessage('recognitionStarted'));
  } catch (error) {
    logger.error(`[${ws.connectionId}] Failed to start recognition: ${error.message}`);
    wsService.sendToClient(
      ws, 
      wsService.createMessage('error', 'Failed to start recognition', { details: error.message })
    );
  }
}

/**
 * Close the recognizer object
 * @param {WebSocket} ws - WebSocket connection
 */
function closeRecognizer(ws) {
  const recognizer = ws.context.speech.recognizer;
  if (recognizer) {
    try { 
      recognizer.close(); 
    } catch (e) { 
      logger.error(`[${ws.connectionId}] Error closing recognizer: ${e.message}`);
    }
    ws.context.speech.recognizer = null;
  }
}

/**
 * Clean up ASR resources
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function cleanup(ws) {
  try {
    await stopRecognition(ws);
    
    // Reset all resources
    ws.context.speech.pushStream = null;
    ws.context.speech.audioConfig = null;
    ws.context.speech.recognizer = null;
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error cleaning up ASR resources: ${error.message}`);
  }
}

// Export ASR service
export const asrService = {
  processAudioData,
  setupRecognizer,
  startRecognition,
  stopRecognition,
  detectVoiceActivity,
  cleanup
}; 