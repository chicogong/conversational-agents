/**
 * Chat UI manager
 */
class ChatManager {
    constructor(chatContainerId) {
        this.chatContainer = document.getElementById(chatContainerId);
        this.messageCounter = 0;
        this.isTyping = false;
        
        // Track current message bubbles
        this.partialBubbleId = null;   // ID for user partial messages
        this.currentAIBubbleId = null; // ID for current AI response (may be updated)
        this.lastUserBubbleId = null;  // ID for last complete user message
    }

    /**
     * Create a new message bubble
     * @param {string} text - Message text
     * @param {boolean} isUser - Whether the message is from the user
     * @param {boolean} isPartial - Whether the message is a partial result
     * @returns {string} Generated bubble ID
     */
    createBubble(text, isUser, isPartial) {
        const bubbleType = isUser ? 'user' : 'ai';
        this.messageCounter++;
        const bubbleId = `msg-${bubbleType}-${this.messageCounter}`;
        
        const bubbleDiv = document.createElement('div');
        bubbleDiv.id = bubbleId;
        bubbleDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        
        if (isPartial) {
            bubbleDiv.classList.add('partial-message');
            this.partialBubbleId = bubbleId;
        } else if (isUser) {
            this.lastUserBubbleId = bubbleId;
            this.partialBubbleId = null; // Clear partial bubble reference
        } else {
            // For AI responses
            this.currentAIBubbleId = bubbleId;
        }
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        
        bubbleDiv.appendChild(contentDiv);
        this.chatContainer.appendChild(bubbleDiv);
        
        return bubbleId;
    }
    
    /**
     * Update an existing bubble
     * @param {string} bubbleId - Bubble ID to update
     * @param {string} text - New message text
     * @param {boolean} isPartial - Whether it's still a partial message
     * @returns {boolean} Success status
     */
    updateBubble(bubbleId, text, isPartial) {
        const bubbleDiv = document.getElementById(bubbleId);
        if (!bubbleDiv) return false;
        
        const contentDiv = bubbleDiv.querySelector('.message-content');
        if (!contentDiv) return false;
        
        contentDiv.textContent = text;
        
        if (isPartial) {
            bubbleDiv.classList.add('partial-message');
        } else {
            bubbleDiv.classList.remove('partial-message');
            // Only clear partial if it's a user message
            if (bubbleDiv.classList.contains('user-message')) {
                this.partialBubbleId = null;
            }
        }
        
        return true;
    }
    
    /**
     * Handle partial speech recognition results
     * @param {string} text - Recognized text
     */
    handlePartialTranscription(text) {
        if (this.partialBubbleId) {
            // Update existing partial bubble
            this.updateBubble(this.partialBubbleId, text, true);
        } else {
            // Create new partial bubble
            this.createBubble(text, true, true);
        }
        this.scrollToBottom();
    }
    
    /**
     * Handle final speech recognition results
     * @param {string} text - Recognized text
     */
    handleFinalTranscription(text) {
        if (this.partialBubbleId) {
            // Convert partial bubble to final
            const updated = this.updateBubble(this.partialBubbleId, text, false);
            if (updated) {
                this.lastUserBubbleId = this.partialBubbleId;
                this.partialBubbleId = null;
            } else {
                // If update failed, create new bubble
                this.createBubble(text, true, false);
            }
        } else {
            // Create new final bubble
            this.createBubble(text, true, false);
        }
        
        // Reset AI bubble when user sends a new message
        this.currentAIBubbleId = null;
        
        this.scrollToBottom();
    }
    
    /**
     * Handle AI responses
     * @param {string} text - Response text
     */
    handleAIResponse(text) {
        if (this.currentAIBubbleId) {
            // Update existing AI bubble
            this.updateBubble(this.currentAIBubbleId, text, false);
        } else {
            // Create new AI bubble
            this.createBubble(text, false, false);
        }
        this.scrollToBottom();
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