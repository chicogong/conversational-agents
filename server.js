import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { wsService } from './services/wsHandler.js';
import logger from './services/logger.js';

// Set up directory paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Initialize Express application, HTTP server and WebSocket server
 * @returns {Object} Object containing app, server and wss instances
 */
function initializeServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  
  // Serve static files from the public directory
  app.use(express.static(path.join(__dirname, 'public')));
  
  // Handle WebSocket connections
  wss.on('connection', wsService.handleConnection);
  
  return { app, server, wss };
}

/**
 * Handle graceful shutdown of services
 * @param {string} signal - Signal that triggered the shutdown
 * @param {Object} services - Object containing server instances to shut down
 * @returns {Promise<void>}
 */
async function gracefulShutdown(signal, { wss }) {
  logger.info(`Received ${signal} signal, shutting down services...`);
  
  // Close WebSocket server with timeout
  const closeWebSocketServer = new Promise((resolve) => {
    wss.close(() => {
      logger.info('WebSocket server closed');
      resolve();
    });
    
    // Force close after timeout
    setTimeout(() => {
      logger.warn('WebSocket server force closed after timeout');
      resolve();
    }, 5000);
  });
  
  try {
    await closeWebSocketServer;
    await logger.shutdown();
    
    logger.info('All services shut down successfully');
    process.exit(0);
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Set up process event handlers for graceful shutdown
 * @param {Object} services - Server instances to shut down
 */
function setupProcessHandlers(services) {
  // Register shutdown handlers
  process.on('SIGINT', () => gracefulShutdown('SIGINT', services));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', services));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION', services);
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection:', reason);
    gracefulShutdown('UNHANDLED_REJECTION', services);
  });
}

/**
 * Start the HTTP server
 * @param {http.Server} server - HTTP server instance
 * @returns {Promise<void>}
 */
function startServer(server) {
  return new Promise((resolve, reject) => {
    server.listen(config.server.port, config.server.host, () => {
      logger.info(`Server running at http://${config.server.host}:${config.server.port}`);
      logger.info('WebSocket service enabled on the same port');
      logger.info('Azure Speech Recognition service enabled');
      logger.info(`Using OpenAI model: ${config.openai.model}`);
      logger.info(`Using Azure region: ${config.speech.region}`);
      resolve();
    });
    
    server.on('error', (error) => {
      logger.error('Server error:', error);
      reject(error);
    });
  });
}

/**
 * Main application function
 */
async function main() {
  try {
    // Initialize server components
    const services = initializeServer();
    
    // Set up process handlers for graceful shutdown
    setupProcessHandlers(services);
    
    // Start the server
    await startServer(services.server);
    
    // Log startup success
    logger.info('Server initialization complete');
    logger.info(`Active connections: ${wsService.getActiveConnectionCount()}`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the application
main();