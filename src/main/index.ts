import { app, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import store from './store';
import { logger, setupRendererLogger } from './logger';
import { TranscriptionManager } from './transcription/TranscriptionManager';
import { EnhancementManager } from './enhancement/EnhancementManager';
import * as WindowManager from './modules/windowManager';
import * as ShortcutManager from './modules/shortcutManager';
import * as IpcHandlers from './modules/ipcHandlers';
import { EventEmitter } from 'events';

// Central status emitter
export const statusEmitter = new EventEmitter();

let tray: Tray | null = null;
let transcriptionManager: TranscriptionManager;
let enhancementManager: EnhancementManager;
let processingCancelledByEscape = false;

export function sendRecordingStatus(status: 'idle' | 'recording' | 'processing' | 'error'): void {
    logger.info(`Updating status to: ${status}`);
    processingCancelledByEscape = status === 'error';

    // Emit the status update event
    statusEmitter.emit('status-update', status);

    // WindowManager still needs direct calls for now, will be refactored
    WindowManager.sendToMain('status-update', status);
    WindowManager.sendToWidget('widget-status-update', status);
    WindowManager.setWidgetClickThrough(status === 'idle' || status === 'error');
}

app.whenReady().then(async () => {
    logger.info('App ready, initializing...');
    electronApp.setAppUserModelId('com.electron');

    if (process.platform === 'darwin') {
      if (app.dock) {
        app.dock.hide();
      }
      logger.info('Dock icon hidden on macOS.');
    }

    setupRendererLogger();

    transcriptionManager = new TranscriptionManager();
    enhancementManager = new EnhancementManager();
    logger.info('Core managers (Transcription, Enhancement) initialized.');

    const sendRawShortcutAction = (action: string, keyName: string): void => {
        WindowManager.sendToMain('shortcutAction', action, keyName);
    };

    const startRecording = (): void => {
        WindowManager.sendToMain('start-recording');
    };

    const stopRecording = (): void => {
        WindowManager.sendToMain('stop-recording');
    };

    const cancelRecording = (): void => {
        WindowManager.sendToMain('cancel-recording');
    };

    const notifyProcessingCancelledByEscape = (): void => {
        processingCancelledByEscape = true;
    };

    const getProcessingCancelledFlag = (): boolean => {
        return processingCancelledByEscape;
    };

    const setProcessingCancelledFlag = (value: boolean): void => {
        processingCancelledByEscape = value;
    };

    ShortcutManager.initializeShortcutManager({
        sendRawShortcutAction,
        startRecording,
        stopRecording,
        cancelRecording,
        notifyProcessingCancelledByEscape,
    });

    IpcHandlers.initializeIpcHandlers({
        transcriptionManager,
        enhancementManager,
        getProcessingCancelledFlag,
        setProcessingCancelledFlag,
    });

    IpcHandlers.setupIpcHandlers();

    WindowManager.createMainWindow();
    WindowManager.createWidgetWindow();

    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window);
    });

    if (process.platform === 'darwin') {
        const initialKeys = (store.get('shortcutKeysMapped') as string[] | undefined) || [];
        logger.info('Starting initial key monitor with keys from store:', initialKeys);
        ShortcutManager.startKeyMonitor(initialKeys);
    } else {
        logger.warn('Key monitor helper is only supported on macOS.');
    }

    try {
        const iconPath = app.isPackaged
            ? path.join(process.resourcesPath, 'resources/icon-tray.png')
            : path.join(app.getAppPath(), 'resources/icon-tray.png');

        if (!fs.existsSync(iconPath)) {
            logger.error(`Tray icon not found at: ${iconPath}`);
        } else {
            logger.info(`Loading tray icon from: ${iconPath}`);
            const icon = nativeImage.createFromPath(iconPath);
            if (process.platform === 'darwin') {
                icon.setTemplateImage(true);
            }

            tray = new Tray(icon);

            const contextMenu = Menu.buildFromTemplate([
                {
                    label: 'Show Settings',
                    click: () => {
                        let win = WindowManager.getMainWindow();
                        if (!win || win.isDestroyed()) {
                            win = WindowManager.createMainWindow();
                            win.once('ready-to-show', () => {
                                win?.show();
                                win?.focus();
                            });
                        } else {
                            win.show();
                            win.focus();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit Vox Transcriber',
                    click: () => {
                        app.quit();
                    }
                }
            ]);

            tray.setToolTip('Vox Transcriber');
            tray.setContextMenu(contextMenu);

            if (process.platform === 'darwin') {
                tray.on('click', () => {
                    const win = WindowManager.getMainWindow();
                    if (win && !win.isDestroyed()) {
                        if (win.isVisible() && win.isFocused()) {
                            win.hide();
                        } else {
                            win.show();
                            win.focus();
                        }
                    } else {
                        const newWin = WindowManager.createMainWindow();
                        newWin.once('ready-to-show', () => {
                            newWin?.show();
                            newWin?.focus();
                        });
                    }
                });
            }
        }
    } catch (error) {
        logger.error('Failed to create Tray icon:', error);
    }

    app.on('activate', () => {
        let win = WindowManager.getMainWindow();
        if (!win || win.isDestroyed()) {
            win = WindowManager.createMainWindow();
            win.once('ready-to-show', () => {
                win?.show();
                win?.focus();
            });
        } else {
            win.show();
            win.focus();
        }
        if (WindowManager.getWidgetWindow() === null) {
            WindowManager.createWidgetWindow();
        }
    });

    logger.info('App initialization complete.');

}).catch(error => {
    logger.error('Error during app initialization:', error);
    app.quit();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    ShortcutManager.stopKeyMonitor();
});

app.on('will-quit', () => {
    ShortcutManager.stopKeyMonitor();
});
