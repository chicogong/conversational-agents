import WebSocketClient from './websocket-client.js';
import AudioHandler from './audio-handler.js';
import ChatManager from './chat-manager.js';

/**
 * Main application class for conversational AI app
 */
class ConversationalApp {
    /**
     * Initialize the application
     */
    constructor() {
        this.initializeUI();
        this.initializeManagers();
        this.bindEventHandlers();
        this.init();
    }
    
    /**
     * Initialize UI elements
     */
    initializeUI() {
        this.elements = {
            startButton: document.getElementById('startButton'),
            stopButton: document.getElementById('stopButton'),
            statusElement: document.getElementById('status'),
            chatContainer: document.getElementById('chatContainer'),
            welcomeMessage: document.querySelector('.welcome-card')
        };
        
        if (!this.elements.startButton || !this.elements.stopButton || 
            !this.elements.statusElement || !this.elements.chatContainer) {
            console.error('[Error] Required UI elements not found');
        }
    }
    
    /**
     * Initialize manager objects
     */
    initializeManagers() {
        this.chatManager = new ChatManager('chatContainer');
        this.webSocketClient = null;
        this.audioHandler = null;
    }
    
    /**
     * Bind event handlers
     */
    bindEventHandlers() {
        this.elements.startButton.addEventListener('click', () => this.startConversation());
        this.elements.stopButton.addEventListener('click', () => this.stopConversation());
    }
    
    /**
     * Initialize the application
     */
    async init() {
        this.updateStatus('连接中...');
        this.disableButtons();
        
        try {
            await this.initWebSocket();
            this.enableStartButton();
        } catch (error) {
            console.error('[Error] Failed to initialize:', error);
            this.updateStatus('连接失败，请刷新页面重试');
        }
    }
    
    /**
     * Initialize WebSocket connection
     */
    async initWebSocket() {
        const handlers = {
            onOpen: () => {
                this.updateStatus('已连接');
                this.enableStartButton();
            },
            onClose: () => {
                this.updateStatus('已断开连接');
                this.disableButtons();
                this.stopConversation();
            },
            onError: () => {
                this.updateStatus('连接错误，请刷新页面');
                this.disableButtons();
            },
            onAudioData: (data) => {
                if (this.audioHandler) this.audioHandler.addToAudioQueue(data);
            },
            onTranscription: (text) => {
                this.hideWelcomeMessage();
                this.chatManager.handleFinalTranscription(text);
            },
            onPartialTranscription: (text) => {
                this.hideWelcomeMessage();
                this.chatManager.handlePartialTranscription(text);
            },
            onAIResponse: (text) => {
                this.chatManager.handleAIResponse(text);
            },
            onInterrupt: () => {
                if (this.audioHandler) this.audioHandler.handleInterruption();
                this.updateStatusWithIndicator('正在聆听...');
            },
            onServerError: (error) => {
                this.chatManager.hideTypingIndicator();
                this.chatManager.handleAIResponse(`错误: ${error}`);
                console.error('[Server Error]', error);
            }
        };
        
        this.webSocketClient = new WebSocketClient(handlers);
        await this.webSocketClient.connect();
        this.audioHandler = new AudioHandler(this.webSocketClient.websocket);
    }
    
    /**
     * Start conversation with voice
     */
    async startConversation() {
        try {
            // Ensure connection is active
            if (!this.webSocketClient || !this.webSocketClient.isConnected()) {
                this.updateStatus('重新连接中...');
                await this.initWebSocket();
            }
            
            // Start audio streaming
            await this.audioHandler.startStreamingConversation();
            
            // Update UI
            this.elements.startButton.disabled = true;
            this.elements.stopButton.disabled = false;
            this.updateStatusWithIndicator('正在聆听...');
            this.hideWelcomeMessage();
        } catch (error) {
            console.error('[Error] Failed to start conversation:', error);
            this.updateStatus(`无法访问麦克风: ${error.message}`);
        }
    }
    
    /**
     * Stop conversation
     */
    stopConversation() {
        if (this.audioHandler) {
            this.audioHandler.stopStreamingConversation();
        }
        
        this.elements.startButton.disabled = false;
        this.elements.stopButton.disabled = true;
        this.updateStatus('对话已结束');
    }
    
    /**
     * Hide welcome message when conversation starts
     */
    hideWelcomeMessage() {
        if (this.elements.welcomeMessage && this.elements.welcomeMessage.parentNode) {
            this.elements.welcomeMessage.style.display = 'none';
        }
    }
    
    /**
     * Update status element
     * @param {string} message - Status message
     */
    updateStatus(message) {
        this.elements.statusElement.textContent = message;
    }
    
    /**
     * Update status with recording indicator
     * @param {string} message - Status message
     */
    updateStatusWithIndicator(message) {
        this.elements.statusElement.innerHTML = `<span class="recording-indicator"></span>${message}`;
    }
    
    /**
     * Enable start button
     */
    enableStartButton() {
        this.elements.startButton.disabled = false;
        this.elements.stopButton.disabled = true;
    }
    
    /**
     * Disable all buttons
     */
    disableButtons() {
        this.elements.startButton.disabled = true;
        this.elements.stopButton.disabled = true;
    }
}

// Initialize the app when the page is loaded
window.addEventListener('DOMContentLoaded', () => {
    new ConversationalApp();
}); 