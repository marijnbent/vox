import { ipcMain } from 'electron';
import log from 'electron-log';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.initialize();

export function mainLog(level: 'info' | 'warn' | 'error' | 'debug' | 'verbose', message: string, ...args: unknown[]): void {
  log[level](`[Main] ${message}`, ...args);
}

export function setupRendererLogger(): void {
  ipcMain.on('logFromRenderer', (_event, level: string, message: string, ...args: unknown[]) => {
    const validLevels = ['info', 'warn', 'error', 'debug', 'verbose'];
    const logLevel = validLevels.includes(level) ? level as 'info' | 'warn' | 'error' | 'debug' | 'verbose' : 'info';
    log[logLevel](`[Renderer] ${message}`, ...args);
  });
  mainLog('info', 'Renderer logger initialized via IPC.');
}

export const logger = {
    info: (message: string, ...args: unknown[]): void => mainLog('info', message, ...args),
    warn: (message: string, ...args: unknown[]): void => mainLog('warn', message, ...args),
    error: (message: string, ...args: unknown[]): void => mainLog('error', message, ...args),
    debug: (message: string, ...args: unknown[]): void => mainLog('debug', message, ...args),
    verbose: (message: string, ...args: unknown[]): void => mainLog('verbose', message, ...args),
};