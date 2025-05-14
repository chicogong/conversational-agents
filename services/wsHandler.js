import { WebSocket } from 'ws';
import logger from './logger.js';
import { serviceRegistry } from './serviceRegistry.js';

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
    
    // Process audio via ASR Provider
    return serviceRegistry.getASR().processAudioData(buffer, ws);
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
    await serviceRegistry.getASR().cleanup(ws);
    
    // Clean up TTS resources
    await serviceRegistry.getTTS().cleanup(ws);
    
    // Clean up LLM resources
    await serviceRegistry.getLLM().cleanup(ws);
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
          serviceRegistry.getLLM().clearConversationHistory(ws);
          sendToClient(ws, createMessage('conversationCleared'));
          break;
          
        case 'getConversation':
          const history = serviceRegistry.getLLM().getConversationHistory(ws);
          sendToClient(ws, createMessage('conversationHistory', history));
          break;
          
        case 'textInput':
          if (data.payload && typeof data.payload === 'string') {
            serviceRegistry.getLLM().processUserInput(data.payload, ws);
          }
          break;
          
        case 'startRecognition':
          serviceRegistry.getASR().startRecognition(ws);
          break;
          
        case 'stopRecognition':
          serviceRegistry.getASR().stopRecognition(ws);
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
  // Handle messages
  ws.on('message', (message) => {
    handleClientMessage(ws, message);
  });
  
  // Handle connection close
  ws.on('close', async () => {
    logger.ws.info(`[${ws.connectionId}] WebSocket connection closed`);
    await cleanupResources(ws);
  });
  
  // Handle connection errors
  ws.on('error', async (error) => {
    logger.error(`[${ws.connectionId}] WebSocket error: ${error.message}`);
    await cleanupResources(ws);
  });
  
  // Set up heartbeat mechanism
  setupHeartbeat(ws);
}

/**
 * Handle new WebSocket connections
 * @param {WebSocket} ws - WebSocket connection
 */
export function handleConnection(ws) {
  // Initialize client state
  initializeClientState(ws);
  
  // Add to active connections
  activeConnections.add(ws);
  
  // Set up WebSocket event handlers
  setupWebSocketEvents(ws);
  
  // Log connection
  logger.ws.info(`[${ws.connectionId}] New WebSocket connection established`);
  logger.ws.debug(`Active connections: ${activeConnections.size}`);
  
  // Send welcome message
  sendToClient(ws, createMessage('connected', { 
    id: ws.connectionId, 
    timestamp: Date.now() 
  }));
  
  // 自动启动语音识别
  serviceRegistry.getASR().startRecognition(ws);
}

/**
 * Cancel ongoing activities across all services
 * @param {WebSocket} ws - WebSocket connection
 * @param {boolean} sendInterrupt - Whether to send interrupt signal to client
 */
export function cancelOngoingActivities(ws, sendInterrupt = true) {
  if (!ws || !ws.connectionActive) return;
  
  // Cancel LLM processing
  serviceRegistry.getLLM().cancelActivities(ws);
  
  // Cancel TTS processing
  serviceRegistry.getTTS().cancelTTS(ws);
  
  // Notify client of interruption if needed
  if (sendInterrupt) {
    sendToClient(ws, createMessage('interrupted'));
  }
}

/**
 * Get the number of active WebSocket connections
 * @returns {number} Count of active connections
 */
export function getActiveConnectionCount() {
  return activeConnections.size;
}

// Export websocket service
export const wsService = {
  handleConnection,
  cancelOngoingActivities,
  sendToClient,
  createMessage,
  getActiveConnectionCount
}; 