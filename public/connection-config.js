/**
 * Connection configuration for the WebSocket client
 */
const ConnectionConfig = {
    /**
     * Connection timeout in milliseconds
     */
    CONNECTION_TIMEOUT: 5000,
    
    /**
     * Maximum number of reconnection attempts
     */
    MAX_RECONNECT_ATTEMPTS: 5,
    
    /**
     * Base delay for exponential backoff in milliseconds
     */
    RECONNECT_BASE_DELAY: 1000,
    
    /**
     * Maximum delay for reconnection in milliseconds
     */
    MAX_RECONNECT_DELAY: 30000,
    
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