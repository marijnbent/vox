export interface TranscriptionService {
  transcribe(audioBuffer: Buffer, mimeType: string, language?: string): Promise<string>
}