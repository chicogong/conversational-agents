import 'dotenv/config';

export default {
  server: {
    port: process.env.SERVER_PORT || 8080,
    host: process.env.SERVER_HOST || 'localhost',
  },
  speech: {
    key: process.env.AZURE_SPEECH_KEY,
    region: process.env.AZURE_SPEECH_REGION,
    language: 'zh-CN',
    voice: 'zh-CN-XiaochenMultilingualNeural',
    outputFormat: 'audio-16khz-128kbitrate-mono-mp3',
    voiceDetectionThreshold: 300
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
  },
  patterns: {
    sentenceEnd: /[！。？：，]/
  }
} 