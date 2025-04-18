import { createClient } from '@deepgram/sdk';
import { TranscriptionService } from './TranscriptionService';
import store from '../store';
import { logger } from '../logger';

export class DeepgramService implements TranscriptionService {
  private client: ReturnType<typeof createClient> | null = null;

  constructor() {
    this.initializeClient();
    store.onDidChange('transcription', (newValue, oldValue) => {
      if (newValue?.provider === 'deepgram' && newValue?.deepgramApiKey !== oldValue?.deepgramApiKey) {
        logger.info('Transcription settings changed, re-initializing Deepgram client.');
        this.initializeClient();
      } else if (newValue?.provider !== 'deepgram' && this.client !== null) {
        logger.info('Transcription provider changed away from Deepgram, disabling client.');
        this.client = null;
      }
    });
  }

  private initializeClient(): void {
    const provider = store.get('transcription.provider');
    if (provider !== 'deepgram') {
      this.client = null;
      logger.info(`Deepgram provider not selected (current: ${provider}). Deepgram client not initialized.`);
      return;
    }
    const apiKey = store.get('transcription.deepgramApiKey') as string | undefined;
    if (apiKey) {
      try {
        this.client = createClient(apiKey);
        logger.info('Deepgram client initialized with API key.');
      } catch (error) {
        this.client = null;
        logger.error('Error initializing Deepgram client:', error);
      }
    } else {
      this.client = null;
      logger.warn('Deepgram API key not found in settings. Deepgram client not initialized.');
    }
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, language?: string): Promise<string> {
    if (!this.client) {
      logger.error('Deepgram client not initialized. Cannot transcribe.');
      throw new Error('Deepgram client not initialized. API key might be missing.');
    }

    try {
      logger.info(`Sending audio buffer to Deepgram API for transcription... (MIME type: ${mimeType}, Buffer size: ${audioBuffer.length} bytes)`);
      const modelName = store.get('transcription.deepgramModel', 'nova-3');
      logger.info(`Using Deepgram transcription model: ${modelName}`);
      const options: Record<string, any> = {
        model: modelName,
        detect_language: true,
        smart_format: true
      };

      if (language) {
        options.language = language;
      }

      logger.info(`Audio format: ${mimeType}, sending ${audioBuffer.byteLength} bytes to Deepgram`);
      const { result, error } = await this.client.listen.prerecorded.transcribeFile(
        audioBuffer,
        options
      );
      if (error) {
        logger.error('Deepgram API returned an error:', error);
        throw new Error(`Deepgram API error: ${error.message}`);
      }
      if (!result) {
        logger.error('No result returned from Deepgram API');
        throw new Error('No result returned from Deepgram API');
      }
      const transcript = result.results?.channels[0]?.alternatives[0]?.transcript || '';
      if (transcript) {
        logger.info(`Transcription received from Deepgram: "${transcript.substring(0, 50)}${transcript.length > 50 ? '...' : ''}"`);
      } else {
        logger.warn('Deepgram returned empty transcript');
      }
      return transcript;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Error during Deepgram transcription:', error);
      throw new Error(`Deepgram transcription failed: ${message}`);
    }
  }
}