/**
 * WebSocket client for handling server communication
 */
class WebSocketClient {
    /**
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
     * @param {Function} handlers.onServerStatus - Server status handler
     */
    constructor(handlers = {}) {
        this.websocket = null;
        this.handlers = handlers;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectTimeout = null;
    }

    /**
     * Initialize WebSocket connection
     * @returns {Promise<void>}
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (this.websocket) {
                this.websocket.close();
            }
            
            // Use the same protocol and host as the current page
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${window.location.host}`;
            console.log('[WebSocket] Connecting to:', wsUrl);
            
            this.websocket = new WebSocket(wsUrl);
            
            const connectionTimeout = setTimeout(() => {
                if (this.websocket.readyState !== WebSocket.OPEN) {
                    reject(new Error('Connection timeout'));
                    this.websocket.close();
                }
            }, 5000);
            
            this.websocket.onopen = () => {
                console.log('[WebSocket] Connection established');
                clearTimeout(connectionTimeout);
                this.reconnectAttempts = 0;
                
                if (this.handlers.onOpen) {
                    this.handlers.onOpen();
                }
                
                resolve();
            };

            this.websocket.onmessage = (event) => {
                this._handleMessage(event);
            };

            this.websocket.onclose = (event) => {
                console.log('[WebSocket] Connection closed', event.code, event.reason);
                clearTimeout(connectionTimeout);
                
                if (this.handlers.onClose) {
                    this.handlers.onClose();
                }
                
                this._scheduleReconnect();
            };

            this.websocket.onerror = (error) => {
                console.error('[Error] WebSocket error:', error);
                clearTimeout(connectionTimeout);
                
                if (this.handlers.onError) {
                    this.handlers.onError(error);
                }
                
                reject(error);
            };
        });
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
     * @returns {boolean}
     */
    isConnected() {
        return this.websocket && this.websocket.readyState === WebSocket.OPEN;
    }

    /**
     * Handle WebSocket messages
     * @param {MessageEvent} event - WebSocket message event
     * @private
     */
    _handleMessage(event) {
        // Check if the message is binary data (audio)
        if (event.data instanceof Blob) {
            if (this.handlers.onAudioData) {
                this.handlers.onAudioData(event.data);
            }
            return;
        }
        
        // Handle JSON messages
        try {
            const data = JSON.parse(event.data);
            
            if (data.status && this.handlers.onServerStatus) {
                this.handlers.onServerStatus(data.message);
            } else if (data.transcription && this.handlers.onTranscription) {
                this.handlers.onTranscription(data.transcription);
            } else if (data.partialTranscription && this.handlers.onPartialTranscription) {
                this.handlers.onPartialTranscription(data.partialTranscription);
            } else if (data.llmResponse && this.handlers.onAIResponse) {
                this.handlers.onAIResponse(data.llmResponse);
            } else if (data.interrupt && this.handlers.onInterrupt) {
                this.handlers.onInterrupt();
            } else if (data.error && this.handlers.onServerError) {
                this.handlers.onServerError(data.error);
            }
        } catch (error) {
            console.error('[Error] Failed to parse server message:', error, event.data);
        }
    }

    /**
     * Schedule a reconnection attempt
     * @private
     */
    _scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocket] Maximum reconnection attempts reached');
            return;
        }
        
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        console.log(`[WebSocket] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
        
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectAttempts++;
            console.log(`[WebSocket] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            this.connect().catch(error => {
                console.error('[WebSocket] Reconnection failed:', error);
            });
        }, delay);
    }
}

export default WebSocketClient; 