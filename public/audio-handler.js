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
     */
    addToAudioQueue(audioData) {
        this.audioQueue.push(audioData);
        if (!this.isPlaying) {
            this.playNextAudio();
        }
    }

    /**
     * Convert PCM data to WAV format
     * @param {ArrayBuffer} pcmBuffer - Raw PCM audio data
     * @param {number} sampleRate - Sample rate of the audio (default: 16000)
     * @returns {Blob} - WAV formatted audio blob
     */
    convertPCMToWAV(pcmBuffer, sampleRate = 16000) {
        // Helper function to write a string to a DataView
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        // Create WAV header
        const createWavHeader = (dataLength) => {
            const buffer = new ArrayBuffer(44);
            const view = new DataView(buffer);
            
            // RIFF identifier
            writeString(view, 0, 'RIFF');
            // File length (data length + 36)
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
            view.setUint16(22, 1, true);
            // Sample rate
            view.setUint32(24, sampleRate, true);
            // Byte rate (sample rate * block align)
            view.setUint32(28, sampleRate * 2, true);
            // Block align (channels * bytes per sample)
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
            
            // Try to detect if this is raw PCM data based on MIME type or content inspection
            let audioToPlay;
            if (audioData.type === 'audio/wav' || audioData.type === 'audio/mp3') {
                // Already in a playable format
                audioToPlay = arrayBuffer;
            } else {
                // Convert from PCM to WAV if we suspect it's raw PCM
                // We're assuming 16kHz 16-bit mono PCM
                const wavBlob = this.convertPCMToWAV(arrayBuffer, 16000);
                audioToPlay = await wavBlob.arrayBuffer();
            }
            
            // Decode and play the audio
            const audioBuffer = await this.audioContext.decodeAudioData(audioToPlay);
            
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