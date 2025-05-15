import OpenAI from 'openai';
import Mustache from 'mustache';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron'; // Added for path resolution
import { EnhancementService } from './EnhancementService';
import { logger } from '../logger';
import store from '../store';
import type { EnhancementSettings, EnhancementPrompt } from '../store';
import { getFocusedInputTextWithCursor } from '../modules/macOSIntegration';

// Define constants for the new default prompts
const DEFAULT_CLEAN_TRANSCRIPTION_ID = "default_clean_transcription";
const DEFAULT_CONTEXTUAL_FORMATTING_ID = "default_contextual_formatting";

const CLEAN_TRANSCRIPTION_PROMPT_FILENAME = "prompt-clean-transcription.txt";
const CONTEXTUAL_FORMATTING_PROMPT_FILENAME = "prompt-contextual-formatting.txt";

const DEFAULT_CLEAN_TRANSCRIPTION_TEMP = 0.1;
const DEFAULT_CONTEXTUAL_FORMATTING_TEMP = 1.0;

const DEFAULT_PROMPT_NAMES: Record<string, string> = {
  [DEFAULT_CLEAN_TRANSCRIPTION_ID]: 'Clean Transcription',
  [DEFAULT_CONTEXTUAL_FORMATTING_ID]: 'Input Formatting'
};

// Helper function to read prompt file content
async function readPromptFileContent(fileName: string): Promise<string> {
  try {
    const basePath = app.isPackaged
        ? process.resourcesPath
        : path.join(app.getAppPath(), 'resources');
    const filePath = path.join(basePath, fileName);
    logger.debug(`Attempting to read default prompt file: ${filePath}`);
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    logger.error(`Failed to read default prompt file "${fileName}":`, error);
    throw new Error(
      `Unable to load prompt file "${fileName}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export class OpenaiEnhancementService implements EnhancementService {
  private defaultPrompts = new Map<string, { template: string; temperature: number }>();

  constructor() {
    this.initializeDefaultPrompts();
  }

  private async initializeDefaultPrompts(): Promise<void> {
    const cleanTemplate = await readPromptFileContent(CLEAN_TRANSCRIPTION_PROMPT_FILENAME);
    this.defaultPrompts.set(DEFAULT_CLEAN_TRANSCRIPTION_ID, {
      template: cleanTemplate,
      temperature: DEFAULT_CLEAN_TRANSCRIPTION_TEMP,
    });

    const formatTemplate = await readPromptFileContent(CONTEXTUAL_FORMATTING_PROMPT_FILENAME);
    this.defaultPrompts.set(DEFAULT_CONTEXTUAL_FORMATTING_ID, {
      template: formatTemplate,
      temperature: DEFAULT_CONTEXTUAL_FORMATTING_TEMP,
    });
    logger.info('Default enhancement prompts initialized.');
  }

  async enhance(
    initialText: string,
    apiKey: string,
    model: string,
    baseURL?: string
  ): Promise<{ finalText: string; promptDetails: { promptId: string; promptName: string; renderedPrompt: string; enhancedText: string; }[] }> {

    if (!apiKey) {
      logger.error('OpenAI Enhancement Chain: API key is missing.');
      throw new Error('OpenAI API key for enhancement is required.');
    }

    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL || undefined
    });

    const enhancementSettings = store.get('enhancements') as EnhancementSettings;
    const customPrompts = store.get('enhancementPrompts', []) as EnhancementPrompt[];
    const activeChainIds = enhancementSettings.activePromptChain || [DEFAULT_CLEAN_TRANSCRIPTION_ID, DEFAULT_CONTEXTUAL_FORMATTING_ID];

    if (activeChainIds.length === 0) {
        logger.warn('Enhancement chain is empty. Returning original text.');
        activeChainIds.push(DEFAULT_CLEAN_TRANSCRIPTION_ID, DEFAULT_CONTEXTUAL_FORMATTING_ID);
        logger.info('Defaulting to two-step enhancement chain as active chain was empty.');
    }

    if (this.defaultPrompts.size === 0) {
        logger.warn('Default prompts not initialized, attempting to initialize now.');
        await this.initializeDefaultPrompts();
        if (this.defaultPrompts.size === 0) {
            logger.error('Failed to initialize default prompts. Enhancement may not work as expected.');
        }
    }

    const promptMap = new Map(this.defaultPrompts);
    const promptNameMap = new Map(Object.entries(DEFAULT_PROMPT_NAMES));
    const globalDefaultTempForCustom = 0.7;
    customPrompts.forEach(p => {
        promptMap.set(p.id, { template: p.template, temperature: p.temperature ?? globalDefaultTempForCustom });
        promptNameMap.set(p.id, p.name);
    });

    logger.info(`Starting enhancement chain with ${activeChainIds.length} prompts.`);

    // build all static context fields once
    const baseContextData: Record<string, any> = {
      transcription: initialText
    };

    if (enhancementSettings.useContextScreen) {
      baseContextData.context_screen = "[Screen Content Placeholder - Not Implemented]";
    }

    if (enhancementSettings.useContextInputField) {
      baseContextData.context_input_field = await getFocusedInputTextWithCursor();
    }

    if (enhancementSettings.useContextClipboard) {
      baseContextData.context_clipboard = "[Clipboard Placeholder - Not Implemented]";
    }

    if (enhancementSettings.useDictionaryWordList) {
      const dictionaryWords = store.get('dictionary.words', []) as string[];
      baseContextData.dictionary_word_list = dictionaryWords.join(', ');
    }

    let currentText = initialText;
    const promptDetails: { promptId: string; promptName: string; renderedPrompt: string; enhancedText: string; }[] = [];

    for (let i = 0; i < activeChainIds.length; i++) {
        const promptId = activeChainIds[i];
        const promptDetailsEntry = promptMap.get(promptId);

        if (!promptDetailsEntry) {
          logger.warn(`Prompt ID "${promptId}" not found in map. Skipping step ${i + 1}.`);
          continue;
        }

        if (promptId === DEFAULT_CONTEXTUAL_FORMATTING_ID) {
          if (!enhancementSettings.useContextInputField) {
            logger.info(`Prompt ID "${promptId}" skipped due to context input field settings.`);
            continue;
          }

          if (baseContextData.context_input_field === '[[cursor]]') {
            logger.info(`Prompt ID "${promptId}" skipped as input is empty.`);
            continue;
          }
        }

        const contextData = {
            ...baseContextData,
            previous_output: currentText
        };

        const finalPrompt = Mustache.render(promptDetailsEntry.template, contextData);

        try {
            const completion = await openai.chat.completions.create({
                messages: [{ role: 'user', content: finalPrompt }],
                model: model,
                temperature: promptDetailsEntry.temperature,
                max_tokens: Math.max(150, currentText.length * 2),
            });

            const stepResult = completion.choices[0]?.message?.content;

            if (stepResult) {
                currentText = stepResult.trim();
                const promptName = promptNameMap.get(promptId) || promptId;
                promptDetails.push({
                    promptId,
                    promptName,
                    renderedPrompt: finalPrompt,
                    enhancedText: currentText
                });
            } else {
                throw new Error(`OpenAI enhancement step ${i + 1} (ID: ${promptId}) returned an empty response.`);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`OpenAI enhancement step ${i + 1} (ID: ${promptId}) failed: ${message}`);
        }
    }

    return { finalText: currentText, promptDetails };
  }
}