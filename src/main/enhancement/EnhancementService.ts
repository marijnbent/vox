export interface EnhancementService {
  /**
   * Enhances the given text using a specific prompt template.
   * @param text The original transcribed text.
   * @param promptTemplate The prompt template (e.g., "Fix this text: {{transcription}}").
   * @param apiKey The API key for the service.
   * @param model The specific model to use.
   * @param apiEndpoint Optional endpoint for custom providers.
   * @returns The enhanced text.
   */
  enhance(
    text: string,
    promptTemplate: string,
    apiKey: string,
    model: string,
    apiEndpoint?: string
  ): Promise<string>;
}