import ConnectionConfig from './connection-config.js';

/**
 * Audio streaming and processing module for conversational AI
 */
class AudioHandler {
    /**
     * @param {WebSocket} websocket - WebSocket connection to send audio data
     */
    constructor(websocket) {
        this.websocket = websocket;
        this.audioContext = null;
        this.mediaStream = null;
        this.processorNode = null;
        this.audioSendInterval = null;
        this.audioBuffer = new Float32Array(0);
        
        // Audio playback
        this.audioQueue = [];
        this.isPlaying = false;
        this.currentSource = null;
    }

    /**
     * Start capturing and streaming audio
     * @returns {Promise<boolean>} Success status
     */
    async startStreamingConversation() {
        try {
            if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket not connected');
            }
            
            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 48000,
                    channelCount: ConnectionConfig.AUDIO.CHANNELS,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            // Initialize audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            
            // Create processor node
            this.processorNode = this.audioContext.createScriptProcessor(
                ConnectionConfig.AUDIO.BUFFER_SIZE, 
                ConnectionConfig.AUDIO.CHANNELS, 
                ConnectionConfig.AUDIO.CHANNELS
            );
            
            // Connect audio processing chain
            source.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);
            
            // Process audio data
            this.processorNode.onaudioprocess = this._handleAudioProcess.bind(this);
            
            // Periodically send audio data
            this.audioSendInterval = setInterval(
                () => this._processAndSendAudioData(), 
                ConnectionConfig.AUDIO.PROCESS_INTERVAL
            );
            
            return true;
        } catch (error) {
            console.error('[Error] Audio streaming error:', error);
            this._cleanupAudioResources();
            throw error;
        }
    }

    /**
     * Handle audio processing event
     * @param {AudioProcessingEvent} e - Audio processing event
     * @private
     */
    _handleAudioProcess(e) {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Collect all audio data
        const newBuffer = new Float32Array(this.audioBuffer.length + inputData.length);
        newBuffer.set(this.audioBuffer);
        newBuffer.set(inputData, this.audioBuffer.length);
        this.audioBuffer = newBuffer;
    }

    /**
     * Process and send audio data to the server
     * @private
     */
    _processAndSendAudioData() {
        if (this.audioBuffer.length === 0 || 
            !this.websocket || 
            this.websocket.readyState !== WebSocket.OPEN) {
            return;
        }
        
        // Prepare data for sending
        const rawLength = this.audioBuffer.length;
        
        // Resample audio data
        const sourceSampleRate = this.audioContext.sampleRate;
        const destinationSampleRate = ConnectionConfig.AUDIO.SAMPLE_RATE;
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
        this._cleanupAudioResources();
    }
    
    /**
     * Clean up audio resources
     * @private
     */
    _cleanupAudioResources() {
        if (this.audioSendInterval) {
            clearInterval(this.audioSendInterval);
            this.audioSendInterval = null;
        }
        
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = null;
        }
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
        }
        
        this.audioBuffer = new Float32Array(0);
    }

    /**
     * Add audio data to the playback queue
     * @param {Blob} audioData - Audio data to play
     */
    addToAudioQueue(audioData) {
        this.audioQueue.push(audioData);
        if (!this.isPlaying) {
            this.playNextAudio();
        }
    }

    /**
     * Handle user interruption during conversation
     */
    handleInterruption() {
        if (this.currentSource) {
            this.currentSource.stop();
            this.currentSource = null;
        }
        this.audioQueue = [];
        this.isPlaying = false;
    }

    /**
     * Convert PCM data to WAV format
     * @param {ArrayBuffer} pcmBuffer - Raw PCM audio data
     * @param {number} sampleRate - Sample rate of the audio
     * @returns {Blob} - WAV formatted audio blob
     */
    convertPCMToWAV(pcmBuffer, sampleRate = ConnectionConfig.AUDIO.SAMPLE_RATE) {
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        const createWavHeader = (dataLength) => {
            const buffer = new ArrayBuffer(44);
            const view = new DataView(buffer);
            
            // RIFF identifier
            writeString(view, 0, 'RIFF');
            // File length
            view.setUint32(4, 36 + dataLength, true);
            // WAVE identifier
            writeString(view, 8, 'WAVE');
            // Format chunk identifier
            writeString(view, 12, 'fmt ');
            // Format chunk length
            view.setUint32(16, 16, true);
            // Sample format (1 is PCM)
            view.setUint16(20, 1, true);
            // Channels (mono = 1)
            view.setUint16(22, ConnectionConfig.AUDIO.CHANNELS, true);
            // Sample rate
            view.setUint32(24, sampleRate, true);
            // Byte rate
            view.setUint32(28, sampleRate * 2, true);
            // Block align
            view.setUint16(32, 2, true);
            // Bits per sample
            view.setUint16(34, 16, true);
            // Data chunk identifier
            writeString(view, 36, 'data');
            // Data chunk length
            view.setUint32(40, dataLength, true);
            
            return buffer;
        };
        
        // Create WAV header
        const wavHeader = createWavHeader(pcmBuffer.byteLength);
        
        // Combine header and PCM data
        const wavBuffer = new Uint8Array(wavHeader.byteLength + pcmBuffer.byteLength);
        wavBuffer.set(new Uint8Array(wavHeader), 0);
        wavBuffer.set(new Uint8Array(pcmBuffer), wavHeader.byteLength);
        
        // Create and return WAV blob
        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    /**
     * Play the next audio in the queue
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
            
            // Determine audio format and prepare for playback
            let audioToPlay;
            if (audioData.type === 'audio/wav' || audioData.type === 'audio/mp3') {
                audioToPlay = arrayBuffer;
            } else {
                const wavBlob = this.convertPCMToWAV(arrayBuffer);
                audioToPlay = await wavBlob.arrayBuffer();
            }
            
            // Decode and play audio
            const audioBuffer = await this.audioContext.decodeAudioData(audioToPlay);
            this.currentSource = this.audioContext.createBufferSource();
            this.currentSource.buffer = audioBuffer;
            this.currentSource.connect(this.audioContext.destination);
            
            this.currentSource.onended = () => {
                this.currentSource = null;
                URL.revokeObjectURL(audioUrl);
                this.playNextAudio();
            };
            
            this.currentSource.start(0);
        } catch (error) {
            console.error('[Error] Audio playback error:', error);
            this.playNextAudio(); // Try next audio in queue
        }
    }
}

export default AudioHandler; 