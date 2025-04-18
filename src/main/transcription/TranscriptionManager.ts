import { TranscriptionService } from './TranscriptionService'
import { OpenaiWhisperService } from './OpenaiWhisperService'
import { DeepgramService } from './DeepgramService'
import store from '../store'
import { logger } from '../logger'

type TranscriptionMode = 'openai' | 'deepgram'

export class TranscriptionManager {
  private services: Map<TranscriptionMode, TranscriptionService>
  private currentMode: TranscriptionMode | null = null

  constructor() {
    this.services = new Map()
    this.services.set('openai', new OpenaiWhisperService())
    this.services.set('deepgram', new DeepgramService())
    this.updateModeFromSettings()
    store.onDidChange('transcription', (newValue, oldValue) => {
      const providerChanged = newValue?.provider !== oldValue?.provider;

      if (providerChanged) {
          logger.info('Transcription settings changed, updating manager.')
          this.updateModeFromSettings()
       }
    })
  }

  private updateModeFromSettings(): void {
    const modeFromSettings = store.get('transcription.provider') as TranscriptionMode | undefined
    if (modeFromSettings && this.services.has(modeFromSettings)) {
      this.currentMode = modeFromSettings
      logger.info(`TranscriptionManager mode set to: ${this.currentMode}`)
    } else {
      this.currentMode = null
      logger.warn(`TranscriptionManager: Configured mode "${modeFromSettings}" is not available or invalid. No active transcription service.`)
    }
  }

  public async transcribe(audioBuffer: Buffer, mimeType: string, language?: string): Promise<string> {
    if (!this.currentMode) {
      logger.error('TranscriptionManager: No active transcription mode set.')
      throw new Error('No active transcription mode configured.')
    }

    const service = this.services.get(this.currentMode)
    if (!service) {
      logger.error(`TranscriptionManager: Service for mode "${this.currentMode}" not found.`)
      throw new Error(`Internal error: Service for mode ${this.currentMode} not found.`)
    }

    logger.info(`TranscriptionManager: Delegating transcription to ${this.currentMode} service with type ${mimeType}.`)
    try {
      const result = await service.transcribe(audioBuffer, mimeType, language)
      logger.info(`TranscriptionManager: Received result from ${this.currentMode} service.`)
      return result
    } catch (error) {
      logger.error(`TranscriptionManager: Error during transcription via ${this.currentMode} service:`, error)
      throw error
    }
  }
}