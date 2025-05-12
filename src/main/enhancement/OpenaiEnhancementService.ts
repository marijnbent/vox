import OpenAI from 'openai';
import Mustache from 'mustache';
import fs from 'fs/promises';
import path from 'path';
import { EnhancementService } from './EnhancementService';
import { logger } from '../logger';
import store from '../store';
import type { EnhancementSettings, EnhancementPrompt } from '../store';

const DEFAULT_PROMPT_TEMPERATURE = 0.7; // Consistent default

export class OpenaiEnhancementService implements EnhancementService {

  // Helper to get the default prompt content
  private async getDefaultPromptTemplate(): Promise<string> {
    try {
      // Assuming store.path gives the path to the config file, navigate relative to it
      // This might need adjustment based on actual electron-store behavior or app structure
      const storeDir = path.dirname(store.path);
      const resourcesPath = path.join(storeDir, '../../resources'); // Adjust relative path if needed
      const defaultPromptPath = path.join(resourcesPath, 'default-prompt.txt');
      logger.debug(`Attempting to read default prompt from: ${defaultPromptPath}`);
      const content = await fs.readFile(defaultPromptPath, 'utf-8');
      return content;
    } catch (error) {
        logger.error('Failed to read default prompt template:', error);
        // Fallback to a very basic template if file reading fails
        return 'Format the following transcription:\n\n{{transcription}}';
    }
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
    const activeChainIds = enhancementSettings.activePromptChain || ['default']; // Ensure chain exists

    if (activeChainIds.length === 0) {
        logger.warn('Enhancement chain is empty. Returning original text.');
        return initialText;
    }

    const defaultPromptTemplate = await this.getDefaultPromptTemplate();

    // Create a map for easy lookup, including the default prompt details
    const promptMap = new Map<string, { template: string; temperature: number }>();
    promptMap.set('default', { template: defaultPromptTemplate, temperature: DEFAULT_PROMPT_TEMPERATURE });
    customPrompts.forEach(p => {
        promptMap.set(p.id, { template: p.template, temperature: p.temperature ?? DEFAULT_PROMPT_TEMPERATURE });
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