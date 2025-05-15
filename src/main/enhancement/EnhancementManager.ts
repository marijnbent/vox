import { EnhancementService } from './EnhancementService';
import { OpenaiEnhancementService } from './OpenaiEnhancementService';
import store from '../store';
import { logger } from '../logger';
import type { EnhancementSettings } from '../store';

export class EnhancementManager {
  private enhancementService: EnhancementService;

  constructor() {
    this.enhancementService = new OpenaiEnhancementService();
    logger.info('Enhancement Manager initialized using OpenaiEnhancementService for all providers.');
  }

  public async enhance(text: string): Promise<{ finalText: string; promptDetails: { promptId: string; promptName: string; renderedPrompt: string; enhancedText: string; }[] }> {
    const settings = store.get('enhancements') as EnhancementSettings;

    if (text === '') {
        logger.warn('EnhancementManager: No text provided for enhancement. Skipping enhancement.');
        return { finalText: text, promptDetails: [] };
    }

    if (!settings.enabled) {
        logger.info('Enhancement disabled. Skipping enhancement.');
        return { finalText: text, promptDetails: [] };
    }

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
            return { finalText: text, promptDetails: [] };
    }

    if (!apiKey) {
        logger.warn(`EnhancementManager: API key for provider "${settings.provider}" is missing. Skipping enhancement.`);
        return { finalText: text, promptDetails: [] };
    }

    return this.enhancementService.enhance(text, apiKey, model, apiEndpoint);
  }
}