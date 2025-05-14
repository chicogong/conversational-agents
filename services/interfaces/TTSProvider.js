/**
 * Interface for TTS (Text-to-Speech) providers
 * All TTS implementations must implement these methods
 */
export class TTSProvider {
  /**
   * Initialize the TTS provider with configuration
   * @param {Object} config - Configuration for the provider
   * @returns {Promise<void>}
   */
  async initialize(config) {
    throw new Error('Method not implemented');
  }

  /**
   * Convert text to speech
   * @param {string} text - Text to synthesize
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<Buffer|null>} - Audio buffer or null if failed
   */
  async textToSpeech(text, ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Cancel ongoing TTS operation
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async cancelTTS(ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Process next TTS in queue
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async processNextTTS(ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Clean up TTS resources
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async cleanup(ws) {
    throw new Error('Method not implemented');
  }
} 