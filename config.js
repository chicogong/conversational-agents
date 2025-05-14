import 'dotenv/config';
import { fileURLToPath } from 'url';
import path from 'path';

// Determine project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;

// Validate required environment variables
const requiredEnvVars = [
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_REGION',
  'OPENAI_API_KEY'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error(`⚠️ Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Please check your .env file or environment configuration');
  // Continue execution with default values where possible
}

// Configuration with defaults and environment overrides
const config = {
  // Server configuration
  server: {
    port: parseInt(process.env.SERVER_PORT, 10) || 8080,
    host: process.env.SERVER_HOST || 'localhost',
    cors: {
      enabled: process.env.ENABLE_CORS === 'true',
      origin: process.env.CORS_ORIGIN || '*'
    },
    paths: {
      root: rootDir,
      public: path.join(rootDir, 'public'),
      logs: path.join(rootDir, 'logs')
    }
  },
  
  // Service providers configuration
  services: {
    // ASR service configuration
    asr: {
      provider: process.env.ASR_PROVIDER || 'azure',
      // Additional provider-specific config can be added here
    },
    
    // TTS service configuration
    tts: {
      provider: process.env.TTS_PROVIDER || 'azure',
      // Additional provider-specific config can be added here
    },
    
    // LLM service configuration
    llm: {
      provider: process.env.LLM_PROVIDER || 'openai',
      // Additional provider-specific config can be added here
    }
  },
  
  // Azure Speech Service configuration
  speech: {
    key: process.env.AZURE_SPEECH_KEY,
    region: process.env.AZURE_SPEECH_REGION,
    language: process.env.SPEECH_LANGUAGE || 'zh-CN',
    voice: process.env.SPEECH_VOICE || 'zh-CN-XiaochenMultilingualNeural',
    outputFormat: process.env.SPEECH_OUTPUT_FORMAT || 'audio-16khz-128kbitrate-mono-mp3',
    voiceDetectionThreshold: parseInt(process.env.VOICE_DETECTION_THRESHOLD, 10) || 300,
    
    // Speech service timeouts (ms)
    timeouts: {
      initialSilence: parseInt(process.env.INITIAL_SILENCE_TIMEOUT, 10) || 5000,
      endSilence: parseInt(process.env.END_SILENCE_TIMEOUT, 10) || 1000,
      tts: parseInt(process.env.TTS_TIMEOUT, 10) || 8000
    }
  },
  
  // OpenAI API configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS, 10) || 300,
    systemPrompt: process.env.SYSTEM_PROMPT || 
      "You are an intelligent voice assistant named Xiao Rui. Please respond in a conversational, concise way. Avoid using emoji or special characters."
  },
  
  // Conversation settings
  conversation: {
    maxHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY, 10) || 10,
    clearOnDisconnect: process.env.CLEAR_ON_DISCONNECT !== 'false'
  },
  
  // WebSocket configuration
  websocket: {
    pingInterval: parseInt(process.env.WS_PING_INTERVAL, 10) || 30000,
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT, 10) || 5000
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    console: process.env.LOG_CONSOLE !== 'false',
    file: process.env.LOG_FILE !== 'false',
    maxLogFiles: parseInt(process.env.MAX_LOG_FILES, 10) || 7
  },
  
  // Pattern matching
  patterns: {
    sentenceEnd: /[！。？：，!.?:;]/
  }
};

// Flag indicating development mode
config.isDev = process.env.NODE_ENV !== 'production';

export default config; 