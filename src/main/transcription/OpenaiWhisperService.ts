import OpenAI from 'openai'
import { TranscriptionService } from './TranscriptionService'
import store from '../store'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logger } from '../logger'

export class OpenaiWhisperService implements TranscriptionService {
  private openai: OpenAI | null = null

  constructor() {
    this.initializeClient()
    store.onDidChange('transcription', (newValue, oldValue) => {
      if (newValue?.provider === 'openai' && newValue?.openaiApiKey !== oldValue?.openaiApiKey) {
         logger.info('Transcription settings changed, re-initializing OpenAI client.');
         this.initializeClient();
      } else if (newValue?.provider !== 'openai' && this.openai !== null) {
        logger.info('Transcription provider changed away from OpenAI, disabling client.');
        this.openai = null;
      }
    })
  }

  private initializeClient(): void {
    const provider = store.get('transcription.provider');
    if (provider !== 'openai') {
        this.openai = null;
        logger.info(`OpenAI provider not selected (current: ${provider}). OpenAI client not initialized.`);
        return;
    }
    const apiKey = store.get('transcription.openaiApiKey') as string | undefined
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      logger.info('OpenAI client initialized with API key.')
    } else {
      this.openai = null;
      logger.warn('OpenAI API key not found in settings. OpenAI client not initialized.')
    }
  }

  private getExtensionFromMimeType(mimeType: string): string | null {
    const mimeMap: { [key: string]: string } = {
      'audio/webm': 'webm',
      'audio/webm;codecs=opus': 'webm',
      'audio/wav': 'wav',
      'audio/mp4': 'mp4',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mpeg',
      'audio/mpga': 'mpga',
      'audio/aac': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/m4a': 'm4a',
      'audio/ogg': 'ogg',
      'audio/ogg;codecs=opus': 'ogg',
    };

    const baseMimeType = mimeType.split(';')[0];

    if (mimeMap[baseMimeType]) {
      return mimeMap[baseMimeType];
    }

    logger.warn(`Could not determine file extension for MIME type: ${mimeType}`);
    return null;
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, language?: string): Promise<string> {
    if (!this.openai) {
      logger.error('OpenAI client not initialized. Cannot transcribe.')
      throw new Error('OpenAI client not initialized. API key might be missing.')
    }

    const extension = this.getExtensionFromMimeType(mimeType);
    if (!extension) {
        logger.error(`Unsupported MIME type for OpenAI transcription: ${mimeType}`);
        throw new Error(`Unsupported audio format: ${mimeType}`);
    }

    const tempFilePath = path.join(os.tmpdir(), `vox-audio-${Date.now()}.${extension}`);

    try {
      logger.info(`Writing audio buffer to temporary file: ${tempFilePath}`)
      await fs.promises.writeFile(tempFilePath, audioBuffer)

      logger.info(`Sending audio file to OpenAI Whisper API for transcription...`)
      const model = store.get('transcription.openaiModel', 'gpt-4o-mini-transcribe');
      logger.info(`Using OpenAI transcription model: ${model}`)
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: model,
        language: language
      })
      logger.info(`Transcription received from OpenAI: "${transcription.text}"`)

      return transcription.text
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Error during OpenAI transcription:', error)
      throw new Error(`OpenAI transcription failed: ${message}`)
    } finally {
      try {
        await fs.promises.unlink(tempFilePath);
        logger.info(`Temporary audio file deleted: ${tempFilePath}`)
      } catch (cleanupError) {
        logger.error(`Failed to delete temporary audio file ${tempFilePath}:`, cleanupError)
      }
    }
  }
}