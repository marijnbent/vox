import { EnhancementService } from './EnhancementService';
import { OpenaiEnhancementService } from './OpenaiEnhancementService';
import store from '../store';
import { logger } from '../logger';
import type { EnhancementSettings } from '../store'; // EnhancementPrompt is not used here anymore

// getDefaultPromptTemplate function removed as it's no longer needed.
// The OpenaiEnhancementService now handles its own default prompt loading.

export class EnhancementManager {
  private enhancementService: EnhancementService;

  constructor() {
    this.enhancementService = new OpenaiEnhancementService();
    logger.info('Enhancement Manager initialized using OpenaiEnhancementService for all providers.');
  }

  // getActivePromptTemplate method removed.
  // The OpenaiEnhancementService now manages the prompt chain internally
  // based on settings.activePromptChain.

  public async enhance(text: string): Promise<string> {
    const settings = store.get('enhancements') as EnhancementSettings;

    if (text === '') {
      logger.warn('EnhancementManager: No text provided for enhancement. Skipping enhancement.');
      return text;
    }
    
    if (!settings.enabled) {
      logger.info('Enhancement disabled. Skipping enhancement.');
      return text;
    }

    // const promptTemplate = this.getActivePromptTemplate(settings); // Removed
    let apiKey = '';
    let model = '';
    let apiEndpoint: string | undefined = undefined;

    switch (settings.provider) {
      case 'openai':
        apiKey = settings.openaiApiKey;
        model = settings.openaiModel;
        break;
      case 'gemini':
        apiKey = settings.geminiApiKey;
        model = settings.geminiModel;
        apiEndpoint = "https://generativelanguage.googleapis.com/v1beta/openai/";
        break;
      case 'custom':
        apiKey = settings.customApiKey;
        model = settings.customModelName;
        apiEndpoint = settings.customBaseUrl || undefined;
        break;
      default:
        logger.error(`EnhancementManager: Invalid provider "${settings.provider}" encountered.`);
        return text; 
    }

    if (!apiKey) {
        logger.warn(`EnhancementManager: API key for provider "${settings.provider}" is missing. Skipping enhancement.`);
        return text;
    }
     if (!model) {
        logger.warn(`EnhancementManager: Model for provider "${settings.provider}" is missing. Skipping enhancement.`);
        return text;
    }

    logger.info(`EnhancementManager: Enhancing text via OpenAI-compatible service using provider "${settings.provider}" settings (Model: "${model}", Endpoint: ${apiEndpoint || 'Default'}).`);
    try {
      const enhancedText = await this.enhancementService.enhance(
          text,
          // promptTemplate, // Removed
          apiKey,
          model,
          apiEndpoint
      );
      logger.info('EnhancementManager: Enhancement successful.');
      return enhancedText;
    } catch (error) {
      logger.error(`EnhancementManager: Error during enhancement using ${settings.provider} settings:`, error);
      return text;
    }
  }
}