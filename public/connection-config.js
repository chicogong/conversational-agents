/**
 * Connection configuration for the WebSocket client
 */
const ConnectionConfig = {
    // Connection settings
    CONNECTION: {
        TIMEOUT: 5000,
        MAX_RECONNECT_ATTEMPTS: 5,
        RECONNECT_BASE_DELAY: 1000,
        MAX_RECONNECT_DELAY: 30000
    },
    
    // Audio settings
    AUDIO: {
        SAMPLE_RATE: 16000,
        CHANNELS: 1,
        PROCESS_INTERVAL: 100,
        BUFFER_SIZE: 4096
    },
    
    /**
     * Get WebSocket URL based on current location
     * @returns {string} WebSocket URL
     */
    getWebSocketUrl() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProtocol}//${window.location.host}`;
    }
};

export default ConnectionConfig; 