/**
 * Audio streaming and processing module for conversational AI
 */
class AudioHandler {
    constructor(websocket) {
        this.websocket = websocket;
        this.audioContext = null;
        this.mediaRecorder = null;
        this.audioQueue = [];
        this.isPlaying = false;
        this.currentSource = null;
        this.processorNode = null;
        this.audioSendInterval = null;
        this.audioBuffer = new Float32Array(0);
    }

    /**
     * Start streaming audio for conversation
     * @returns {Promise<boolean>} Success status
     */
    async startStreamingConversation() {
        try {
            if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket not connected');
            }
            
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 48000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(stream);
            
            // Target sample rate for processing
            const destinationSampleRate = 16000;
            const sourceSampleRate = this.audioContext.sampleRate;
            
            console.log(`[Audio] Original sample rate: ${sourceSampleRate}Hz, target: ${destinationSampleRate}Hz`);
            
            // Create processor
            this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
            
            // Connect audio processing chain
            source.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);
            
            // Process audio data
            this.processorNode.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Collect all audio data
                const newBuffer = new Float32Array(this.audioBuffer.length + inputData.length);
                newBuffer.set(this.audioBuffer);
                newBuffer.set(inputData, this.audioBuffer.length);
                this.audioBuffer = newBuffer;
            };
            
            // Periodically send audio data
            this.audioSendInterval = setInterval(() => {
                this._processAndSendAudioData(destinationSampleRate, sourceSampleRate);
            }, 100);
            
            // Save references for later cleanup
            this.mediaRecorder = {
                stream,
                source,
                stop: () => this.stopStreamingConversation()
            };
            
            return true;
        } catch (error) {
            console.error('[Error] Audio streaming error:', error);
            throw error;
        }
    }

    /**
     * Process and send audio data to the server
     * @param {number} destinationSampleRate - Target sample rate
     * @param {number} sourceSampleRate - Original sample rate
     * @private
     */
    _processAndSendAudioData(destinationSampleRate, sourceSampleRate) {
        if (this.audioBuffer.length === 0 || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            return;
        }
        
        // Prepare data for sending
        const rawLength = this.audioBuffer.length;
        
        // Resample audio data
        const resampleRatio = destinationSampleRate / sourceSampleRate;
        const resampledLength = Math.round(rawLength * resampleRatio);
        const resampledData = new Float32Array(resampledLength);
        
        for (let i = 0; i < resampledLength; i++) {
            const sourceIndex = Math.min(Math.floor(i / resampleRatio), rawLength - 1);
            resampledData[i] = this.audioBuffer[sourceIndex];
        }
        
        // Convert to 16-bit PCM
        const pcmBuffer = new Int16Array(resampledLength);
        for (let i = 0; i < resampledLength; i++) {
            pcmBuffer[i] = Math.min(1, Math.max(-1, resampledData[i])) * 32767;
        }
        
        // Send data to server
        this.websocket.send(pcmBuffer.buffer);
        
        // Clear buffer after sending
        this.audioBuffer = new Float32Array(0);
    }

    /**
     * Stop streaming conversation
     */
    stopStreamingConversation() {
        if (this.audioSendInterval) {
            clearInterval(this.audioSendInterval);
            this.audioSendInterval = null;
        }
        
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }
        
        if (this.mediaRecorder) {
            if (this.mediaRecorder.source) {
                this.mediaRecorder.source.disconnect();
            }
            
            if (this.mediaRecorder.stream) {
                this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            }
            
            this.mediaRecorder = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
        }
        
        this.audioBuffer = new Float32Array(0);
    }

    /**
     * Add audio data to the playback queue
     * @param {Blob} audioData - Audio data blob
     */
    addToAudioQueue(audioData) {
        this.audioQueue.push(audioData);
        if (!this.isPlaying) {
            this.playNextAudio();
        }
    }

    /**
     * Play the next audio in the queue
     * @returns {Promise<void>}
     */
    async playNextAudio() {
        if (this.audioQueue.length === 0) {
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const audioData = this.audioQueue.shift();
        
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const audioUrl = URL.createObjectURL(audioData);
            const response = await fetch(audioUrl);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioContext.destination);
            
            this.currentSource = source;
            
            source.onended = () => {
                URL.revokeObjectURL(audioUrl);
                this.currentSource = null;
                this.playNextAudio();
            };
            
            source.start(0);
        } catch (error) {
            console.error('[Error] Audio playback error:', error);
            this.currentSource = null;
            this.playNextAudio();
        }
    }

    /**
     * Handle interruption signals
     */
    handleInterruption() {
        if (this.currentSource) {
            try {
                this.currentSource.stop(0);
            } catch(e) {
                console.error('[Error] Failed to stop audio source:', e);
            }
            this.currentSource = null;
        }
        
        this.audioQueue.length = 0;
        this.isPlaying = false;
    }
}

export default AudioHandler; 