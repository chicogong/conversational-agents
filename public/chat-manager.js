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
        
        // If it's a new conversation round or there's no current message ID
        if (!messageId || (!isPartial && isUser)) {
            this.messageCounter++;
            messageId = `msg-${messageType}-${this.messageCounter}`;
            
            if (isUser) {
                this.currentUserMessageId = messageId;
                // A new user message means a new conversation round, clear AI message ID
                this.currentAIMessageId = null;
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
            
            // Add avatar if it's an AI message
            if (!isUser) {
                const avatarDiv = document.createElement('div');
                avatarDiv.className = 'message-avatar';
                avatarDiv.innerHTML = '<i class="fas fa-robot"></i>';
                messageDiv.appendChild(avatarDiv);
            }
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = text;
            
            messageDiv.appendChild(contentDiv);
            
            // Add timestamp
            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'message-timestamp';
            const now = new Date();
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
        console.log('[ASR] Partial recognition result:', text);
        this.updateMessage(text, true, true);
    }
    
    /**
     * Handle final speech recognition results
     * @param {string} text - Recognized text
     */
    handleFinalTranscription(text) {
        console.log('[ASR] Final recognition result:', text);
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
            const dot = document.createElement('span');
            indicator.appendChild(dot);
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
        if (indicator) {
            indicator.remove();
        }
    }
    
    /**
     * Scroll chat to bottom
     */
    scrollToBottom() {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
}

export default ChatManager; 