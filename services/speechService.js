import sdk from 'microsoft-cognitiveservices-speech-sdk';
import config from '../config.js';
import logger from './logger.js';

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
 * Converts text to speech and sends audio to client
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
  
  let synthesizer = null;
  
  try {
    // Clean up existing synthesizer
    if (ws.currentSynthesizer) {
      try {
        ws.currentSynthesizer.close();
      } catch (error) {
        logger.speech.warn(`[${ws.connectionId}] Error closing previous synthesizer: ${error.message}`);
      }
      ws.currentSynthesizer = null;
    }
    
    // Create new synthesizer
    synthesizer = new sdk.SpeechSynthesizer(createTTSConfig());
    ws.currentSynthesizer = synthesizer;
    
    // Attach event handlers
    synthesizer.synthesisStarted = () => {
      logger.speech.debug(`[${ws.connectionId}] Synthesis started`);
    };
    
    // Perform synthesis with timeout
    const result = await Promise.race([
      new Promise((resolve, reject) => {
        synthesizer.speakTextAsync(
          text,
          result => resolve(result),
          error => reject(error)
        );
      }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('TTS synthesis timeout')), 8000);
      })
    ]);

    // Check if synthesis was cancelled
    if (!ws.connectionActive || !ws.currentSynthesizer) {
      logger.speech.info(`[${ws.connectionId}] Synthesis was cancelled`);
      closeAndCleanup();
      return;
    }

    // Handle successful synthesis
    if (result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
      const endTime = Date.now();
      logger.speech.info(`[${ws.connectionId}] TTS latency: ${endTime - startTime}ms`);
      
      // Send audio data to client
      if (ws.connectionActive) {
        try {
          ws.send(result.audioData);
        } catch (error) {
          logger.error(`[${ws.connectionId}] Error sending TTS audio data: ${error.message}`);
        }
      }
    } else {
      // Handle synthesis error
      const errorDetails = result ? 
        `Reason: ${result.reason}, Error: ${result.errorDetails}` : 
        'Unknown error';
      
      logger.error(`[${ws.connectionId}] Speech synthesis failed: ${errorDetails}`);
      
      if (ws.connectionActive) {
        try {
          ws.send(JSON.stringify({ 
            error: `Speech synthesis failed`,
            details: errorDetails
          }));
        } catch (sendError) {
          logger.error(`[${ws.connectionId}] Error sending TTS error to client: ${sendError.message}`);
        }
      }
    }
    
    closeAndCleanup();
  } catch (error) {
    logger.error(`[${ws.connectionId}] TTS error: ${error.message}`);
    
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
    
    closeAndCleanup();
  }
  
  // Helper function to close synthesizer and clean up
  function closeAndCleanup() {
    if (synthesizer) {
      try {
        synthesizer.close();
      } catch (error) {
        logger.speech.warn(`[${ws.connectionId}] Error closing synthesizer: ${error.message}`);
      }
      
      if (ws.currentSynthesizer === synthesizer) {
        ws.currentSynthesizer = null;
      }
    }
  }
} 