import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { handleConnection } from './services/wsHandler.js';
import logger from './services/logger.js';

// Set up directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express application and create HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle WebSocket connections
wss.on('connection', handleConnection);

// Handle shutdown signals gracefully
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal} signal, shutting down services...`);
  
  // Close WebSocket server
  wss.close(() => {
    logger.info('WebSocket server closed');
  });
  
  // Shutdown logger and other services
  await logger.shutdown();
  
  // Exit process
  process.exit(0);
};

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
const startServer = () => {
  return new Promise((resolve, reject) => {
    server.listen(config.server.port, config.server.host, () => {
      logger.info(`Server running at http://${config.server.host}:${config.server.port}`);
      logger.info('WebSocket service enabled on the same port');
      logger.info('Azure Speech Recognition service enabled');
      logger.info(`Using region: ${config.speech.region}`);
      resolve();
    });
    
    server.on('error', (error) => {
      logger.error('Server error:', error);
      reject(error);
    });
  });
};

// Start the server and catch any errors
startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});