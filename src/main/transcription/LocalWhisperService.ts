import { TranscriptionService } from './TranscriptionService'
import store from '../store'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logger } from '../logger'
import { nodewhisper, IOptions } from 'nodejs-whisper'

interface WhisperOptions {
  outputInCsv?: boolean
  outputInJson?: boolean
  outputInJsonFull?: boolean
  outputInLrc?: boolean
  outputInSrt?: boolean
  outputInText?: boolean
  outputInVtt?: boolean
  outputInWords?: boolean
  translateToEnglish?: boolean
  timestamps_length?: number
  wordTimestamps?: boolean
  splitOnWord?: boolean
  language?: string
}

export const AVAILABLE_LOCAL_MODELS = [
  'tiny', 'tiny.en',
  'base', 'base.en',
  'small', 'small.en',
  'medium', 'medium.en',
  'large-v2', 'large-v3',
  'large-v3-turbo'
];

export class LocalWhisperService implements TranscriptionService {

  constructor() {
    logger.info('LocalWhisperService initialized.');
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
    return 'wav'; 
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, language?: string): Promise<string> {
    const provider = store.get('transcription.provider');
    if (provider !== 'local') {
      logger.error('LocalWhisperService transcribe called when provider is not local.');
      throw new Error('LocalWhisperService called incorrectly.');
    }

    const selectedModel = store.get('transcription.localModelName', 'base.en');
    logger.info(`Using local Whisper model: ${selectedModel}`);

    const extension = this.getExtensionFromMimeType(mimeType) || 'wav';
    const tempFilePath = path.join(os.tmpdir(), `vox-local-audio-${Date.now()}.${extension}`);

    try {
      logger.info(`Writing audio buffer to temporary file for local transcription: ${tempFilePath}`);
      await fs.promises.writeFile(tempFilePath, audioBuffer);

      const whisperOptions: WhisperOptions = {
        outputInText: true,
        translateToEnglish: false,
        wordTimestamps: false,
        splitOnWord: true,
        language: language || 'auto'
      };

      const useGpu = process.platform === 'darwin';
      logger.info(`Local transcription GPU (Metal) usage: ${useGpu}`);

      const options: IOptions = {
        // execPath: process.execPath, // Reverted: Not a valid option in IOptions
        modelName: selectedModel,
        whisperOptions: whisperOptions,
      };

      const loggableOptions = { ...options, logger: undefined, whisperOptions }; // Reverted logging change
      logger.info(`Calling nodejs-whisper with options: ${JSON.stringify(loggableOptions)}`);

      options.whisperOptions!.outputInText = true;
      options.whisperOptions!.outputInSrt = false;
      options.whisperOptions!.outputInVtt = false;
      options.whisperOptions!.outputInJson = false;

      await nodewhisper(tempFilePath, options);

      const outputTxtPath = tempFilePath.replace(`.${extension}`, '.txt');

      if (fs.existsSync(outputTxtPath)) {
        const transcript = await fs.promises.readFile(outputTxtPath, 'utf-8');
        logger.info(`Local transcription successful. Result length: ${transcript.length}`);
        try {
          await fs.promises.unlink(outputTxtPath);
          logger.debug(`Deleted output text file: ${outputTxtPath}`);
        } catch (cleanupError) {
          logger.warn(`Failed to delete output text file ${outputTxtPath}:`, cleanupError);
        }
        return transcript.trim();
      } else {
        logger.error(`Output text file not found after nodejs-whisper execution: ${outputTxtPath}`);
        throw new Error('Local transcription failed: Output file not generated.');
      }

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Error during local Whisper transcription:', error);
      throw new Error(`Local transcription failed: ${message}`);
    } finally {
      try {
        if (fs.existsSync(tempFilePath)) {
          await fs.promises.unlink(tempFilePath);
          logger.info(`Temporary audio file deleted: ${tempFilePath}`);
        }
      } catch (cleanupError) {
        logger.warn(`Failed to delete temporary audio file ${tempFilePath}:`, cleanupError);
      }
    }
  }

  static async downloadModel(modelName: string): Promise<void> {
      if (!AVAILABLE_LOCAL_MODELS.includes(modelName)) {
          logger.error(`Attempted to download invalid local model: ${modelName}`);
          throw new Error(`Invalid local model name: ${modelName}`);
      }
      logger.info(`Attempting to download local model: ${modelName}...`);
      try {
          const { exec } = await import('child_process');
          // NOTE: This approach of shelling out to npx might still be problematic in packaged apps.
          // A more robust solution might involve bundling whisper.cpp differently or
          // using a library that manages the binary execution better within Electron.
          const command = `npx nodejs-whisper download ${modelName}`;
          logger.info(`Executing command: ${command} with execPath context: ${process.execPath}`);

          await new Promise<void>((resolve, reject) => {
              // Pass environment options, potentially including execPath's directory in PATH
              const env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}` };
              const childProcess = exec(command, { env }, (error, stdout, stderr) => {
                  if (error) {
                      logger.error(`Error downloading model ${modelName}: ${error.message}`);
                      logger.error(`stderr: ${stderr}`);
                      // Include stdout in error if helpful
                      logger.error(`stdout: ${stdout}`);
                      reject(error);
                      return;
                  }
                  if (stderr) {
                      logger.warn(`stderr during model download ${modelName}: ${stderr}`);
                  }
                  logger.info(`stdout for model download ${modelName}: ${stdout}`);
                  logger.info(`Successfully downloaded model: ${modelName}`);
                  resolve();
              });

              process.stdout?.on('data', (data) => logger.debug(`[Download ${modelName} stdout]: ${data}`));
              process.stderr?.on('data', (data) => logger.warn(`[Download ${modelName} stderr]: ${data}`));
          });

      } catch (error) {
          logger.error(`Failed to download model ${modelName}:`, error);
          throw error;
      }
  }
}
