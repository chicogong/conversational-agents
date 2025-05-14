/**
 * Chat UI manager for handling conversation display
 */
class ChatManager {
    /**
     * @param {string} chatContainerId - ID of the chat container element
     */
    constructor(chatContainerId) {
        this.chatContainer = document.getElementById(chatContainerId);
        this.messageCounter = 0;
        this.isTyping = false;
        
        // Message bubble tracking
        this.bubbles = {
            partial: null,  // Current partial user message
            lastUser: null, // Last complete user message
            currentAI: null // Current AI response
        };
    }

    /**
     * Create a new message bubble
     * @param {string} text - Message text
     * @param {boolean} isUser - Whether the message is from the user
     * @param {boolean} isPartial - Whether the message is a partial result
     * @returns {string} Generated bubble ID
     */
    createBubble(text, isUser, isPartial = false) {
        const bubbleType = isUser ? 'user' : 'ai';
        this.messageCounter++;
        const bubbleId = `msg-${bubbleType}-${this.messageCounter}`;
        
        const bubbleDiv = document.createElement('div');
        bubbleDiv.id = bubbleId;
        bubbleDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        
        if (isPartial) {
            bubbleDiv.classList.add('partial-message');
            this.bubbles.partial = bubbleId;
        } else if (isUser) {
            this.bubbles.lastUser = bubbleId;
            this.bubbles.partial = null;
        } else {
            this.bubbles.currentAI = bubbleId;
        }
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text;
        
        bubbleDiv.appendChild(contentDiv);
        this.chatContainer.appendChild(bubbleDiv);
        this.scrollToBottom();
        
        return bubbleId;
    }
    
    /**
     * Update an existing bubble
     * @param {string} bubbleId - Bubble ID to update
     * @param {string} text - New message text
     * @param {boolean} isPartial - Whether it's still a partial message
     * @returns {boolean} Success status
     */
    updateBubble(bubbleId, text, isPartial = false) {
        const bubbleDiv = document.getElementById(bubbleId);
        if (!bubbleDiv) return false;
        
        const contentDiv = bubbleDiv.querySelector('.message-content');
        if (!contentDiv) return false;
        
        contentDiv.textContent = text;
        
        if (isPartial) {
            bubbleDiv.classList.add('partial-message');
        } else {
            bubbleDiv.classList.remove('partial-message');
            if (bubbleDiv.classList.contains('user-message')) {
                this.bubbles.partial = null;
            }
        }
        
        this.scrollToBottom();
        return true;
    }
    
    /**
     * Handle partial speech recognition results
     * @param {string} text - Recognized text
     */
    handlePartialTranscription(text) {
        if (!text.trim()) return;
        
        if (this.bubbles.partial) {
            this.updateBubble(this.bubbles.partial, text, true);
        } else {
            this.createBubble(text, true, true);
        }
    }
    
    /**
     * Handle final speech recognition results
     * @param {string} text - Recognized text
     */
    handleFinalTranscription(text) {
        if (!text.trim()) return;
        
        if (this.bubbles.partial) {
            const updated = this.updateBubble(this.bubbles.partial, text, false);
            if (updated) {
                this.bubbles.lastUser = this.bubbles.partial;
                this.bubbles.partial = null;
            } else {
                this.createBubble(text, true, false);
            }
        } else {
            this.createBubble(text, true, false);
        }
        
        // Reset AI bubble when user sends a new message
        this.bubbles.currentAI = null;
        
        // Show typing indicator for AI response
        this.showTypingIndicator();
    }
    
    /**
     * Handle AI responses
     * @param {string} text - Response text
     */
    handleAIResponse(text) {
        if (!text.trim()) return;
        
        if (this.bubbles.currentAI) {
            this.updateBubble(this.bubbles.currentAI, text, false);
        } else {
            this.createBubble(text, false, false);
        }
        
        this.hideTypingIndicator();
    }
    
    /**
     * Show typing indicator for AI response
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