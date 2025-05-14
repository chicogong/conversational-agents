# Conversational Agents Service Providers

This document explains how to extend the application with new service providers for ASR (Automatic Speech Recognition), TTS (Text-to-Speech), and LLM (Large Language Model) services.

## Architecture Overview

The system uses a modular architecture with interfaces and factories to support different service providers:

1. **Interfaces**: Define the contract that each provider must implement
2. **Providers**: Concrete implementations of the interfaces for specific services
3. **Factories**: Create and manage provider instances
4. **Service Registry**: Central manager that maintains provider instances and allows dynamic switching

## Adding a New Provider

### Step 1: Implement the Provider Interface

Create a new file in the `services/providers` directory that implements the appropriate interface:

```javascript
// Example: services/providers/ExampleTTSProvider.js
import { TTSProvider } from '../interfaces/TTSProvider.js';

export class ExampleTTSProvider extends TTSProvider {
  async initialize(config) {
    // Initialize your provider with configuration
  }
  
  async textToSpeech(text, ws) {
    // Implement text-to-speech functionality
  }
  
  async cancelTTS(ws) {
    // Implement cancellation
  }
  
  async processNextTTS(ws) {
    // Implement queue processing
  }
  
  async cleanup(ws) {
    // Implement resource cleanup
  }
}
```

### Step 2: Register the Provider in Service Registry

Update the `serviceRegistry.js` file to register your new provider:

```javascript
// In services/serviceRegistry.js
import { ExampleTTSProvider } from './providers/ExampleTTSProvider.js';

// In the registerBuiltInProviders method
registerBuiltInProviders() {
  // ...existing providers
  
  // Register your new provider
  ttsFactory.registerProvider('example', ExampleTTSProvider);
}
```

### Step 3: Update Configuration

Add any necessary configuration options to `config.js`:

```javascript
// In config.js
example: {
  apiKey: process.env.EXAMPLE_API_KEY,
  region: process.env.EXAMPLE_REGION,
  // Other settings...
}
```

### Step 4: Use Your Provider

You can now use your provider by:

1. Setting the appropriate environment variable:
   ```
   TTS_PROVIDER=example
   ```

2. Or by changing the provider dynamically through the API:
   ```
   POST /api/services/change
   {
     "service": "tts",
     "provider": "example"
   }
   ```

## Available Interfaces

### ASR Provider Interface

```javascript
// services/interfaces/ASRProvider.js
export class ASRProvider {
  async initialize(config) {}
  async processAudioData(buffer, ws) {}
  async startRecognition(ws) {}
  async stopRecognition(ws) {}
  async cleanup(ws) {}
}
```

### TTS Provider Interface

```javascript
// services/interfaces/TTSProvider.js
export class TTSProvider {
  async initialize(config) {}
  async textToSpeech(text, ws) {}
  async cancelTTS(ws) {}
  async processNextTTS(ws) {}
  async cleanup(ws) {}
}
```

### LLM Provider Interface

```javascript
// services/interfaces/LLMProvider.js
export class LLMProvider {
  async initialize(config) {}
  async processUserInput(text, ws) {}
  async cancelActivities(ws) {}
  getConversationHistory(ws) {}
  async clearConversationHistory(ws) {}
  async cleanup(ws) {}
}
```

## Testing Your Provider

You can test your provider by:

1. Starting the server with your provider configured
2. Accessing the status endpoint to verify the active provider:
   ```
   GET /api/status
   ```
3. Switching to your provider dynamically:
   ```
   POST /api/services/change
   {
     "service": "tts",
     "provider": "example"
   }
   ```
4. Using the web interface to interact with your provider

## Debugging

If you encounter issues with your provider, check the server logs for error messages. The system uses detailed logging to help diagnose problems with each service. 