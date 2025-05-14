/**
 * WebSocket client module
 * Responsible for server communication and connection management
 */
import SignalHandler from './signal-handler.js';
import ConnectionConfig from './connection-config.js';

class WebSocketClient {
    /**
     * Initialize WebSocket client with event handlers
     * 
     * @param {Object} handlers - Event handlers
     * @param {Function} handlers.onOpen - Connection open handler
     * @param {Function} handlers.onClose - Connection close handler
     * @param {Function} handlers.onError - Error handler
     * @param {Function} handlers.onAudioData - Audio data handler
     * @param {Function} handlers.onTranscription - Final transcription handler
     * @param {Function} handlers.onPartialTranscription - Partial transcription handler
     * @param {Function} handlers.onAIResponse - AI response handler
     * @param {Function} handlers.onInterrupt - Interrupt signal handler
     * @param {Function} handlers.onServerError - Server error handler
     */
    constructor(handlers = {}) {
        this.websocket = null;
        this.handlers = handlers;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = ConnectionConfig.CONNECTION.MAX_RECONNECT_ATTEMPTS;
        this.reconnectTimeout = null;
        this.signalHandler = new SignalHandler(handlers);
    }

    /**
     * Initialize WebSocket connection
     * @returns {Promise<void>} Promise that resolves when connection is established
     */
    connect() {
        return new Promise((resolve, reject) => {
            this._closeExistingConnection();
            
            // Get WebSocket URL from configuration
            const wsUrl = ConnectionConfig.getWebSocketUrl();
            
            this.websocket = new WebSocket(wsUrl);
            
            const connectionTimeout = setTimeout(() => {
                if (this.websocket && this.websocket.readyState !== WebSocket.OPEN) {
                    reject(new Error('Connection timeout'));
                    this.websocket.close();
                }
            }, ConnectionConfig.CONNECTION.TIMEOUT);
            
            this._setupEventHandlers(connectionTimeout, resolve, reject);
        });
    }
    
    /**
     * Set up WebSocket event handlers
     * @private
     * @param {number} connectionTimeout - Timeout ID
     * @param {Function} resolve - Promise resolve function
     * @param {Function} reject - Promise reject function
     */
    _setupEventHandlers(connectionTimeout, resolve, reject) {
        this.websocket.onopen = () => {
            clearTimeout(connectionTimeout);
            this.reconnectAttempts = 0;
            if (this.handlers.onOpen) this.handlers.onOpen();
            resolve();
        };

        this.websocket.onmessage = (event) => this.signalHandler.processMessage(event);

        this.websocket.onclose = () => {
            clearTimeout(connectionTimeout);
            if (this.handlers.onClose) this.handlers.onClose();
            this._scheduleReconnect();
        };

        this.websocket.onerror = (error) => {
            clearTimeout(connectionTimeout);
            if (this.handlers.onError) this.handlers.onError(error);
            reject(error);
        };
    }
    
    /**
     * Close existing connection if any
     * @private
     */
    _closeExistingConnection() {
        if (this.websocket) {
            this.websocket.close();
        }
    }

    /**
     * Send data through the WebSocket
     * @param {*} data - Data to send
     * @returns {boolean} - Whether the data was sent
     */
    send(data) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(data);
            return true;
        }
        return false;
    }

    /**
     * Close the WebSocket connection
     */
    close() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }

    /**
     * Check if WebSocket is connected
     * @returns {boolean} True if connected
     */
    isConnected() {
        return this.websocket && this.websocket.readyState === WebSocket.OPEN;
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     * @private
     */
    _scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
        
        const delay = Math.min(
            ConnectionConfig.CONNECTION.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
            ConnectionConfig.CONNECTION.MAX_RECONNECT_DELAY
        );
        
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectAttempts++;
            this.connect().catch(() => {});
        }, delay);
    }
}

export default WebSocketClient; 