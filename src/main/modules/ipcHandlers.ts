import { ipcMain, systemPreferences, shell, clipboard, app } from 'electron';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path'; // Added path
import log from 'electron-log';
import store from '../store';
import { logger } from '../logger';
import { TranscriptionManager } from '../transcription/TranscriptionManager';
import { EnhancementManager } from '../enhancement/EnhancementManager';
import * as historyService from '../historyService';
import { startKeyMonitor } from './shortcutManager';
import { getMainWindow, sendToMain, sendToWidget } from './windowManager';
import { getFocusedInputTextWithCursor, type FocusedInputContext } from './macOSIntegration';
import type { EnhancementSettings } from '../store';

let transcriptionManager: TranscriptionManager;
let enhancementManager: EnhancementManager;

const DEFAULT_PROMPTS_CONFIG: Record<string, { name: string; filePath: string; temperature: number; fallbackTemplate: string }> = {
    "default_clean_transcription": {
        name: "🧽 Clean Transcription",
        filePath: "resources/prompt-clean-transcription.txt",
        temperature: 0.1,
        fallbackTemplate: ""
    },
    "default_contextual_formatting": {
        name: "✏️ Input Formatting",
        filePath: "resources/prompt-contextual-formatting.txt",
        temperature: 1.0,
        fallbackTemplate: ""
    }
};

export function initializeIpcHandlers(dependencies: {
    transcriptionManager: TranscriptionManager;
    enhancementManager: EnhancementManager;
    setProcessingCancelledFlag: (value: boolean) => void;
    getProcessingCancelledFlag: () => boolean; // Added getter
    sendRecordingStatus: (status: 'idle' | 'recording' | 'processing' | 'error') => void;
}): void {
    transcriptionManager = dependencies.transcriptionManager;
    enhancementManager = dependencies.enhancementManager;
    _setProcessingCancelledFlag = dependencies.setProcessingCancelledFlag;
    _getProcessingCancelledFlag = dependencies.getProcessingCancelledFlag; // Added getter
    _sendRecordingStatus = dependencies.sendRecordingStatus;
    logger.info('IPC Handlers initialized with dependencies.');
}

let _setProcessingCancelledFlag: (value: boolean) => void = () => {};
let _getProcessingCancelledFlag: () => boolean = () => false; // Added getter
let _sendRecordingStatus: (status: 'idle' | 'recording' | 'processing' | 'error') => void = () => {};

// New transcription handler with enhancement and history details
async function handleTranscribeAudio(
  _event: Electron.IpcMainInvokeEvent,
  audio: { audioData: ArrayBuffer; mimeType: string }
): Promise<void> {
  _setProcessingCancelledFlag(false);
  _sendRecordingStatus('processing');
  try {
    if (_getProcessingCancelledFlag()) { // Use getter
      logger.info('Processing cancelled by escape key.');
      _sendRecordingStatus('idle');
      return;
    }
    if (!transcriptionManager) throw new Error('TranscriptionManager not initialized.');
    const mainWindow = getMainWindow();
    if (!mainWindow) throw new Error('Main window not available.');

    const buffer = Buffer.from(audio.audioData);
    const originalText = await transcriptionManager.transcribe(buffer, audio.mimeType, undefined);
    let finalText = originalText;
    let promptDetails: { promptId: string; promptName: string; renderedPrompt: string; enhancedText: string }[] = [];

    const settings = store.get('enhancements') as EnhancementSettings;
    if (settings.enabled) {
      const { finalText: enhanced, promptDetails: details } = await enhancementManager.enhance(originalText);
      finalText = enhanced;
      promptDetails = details;
    }

    historyService.addHistoryEntry({ originalText, enhancedText: finalText !== originalText ? finalText : null, promptDetails });
    sendToMain('transcription-result', finalText);

    clipboard.writeText(finalText);

    if (process.platform === 'darwin') {
      exec('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', (error) => {
        if (error) {
          logger.error('Failed to simulate paste action:', error);
        } else {
          logger.info('Successfully simulated paste action.');
        }
      });
    } else {
      logger.warn('Auto-paste is only supported on macOS.');
    }

  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('IPC: transcribe-audio failed:', msg);
    sendToMain('transcription-error', msg);
    _sendRecordingStatus('error');
    throw err;
  } finally {
    _sendRecordingStatus('idle');
  }
}

export function setupIpcHandlers(): void {
    logger.info('Setting up IPC Handlers...');

    ipcMain.handle('getStoreValue', (_, key: string) => {
        logger.debug(`IPC: Handling getStoreValue for key: ${key}`);
        try {
            const value = store.get(key);
            logger.debug(`IPC: Value for ${key}:`, value);
            return value;
        } catch (error) {
            logger.error(`IPC: Error getting store value for key ${key}:`, error);
            throw error;
        }
    });
    ipcMain.handle('setStoreValue', (_, key: string, value: unknown) => {
        logger.debug(`IPC: Handling setStoreValue for key: ${key} with value:`, value);
        try {
            store.set(key, value);
            logger.debug(`IPC: Successfully set store value for key: ${key}`);
        } catch (error) {
            logger.error(`IPC: Error setting store value for key ${key}:`, error);
            throw error;
        }
    });

    ipcMain.handle('updateMonitoredKeys', (_, keys: string[]) => {
        logger.info('IPC: Received request to update monitored keys:', keys);
        if (process.platform === 'darwin') {
            const validKeys = keys.map(k => k.toUpperCase()).filter(k => ["COMMAND", "OPTION", "CONTROL", "SHIFT", "FN"].includes(k));
            startKeyMonitor(validKeys);
        } else {
            logger.warn('IPC: Key monitoring only supported on macOS.');
        }
    });

    ipcMain.handle('transcribe-audio', handleTranscribeAudio);

    ipcMain.handle('getAccessibilityStatus', handleGetAccessibilityStatus);
    ipcMain.handle('requestAccessibilityAccess', handleRequestAccessibilityAccess);
    ipcMain.handle('getMediaPermissionStatus', handleGetMediaPermissionStatus);
    ipcMain.handle('requestMediaPermission', handleRequestMediaPermission);
    ipcMain.handle('openSettingsURL', handleOpenSettingsURL);
    ipcMain.handle('getFocusedInputFieldText', handleGetFocusedInputFieldText);
    ipcMain.handle('controlMusic', handleControlMusic);
    ipcMain.handle('setSystemVolume', handleSetSystemVolume);
    ipcMain.handle('getSystemVolume', handleGetSystemVolume);

    ipcMain.handle('getHistory', (_, page?: number, pageSize?: number) => {
        logger.info(`IPC: Received request for history page ${page || 1}`);
        return historyService.getHistoryEntries(page, pageSize);
    });
    ipcMain.handle('deleteHistoryEntry', (_, id: string) => {
         logger.info(`IPC: Received request to delete history entry ${id}`);
         return historyService.deleteHistoryEntry(id);
    });
    ipcMain.handle('clearAllHistory', () => {
         logger.info(`IPC: Received request to clear all history`);
         return historyService.clearAllHistory();
    });

    ipcMain.on('processing-cancelled-silence', handleProcessingCancelledSilence);

    ipcMain.on('widget-stop-recording', () => {
        logger.info('Received stop recording request from widget');
        sendToMain('stop-recording');
    });

    ipcMain.on('recorder-actually-started', () => {
        logger.debug('IPC: Received notification that recorder actually started.');
        sendToWidget('widget-recorder-started');
    });

    ipcMain.handle('getDefaultPromptDetails', async (_event, id: string) => {
        const config = DEFAULT_PROMPTS_CONFIG[id];
        if (!config) {
            logger.error(`[IPC] getDefaultPromptDetails: Unknown default prompt ID requested: ${id}`);
            return null;
        }
        try {
            const basePath = app.isPackaged
                ? process.resourcesPath
                : path.join(app.getAppPath());
            const fullFilePath = path.join(basePath, config.filePath);

            logger.debug(`[IPC] Attempting to read default prompt file for ID "${id}" from: ${fullFilePath}`);
            const template = await fs.readFile(fullFilePath, 'utf-8');
            return { id, name: config.name, template, temperature: config.temperature };
        } catch (error) {
            logger.error(`[IPC] Failed to read default prompt file for ID "${id}" at ${config.filePath}:`, error);
            return { id, name: config.name, template: config.fallbackTemplate, temperature: config.temperature, isFallback: true };
        }
    });

    ipcMain.handle('getLogFilePath', () => {
        try {
            const logPath = log.transports.file.getFile().path;
            logger.info(`IPC: Providing log file path: ${logPath}`);
            return logPath;
        } catch (error) {
            logger.error('IPC: Error getting log file path:', error);
            throw error;
        }
    });

    ipcMain.handle('getLogLines', async (_, lineCount: number = 500) => {
        logger.info(`IPC: Received request for last ${lineCount} log lines.`);
        try {
            const logPath = log.transports.file.getFile().path;
            const data = await fs.readFile(logPath, 'utf-8');
            const lines = data.split('\n');
            const lastLines = lines.slice(Math.max(lines.length - lineCount, 0));
            logger.debug(`IPC: Returning ${lastLines.length} log lines.`);
            return lastLines;
        } catch (error) {
            logger.error(`IPC: Error reading log file for getLogLines:`, error);
            throw error;
        }
    });

    ipcMain.handle('playSystemSound', async (_, soundName: string) => {
        if (process.platform !== 'darwin') {
            logger.warn(`IPC: playSystemSound called on non-macOS platform for sound: ${soundName}. Ignoring.`);
            return;
        }
        if (!soundName || typeof soundName !== 'string' || !/^[a-zA-Z0-9]+$/.test(soundName)) {
            logger.error(`IPC: Invalid soundName received for playSystemSound: ${soundName}`);
            throw new Error('Invalid sound name provided.');
        }

        const soundPath = `/System/Library/Sounds/${soundName}.aiff`;
        logger.info(`IPC: Attempting to play system sound: ${soundPath}`);

        try {
            // Check if the sound file exists before attempting to play
            await fs.access(soundPath);
            exec(`afplay "${soundPath}"`, (error) => {
                if (error) {
                    logger.error(`IPC: Error playing system sound "${soundName}" using afplay:`, error);
                    // We don't throw here as it's not critical if the sound doesn't play
                } else {
                    logger.debug(`IPC: Successfully played system sound: ${soundName}`);
                }
            });
        } catch (accessError) {
            logger.error(`IPC: System sound file not found or not accessible: ${soundPath}`, accessError);
            // Not throwing, as it's a non-critical feature.
        }
    });

    logger.info('IPC Handlers setup complete.');
}

function handleGetAccessibilityStatus() {
    if (process.platform === 'darwin') {
        const isTrusted = systemPreferences.isTrustedAccessibilityClient(false);
        logger.info(`Accessibility Status Check: ${isTrusted ? 'granted' : 'not granted'}`);
        return isTrusted ? 'granted' : 'not-granted';
    }
    logger.warn('Accessibility status check only available on macOS.');
    return 'unavailable';
}

function handleRequestAccessibilityAccess() {
    if (process.platform === 'darwin') {
        logger.info('Checking/Requesting Accessibility access (will prompt user if needed)...');
        const isTrustedNow = systemPreferences.isTrustedAccessibilityClient(true);
        logger.info(`Accessibility status after check/prompt: ${isTrustedNow}`);
        return isTrustedNow;
    }
    logger.warn('Accessibility access request only available on macOS.');
    return false;
}

async function handleGetMediaPermissionStatus(_, mediaType: 'microphone' | 'camera' | 'screen') {
    if (process.platform !== 'darwin') return 'unavailable';
    try {
        const status = systemPreferences.getMediaAccessStatus(mediaType);
        logger.info(`Media Status Check [${mediaType}]: ${status}`);
        return status;
    } catch (error) {
        logger.error(`Error checking media status [${mediaType}]:`, error);
        return 'unavailable';
    }
}

async function handleRequestMediaPermission(_, mediaType: 'microphone' | 'camera') {
    if (process.platform !== 'darwin') return false;
    try {
        logger.info(`Requesting media access [${mediaType}]...`);
        const granted = await systemPreferences.askForMediaAccess(mediaType);
        logger.info(`Media access request result [${mediaType}]: ${granted}`);
        return granted;
    } catch (error) {
        logger.error(`Error requesting media access [${mediaType}]:`, error);
        return false;
    }
}

function handleOpenSettingsURL(_, url: string) {
    if (process.platform === 'darwin' && url.startsWith('x-apple.systempreferences:')) {
        logger.info(`Opening settings URL: ${url}`);
        return shell.openExternal(url);
    }
    logger.warn(`Invalid or unsupported settings URL requested: ${url}`);
    return Promise.resolve();
}

function handleProcessingCancelledSilence() {
    logger.info('IPC: Received notification that processing was cancelled due to silence.');

    _sendRecordingStatus('idle');

}

let mainProcessRecordingStatus: 'idle' | 'recording' | 'processing' | 'error' = 'idle';
export function updateIpcHandlerStatus(status: typeof mainProcessRecordingStatus): void {
    mainProcessRecordingStatus = status;
}

async function handleGetFocusedInputFieldText(): Promise<FocusedInputContext | null> {
    logger.debug('IPC: Received request for getFocusedInputFieldText, calling macOSIntegration module.');
    return getFocusedInputTextWithCursor();
}

async function executeAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
            if (error) {
                logger.error(`AppleScript execution error: ${error.message} Stderr: ${stderr}`);
                reject(error);
                return;
            }
            if (stderr) {
                logger.warn(`AppleScript execution stderr: ${stderr}`);
            }
            resolve(stdout.trim());
        });
    });
}

async function handleControlMusic(_event: Electron.IpcMainInvokeEvent, action: 'playpause' | 'play' | 'pause'): Promise<void> {
    if (process.platform !== 'darwin') {
        logger.warn('Music control is only available on macOS.');
        return;
    }
    logger.info(`IPC: handleControlMusic received action: ${action}`);
    const scripts = [
        `tell application "Spotify" to ${action}`,
        `tell application "Music" to ${action}`,
    ];

    for (const script of scripts) {
        try {
            await executeAppleScript(script);
            logger.info(`Successfully executed AppleScript for music control: ${script}`);
            return;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.debug(`Failed to control music with script "${script}", trying next. Error: ${errorMessage}`);
        }
    }
    logger.warn(`Could not control music; no target application (Spotify, Music) responded to action: ${action}.`);
}


async function handleSetSystemVolume(_event: Electron.IpcMainInvokeEvent, volume: number): Promise<void> {
    if (process.platform !== 'darwin') {
        logger.warn('Setting system volume is only available on macOS.');
        return;
    }
    if (typeof volume !== 'number' || volume < 0 || volume > 100) {
        logger.error(`IPC: Invalid volume level: ${volume}. Must be between 0 and 100.`);
        throw new Error('Invalid volume level. Must be between 0 and 100.');
    }
    logger.info(`IPC: handleSetSystemVolume received volume: ${volume}`);
    const script = `set volume output volume ${volume}`;
    try {
        await executeAppleScript(script);
        logger.info(`System volume set to ${volume}`);
    } catch (error) {
        logger.error(`Failed to set system volume to ${volume}:`, error);
        throw error;
    }
}

async function handleGetSystemVolume(): Promise<number | null> {
    if (process.platform !== 'darwin') {
        logger.warn('Getting system volume is only available on macOS.');
        return null;
    }
    logger.info('IPC: handleGetSystemVolume received request.');
    const script = `output volume of (get volume settings)`;
    try {
        const result = await executeAppleScript(script);
        const volume = parseInt(result, 10);
        if (isNaN(volume)) {
            logger.error(`Could not parse system volume from AppleScript result: "${result}"`);
            return null;
        }
        logger.info(`Current system volume retrieved: ${volume}`);
        return volume;
    } catch (error) {
        logger.error('Failed to get system volume:', error);
        return null;
    }
}

