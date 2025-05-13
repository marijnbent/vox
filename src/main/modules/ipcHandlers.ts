import Mustache from 'mustache';
import { ipcMain, systemPreferences, shell, clipboard, app } from 'electron'; // Added app
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path'; // Added path
import log from 'electron-log';
import store from '../store';
import { logger } from '../logger';
import { TranscriptionManager } from '../transcription/TranscriptionManager';
import { EnhancementManager } from '../enhancement/EnhancementManager'; // Removed getDefaultPromptTemplate
import * as historyService from '../historyService';
import { startKeyMonitor } from './shortcutManager';
import { getMainWindow, sendToMain, sendToWidget } from './windowManager';
import { getFocusedInputTextWithCursor, type FocusedInputContext } from './macOSIntegration';
import type { EnhancementPrompt, EnhancementSettings } from '../store';
import type { HistoryRecord } from '../historyService';



let transcriptionManager: TranscriptionManager;
let enhancementManager: EnhancementManager;

export function initializeIpcHandlers(dependencies: {
    transcriptionManager: TranscriptionManager;
    enhancementManager: EnhancementManager;
    getProcessingCancelledFlag: () => boolean;
    setProcessingCancelledFlag: (value: boolean) => void;
    sendRecordingStatus: (status: 'idle' | 'recording' | 'processing' | 'error') => void;
}): void {
    transcriptionManager = dependencies.transcriptionManager;
    enhancementManager = dependencies.enhancementManager;
    _getProcessingCancelledFlag = dependencies.getProcessingCancelledFlag;
    _setProcessingCancelledFlag = dependencies.setProcessingCancelledFlag;
    _sendRecordingStatus = dependencies.sendRecordingStatus;
    logger.info('IPC Handlers initialized with dependencies.');
}

let _getProcessingCancelledFlag: () => boolean = () => false;
let _setProcessingCancelledFlag: (value: boolean) => void = () => {};
let _sendRecordingStatus: (status: 'idle' | 'recording' | 'processing' | 'error') => void = () => {};

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

    // Removed old getDefaultPromptContent handler

    // New handler for specific default prompt details
    ipcMain.handle('getDefaultPromptDetails', async (_event, id: string) => {
      const DEFAULT_PROMPTS_CONFIG = {
        "default_clean_transcription": {
          name: "Default Clean Transcription",
          filePath: "resources/prompt-clean-transcription.txt",
          temperature: 0.1,
          fallbackTemplate: "Clean this: {{transcription}}"
        },
        "default_contextual_formatting": {
          name: "Default Contextual Formatting",
          filePath: "resources/prompt-contextual-formatting.txt",
          temperature: 1.0,
          fallbackTemplate: "Format this: {{previous_output}}"
        }
      };

      const config = DEFAULT_PROMPTS_CONFIG[id as keyof typeof DEFAULT_PROMPTS_CONFIG];
      if (!config) {
        logger.error(`[IPC] getDefaultPromptDetails: Unknown default prompt ID requested: ${id}`);
        return null;
      }

      try {
        const basePath = app.isPackaged
            ? process.resourcesPath
            : path.join(app.getAppPath()); // resources subdir is part of config.filePath
        const fullFilePath = path.join(basePath, config.filePath);

        logger.debug(`[IPC] Attempting to read default prompt file for ID "${id}" from: ${fullFilePath}`);
        const template = await fs.readFile(fullFilePath, 'utf-8');
        return {
          id: id,
          name: config.name,
          template: template,
          temperature: config.temperature
        };
      } catch (error) {
        logger.error(`[IPC] Failed to read default prompt file for ID "${id}" at ${config.filePath}:`, error);
        return {
          id: id,
          name: config.name,
          template: config.fallbackTemplate,
          temperature: config.temperature,
          isFallback: true
        };
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

async function handleTranscribeAudio(_, audio: { audioData: ArrayBuffer; mimeType: string }): Promise<void> {
    _setProcessingCancelledFlag(false);
    const mainWindow = getMainWindow();

    if (!transcriptionManager) {
        logger.error('IPC: Cannot transcribe audio, TranscriptionManager not initialized.');
        _sendRecordingStatus('error');
        throw new Error('TranscriptionManager not initialized.');
    }
    if (!mainWindow) {
        logger.error('IPC: Cannot transcribe audio, mainWindow is not available.');
        _sendRecordingStatus('error');
        throw new Error('Main window not available.');
    }

    logger.info(`IPC: Received audio data (${audio.audioData.byteLength} bytes, type: ${audio.mimeType}) for transcription.`);
    _sendRecordingStatus('processing');

    let originalTranscriptionText = '';

    let finalText = '';
    let enhancementAttempted = false;
    let finalPromptRendered: string | null = null;

    try {
        if (_getProcessingCancelledFlag()) {
            logger.info('Processing cancelled by Escape before transcription.');
            return;
        }

        const audioBuffer = Buffer.from(audio.audioData);
        originalTranscriptionText = await transcriptionManager.transcribe(audioBuffer, audio.mimeType, undefined);
        finalText = originalTranscriptionText;
        logger.info(`IPC: Transcription successful: "${originalTranscriptionText}"`);

        if (_getProcessingCancelledFlag()) {
            logger.info('Processing cancelled by Escape after transcription.');
            return;
        }

        const enhancementSettings = store.get('enhancements') as EnhancementSettings;
        if (enhancementManager && enhancementSettings.enabled && !_getProcessingCancelledFlag()) {
            enhancementAttempted = true;
            try {
                logger.info('Applying enhancement...');
                // The enhancementManager.enhance now handles the prompt chain internally.
                // We don't need to render a single prompt here for history anymore.
                // The OpenaiEnhancementService logs each step of the chain.
                // For simplicity in history, we'll set finalPromptRendered to null.

                // const contextData setup and Mustache.render for finalPromptRendered is removed.
                // If specific context data is still needed by the enhancement service,
                // it should be passed through or handled within the service itself.
                // The current OpenaiEnhancementService already has logic for context variables.

                finalPromptRendered = null; // Simplified for history

                const enhancedTextResult = await enhancementManager.enhance(originalTranscriptionText);

                if (enhancedTextResult !== originalTranscriptionText) {
                     logger.info(`IPC: Enhancement successful: "${enhancedTextResult}"`);
                     finalText = enhancedTextResult;
                 } else {
                     logger.info('Enhancement did not modify the text.');
                 }
            } catch (enhancementError) {
                logger.error('Enhancement step failed:', enhancementError);
                finalPromptRendered = null;
            }
        } else if (_getProcessingCancelledFlag()) {
             logger.info('Enhancement skipped due to cancellation.');
        } else {
            logger.info('Enhancement disabled or provider is none, skipping.');
        }

        if (_getProcessingCancelledFlag()) {
            logger.info('Processing cancelled by Escape before history/paste.');
            return;
        }

        try {
            let promptIdForHistory: string | null = null; // Simplified for history
            if (enhancementAttempted) {
                // Optionally, store the chain as a string or just the first prompt ID
                // For now, keeping it simple as null, as the service logs details.
                // promptIdForHistory = enhancementSettings.activePromptChain.join(', ');
            }
            const historyEntryData: Omit<HistoryRecord, 'id' | 'timestamp'> = {
                originalText: originalTranscriptionText,
                renderedPrompt: finalPromptRendered, // Now null
                enhancedText: finalText !== originalTranscriptionText ? finalText : null,
                promptIdUsed: promptIdForHistory // Now null
            };
            historyService.addHistoryEntry(historyEntryData);
        } catch(historyError) {
             logger.error('Failed to save transcription to history:', historyError);
        }

        if (_getProcessingCancelledFlag()) {
            logger.info('Processing cancelled by Escape before sending result/pasting.');
            return;
        }

        sendToMain('transcription-result', finalText);
        _sendRecordingStatus('idle');

        if (store.get('settings.autoPaste', true) && !_getProcessingCancelledFlag()) {
           logger.info('Auto-paste enabled, writing to clipboard and simulating paste...');
           clipboard.writeText(finalText);
           if (process.platform === 'darwin') {
              const appleScript = `
                tell application "System Events"
                  keystroke "v" using command down
                end tell
              `;
              exec(`osascript -e '${appleScript}'`, (error) => {
                if (error) {
                  logger.error('Failed to execute paste AppleScript:', error);
                  sendToMain('transcription-error', 'Transcription complete, but failed to paste.');
                } else {
                  logger.info('Paste simulated via AppleScript.');
                }
              });
           } else {
              logger.warn('Auto-paste simulation not implemented for this platform.');
              sendToMain('transcription-error', 'Transcription complete, but auto-paste not supported on this OS.');
           }
        } else if (_getProcessingCancelledFlag()) {
            logger.info('Paste skipped due to cancellation.');
        } else {
            logger.info('Auto-paste disabled, skipping paste action.');
        }

    } catch (error: unknown) {
        if (_getProcessingCancelledFlag()) {
            logger.info('Processing cancelled by Escape during error handling.');
            if (mainProcessRecordingStatus !== 'idle') {
                _sendRecordingStatus('idle');
            }
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.error('IPC: Transcription failed:', message);
        sendToMain('transcription-error', message);
        _sendRecordingStatus('error');
        throw error;
    }
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

