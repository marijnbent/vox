import OpenAI from 'openai';
import Mustache from 'mustache';
import { EnhancementService } from './EnhancementService';
import { logger } from '../logger';
import store from '../store';
import type { EnhancementSettings } from '../store';

export class OpenaiEnhancementService implements EnhancementService {
  async enhance(
    text: string,
    promptTemplate: string,
    apiKey: string,
    model: string,
    baseURL?: string
  ): Promise<string> {

    if (!apiKey) {
      logger.error('OpenAI Enhancement: API key is missing.');
      throw new Error('OpenAI API key for enhancement is required.');
    }

    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL || undefined
    });

    const contextData: { [key: string]: any } = {
      transcription: text
    };
    const enhancementSettings = store.get('enhancements') as EnhancementSettings;

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

    logger.debug('Rendering prompt template with context:', contextData);
    const finalPrompt = Mustache.render(promptTemplate, contextData);
    logger.debug(`Final rendered prompt: ${finalPrompt.substring(0, 100)}...`);

    logger.info(`Sending enhancement request to OpenAI model ${model}...`);

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: 'user', content: finalPrompt }
        ],
        model: model,
        temperature: 0,
        max_tokens: Math.max(100, text.length * 2),
      });

      const enhancedText = completion.choices[0]?.message?.content;

      if (enhancedText) {
        logger.info('OpenAI Enhancement successful.');
        return enhancedText.trim();
      } else {
        logger.error('OpenAI Enhancement: Received empty response from API.');
        throw new Error('OpenAI enhancement returned an empty response.');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('OpenAI Enhancement failed:', error);
      throw new Error(`OpenAI enhancement failed: ${message}`);
    }
  }
}