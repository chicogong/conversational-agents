/**
 * Interface for ASR (Automatic Speech Recognition) providers
 * All ASR implementations must implement these methods
 */
export class ASRProvider {
  /**
   * Initialize the ASR provider with configuration
   * @param {Object} config - Configuration for the provider
   * @returns {Promise<void>}
   */
  async initialize(config) {
    throw new Error('Method not implemented');
  }

  /**
   * Process audio data for speech recognition
   * @param {Buffer} buffer - Audio data buffer
   * @param {WebSocket} ws - WebSocket connection
   * @returns {boolean} - Whether processing was successful
   */
  processAudioData(buffer, ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Start speech recognition
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async startRecognition(ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Stop speech recognition
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async stopRecognition(ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Clean up ASR resources
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async cleanup(ws) {
    throw new Error('Method not implemented');
  }
} 