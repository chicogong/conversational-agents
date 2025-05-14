import { AzureASRProvider } from './providers/asr/AzureASRProvider.js';
import { AzureTTSProvider } from './providers/tts/AzureTTSProvider.js';
import { OpenAILLMProvider } from './providers/llm/OpenAILLMProvider.js';
import logger from './logger.js';

/**
 * Service registry to manage and provide access to service providers
 */
class ServiceRegistry {
  constructor() {
    this.asr = null;
    this.tts = null;
    this.llm = null;
    this.config = null;
    
    // Available providers
    this.asrProviders = {
      'azure': AzureASRProvider
    };
    
    this.ttsProviders = {
      'azure': AzureTTSProvider
    };
    
    this.llmProviders = {
      'openai': OpenAILLMProvider
    };
  }
  
  /**
   * Initialize service registry with configuration
   * @param {Object} config - Application configuration
   * @returns {Promise<void>}
   */
  async initialize(config) {
    this.config = config;
    await this.initializeProviders();
    logger.info('Service registry initialized with configured providers');
  }
  
  /**
   * Initialize providers based on configuration
   * @returns {Promise<void>}
   */
  async initializeProviders() {
    try {
      // Get provider types from config or use defaults
      const asrType = this.config.services?.asr?.provider || 'azure';
      const ttsType = this.config.services?.tts?.provider || 'azure';
      const llmType = this.config.services?.llm?.provider || 'openai';
      
      // Initialize providers
      await this.setASRProvider(asrType);
      await this.setTTSProvider(ttsType);
      await this.setLLMProvider(llmType);
      
    } catch (error) {
      logger.error(`Error initializing service providers: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Create and initialize a provider instance
   * @param {string} type - Provider type
   * @param {Object} providerMap - Map of available providers
   * @param {string} serviceName - Name of service for logging
   * @returns {Object} - Initialized provider instance
   */
  async createProvider(type, providerMap, serviceName) {
    const ProviderClass = providerMap[type];
    if (!ProviderClass) {
      throw new Error(`${serviceName} provider '${type}' not available`);
    }
    
    const provider = new ProviderClass();
    await provider.initialize(this.config);
    logger.info(`Initialized ${serviceName} provider: ${type}`);
    
    return provider;
  }
  
  /**
   * Set ASR provider
   * @param {string} providerType - Provider type to use
   * @returns {Promise<void>}
   */
  async setASRProvider(providerType) {
    try {
      this.asr = await this.createProvider(providerType, this.asrProviders, 'ASR');
    } catch (error) {
      logger.error(`Error setting ASR provider: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Set TTS provider
   * @param {string} providerType - Provider type to use
   * @returns {Promise<void>}
   */
  async setTTSProvider(providerType) {
    try {
      this.tts = await this.createProvider(providerType, this.ttsProviders, 'TTS');
    } catch (error) {
      logger.error(`Error setting TTS provider: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Set LLM provider
   * @param {string} providerType - Provider type to use
   * @returns {Promise<void>}
   */
  async setLLMProvider(providerType) {
    try {
      this.llm = await this.createProvider(providerType, this.llmProviders, 'LLM');
    } catch (error) {
      logger.error(`Error setting LLM provider: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Register a new ASR provider
   * @param {string} type - Provider type identifier
   * @param {Class} providerClass - Provider implementation class
   */
  registerASRProvider(type, providerClass) {
    this.asrProviders[type] = providerClass;
    logger.info(`Registered ASR provider: ${type}`);
  }
  
  /**
   * Register a new TTS provider
   * @param {string} type - Provider type identifier
   * @param {Class} providerClass - Provider implementation class
   */
  registerTTSProvider(type, providerClass) {
    this.ttsProviders[type] = providerClass;
    logger.info(`Registered TTS provider: ${type}`);
  }
  
  /**
   * Register a new LLM provider
   * @param {string} type - Provider type identifier
   * @param {Class} providerClass - Provider implementation class
   */
  registerLLMProvider(type, providerClass) {
    this.llmProviders[type] = providerClass;
    logger.info(`Registered LLM provider: ${type}`);
  }
  
  /**
   * Get ASR service
   * @returns {Object} ASR provider
   */
  getASR() {
    return this.asr;
  }
  
  /**
   * Get TTS service
   * @returns {Object} TTS provider
   */
  getTTS() {
    return this.tts;
  }
  
  /**
   * Get LLM service
   * @returns {Object} LLM provider
   */
  getLLM() {
    return this.llm;
  }
}

// Create singleton instance
export const serviceRegistry = new ServiceRegistry(); 