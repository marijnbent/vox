// Define the structure of the API exposed by preload/widget.ts
export interface WidgetAPI {
  // Main -> Widget: Receive status updates
  onStatusUpdate: (callback: (status: 'idle' | 'recording' | 'processing' | 'error') => void) => () => void;
  stopRecording: () => void;
      onRecorderStarted: (callback: () => void) => () => void; // Main -> Widget
}

// Augment the global Window interface
declare global {
  interface Window {
    widgetApi: WidgetAPI;
  }
}

// Export an empty object to satisfy ES module requirements if needed by tsconfig
export {};