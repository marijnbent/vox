import { app, BrowserWindow, screen, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { logger } from '../logger';

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
    return mainWindow;
}

export function getWidgetWindow(): BrowserWindow | null {
    return widgetWindow;
}

export function createMainWindow(): BrowserWindow {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 670,
        show: false,
        autoHideMenuBar: true,
        titleBarStyle: 'hiddenInset',
        title: 'Vox',
        webPreferences: {
            preload: join(app.getAppPath(), './out/preload/index.js'),
            sandbox: false,
            contextIsolation: true
        }
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url);
        return { action: 'deny' };
    });

    const mainWindowPath = join(app.getAppPath(), './out/renderer/index.html');
    const mainWindowUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
        ? process.env['ELECTRON_RENDERER_URL']
        : mainWindowPath;
    if (is.dev) {
        mainWindow.loadURL(mainWindowUrl);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        mainWindow.loadFile(mainWindowPath);
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    return mainWindow;
}

export function createWidgetWindow(): BrowserWindow | null {
    if (widgetWindow) {
        widgetWindow.focus();
        return widgetWindow;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: displayWidth, height: displayHeight } = primaryDisplay.workAreaSize;

    const widgetWidth = 320;
    const widgetHeight = 100;

    const x = Math.round((displayWidth - widgetWidth) / 2);
    const y = Math.round(displayHeight - widgetHeight - 40);

    widgetWindow = new BrowserWindow({
        width: widgetWidth,
        height: widgetHeight,
        x: x,
        y: y,
        show: true,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
            preload: join(app.getAppPath(), './out/preload/widget.js'),
            sandbox: false,
            contextIsolation: true,
        }
    });

    setWidgetClickThrough(true);

    let loadPath: string;
    let isUrl = false;

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        const devServerUrl = new URL(process.env['ELECTRON_RENDERER_URL']);
        devServerUrl.pathname = 'widget.html';
        loadPath = devServerUrl.toString();
        isUrl = true;
    } else {
        loadPath = join(app.getAppPath(), './out/renderer/widget.html');
        isUrl = false;
    }

    if (isUrl) {
        widgetWindow.loadURL(loadPath).catch(err => {
            logger.error('Failed to load widget URL:', err);
        });
    } else {
        widgetWindow.loadFile(loadPath).catch(err => {
            logger.error('Failed to load widget URL:', err);
        });
    }

    widgetWindow.on('closed', () => {
        widgetWindow = null;
    });

    widgetWindow.on('focus', () => {
        focusMainWindow();
    });

    return widgetWindow;
}

export function setWidgetClickThrough(ignore: boolean): void {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.setIgnoreMouseEvents(ignore, { forward: ignore });
    }
}

export function focusMainWindow(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
    }
}

export function closeAllWindows(): void {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.close();
        widgetWindow = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
        mainWindow = null;
    }
}

export function sendToWidget(channel: string, ...args: any[]): void {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        widgetWindow.webContents.send(channel, ...args);
    }
}

export function sendToMain(channel: string, ...args: any[]): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
    }
}