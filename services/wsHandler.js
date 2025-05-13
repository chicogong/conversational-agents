import { WebSocket } from 'ws';
import logger from './logger.js';
import { asrService } from './asrService.js';
import { ttsService } from './ttsService.js';
import { llmService } from './llmService.js';

// Track active connections for monitoring
const activeConnections = new Set();

/**
 * Creates a typed message object with standardized format
 * @param {string} type - Message type
 * @param {*} payload - Message payload
 * @param {Object} additionalFields - Additional fields to include
 * @returns {Object} - Standardized message object
 */
export function createMessage(type, payload = null, additionalFields = {}) {
  const message = {
    type,
    ...additionalFields
  };
  
  if (payload !== null) {
    message.payload = payload;
  }
  
  return message;
}

/**
 * Send data to WebSocket client
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} data - Data to send
 */
export function sendToClient(ws, data) {
  if (!ws || !ws.connectionActive) return;
  
  try {
    ws.send(JSON.stringify(data));
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error sending data to client: ${error.message}`);
  }
}

/**
 * Initialize client state with default values
 * @param {WebSocket} ws - WebSocket connection
 */
function initializeClientState(ws) {
  ws.ttsPendingSentences = [];
  ws.processingTTS = false;
  ws.isUserSpeaking = false;
  ws.connectionActive = true;
  ws.connectionId = generateConnectionId();
  ws.context = {
    // Shared context object for all services
    llm: {
      conversationHistory: null,
      stream: null
    },
    speech: {
      recognizer: null,
      pushStream: null,
      audioConfig: null,
      synthesizer: null
    }
  };
}

/**
 * Generate a unique connection ID
 * @returns {string} Unique connection ID
 */
function generateConnectionId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Process incoming audio data
 * @param {Buffer} data - Audio data buffer
 * @param {WebSocket} ws - WebSocket connection
 * @returns {boolean} - Whether processing was successful
 */
async function processAudioData(data, ws) {
  try {
    if (!data || data.length === 0 || !ws.connectionActive) return false;
    
    const buffer = Buffer.from(data);
    
    // Process audio via ASR Service
    return asrService.processAudioData(buffer, ws);
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error processing audio data: ${error.message}`);
    return false;
  }
}

/**
 * Clean up resources
 * @param {WebSocket} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function cleanupResources(ws) {
  try {
    // Mark connection as closed
    ws.connectionActive = false;
    
    // Remove from active connections
    activeConnections.delete(ws);
    logger.ws.debug(`Connection closed. Active connections: ${activeConnections.size}`);
    
    // Clean up ASR resources
    await asrService.cleanup(ws);
    
    // Clean up TTS resources
    ttsService.cleanup(ws);
    
    // Clean up LLM resources
    llmService.cleanup(ws);
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error cleaning up resources: ${error.message}`);
  }
}

/**
 * Set up heartbeat mechanism for WebSocket connection
 * @param {WebSocket} ws - WebSocket connection
 */
function setupHeartbeat(ws) {
  // Set up ping interval to detect dead connections
  const pingInterval = setInterval(() => {
    if (!ws || !ws.connectionActive) {
      clearInterval(pingInterval);
      return;
    }
    
    try {
      ws.ping();
    } catch (error) {
      clearInterval(pingInterval);
      ws.terminate();
    }
  }, 30000); // 30 seconds ping interval
  
  // Clean up interval on close
  ws.on('close', () => {
    clearInterval(pingInterval);
  });
}

/**
 * Handle WebSocket client messages
 * @param {WebSocket} ws - WebSocket connection
 * @param {string|Buffer} message - Client message
 */
function handleClientMessage(ws, message) {
  try {
    if (message instanceof Buffer) {
      // Process audio data
      processAudioData(message, ws);
    } else {
      // Process JSON command
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'ping':
          sendToClient(ws, createMessage('pong'));
          break;
          
        case 'clearConversation':
          llmService.clearConversationHistory(ws);
          sendToClient(ws, createMessage('conversationCleared'));
          break;
          
        case 'getConversation':
          const history = llmService.getConversationHistory(ws);
          sendToClient(ws, createMessage('conversationHistory', history));
          break;
          
        case 'textInput':
          if (data.payload && typeof data.payload === 'string') {
            llmService.processUserInput(data.payload, ws);
          }
          break;
          
        case 'startRecognition':
          asrService.startRecognition(ws);
          break;
          
        case 'stopRecognition':
          asrService.stopRecognition(ws);
          break;
          
        default:
          logger.ws.warn(`[${ws.connectionId}] Unknown message type: ${data.type}`);
      }
    }
  } catch (error) {
    logger.error(`[${ws.connectionId}] Error handling client message: ${error.message}`);
  }
}

/**
 * Set up WebSocket event handlers
 * @param {WebSocket} ws - WebSocket connection
 */
function setupWebSocketEvents(ws) {
  // Initialize connection
  initializeClientState(ws);
  setupHeartbeat(ws);
  
  // Add to active connections
  activeConnections.add(ws);
  logger.ws.debug(`Active connections: ${activeConnections.size}`);
  
  // Set up speech recognition
  asrService.setupRecognizer(ws)
    .then(() => {
      logger.speech.info(`[${ws.connectionId}] Speech recognition ready`);
      sendToClient(ws, createMessage('ready'));
    })
    .catch(error => {
      logger.error(`[${ws.connectionId}] Failed to initialize speech recognition: ${error.message}`);
      sendToClient(ws, createMessage('error', 'Failed to initialize speech recognition', { details: error.message }));
    });
  
  // Handle incoming messages
  ws.on('message', (message) => handleClientMessage(ws, message));
  
  // Handle connection close
  ws.on('close', () => {
    logger.ws.info(`[${ws.connectionId}] WebSocket connection closed`);
    cleanupResources(ws);
  });
  
  // Handle connection errors
  ws.on('error', (error) => {
    logger.error(`[${ws.connectionId}] WebSocket error: ${error.message}`);
    cleanupResources(ws);
  });
}

/**
 * Handles a new WebSocket connection
 * @param {WebSocket} ws - WebSocket connection 
 */
export function handleConnection(ws) {
  if (!ws) {
    logger.error('Received null WebSocket connection');
    return;
  }
  
  logger.ws.info('New WebSocket connection established');
  setupWebSocketEvents(ws);
}

/**
 * Cancels all ongoing activities for a connection
 * This is exposed for other services to use
 * @param {WebSocket} ws - WebSocket connection
 * @param {boolean} sendInterrupt - Whether to send interrupt signal to client
 */
export function cancelOngoingActivities(ws, sendInterrupt = true) {
  if (!ws) return;
  
  // Cancel LLM stream
  llmService.cancelActivities(ws);
  
  // Cancel TTS processing
  ttsService.cancelTTS(ws);
  
  // Send interrupt signal to client
  if (sendInterrupt && ws.connectionActive) {
    sendToClient(ws, createMessage('interrupt'));
  }
}

/**
 * Get the current count of active connections
 * @returns {number} Number of active connections
 */
export function getActiveConnectionCount() {
  return activeConnections.size;
}

// Export the WebSocket service
export const wsService = {
  handleConnection,
  sendToClient,
  createMessage,
  cancelOngoingActivities,
  getActiveConnectionCount
}; 