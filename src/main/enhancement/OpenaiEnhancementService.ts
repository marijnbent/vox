import OpenAI from 'openai';
import Mustache from 'mustache';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron'; // Added for path resolution
import { EnhancementService } from './EnhancementService';
import { logger } from '../logger';
import store from '../store';
import type { EnhancementSettings, EnhancementPrompt } from '../store';

// Define constants for the new default prompts
const DEFAULT_CLEAN_TRANSCRIPTION_ID = "default_clean_transcription";
const DEFAULT_CONTEXTUAL_FORMATTING_ID = "default_contextual_formatting";

const CLEAN_TRANSCRIPTION_PROMPT_FILENAME = "prompt-clean-transcription.txt";
const CONTEXTUAL_FORMATTING_PROMPT_FILENAME = "prompt-contextual-formatting.txt";

const DEFAULT_CLEAN_TRANSCRIPTION_TEMP = 0.1;
const DEFAULT_CONTEXTUAL_FORMATTING_TEMP = 1.0;

const FALLBACK_CLEAN_TEMPLATE = "Clean this: {{transcription}}";
const FALLBACK_FORMATTING_TEMPLATE = "Format this: {{previous_output}}";

// Helper function to read prompt file content with fallback
async function readPromptFileContent(fileName: string, fallbackTemplate: string): Promise<string> {
  try {
    const basePath = app.isPackaged
        ? process.resourcesPath
        : path.join(app.getAppPath(), 'resources');
    const filePath = path.join(basePath, fileName);
    logger.debug(`Attempting to read default prompt file: ${filePath}`);
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    logger.error(`Failed to read default prompt file "${fileName}":`, error, `Using fallback.`);
    return fallbackTemplate;
  }
}

export class OpenaiEnhancementService implements EnhancementService {
  private defaultPrompts = new Map<string, { template: string; temperature: number }>();

  constructor() {
    this.initializeDefaultPrompts();
  }

  private async initializeDefaultPrompts(): Promise<void> {
    const cleanTemplate = await readPromptFileContent(CLEAN_TRANSCRIPTION_PROMPT_FILENAME, FALLBACK_CLEAN_TEMPLATE);
    this.defaultPrompts.set(DEFAULT_CLEAN_TRANSCRIPTION_ID, {
      template: cleanTemplate,
      temperature: DEFAULT_CLEAN_TRANSCRIPTION_TEMP,
    });

    const formatTemplate = await readPromptFileContent(CONTEXTUAL_FORMATTING_PROMPT_FILENAME, FALLBACK_FORMATTING_TEMPLATE);
    this.defaultPrompts.set(DEFAULT_CONTEXTUAL_FORMATTING_ID, {
      template: formatTemplate,
      temperature: DEFAULT_CONTEXTUAL_FORMATTING_TEMP,
    });
    logger.info('Default enhancement prompts initialized.');
  }

  async enhance(
    initialText: string,
    // promptTemplate: string, // Removed - we use the chain now
    apiKey: string,
    model: string,
    baseURL?: string
  ): Promise<string> {

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
        // This case should ideally be prevented by store defaults, but as a safeguard:
        activeChainIds.push(DEFAULT_CLEAN_TRANSCRIPTION_ID, DEFAULT_CONTEXTUAL_FORMATTING_ID);
        logger.info('Defaulting to two-step enhancement chain as active chain was empty.');
    }

    // Ensure default prompts are loaded if constructor hasn't finished or failed silently
    if (this.defaultPrompts.size === 0) {
        logger.warn('Default prompts not initialized, attempting to initialize now.');
        await this.initializeDefaultPrompts();
        if (this.defaultPrompts.size === 0) {
            logger.error('Failed to initialize default prompts. Enhancement may not work as expected.');
            // Potentially throw an error or return initialText if critical
        }
    }
    
    // Create a new promptMap for this enhancement call
    // Start with the initialized default prompts
    const promptMap = new Map(this.defaultPrompts);

    // Layer custom prompts on top, potentially overriding defaults if IDs clash (though unlikely with UUIDs for custom)
    // And apply a default temperature for custom prompts if not specified.
    const globalDefaultTempForCustom = 0.7; // Or fetch from settings if it becomes configurable
    customPrompts.forEach(p => {
        promptMap.set(p.id, { template: p.template, temperature: p.temperature ?? globalDefaultTempForCustom });
    });

    let currentText = initialText; // Start with the original transcription

    logger.info(`Starting enhancement chain with ${activeChainIds.length} prompts.`);

    for (let i = 0; i < activeChainIds.length; i++) {
        const promptId = activeChainIds[i];
        const promptDetails = promptMap.get(promptId);

        if (!promptDetails) {
            logger.warn(`Prompt ID "${promptId}" not found in map. Skipping step ${i + 1}.`);
            continue;
        }

        logger.info(`Running prompt ${i + 1}/${activeChainIds.length}: ID "${promptId}"`);

        // Prepare context for this specific prompt
        const contextData: { [key: string]: any } = {
            transcription: initialText, // Always provide the original transcription
            previous_output: i > 0 ? currentText : initialText // Output of previous step (or initial text for first step)
            // Note: If the first prompt *only* wants {{transcription}}, it works.
            // If a later prompt wants {{transcription}}, it gets the original.
            // If a later prompt wants {{previous_output}}, it gets the chained result.
        };

        // Add other context variables if enabled
        if (enhancementSettings.useContextScreen) {
            contextData.context_screen = "[Screen Content Placeholder - Not Implemented]";
        }
        if (enhancementSettings.useContextInputField) {
            contextData.context_input_field = "[Input Field Placeholder - Not Implemented]";
        }
        if (enhancementSettings.useContextClipboard) {
            contextData.context_clipboard = "[Clipboard Placeholder - Not Implemented]";
        }
        if (enhancementSettings.useDictionaryWordList) {
            const dictionaryWords = store.get('dictionary.words', []) as string[];
            contextData.dictionary_word_list = dictionaryWords.join(', ');
        }

        logger.debug(`Rendering prompt template for step ${i + 1} with context keys:`, Object.keys(contextData));
        const finalPrompt = Mustache.render(promptDetails.template, contextData);
        logger.debug(`Final rendered prompt (step ${i + 1}): ${finalPrompt.substring(0, 100)}...`);

        try {
            const completion = await openai.chat.completions.create({
                messages: [{ role: 'user', content: finalPrompt }],
                model: model,
                temperature: promptDetails.temperature, // Use temperature from this specific prompt
                max_tokens: Math.max(150, currentText.length * 2), // Base on current text length
            });

            const stepResult = completion.choices[0]?.message?.content;

            if (stepResult) {
                logger.info(`Prompt step ${i + 1} successful.`);
                currentText = stepResult.trim(); // Update currentText for the next iteration
            } else {
                logger.error(`OpenAI Enhancement Step ${i + 1}: Received empty response from API for prompt ID "${promptId}". Stopping chain.`);
                // Decide whether to throw or return intermediate result
                // Throwing might be safer to indicate failure.
                throw new Error(`OpenAI enhancement step ${i + 1} (ID: ${promptId}) returned an empty response.`);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`OpenAI Enhancement Step ${i + 1} (ID: ${promptId}) failed:`, error);
            // Rethrow the error to stop the chain and signal failure
            throw new Error(`OpenAI enhancement step ${i + 1} (ID: ${promptId}) failed: ${message}`);
        }
    } // End of chain loop

    logger.info('Enhancement chain completed successfully.');
    return currentText; // Return the final result after all steps
  }
}