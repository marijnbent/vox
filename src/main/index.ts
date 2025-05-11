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

let tray: Tray | null = null;
let transcriptionManager: TranscriptionManager;
let enhancementManager: EnhancementManager;
let processingCancelledByEscape = false;

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

    const sendRecordingStatus = (status: 'idle' | 'recording' | 'processing' | 'error'): void => {
        logger.info(`[Main] Sending status update: ${status}`);
        ShortcutManager.updateMainProcessStatus(status);
        IpcHandlers.updateIpcHandlerStatus(status);
        WindowManager.sendToMain('recording-status', status);
        WindowManager.sendToWidget('widget-status-update', status);
        WindowManager.setWidgetClickThrough(status === 'idle' || status === 'error');
    };

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
        sendRecordingStatus,
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
        sendRecordingStatus,
    });

    IpcHandlers.setupIpcHandlers();

    logger.info('Log callback set for IPC communication.');


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
            ? path.join(process.resourcesPath, 'icon-tray.png')
            : path.join(app.getAppPath(), 'resources/icon-tray.png');

        if (!fs.existsSync(iconPath)) {
            logger.error(`Tray icon not found at: ${iconPath}`);
        } else {
            logger.info(`Loading tray icon from: ${iconPath}`);
            const icon = nativeImage.createFromPath(iconPath);
            if (icon.isEmpty()) {
                logger.error('Created nativeImage is empty.');
            } else {
                logger.info('nativeImage created successfully.');
            }
            if (process.platform === 'darwin') {
                logger.info('Setting template image for macOS.');
                icon.setTemplateImage(true);
            }

            logger.info('Attempting to create Tray object...');
            tray = new Tray(icon);
            if (tray) {
                logger.info('Tray object created successfully.');
            } else {
                logger.error('Failed to create Tray object.');
            }

            logger.info('Building context menu...');
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
            logger.info('Context menu built.');

            logger.info('Setting tooltip...');
            tray.setToolTip('Vox Transcriber');
            logger.info('Tooltip set.');

            logger.info('Setting context menu...');
            tray.setContextMenu(contextMenu);
            logger.info('Context menu set.');

            if (process.platform === 'darwin') {
                logger.info('Setting up tray click listener for macOS...');
                tray.on('click', () => {
                    logger.info('Tray clicked on macOS.');
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
