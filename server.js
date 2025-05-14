import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import { wsService } from './services/wsHandler.js';
import logger from './services/logger.js';
import { serviceRegistry } from './services/serviceRegistry.js';

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
  
  // Enable JSON body parsing
  app.use(express.json());
  
  // Serve static files from the public directory
  app.use(express.static(path.join(__dirname, 'public')));
  
  // API endpoints
  setupApiEndpoints(app);
  
  // Handle WebSocket connections
  wss.on('connection', wsService.handleConnection);
  
  return { app, server, wss };
}

/**
 * Set up API endpoints
 * @param {express.Application} app - Express application
 */
function setupApiEndpoints(app) {
  // API status endpoint
  app.get('/api/status', (req, res) => {
    const status = {
      activeConnections: wsService.getActiveConnectionCount(),
      services: {
        asr: config.services.asr.provider,
        tts: config.services.tts.provider,
        llm: config.services.llm.provider
      }
    };
    res.json(status);
  });
  
  // API endpoint to change service providers
  app.post('/api/services/change', async (req, res) => {
    try {
      const { service, provider } = req.body;
      
      if (!service || !provider) {
        return res.status(400).json({ 
          error: 'Missing required parameters',
          message: 'Both service and provider must be specified'
        });
      }
      
      // Validate service type
      if (!['asr', 'tts', 'llm'].includes(service)) {
        return res.status(400).json({ 
          error: 'Invalid service type',
          message: 'Service must be one of: asr, tts, llm'
        });
      }
      
      // Change provider based on service type
      switch(service) {
        case 'asr':
          await serviceRegistry.changeASRProvider(provider);
          break;
          
        case 'tts':
          await serviceRegistry.changeTTSProvider(provider);
          break;
          
        case 'llm':
          await serviceRegistry.changeLLMProvider(provider);
          break;
      }
      
      // Update config
      config.services[service].provider = provider;
      
      res.json({ 
        success: true, 
        message: `Changed ${service} provider to ${provider}`,
        services: {
          asr: config.services.asr.provider,
          tts: config.services.tts.provider,
          llm: config.services.llm.provider
        }
      });
    } catch (error) {
      logger.error(`Error changing service provider: ${error.message}`);
      res.status(500).json({ 
        error: 'Failed to change service provider',
        message: error.message
      });
    }
  });
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
      const asrProvider = config.services.asr.provider;
      const ttsProvider = config.services.tts.provider;
      const llmProvider = config.services.llm.provider;
      
      logger.info(`Server running at http://${config.server.host}:${config.server.port} | ` +
        `WebSocket service enabled | ` +
        `Using ASR: ${asrProvider} | Using TTS: ${ttsProvider} | Using LLM: ${llmProvider}`);
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
    // Initialize service registry
    await serviceRegistry.initialize(config);
    
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