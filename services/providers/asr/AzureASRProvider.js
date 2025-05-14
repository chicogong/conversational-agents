import sdk from 'microsoft-cognitiveservices-speech-sdk';
import { ASRProvider } from '../../interfaces/ASRProvider.js';
import logger from '../../logger.js';
import { wsService } from '../../wsHandler.js';

/**
 * Azure Cognitive Services Speech SDK ASR provider
 */
export class AzureASRProvider extends ASRProvider {
  /**
   * Initialize the Azure ASR provider
   * @param {Object} config - Configuration for the provider
   * @returns {Promise<void>}
   */
  async initialize(config) {
    this.config = config;
    logger.info(`Initialized Azure ASR provider with region: ${config.speech.region}`);
  }
  
  /**
   * Creates a speech recognition configuration
   * @returns {sdk.SpeechConfig} Configured speech recognition config
   */
  createSpeechConfig() {
    try {
      const speechConfig = sdk.SpeechConfig.fromSubscription(
        this.config.speech.key,
        this.config.speech.region
      );
      speechConfig.speechRecognitionLanguage = this.config.speech.language;
      
      // Add additional speech config settings
      speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, 
        String(this.config.speech.timeouts.initialSilence));
      speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, 
        String(this.config.speech.timeouts.endSilence));
      
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
  detectVoiceActivity(buffer) {
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
      return avgMagnitude > this.config.speech.voiceDetectionThreshold;
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
  processAudioData(buffer, ws) {
    try {
      if (!buffer || buffer.length === 0 || !ws.connectionActive) return false;
      
      // Ensure valid PCM data
      if (buffer.length >= 2 && buffer.length % 2 === 0) {
        // Check for voice activity
        const hasVoiceActivity = this.detectVoiceActivity(buffer);
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
   * @returns {Promise<boolean>}
   */
  async setupRecognizer(ws) {
    logger.speech.info(`[${ws.connectionId}] Setting up speech recognizer...`);
    try {
      // Create audio stream and recognizer
      const pushFormat = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      ws.context.speech.pushStream = sdk.AudioInputStream.createPushStream(pushFormat);
      ws.context.speech.audioConfig = sdk.AudioConfig.fromStreamInput(ws.context.speech.pushStream);
      ws.context.speech.recognizer = new sdk.SpeechRecognizer(this.createSpeechConfig(), ws.context.speech.audioConfig);
      
      logger.speech.info(`[${ws.connectionId}] Successfully created speech recognizer and audio stream`);
  
      // Set up event handlers
      this.setupRecognizerEvents(ws);
      
      // Start continuous recognition with timeout
      await this.startContinuousRecognition(ws);
      
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
  setupRecognizerEvents(ws) {
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
        import('../../serviceRegistry.js').then(({ serviceRegistry }) => {
          // Call language model
          serviceRegistry.getLLM().processUserInput(e.result.text, ws);
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
  async startContinuousRecognition(ws) {
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
   * Start recognition manually
   * @param {WebSocket} ws - WebSocket connection
   */
  async startRecognition(ws) {
    if (!ws || !ws.connectionActive) return;
    
    try {
      logger.speech.info(`[${ws.connectionId}] Starting speech recognition`);
      
      // Set up the recognizer if not already set up
      if (!ws.context.speech.recognizer) {
        await this.setupRecognizer(ws);
      }
      
      wsService.sendToClient(ws, wsService.createMessage('recognitionStarted'));
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error starting recognition: ${error.message}`);
      wsService.sendToClient(
        ws, 
        wsService.createMessage('error', 'Failed to start recognition', { details: error.message })
      );
    }
  }
  
  /**
   * Stop the recognizer with timeout
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async stopRecognition(ws) {
    if (!ws || !ws.connectionActive) return;
    
    const recognizer = ws.context.speech.recognizer;
    if (!recognizer) return;
    
    logger.speech.info(`[${ws.connectionId}] Stopping speech recognition`);
    
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        logger.speech.warn(`[${ws.connectionId}] Stop recognition timeout, forcing close`);
        this.closeRecognizer(ws);
        resolve();
      }, 3000);
      
      recognizer.stopContinuousRecognitionAsync(
        () => {
          clearTimeout(timeoutId);
          logger.speech.info(`[${ws.connectionId}] Recognizer stopped`);
          this.closeRecognizer(ws);
          resolve();
        },
        error => {
          clearTimeout(timeoutId);
          logger.error(`[${ws.connectionId}] Error stopping recognition: ${error.message}`);
          this.closeRecognizer(ws);
          resolve(); // Continue cleanup even if error occurs
        }
      );
      
      wsService.sendToClient(ws, wsService.createMessage('recognitionStopped'));
    });
  }
  
  /**
   * Clean up and close the recognizer
   * @param {WebSocket} ws - WebSocket connection
   */
  closeRecognizer(ws) {
    if (!ws) return;
    
    try {
      if (ws.context.speech.recognizer) {
        ws.context.speech.recognizer.close();
        ws.context.speech.recognizer = null;
      }
      
      if (ws.context.speech.pushStream) {
        ws.context.speech.pushStream = null;
      }
      
      if (ws.context.speech.audioConfig) {
        ws.context.speech.audioConfig = null;
      }
      
      ws.isUserSpeaking = false;
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error closing recognizer: ${error.message}`);
    }
  }
  
  /**
   * Clean up ASR resources
   * @param {WebSocket} ws - WebSocket connection
   */
  async cleanup(ws) {
    if (!ws) return;
    
    try {
      await this.stopRecognition(ws);
      this.closeRecognizer(ws);
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error during ASR cleanup: ${error.message}`);
    }
  }
} 