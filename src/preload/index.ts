import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getStoreValue: (key: string): Promise<unknown> => ipcRenderer.invoke('getStoreValue', key),
  setStoreValue: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('setStoreValue', key, value),
  updateMonitoredKeys: (keys: string[]): Promise<void> => ipcRenderer.invoke('updateMonitoredKeys', keys),
  onShortcutAction: (callback: (action: string, key: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string, key: string): void => callback(action, key);
    ipcRenderer.on('shortcutAction', handler);
    return (): void => {
      ipcRenderer.removeListener('shortcutAction', handler);
    };
  },
  onRecordingStateUpdate: (callback: (state: { isRecording: boolean; isToggleMode: boolean }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: { isRecording: boolean; isToggleMode: boolean }): void => callback(state);
      ipcRenderer.on('recordingStateUpdate', handler);
      return (): void => {
          ipcRenderer.removeListener('recordingStateUpdate', handler);
      };
  },
  log: (level: string, message: string, ...args: unknown[]): void => {
      ipcRenderer.send('logFromRenderer', level, message, ...args);
  },
  getAccessibilityStatus: (): Promise<'granted' | 'not-granted' | 'unavailable'> => ipcRenderer.invoke('getAccessibilityStatus'),
  requestAccessibilityAccess: (): Promise<boolean> => ipcRenderer.invoke('requestAccessibilityAccess'),
  getMediaPermissionStatus: (mediaType: 'microphone' | 'camera' | 'screen'): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'unavailable'> => ipcRenderer.invoke('getMediaPermissionStatus', mediaType),
  requestMediaPermission: (mediaType: 'microphone' | 'camera'): Promise<boolean> => ipcRenderer.invoke('requestMediaPermission', mediaType),
  openSettingsURL: (url: string): Promise<void> => ipcRenderer.invoke('openSettingsURL', url),
  onStartRecording: (callback: () => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('start-recording', handler);
    return (): void => {
      ipcRenderer.removeListener('start-recording', handler);
    };
  },
  onCancelRecording: (callback: () => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('cancel-recording', handler);
    return (): void => {
      ipcRenderer.removeListener('cancel-recording', handler);
    };
  },
  onStopRecording: (callback: () => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('stop-recording', handler);
    return (): void => {
      ipcRenderer.removeListener('stop-recording', handler);
    };
  },
  updateRecordingStatus: (status: 'idle' | 'recording' | 'processing' | 'error'): void => {
    ipcRenderer.send('update-recording-status', status);
  },
  transcribeAudio: (audio: { audioData: ArrayBuffer, mimeType: string }): Promise<void> => ipcRenderer.invoke('transcribe-audio', audio),
  onTranscriptionResult: (callback: (text: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, text: string): void => callback(text);
    ipcRenderer.on('transcription-result', handler);
    return (): void => {
      ipcRenderer.removeListener('transcription-result', handler);
    };
  },
  onTranscriptionError: (callback: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void => callback(error);
    ipcRenderer.on('transcription-error', handler);
    return (): void => {
      ipcRenderer.removeListener('transcription-error', handler);
    };
  },
  onRecordingStatus: (callback: (status: 'idle' | 'recording' | 'processing' | 'error') => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: 'idle' | 'recording' | 'processing' | 'error'): void => callback(status);
    ipcRenderer.on('recording-status', handler);
    return (): void => {
      ipcRenderer.removeListener('recording-status', handler);
    };
  },
  getHistory: (page?: number, pageSize?: number): Promise<any | null> => ipcRenderer.invoke('getHistory', page, pageSize),
  deleteHistoryEntry: (id: string): Promise<boolean> => ipcRenderer.invoke('deleteHistoryEntry', id),
  clearAllHistory: (): Promise<boolean> => ipcRenderer.invoke('clearAllHistory'),
  notifySilenceCancellation: (): void => ipcRenderer.send('processing-cancelled-silence'),
  getDefaultPromptContent: (): Promise<string> => ipcRenderer.invoke('getDefaultPromptContent'),
  getAvailableLocalModels: (): Promise<string[]> => ipcRenderer.invoke('getAvailableLocalModels'),
  downloadLocalModel: (modelName: string): Promise<void> => ipcRenderer.invoke('download-local-model', modelName),
  notifyRecorderStarted: (): void => ipcRenderer.send('recorder-actually-started'),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
