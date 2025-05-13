/**
 * Chat UI manager
 */
class ChatManager {
    constructor(chatContainerId) {
        this.chatContainer = document.getElementById(chatContainerId);
        this.currentUserMessageId = null;
        this.currentAIMessageId = null;
        this.messageCounter = 0;
        this.isTyping = false;
    }

    /**
     * Create or update message in the chat
     * @param {string} text - Message text
     * @param {boolean} isUser - Whether the message is from the user
     * @param {boolean} isPartial - Whether the message is a partial result
     * @returns {string} Message ID
     */
    updateMessage(text, isUser = false, isPartial = false) {
        const messageType = isUser ? 'user' : 'ai';
        let messageId = isUser ? this.currentUserMessageId : this.currentAIMessageId;
        
        // Only create a new message if there's no existing message ID or it's a new AI response
        if (!messageId || (!isUser && this.currentAIMessageId === null)) {
            this.messageCounter++;
            messageId = `msg-${messageType}-${this.messageCounter}`;
            
            if (isUser) {
                this.currentUserMessageId = messageId;
                // Only clear AI message when creating a new user message that isn't partial
                if (!isPartial) {
                    this.currentAIMessageId = null;
                }
            } else {
                this.currentAIMessageId = messageId;
            }
            
            // Create new message element
            const messageDiv = document.createElement('div');
            messageDiv.id = messageId;
            messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
            
            if (isPartial) {
                messageDiv.classList.add('partial-message');
            }
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = text;
            
            messageDiv.appendChild(contentDiv);
            
            // Add timestamp
            const now = new Date();
            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'message-timestamp';
            timestampDiv.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            messageDiv.appendChild(timestampDiv);
            
            this.chatContainer.appendChild(messageDiv);
        } else {
            // Update existing message
            const messageDiv = document.getElementById(messageId);
            
            if (messageDiv) {
                const contentDiv = messageDiv.querySelector('.message-content');
                
                if (contentDiv) {
                    contentDiv.textContent = text;
                    
                    // Update style (if needed)
                    if (isPartial) {
                        messageDiv.classList.add('partial-message');
                    } else {
                        messageDiv.classList.remove('partial-message');
                    }
                }
            }
        }
        
        // Scroll to bottom
        this.scrollToBottom();
        
        return messageId;
    }
    
    /**
     * Handle partial speech recognition results
     * @param {string} text - Recognized text
     */
    handlePartialTranscription(text) {
        this.updateMessage(text, true, true);
    }
    
    /**
     * Handle final speech recognition results
     * @param {string} text - Recognized text
     */
    handleFinalTranscription(text) {
        this.updateMessage(text, true, false);
    }
    
    /**
     * Handle AI responses
     * @param {string} text - Response text
     */
    handleAIResponse(text) {
        this.updateMessage(text, false, false);
    }
    
    /**
     * Show typing indicator
     */
    showTypingIndicator() {
        if (this.isTyping) return;
        
        this.isTyping = true;
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'typingIndicator';
        
        for (let i = 0; i < 3; i++) {
            indicator.appendChild(document.createElement('span'));
        }
        
        this.chatContainer.appendChild(indicator);
        this.scrollToBottom();
    }
    
    /**
     * Hide typing indicator
     */
    hideTypingIndicator() {
        this.isTyping = false;
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    }
    
    /**
     * Scroll chat to bottom
     */
    scrollToBottom() {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
}

export default ChatManager; 