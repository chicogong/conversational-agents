/**
 * Interface for LLM (Large Language Model) providers
 * All LLM implementations must implement these methods
 */
export class LLMProvider {
  /**
   * Initialize the LLM provider with configuration
   * @param {Object} config - Configuration for the provider
   * @returns {Promise<void>}
   */
  async initialize(config) {
    throw new Error('Method not implemented');
  }

  /**
   * Process user input and generate a response
   * @param {string} text - User input text
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<string|null>} - LLM response or null if failed
   */
  async processUserInput(text, ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Cancel ongoing LLM generation
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async cancelActivities(ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Get conversation history
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Array} - Conversation history
   */
  getConversationHistory(ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Clear conversation history
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async clearConversationHistory(ws) {
    throw new Error('Method not implemented');
  }

  /**
   * Clean up LLM resources
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<void>}
   */
  async cleanup(ws) {
    throw new Error('Method not implemented');
  }
} 