import WebSocketClient from './websocket-client.js';
import AudioHandler from './audio-handler.js';
import ChatManager from './chat-manager.js';

/**
 * Main application class
 */
class ConversationalApp {
    constructor() {
        // DOM elements
        this.startButton = document.getElementById('startButton');
        this.stopButton = document.getElementById('stopButton');
        this.statusElement = document.getElementById('status');
        this.chatContainer = document.getElementById('chatContainer');
        this.welcomeMessage = document.querySelector('.welcome-message');
        
        // Initialize managers
        this.chatManager = new ChatManager('chatContainer');
        this.webSocketClient = null;
        this.audioHandler = null;
        
        // Bind event handlers
        this.startButton.addEventListener('click', () => this.startConversation());
        this.stopButton.addEventListener('click', () => this.stopConversation());
        
        // Initialize the app
        this.init();
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
        this.webSocketClient = new WebSocketClient({
            onOpen: () => {
                this.updateStatus('已连接');
                this.enableStartButton();
            },
            onClose: () => {
                this.updateStatus('已断开连接');
                this.disableButtons();
                this.stopConversation();
            },
            onError: (error) => {
                console.error('[Error] WebSocket error:', error);
                this.updateStatus('连接错误，请刷新页面');
                this.disableButtons();
            },
            onAudioData: (data) => {
                if (this.audioHandler) {
                    this.audioHandler.addToAudioQueue(data);
                }
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
                this.chatManager.hideTypingIndicator();
                this.chatManager.handleAIResponse(text);
            },
            onInterrupt: () => {
                if (this.audioHandler) {
                    this.audioHandler.handleInterruption();
                }
                this.chatManager.hideTypingIndicator();
                this.updateStatusWithIndicator('正在聆听...');
            },
            onServerError: (error) => {
                this.chatManager.hideTypingIndicator();
                this.chatManager.handleAIResponse(`错误: ${error}`);
                console.error('[Server Error]', error);
            },
            onServerStatus: (message) => {
                console.log('[Server Status]', message);
            }
        });
        
        await this.webSocketClient.connect();
        this.audioHandler = new AudioHandler(this.webSocketClient.websocket);
    }
    
    /**
     * Hide welcome message when conversation starts
     */
    hideWelcomeMessage() {
        if (this.welcomeMessage && this.welcomeMessage.parentNode) {
            this.welcomeMessage.style.display = 'none';
        }
    }
    
    /**
     * Start streaming conversation
     */
    async startConversation() {
        try {
            if (!this.webSocketClient || !this.webSocketClient.isConnected()) {
                this.updateStatus('重新连接中...');
                await this.initWebSocket();
            }
            
            await this.audioHandler.startStreamingConversation();
            this.startButton.disabled = true;
            this.stopButton.disabled = false;
            this.updateStatusWithIndicator('正在聆听...');
            this.chatManager.showTypingIndicator();
            this.hideWelcomeMessage();
        } catch (error) {
            console.error('[Error] Failed to start conversation:', error);
            this.updateStatus(`无法访问麦克风: ${error.message}`);
        }
    }
    
    /**
     * Stop streaming conversation
     */
    stopConversation() {
        if (this.audioHandler) {
            this.audioHandler.stopStreamingConversation();
        }
        
        this.startButton.disabled = false;
        this.stopButton.disabled = true;
        this.updateStatus('对话已结束');
        this.chatManager.hideTypingIndicator();
    }
    
    /**
     * Update status element
     * @param {string} message - Status message
     */
    updateStatus(message) {
        this.statusElement.textContent = message;
    }
    
    /**
     * Update status with recording indicator
     * @param {string} message - Status message
     */
    updateStatusWithIndicator(message) {
        this.statusElement.innerHTML = `<span class="recording-indicator"></span>${message}`;
    }
    
    /**
     * Enable start button
     */
    enableStartButton() {
        this.startButton.disabled = false;
        this.stopButton.disabled = true;
    }
    
    /**
     * Disable all buttons
     */
    disableButtons() {
        this.startButton.disabled = true;
        this.stopButton.disabled = true;
    }
}

// Initialize the app when the page is loaded
window.addEventListener('DOMContentLoaded', () => {
    new ConversationalApp();
}); 