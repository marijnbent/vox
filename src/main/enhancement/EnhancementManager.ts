import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { EnhancementService } from './EnhancementService';
import { OpenaiEnhancementService } from './OpenaiEnhancementService';
import store from '../store';
import { logger } from '../logger';
import type { EnhancementSettings, EnhancementPrompt } from '../store';

export function getDefaultPromptTemplate(): string {
  try {
    const basePath = app.isPackaged
        ? process.resourcesPath
        : app.getAppPath();
    const filePath = path.join(basePath, 'resources', 'default-prompt.txt');

    if (fs.existsSync(filePath)) {
      logger.debug(`Loading default prompt from: ${filePath}`);
      return fs.readFileSync(filePath, 'utf-8');
    } else {
      logger.error(`Default prompt file not found at: ${filePath}. Using fallback.`);
      return `Please enhance the following transcription for clarity, grammar, and formatting. Keep the original meaning intact:\n\n{{transcription}}`;
    }
  } catch (error) {
    logger.error('Error reading default prompt file:', error);
    return `Please enhance the following transcription for clarity, grammar, and formatting. Keep the original meaning intact:\n\n{{transcription}}`;
  }
}

export class EnhancementManager {
  private enhancementService: EnhancementService;

  constructor() {
    this.enhancementService = new OpenaiEnhancementService();
    logger.info('Enhancement Manager initialized using OpenaiEnhancementService for all providers.');
  }

  private getActivePromptTemplate(settings: EnhancementSettings): string {
    if (settings.activePromptId === 'default') {
      return getDefaultPromptTemplate();
    }
    const customPrompts = store.get('enhancementPrompts', []) as EnhancementPrompt[];
    const activePrompt = customPrompts.find(p => p.id === settings.activePromptId);
    if (activePrompt) {
      logger.info(`Using custom enhancement prompt: ${activePrompt.name}`);
      return activePrompt.template;
    } else {
      logger.warn(`Active custom prompt ID "${settings.activePromptId}" not found. Falling back to default prompt.`);
      return getDefaultPromptTemplate();
    }
  }

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

    const promptTemplate = this.getActivePromptTemplate(settings);
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
          promptTemplate,
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