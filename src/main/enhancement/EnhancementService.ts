export interface EnhancementService {
  /**
   * Enhances the given text using a chain of prompts defined in settings.
   * @param text The original transcribed text.
   * @param apiKey The API key for the service.
   * @param model The specific model to use.
   * @param apiEndpoint Optional endpoint for custom providers.
   * @returns The enhanced text.
   */
  enhance(
    text: string,
    apiKey: string,
    model: string,
    apiEndpoint?: string
  ): Promise<string>;
}