import OpenAI from 'openai';
import config from '../config.js';
import { textToSpeech } from './speechService.js';
import logger from './logger.js';
import { createMessage } from './wsHandler.js';

// Initialize OpenAI API client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  baseURL: config.openai.baseURL
});

// Default conversation history size
const MAX_CONVERSATION_HISTORY = 10;

/**
 * Cancel all ongoing activities for a connection
 * @param {WebSocket} ws - WebSocket connection
 * @param {boolean} sendInterrupt - Whether to send interrupt signal to client
 */
export function cancelOngoingActivities(ws, sendInterrupt = true) {
  if (!ws) return;
  
  // Cancel LLM stream
  if (ws.llmStream) {
    try {
      ws.llmStream.controller.abort();
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error aborting LLM stream: ${error.message}`);
    }
    ws.llmStream = null;
  }
  
  // Cancel TTS
  if (ws.currentSynthesizer) {
    try {
      ws.currentSynthesizer.close();
    } catch (error) {
      logger.error(`[${ws.connectionId}] Error closing synthesizer: ${error.message}`);
    }
    ws.currentSynthesizer = null;
  }
  
  // Clear TTS queue
  if (ws.ttsPendingSentences) {
    ws.ttsPendingSentences.length = 0;
  }
  ws.processingTTS = false;
  
  // Send interrupt signal to client
  if (sendInterrupt && ws.connectionActive) {
    sendToClient(ws, createMessage('interrupt'));
  }
}

/**
 * Safely send data to client
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} data - Data to send
 */
function sendToClient(ws, data) {
  if (!ws || !ws.connectionActive) return;
  
  try {
    ws.send(JSON.stringify(data));
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error sending data to client: ${error.message}`);
  }
}

/**
 * Process next TTS request in queue
 * @param {WebSocket} ws - WebSocket connection
 */
export async function processNextTTS(ws) {
  // Exit if queue is empty or connection was interrupted
  if (!ws || 
      !ws.ttsPendingSentences || 
      ws.ttsPendingSentences.length === 0 || 
      !ws.llmStream || 
      !ws.connectionActive) {
    if (ws) ws.processingTTS = false;
    return;
  }
  
  ws.processingTTS = true;
  const text = ws.ttsPendingSentences[0];
  
  try {
    const truncatedText = text.length > 30 ? `${text.substring(0, 30)}...` : text;
    logger.speech.debug(`[${ws.connectionId}] Processing TTS for text: "${truncatedText}"`);
    
    await textToSpeech(text, ws);
    
    // Remove processed sentence
    ws.ttsPendingSentences.shift();
    
    // Process next sentence
    if (ws.ttsPendingSentences.length > 0 && ws.connectionActive) {
      processNextTTS(ws);
    } else {
      ws.processingTTS = false;
    }
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error processing TTS queue: ${error.message}`);
    ws.processingTTS = false;
    ws.ttsPendingSentences.length = 0; // Clear queue on error to avoid deadlock
    
    // Attempt to send error to client
    sendToClient(ws, createMessage('error', 'TTS processing error', { details: error.message }));
  }
}

/**
 * Initialize conversation history for a connection
 * @param {WebSocket} ws - WebSocket connection
 */
function initConversationHistory(ws) {
  if (!ws.conversationHistory) {
    ws.conversationHistory = [{
      role: "system",
      content: "You are an intelligent voice assistant named Xiao Rui. Please respond in a conversational, concise way. Avoid using emoji or special characters."
    }];
  }
}

/**
 * Add message to conversation history
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} role - Message role (user/assistant)
 * @param {string} content - Message content
 */
function addToConversationHistory(ws, role, content) {
  initConversationHistory(ws);
  
  ws.conversationHistory.push({
    role: role,
    content: content
  });
  
  // Maintain maximum history size
  if (ws.conversationHistory.length > MAX_CONVERSATION_HISTORY + 1) { // +1 for system message
    // Remove the oldest non-system message
    ws.conversationHistory.splice(1, 1);
  }
}

/**
 * Process streaming LLM response
 * @param {WebSocket} ws - WebSocket connection
 * @param {AsyncIterable} stream - OpenAI stream response
 * @returns {Promise<string>} Full response from LLM
 */
async function processLLMStream(ws, stream) {
  let fullResponse = '';
  let currentSentence = '';
  let firstTokenTime = null;
  const startTime = Date.now();
  
  try {
    // Save stream reference for potential cancellation
    ws.llmStream = stream;
    
    for await (const chunk of stream) {
      // Check if response was cancelled
      if (!ws.llmStream || !ws.connectionActive) {
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
        sendToClient(ws, createMessage('llmResponse', fullResponse));
        
        // Check for sentence end punctuation
        if (config.patterns.sentenceEnd.test(content)) {
          // Add sentence to TTS queue and process
          ws.ttsPendingSentences.push(currentSentence);
          if (ws.ttsPendingSentences.length === 1 && !ws.processingTTS) {
            processNextTTS(ws);
          }
          currentSentence = '';
        }
      }
    }
    
    // Handle last incomplete sentence
    if (currentSentence.trim()) {
      ws.ttsPendingSentences.push(currentSentence);
      if (ws.ttsPendingSentences.length === 1 && !ws.processingTTS) {
        processNextTTS(ws);
      }
    }
    
    return fullResponse;
  } finally {
    // Clear stream reference when done or on error
    ws.llmStream = null;
  }
}

/**
 * Call language model to process user input
 * @param {string} text - User input text
 * @param {WebSocket} ws - WebSocket connection
 */
export async function callLLM(text, ws) {
  if (!text || !ws || !ws.connectionActive) return;
  
  // Track performance
  const startTime = Date.now();
  
  try {
    const truncatedText = text.length > 50 ? `${text.substring(0, 50)}...` : text;
    logger.llm.info(`[${ws.connectionId}] Processing user query: "${truncatedText}"`);
    
    // Cancel ongoing activities
    cancelOngoingActivities(ws, false);
    
    // Initialize queue if needed
    if (!ws.ttsPendingSentences) {
      ws.ttsPendingSentences = [];
    }
    
    // Initialize and update conversation history
    initConversationHistory(ws);
    addToConversationHistory(ws, "user", text);
    
    // Call OpenAI API with streaming response
    const stream = await openai.chat.completions.create({
      model: config.openai.model,
      messages: [...ws.conversationHistory],
      stream: true,
      temperature: 0.7,
      max_tokens: 300,
    });

    // Process stream response
    const fullResponse = await processLLMStream(ws, stream);

    // Save assistant response to conversation history
    if (fullResponse) {
      addToConversationHistory(ws, "assistant", fullResponse);
    }
    
    logger.llm.info(`[${ws.connectionId}] LLM response completed in ${Date.now() - startTime}ms`);
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.llm.info(`[${ws.connectionId}] LLM response cancelled`);
      return;
    }
    
    logger.error(`[${ws.connectionId}] Error calling LLM: ${error.message}`);
    
    sendToClient(ws, createMessage('error', 'Error calling language model', {
      details: process.env.NODE_ENV === 'development' ? error.message : 'Service unavailable'
    }));
  }
}

/**
 * Get conversation history for a connection
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Array} Conversation history
 */
export function getConversationHistory(ws) {
  initConversationHistory(ws);
  return ws.conversationHistory;
}

/**
 * Clear conversation history for a connection
 * @param {WebSocket} ws - WebSocket connection
 */
export function clearConversationHistory(ws) {
  // Keep system message
  const systemMessage = ws.conversationHistory?.[0];
  ws.conversationHistory = systemMessage ? [systemMessage] : null;
  
  sendToClient(ws, createMessage('conversationCleared', true));
} 