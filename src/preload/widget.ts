import { contextBridge, ipcRenderer } from 'electron';

const widgetApi = {
  onStatusUpdate: (callback: (status: 'idle' | 'recording' | 'processing' | 'error') => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: 'idle' | 'recording' | 'processing' | 'error'): void => {
      callback(status);
    };
    ipcRenderer.on('widget-status-update', handler);
    return (): void => {
      ipcRenderer.removeListener('widget-status-update', handler);
    };
  },
  onRecorderStarted: (callback: () => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('widget-recorder-started', handler);
    return (): void => {
      ipcRenderer.removeListener('widget-recorder-started', handler);
    };
  },
  stopRecording: () => {
    ipcRenderer.send('widget-stop-recording');
  }
};

try {
  contextBridge.exposeInMainWorld('widgetApi', widgetApi);
} catch (error) {
  console.error('Failed to expose Widget API:', error);
}


