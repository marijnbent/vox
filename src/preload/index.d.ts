import { ElectronAPI } from '@electron-toolkit/preload';

interface HistoryRecord {
  id: string;
  timestamp: number;
  originalText: string;
  enhancedText: string | null;
  promptIdUsed: string | null;
  promptNameUsed: string | null;
}

interface PaginatedHistory {
  entries: HistoryRecord[];
  totalEntries: number;
  totalPages: number;
  currentPage: number;
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getStoreValue: (key: string) => Promise<unknown>
      setStoreValue: (key: string, value: unknown) => Promise<void>,
      updateMonitoredKeys: (keys: string[]) => Promise<void>,
      onShortcutAction: (callback: (action: string, keyName: string) => void) => (() => void),
      onRecordingStateUpdate: (callback: (state: { isRecording: boolean; isToggleMode: boolean }) => void) => (() => void),
      log: (level: 'info' | 'warn' | 'error' | 'debug' | 'verbose', message: string, ...args: unknown[]) => void,
      getAccessibilityStatus: () => Promise<'granted' | 'not-granted' | 'unavailable'>,
      requestAccessibilityAccess: () => Promise<boolean>,
      getMediaPermissionStatus: (mediaType: 'microphone' | 'camera' | 'screen') => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'unavailable'>,
      requestMediaPermission: (mediaType: 'microphone' | 'camera') => Promise<boolean>,
      openSettingsURL: (url: string) => Promise<void>,
      onStartRecording: (callback: () => void) => (() => void),
      onStopRecording: (callback: () => void) => (() => void),
      onCancelRecording: (callback: () => void) => (() => void),
      updateRecordingStatus: (status: 'idle' | 'recording' | 'processing' | 'error') => void,
      transcribeAudio: (audio: { audioData: ArrayBuffer, mimeType: string }) => Promise<void>,
      onTranscriptionResult: (callback: (text: string) => void) => (() => void),
      onTranscriptionError: (callback: (error: string) => void) => (() => void),
      onRecordingStatus: (callback: (status: 'idle' | 'recording' | 'processing' | 'error') => void) => (() => void),
      getHistory: (page?: number, pageSize?: number) => Promise<PaginatedHistory | null>,
      deleteHistoryEntry: (id: string) => Promise<boolean>,
      clearAllHistory: () => Promise<boolean>,
      notifySilenceCancellation: () => void,
      notifyRecorderStarted: () => void;
      getFocusedInputFieldText: () => Promise<{ text: string; selectedRange?: { start: number; length: number } } | null>;
      getDefaultPromptContent: () => Promise<string>;
      getLogFilePath: () => Promise<string>;
      getLogLines: (lineCount?: number) => Promise<string[]>;
      playSystemSound: (soundName: string) => Promise<void>;
    }
  }
}


