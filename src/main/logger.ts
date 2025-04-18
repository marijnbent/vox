import { ipcMain } from 'electron';
import log from 'electron-log';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.initialize();

let _sendLogLineCallback: ((line: string) => void) | null = null;

export function setLogCallback(callback: (line: string) => void): void {
  _sendLogLineCallback = callback;
}

export function mainLog(level: 'info' | 'warn' | 'error' | 'debug' | 'verbose', message: string, ...args: unknown[]): void {
  const fullMessage = `[Main] ${message} ${args.map(String).join(' ')}`;
  log[level](fullMessage);
  if (_sendLogLineCallback) { _sendLogLineCallback(fullMessage); }
}

export function setupRendererLogger(): void {
  ipcMain.on('logFromRenderer', (_event, level: string, message: string, ...args: unknown[]) => {
    const validLevels = ['info', 'warn', 'error', 'debug', 'verbose'];
    const logLevel = validLevels.includes(level) ? level as 'info' | 'warn' | 'error' | 'debug' | 'verbose' : 'info';
    const fullMessage = `[Renderer] ${message} ${args.map(String).join(' ')}`;
    log[logLevel](fullMessage);
    if (_sendLogLineCallback) { _sendLogLineCallback(fullMessage); }
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