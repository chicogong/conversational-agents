import log4js from 'log4js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, '../logs');

// Create logs directory if it doesn't exist
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`Created logs directory at: ${logsDir}`);
  }
} catch (err) {
  console.error('Failed to create logs directory:', err);
  // Continue execution as we can still log to console
}

// Configure log4js with multiple appenders and categories
log4js.configure({
  appenders: {
    console: { 
      type: 'console',
      layout: {
        type: 'pattern',
        pattern: '%[[%d{ISO8601}] [%p] [%c]%] %m'
      }
    },
    file: { 
      type: 'dateFile', 
      filename: path.join(logsDir, 'app.log'),
      pattern: '.yyyy-MM-dd',
      compress: true,
      maxLogSize: 10485760, // 10MB
      numBackups: 7,        // Keep a week of logs
      layout: {
        type: 'pattern',
        pattern: '[%d{ISO8601}] [%p] [%c] %m'
      }
    },
    error: {
      type: 'dateFile',
      filename: path.join(logsDir, 'error.log'),
      pattern: '.yyyy-MM-dd',
      compress: true,
      maxLogSize: 10485760,
      numBackups: 30,       // Keep a month of error logs
      layout: {
        type: 'pattern',
        pattern: '[%d{ISO8601}] [%p] [%c] %m'
      }
    }
  },
  categories: {
    default: { 
      appenders: ['console', 'file'], 
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' 
    },
    error: { 
      appenders: ['console', 'error'], 
      level: 'error' 
    },
    ws: {
      appenders: ['console', 'file'],
      level: 'debug'
    },
    llm: {
      appenders: ['console', 'file'],
      level: 'debug'
    },
    speech: {
      appenders: ['console', 'file'],
      level: 'debug'
    }
  }
});

// Create logger instances
const defaultLogger = log4js.getLogger();
const errorLogger = log4js.getLogger('error');
const wsLogger = log4js.getLogger('ws');
const llmLogger = log4js.getLogger('llm');
const speechLogger = log4js.getLogger('speech');

// Enhanced logger with specialized loggers for different components
const logger = {
  debug: (...args) => defaultLogger.debug(...args),
  info: (...args) => defaultLogger.info(...args),
  warn: (...args) => defaultLogger.warn(...args),
  error: (...args) => {
    defaultLogger.error(...args);
    errorLogger.error(...args);
  },
  fatal: (...args) => {
    defaultLogger.fatal(...args);
    errorLogger.fatal(...args);
  },
  
  // Component-specific loggers
  ws: wsLogger,
  llm: llmLogger,
  speech: speechLogger,
  
  // Graceful shutdown
  shutdown: () => {
    return new Promise((resolve) => {
      log4js.shutdown(() => {
        resolve();
      });
    });
  }
};

export default logger; 