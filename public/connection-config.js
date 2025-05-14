/**
 * Connection configuration for the WebSocket client
 * Contains all configurable parameters for the application's connections
 */
const ConnectionConfig = {
    // Connection settings
    CONNECTION: {
        TIMEOUT: 5000,           // Connection timeout in milliseconds
        MAX_RECONNECT_ATTEMPTS: 5, // Maximum number of reconnection attempts
        RECONNECT_BASE_DELAY: 1000, // Base delay for exponential backoff
        MAX_RECONNECT_DELAY: 30000  // Maximum reconnection delay
    },
    
    // Audio settings
    AUDIO: {
        SAMPLE_RATE: 16000,      // Audio sample rate in Hz
        CHANNELS: 1,             // Number of audio channels (1 = mono)
        PROCESS_INTERVAL: 100,   // Audio processing interval in milliseconds
        BUFFER_SIZE: 4096        // Audio buffer size
    },
    
    /**
     * Get WebSocket URL based on current location
     * Automatically switches between ws:// and wss:// based on the page protocol
     * 
     * @returns {string} WebSocket URL
     */
    getWebSocketUrl() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProtocol}//${window.location.host}`;
    }
};

export default ConnectionConfig; 