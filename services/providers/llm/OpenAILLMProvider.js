import OpenAI from 'openai';
import { LLMProvider } from '../../interfaces/LLMProvider.js';
import logger from '../../logger.js';
import { wsService } from '../../wsHandler.js';

/**
 * OpenAI API LLM provider
 */
export class OpenAILLMProvider extends LLMProvider {
  /**
   * Initialize the OpenAI LLM provider
   * @param {Object} config - Configuration for the provider
   * @returns {Promise<void>}
   */
  async initialize(config) {
    this.config = config;
    
    // Initialize OpenAI API client
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseURL
    });
    
    this.maxConversationHistory = config.conversation.maxHistory || 10;
    
    logger.info(`Initialized OpenAI LLM provider with model: ${config.openai.model}`);
  }
  
  /**
   * Cancel LLM stream and related activities for a connection
   * @param {WebSocket} ws - WebSocket connection
   */
  async cancelActivities(ws) {
    if (!ws) return;
    
    // Cancel LLM stream
    if (ws.context && ws.context.llm && ws.context.llm.stream) {
      try {
        ws.context.llm.stream.controller.abort();
      } catch (error) {
        logger.error(`[${ws.connectionId}] Error aborting LLM stream: ${error.message}`);
      }
      ws.context.llm.stream = null;
    }
  }
  
  /**
   * Initialize conversation history for a connection
   * @param {WebSocket} ws - WebSocket connection
   */
  initConversationHistory(ws) {
    if (!ws.context.llm.conversationHistory) {
      ws.context.llm.conversationHistory = [{
        role: "system",
        content: this.config.openai.systemPrompt
      }];
    }
  }
  
  /**
   * Add message to conversation history
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} role - Message role (user/assistant)
   * @param {string} content - Message content
   */
  addToConversationHistory(ws, role, content) {
    this.initConversationHistory(ws);
    
    ws.context.llm.conversationHistory.push({
      role: role,
      content: content
    });
    
    // Maintain maximum history size
    if (ws.context.llm.conversationHistory.length > this.maxConversationHistory + 1) { // +1 for system message
      // Remove the oldest non-system message
      ws.context.llm.conversationHistory.splice(1, 1);
    }
  }
  
  /**
   * Process streaming LLM response
   * @param {WebSocket} ws - WebSocket connection
   * @param {AsyncIterable} stream - OpenAI stream response
   * @returns {Promise<string>} Full response from LLM
   */
  async processLLMStream(ws, stream) {
    let fullResponse = '';
    let currentSentence = '';
    let firstTokenTime = null;
    const startTime = Date.now();
    
    try {
      // Save stream reference for potential cancellation
      ws.context.llm.stream = stream;
      
      for await (const chunk of stream) {
        // Check if response was cancelled
        if (!ws.context.llm.stream || !ws.connectionActive) {
          logger.llm.info(`[${ws.connectionId}] LLM response cancelled`);
          return fullResponse;
        }
    
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          // Record first token time
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
            logger.llm.info(`[${ws.connectionId}] LLM first token latency: ${firstTokenTime - startTime}ms`);
          }
    
          fullResponse += content;
          currentSentence += content;
          
          // Update complete response on frontend
          wsService.sendToClient(ws, wsService.createMessage('llmResponse', fullResponse));
          
          // Check for sentence end punctuation
          if (this.config.patterns.sentenceEnd.test(content)) {
            // Add sentence to TTS queue and process
            ws.ttsPendingSentences.push(currentSentence);
            if (ws.ttsPendingSentences.length === 1 && !ws.processingTTS) {
              // Import dynamically to avoid circular dependency
              const { serviceRegistry } = await import('../../serviceRegistry.js');
              serviceRegistry.getTTS().processNextTTS(ws);
            }
            currentSentence = '';
          }
        }
      }
      
      // Handle last incomplete sentence
      if (currentSentence.trim()) {
        ws.ttsPendingSentences.push(currentSentence);
        if (ws.ttsPendingSentences.length === 1 && !ws.processingTTS) {
          // Import dynamically to avoid circular dependency
          const { serviceRegistry } = await import('../../serviceRegistry.js');
          serviceRegistry.getTTS().processNextTTS(ws);
        }
      }
      
      // Add response to conversation history
      this.addToConversationHistory(ws, "assistant", fullResponse);
      
      return fullResponse;
    } finally {
      // Clear stream reference when done or on error
      ws.context.llm.stream = null;
      
      logger.llm.info(`[${ws.connectionId}] LLM response complete, tokens: ${fullResponse.length / 4}`);
    }
  }
  
  /**
   * Call language model to process user input
   * @param {string} text - User input text
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Promise<string|null>} - LLM response or null if failed
   */
  async processUserInput(text, ws) {
    if (!text || !ws || !ws.connectionActive) return null;
    
    // Track performance
    const startTime = Date.now();
    
    try {
      const truncatedText = text.length > 50 ? `${text.substring(0, 50)}...` : text;
      logger.llm.info(`[${ws.connectionId}] Processing user query: "${truncatedText}"`);
      
      // Cancel ongoing activities
      wsService.cancelOngoingActivities(ws, false);
      
      // Initialize queue if needed
      if (!ws.ttsPendingSentences) {
        ws.ttsPendingSentences = [];
      }
      
      // Initialize and update conversation history
      this.initConversationHistory(ws);
      this.addToConversationHistory(ws, "user", text);
      
      // Call OpenAI API with streaming response
      const stream = await this.client.chat.completions.create({
        model: this.config.openai.model,
        messages: [...ws.context.llm.conversationHistory],
        stream: true,
        temperature: this.config.openai.temperature,
        max_tokens: this.config.openai.maxTokens,
      });
  
      // Process stream response
      const fullResponse = await this.processLLMStream(ws, stream);
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      logger.llm.info(`[${ws.connectionId}] LLM processing completed in ${totalTime}ms`);
      
      return fullResponse;
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error processing LLM request: ${error.message}`);
      
      // Send error to client
      wsService.sendToClient(
        ws, 
        wsService.createMessage('error', 'LLM processing error', { details: error.message })
      );
      
      return null;
    }
  }
  
  /**
   * Get conversation history for a connection
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Array} Conversation history
   */
  getConversationHistory(ws) {
    if (!ws || !ws.context || !ws.context.llm || !ws.context.llm.conversationHistory) {
      return [];
    }
    return [...ws.context.llm.conversationHistory];
  }
  
  /**
   * Clear conversation history for a connection
   * @param {WebSocket} ws - WebSocket connection
   */
  async clearConversationHistory(ws) {
    if (!ws || !ws.context || !ws.context.llm) return;
    
    // Reset to only system prompt
    ws.context.llm.conversationHistory = [{
      role: "system",
      content: this.config.openai.systemPrompt
    }];
    
    logger.llm.info(`[${ws.connectionId}] Conversation history cleared`);
  }
  
  /**
   * Clean up LLM resources
   * @param {WebSocket} ws - WebSocket connection
   */
  async cleanup(ws) {
    if (!ws) return;
    
    // Cancel ongoing LLM stream
    await this.cancelActivities(ws);
    
    // Clear conversation history if configured
    if (this.config.conversation.clearOnDisconnect) {
      await this.clearConversationHistory(ws);
    }
  }
} 