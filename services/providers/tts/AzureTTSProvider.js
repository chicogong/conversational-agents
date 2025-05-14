import sdk from 'microsoft-cognitiveservices-speech-sdk';
import { TTSProvider } from '../../interfaces/TTSProvider.js';
import logger from '../../logger.js';
import fetch from 'node-fetch';
import { wsService } from '../../wsHandler.js';

/**
 * Azure Cognitive Services Speech SDK TTS provider
 */
export class AzureTTSProvider extends TTSProvider {
  /**
   * Initialize the Azure TTS provider
   * @param {Object} config - Configuration for the provider
   * @returns {Promise<void>}
   */
  async initialize(config) {
    this.config = config;
    logger.info(`Initialized Azure TTS provider with region: ${config.speech.region} and voice: ${config.speech.voice}`);
  }
  
  /**
   * Creates a text-to-speech configuration
   * @returns {sdk.SpeechConfig} Configured TTS config
   */
  createTTSConfig() {
    try {
      const ttsConfig = sdk.SpeechConfig.fromSubscription(
        this.config.speech.key,
        this.config.speech.region
      );
      ttsConfig.speechSynthesisLanguage = this.config.speech.language;
      ttsConfig.speechSynthesisVoiceName = this.config.speech.voice;
      ttsConfig.setProperty(
        sdk.PropertyId.SpeechServiceConnection_SynthOutputFormat, 
        this.config.speech.outputFormat
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
   * Gets the appropriate TTS endpoint URL based on region configuration
   * @returns {string} TTS endpoint URL
   */
  getTTSEndpoint() {
    const isChina = this.config.speech.region.includes('china') || 
                   ['chinaeast', 'chinanorth', 'chinaeast2', 'chinanorth2'].includes(this.config.speech.region);
    
    return isChina 
      ? `https://${this.config.speech.region}.tts.speech.azure.cn/cognitiveservices/v1`
      : `https://${this.config.speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  }
  
  /**
   * Builds SSML for text-to-speech
   * @param {string} text - Text to convert to speech
   * @returns {string} Formatted SSML
   */
  buildSSML(text) {
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${this.config.speech.language}">
      <voice name="${this.config.speech.voice}">${text}</voice>
    </speak>`;
  }
  
  /**
   * Cancel TTS processing
   * @param {WebSocket} ws - WebSocket connection
   */
  async cancelTTS(ws) {
    if (!ws) return;
    
    // Cancel current synthesizer
    if (ws.context.speech.synthesizer) {
      try {
        ws.context.speech.synthesizer.close();
      } catch (error) {
        logger.error(`[${ws.connectionId}] Error closing synthesizer: ${error.message}`);
      }
      ws.context.speech.synthesizer = null;
    }
    
    // Clear TTS queue
    if (ws.ttsPendingSentences) {
      ws.ttsPendingSentences.length = 0;
    }
    
    ws.processingTTS = false;
  }
  
  /**
   * Converts text to speech using streaming HTTP and sends audio chunks to client
   * @param {string} text - Text to synthesize
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<Buffer|null>} - Audio buffer or null if failed
   */
  async textToSpeech(text, ws) {
    if (!text || !ws || !ws.connectionActive) {
      return null;
    }
    
    const startTime = Date.now();
    const logText = text.length > 30 ? `${text.substring(0, 30)}...` : text;
    logger.speech.info(`[${ws.connectionId}] Starting speech synthesis, text: "${logText}"`);
    
    // Clean up existing synthesizer
    this.cleanupSynthesizer(ws);
    
    try {
      const ssml = this.buildSSML(text);
      const headers = {
        'Ocp-Apim-Subscription-Key': this.config.speech.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'raw-16khz-16bit-mono-pcm',
        'Accept': 'audio/wav'
      };
      
      const endpoint = this.getTTSEndpoint();
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
        wsService.sendToClient(
          ws, 
          wsService.createMessage('error', 'Speech synthesis failed', { details: `Status ${response.status}: ${errorText}` })
        );
        return null;
      }
      
      const buffer = await response.arrayBuffer();
      
      if (!buffer || buffer.byteLength === 0) {
        logger.speech.warn(`[${ws.connectionId}] TTS response returned no audio data for text: "${logText}"`);
        wsService.sendToClient(
          ws, 
          wsService.createMessage('error', 'Speech synthesis returned empty response', { details: 'No audio data received' })
        );
        return null;
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
      
      return Buffer.from(buffer);
    } catch (error) {
      logger.error(`[${ws.connectionId}] TTS streaming error: ${error.message}`);
      wsService.sendToClient(
        ws, 
        wsService.createMessage('error', 'Speech synthesis error', { details: error.message })
      );
      return null;
    }
  }
  
  /**
   * Process next TTS request in queue
   * @param {WebSocket} ws - WebSocket connection
   */
  async processNextTTS(ws) {
    // Exit if queue is empty or connection was interrupted
    if (!ws || 
        !ws.ttsPendingSentences || 
        ws.ttsPendingSentences.length === 0 || 
        !ws.connectionActive) {
      if (ws) ws.processingTTS = false;
      return;
    }
    
    ws.processingTTS = true;
    const text = ws.ttsPendingSentences[0];
    
    try {
      const truncatedText = text.length > 30 ? `${text.substring(0, 30)}...` : text;
      logger.speech.debug(`[${ws.connectionId}] Processing TTS for text: "${truncatedText}"`);
      
      await this.textToSpeech(text, ws);
      
      // Remove processed sentence
      ws.ttsPendingSentences.shift();
      
      // Process next sentence
      if (ws.ttsPendingSentences.length > 0 && ws.connectionActive) {
        this.processNextTTS(ws);
      } else {
        ws.processingTTS = false;
      }
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error processing TTS queue: ${error.message}`);
      ws.processingTTS = false;
      ws.ttsPendingSentences.length = 0; // Clear queue on error to avoid deadlock
      
      // Attempt to send error to client
      wsService.sendToClient(
        ws, 
        wsService.createMessage('error', 'TTS processing error', { details: error.message })
      );
    }
  }
  
  /**
   * Cleans up an existing synthesizer if present
   * @param {WebSocket} ws - WebSocket connection with synthesizer property
   */
  cleanupSynthesizer(ws) {
    if (ws.context.speech.synthesizer) {
      try {
        ws.context.speech.synthesizer.close();
      } catch (error) {
        logger.speech.warn(`[${ws.connectionId}] Error closing previous synthesizer: ${error.message}`);
      }
      ws.context.speech.synthesizer = null;
    }
  }
  
  /**
   * Clean up TTS resources
   * @param {WebSocket} ws - WebSocket connection
   */
  async cleanup(ws) {
    await this.cancelTTS(ws);
  }
} 