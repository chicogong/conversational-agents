import sdk from 'microsoft-cognitiveservices-speech-sdk';
import { createSpeechConfig, detectVoiceActivity } from './speechService.js';
import { callLLM, cancelOngoingActivities } from './llmService.js';
import logger from './logger.js';

// Track active connections for monitoring
const activeConnections = new Set();

/**
 * Handles a new WebSocket connection
 */
export function handleConnection(ws) {
  logger.ws.info('New WebSocket connection established');
  
  // Add to active connections
  activeConnections.add(ws);
  logger.ws.debug(`Active connections: ${activeConnections.size}`);
  
  // Speech recognition resources
  let pushStream = null;
  let audioConfig = null;
  let recognizer = null;
  let audioDataReceived = false;
  
  // Initialize client state
  ws.ttsPendingSentences = [];
  ws.processingTTS = false;
  ws.isUserSpeaking = false;
  ws.connectionActive = true;
  ws.connectionId = Date.now().toString(36) + Math.random().toString(36).substring(2);

  /**
   * Process incoming audio data
   * @param {Buffer} data - Audio data buffer
   * @returns {boolean} - Whether processing was successful
   */
  async function processAudioData(data) {
    try {
      if (!data || data.length === 0 || !ws.connectionActive) return false;
      
      const buffer = Buffer.from(data);
      
      // Ensure valid PCM data
      if (buffer.length >= 2 && buffer.length % 2 === 0) {
        // Check for voice activity
        const hasVoiceActivity = detectVoiceActivity(buffer);
        if (hasVoiceActivity && !ws.isUserSpeaking) {
          logger.speech.debug(`[${ws.connectionId}] Voice activity detected`);
          ws.isUserSpeaking = true;
          
          // Interrupt current response
          cancelOngoingActivities(ws);
        }
        
        // Send data to speech recognition service
        if (pushStream) {
          pushStream.write(buffer);
          return true;
        }
      } else {
        logger.speech.warn(`[${ws.connectionId}] Invalid audio format, length: ${buffer.length}`);
      }
      return false;
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error processing audio data:`, error);
      return false;
    }
  }

  /**
   * Set up speech recognizer
   */
  async function setupRecognizer() {
    logger.speech.info(`[${ws.connectionId}] Setting up speech recognizer...`);
    try {
      // Create audio stream and recognizer
      const pushFormat = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      pushStream = sdk.AudioInputStream.createPushStream(pushFormat);
      audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
      recognizer = new sdk.SpeechRecognizer(createSpeechConfig(), audioConfig);
      
      logger.speech.info(`[${ws.connectionId}] Successfully created speech recognizer and audio stream`);

      // Configure recognition event handlers
      recognizer.recognizing = (s, e) => {
        if (e.result.text && ws.connectionActive) {
          logger.speech.debug(`[${ws.connectionId}] Recognizing: ${e.result.text}`);
          
          // Interrupt current AI response
          cancelOngoingActivities(ws);
          
          // Send intermediate results
          sendToClient({ partialTranscription: e.result.text });
        }
      };

      recognizer.recognized = (s, e) => {
        if (e.result.text && ws.connectionActive) {
          logger.speech.info(`[${ws.connectionId}] Recognition result: ${e.result.text}`);
          
          // Cancel ongoing responses
          cancelOngoingActivities(ws);
          
          // Send final recognition result
          sendToClient({ transcription: e.result.text });
          
          // Call language model
          callLLM(e.result.text, ws);
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

      // Start continuous recognition with timeout
      await new Promise((resolve, reject) => {
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
            logger.error(`[${ws.connectionId}] Recognition error:`, error);
            reject(error);
          }
        );
      });
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error setting up speech recognizer:`, error);
      sendToClient({ error: `Failed to set up speech recognizer: ${error.message}` });
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async function cleanupResources() {
    try {
      // Mark connection as closed
      ws.connectionActive = false;
      
      // Remove from active connections
      activeConnections.delete(ws);
      logger.ws.debug(`Connection closed. Active connections: ${activeConnections.size}`);
      
      if (recognizer) {
        await new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            logger.speech.warn(`[${ws.connectionId}] Stop recognition timeout, forcing close`);
            if (recognizer) {
              try { recognizer.close(); } catch (e) { 
                logger.error(`[${ws.connectionId}] Error closing recognizer:`, e);
              }
            }
            resolve();
          }, 3000);
          
          recognizer.stopContinuousRecognitionAsync(
            () => {
              clearTimeout(timeoutId);
              logger.speech.info(`[${ws.connectionId}] Recognizer stopped`);
              recognizer.close();
              resolve();
            },
            error => {
              clearTimeout(timeoutId);
              logger.error(`[${ws.connectionId}] Error stopping recognition:`, error);
              try { recognizer.close(); } catch (e) { }
              resolve(); // Continue cleanup even if error occurs
            }
          );
        });
      }
      
      // Reset all resources
      pushStream = null;
      audioConfig = null;
      recognizer = null;
      
      // Clean up TTS resources
      cancelOngoingActivities(ws, false);
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error cleaning up resources:`, error);
    }
  }

  /**
   * Safely send data to client
   * @param {Object} data - Data to send
   */
  function sendToClient(data) {
    if (!ws.connectionActive) return;
    
    try {
      ws.send(JSON.stringify(data));
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error sending data to client:`, error);
    }
  }

  // Add heartbeat detection
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.ping();
      } catch (e) {
        logger.error(`[${ws.connectionId}] Heartbeat ping failed:`, e);
        clearInterval(pingInterval);
        cleanupResources();
      }
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  // Initialize and set up handlers
  (async () => {
    try {
      // Initialize recognizer
      await setupRecognizer();
      
      // Send ready status
      sendToClient({
        status: 'ready',
        message: 'Server is ready, you can start the conversation',
        connectionId: ws.connectionId
      });

      // Handle received audio data
      ws.on('message', async (data) => {
        if (!audioDataReceived && ws.connectionActive) {
          audioDataReceived = true;
          logger.ws.info(`[${ws.connectionId}] First audio data received, size: ${data.length} bytes`);
        }
        
        await processAudioData(data);
      });

      // Handle connection close
      ws.on('close', async (code, reason) => {
        logger.ws.info(`[${ws.connectionId}] Connection closed with code: ${code}, reason: ${reason || 'none'}`);
        clearInterval(pingInterval);
        await cleanupResources();
      });

      // Handle errors
      ws.on('error', (error) => {
        logger.error(`[${ws.connectionId}] Connection error:`, error);
        clearInterval(pingInterval);
        cleanupResources();
      });
    } catch (error) {
      logger.error(`[${ws.connectionId}] Failed to handle WebSocket connection:`, error);
      clearInterval(pingInterval);
      cleanupResources();
    }
  })();
}

/**
 * Get current active connection count
 * @returns {number} Number of active connections
 */
export function getActiveConnectionCount() {
  return activeConnections.size;
} 