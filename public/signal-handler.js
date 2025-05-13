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
            
            // Determine message type from the data structure
            let messageType = this._getMessageType(data);
            
            // Get payload (either from payload field or legacy field)
            const payload = this._getPayload(data, messageType);
            
            // Process based on message type
            switch (messageType) {
                case 'transcription':
                    if (this.handlers.onTranscription) {
                        this.handlers.onTranscription(payload);
                    }
                    break;
                
                case 'partialTranscription':
                    if (this.handlers.onPartialTranscription) {
                        this.handlers.onPartialTranscription(payload);
                    }
                    break;
                
                case 'llmResponse':
                    if (this.handlers.onAIResponse) {
                        this.handlers.onAIResponse(payload);
                    }
                    break;
                
                case 'interrupt':
                    if (this.handlers.onInterrupt) {
                        this.handlers.onInterrupt();
                    }
                    break;
                
                case 'error':
                    if (this.handlers.onServerError) {
                        this.handlers.onServerError(payload);
                    }
                    break;
                
                case 'status':
                    // Handle status messages
                    console.log(`[Status] ${data.message || 'Server status update'}`);
                    break;
                    
                default:
                    // Unknown message type
                    console.log('[Info] Received unknown message type:', data);
                    break;
            }
        } catch (error) {
            console.error('[Error] Failed to parse server message:', error);
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
        if (data.transcription) return 'transcription';
        if (data.partialTranscription) return 'partialTranscription';
        if (data.llmResponse) return 'llmResponse';
        if (data.interrupt) return 'interrupt';
        if (data.error) return 'error';
        if (data.status) return 'status';
        
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
            case 'transcription': return data.transcription;
            case 'partialTranscription': return data.partialTranscription;
            case 'llmResponse': return data.llmResponse;
            case 'error': return data.error;
            case 'status': return data.status;
            default: return null;
        }
    }
}

export default SignalHandler; 