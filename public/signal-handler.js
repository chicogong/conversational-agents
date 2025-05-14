/**
 * Message types for WebSocket communication
 * @enum {string}
 */
const MessageType = {
    TRANSCRIPTION: 'transcription',
    PARTIAL_TRANSCRIPTION: 'partialTranscription',
    LLM_RESPONSE: 'llmResponse',
    INTERRUPT: 'interrupt',
    ERROR: 'error',
    STATUS: 'status'
};

/**
 * Signal handler for processing WebSocket messages
 */
class SignalHandler {
    /**
     * @param {Object} handlers - Event handlers
     * @param {Function} handlers.onAudioData - Audio data handler
     * @param {Function} handlers.onTranscription - Final transcription handler
     * @param {Function} handlers.onPartialTranscription - Partial transcription handler
     * @param {Function} handlers.onAIResponse - AI response handler
     * @param {Function} handlers.onInterrupt - Interrupt signal handler
     * @param {Function} handlers.onServerError - Server error handler
     */
    constructor(handlers = {}) {
        this.handlers = handlers;
    }

    /**
     * Process incoming WebSocket message
     * @param {MessageEvent} event - WebSocket message event
     * @returns {void}
     */
    processMessage(event) {
        // Handle binary data (audio)
        if (event.data instanceof Blob) {
            if (this.handlers.onAudioData) {
                this.handlers.onAudioData(event.data);
            }
            return;
        }
        
        // Handle JSON messages
        try {
            const data = JSON.parse(event.data);
            const messageType = this._getMessageType(data);
            const payload = this._getPayload(data, messageType);
            
            this._dispatchMessage(messageType, payload);
        } catch (error) {
            console.error('[Error] Failed to parse server message:', error);
        }
    }

    /**
     * Dispatch message to appropriate handler
     * @param {string} type - Message type
     * @param {*} payload - Message payload
     * @private
     */
    _dispatchMessage(type, payload) {
        switch (type) {
            case MessageType.TRANSCRIPTION:
                if (this.handlers.onTranscription) {
                    this.handlers.onTranscription(payload);
                }
                break;
                
            case MessageType.PARTIAL_TRANSCRIPTION:
                if (this.handlers.onPartialTranscription) {
                    this.handlers.onPartialTranscription(payload);
                }
                break;
                
            case MessageType.LLM_RESPONSE:
                if (this.handlers.onAIResponse) {
                    this.handlers.onAIResponse(payload);
                }
                break;
                
            case MessageType.INTERRUPT:
                if (this.handlers.onInterrupt) {
                    this.handlers.onInterrupt();
                }
                break;
                
            case MessageType.ERROR:
                if (this.handlers.onServerError) {
                    this.handlers.onServerError(payload);
                }
                break;
                
            case MessageType.STATUS:
                console.log(`[Status] ${payload || 'Server status update'}`);
                break;
                
            default:
                console.log('[Info] Received unknown message type:', type);
                break;
        }
    }

    /**
     * Determine message type from the data structure
     * @param {Object} data - Message data
     * @returns {string} Message type
     * @private
     */
    _getMessageType(data) {
        // If data.type exists, use it directly
        if (data.type) return data.type;
        
        // For backward compatibility, determine type from properties
        if (data.transcription) return MessageType.TRANSCRIPTION;
        if (data.partialTranscription) return MessageType.PARTIAL_TRANSCRIPTION;
        if (data.llmResponse) return MessageType.LLM_RESPONSE;
        if (data.interrupt) return MessageType.INTERRUPT;
        if (data.error) return MessageType.ERROR;
        if (data.status) return MessageType.STATUS;
        
        return 'unknown';
    }
    
    /**
     * Get payload from either new format or legacy format
     * @param {Object} data - Message data
     * @param {string} type - Message type
     * @returns {*} Payload data
     * @private
     */
    _getPayload(data, type) {
        // Use payload field if available
        if (data.payload !== undefined) return data.payload;
        
        // Legacy format - extract from type-specific field
        switch (type) {
            case MessageType.TRANSCRIPTION: return data.transcription;
            case MessageType.PARTIAL_TRANSCRIPTION: return data.partialTranscription;
            case MessageType.LLM_RESPONSE: return data.llmResponse;
            case MessageType.ERROR: return data.error;
            case MessageType.STATUS: return data.status;
            default: return null;
        }
    }
}

export default SignalHandler; 