import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { app } from 'electron';
import path from 'path';
import { logger } from '../logger';

export enum ShortcutState {
    IDLE,
    RECORDING_POTENTIAL_CLICK_OR_HOLD,
    WAITING_FOR_SECOND_CLICK,
    TOGGLE_RECORDING,
}

let currentState: ShortcutState = ShortcutState.IDLE;
let keyDownTime: number | null = null;
let firstClickUpTime: number | null = null;
let holdTimeoutId: NodeJS.Timeout | null = null;
let doubleClickTimeoutId: NodeJS.Timeout | null = null;
let keyMonitorProcess: ChildProcessWithoutNullStreams | null = null;
let currentlyMonitoredKeys: string[] = [];
let ignoreNextUpInToggle = false;

const HOLD_DURATION_THRESHOLD = 500;
const DOUBLE_CLICK_WINDOW = 500;

let _sendRecordingStatus: (status: 'idle' | 'recording' | 'processing' | 'error') => void = () => {};
let _sendRawShortcutAction: (action: string, keyName: string) => void = () => {};
let _startRecording: () => void = () => {};
let _stopRecording: () => void = () => {};
let _cancelRecording: () => void = () => {};
let _notifyProcessingCancelledByEscape: () => void = () => {};

export function initializeShortcutManager(dependencies: {
    sendRecordingStatus: typeof _sendRecordingStatus;
    sendRawShortcutAction: typeof _sendRawShortcutAction;
    startRecording: typeof _startRecording;
    stopRecording: typeof _stopRecording;
    cancelRecording: typeof _cancelRecording;
    notifyProcessingCancelledByEscape: typeof _notifyProcessingCancelledByEscape;
}): void {
    _sendRecordingStatus = dependencies.sendRecordingStatus;
    _sendRawShortcutAction = dependencies.sendRawShortcutAction;
    _startRecording = dependencies.startRecording;
    _stopRecording = dependencies.stopRecording;
    _cancelRecording = dependencies.cancelRecording;
    _notifyProcessingCancelledByEscape = dependencies.notifyProcessingCancelledByEscape;
    logger.info('Shortcut Manager initialized with dependencies.');
}

function resetShortcutState(): void {
    logger.debug("Resetting shortcut state machine to IDLE.");
    currentState = ShortcutState.IDLE;
    keyDownTime = null;
    firstClickUpTime = null;
    if (holdTimeoutId) clearTimeout(holdTimeoutId);
    holdTimeoutId = null;
    if (doubleClickTimeoutId) clearTimeout(doubleClickTimeoutId);
    doubleClickTimeoutId = null;
    ignoreNextUpInToggle = false;
}

function handleKeyEvent(keyName: string, type: 'DOWN' | 'UP'): void {
    const now = Date.now();
    logger.debug(`Key Event: ${keyName}_${type} | Current State: ${ShortcutState[currentState]} | Main Status: ${mainProcessRecordingStatus}`);

    if (type === 'DOWN') {
        if (mainProcessRecordingStatus !== 'idle') {
            logger.debug(`Ignoring Key Down ${keyName} because main status is 'processing'.`);
            return;
        }

        if (currentState === ShortcutState.WAITING_FOR_SECOND_CLICK) {
            if (doubleClickTimeoutId) clearTimeout(doubleClickTimeoutId);
            doubleClickTimeoutId = null;

            if (now - (firstClickUpTime ?? 0) < DOUBLE_CLICK_WINDOW) {
                logger.info(`Double Click Detected on ${keyName}. Starting Toggle Recording.`);
                _sendRawShortcutAction('doubleClickStartToggle', keyName);
                currentState = ShortcutState.TOGGLE_RECORDING;
                ignoreNextUpInToggle = true;
                _startRecording();
                _sendRecordingStatus('recording');
            } else {
                logger.debug(`Second click on ${keyName} too late. Treating as new press.`);
                currentState = ShortcutState.RECORDING_POTENTIAL_CLICK_OR_HOLD;
                keyDownTime = now;
                _startRecording();
                _sendRecordingStatus('recording');
            }
        } else if (currentState === ShortcutState.IDLE) {
            logger.debug(`Key Down ${keyName} - Starting immediate recording (Potential Click/Hold).`);
            currentState = ShortcutState.RECORDING_POTENTIAL_CLICK_OR_HOLD;
            keyDownTime = now;
            _startRecording();
            _sendRecordingStatus('recording');
        } else {
            logger.debug(`Ignoring duplicate Key Down ${keyName} in state ${ShortcutState[currentState]}.`);
        }
    } else {
        if (keyDownTime === null && currentState !== ShortcutState.TOGGLE_RECORDING) {
             logger.debug(`Ignoring Key Up ${keyName} - keyDownTime is null or state is unexpected (${ShortcutState[currentState]}).`);
             return;
        }

        const duration = keyDownTime ? now - keyDownTime : 0;
        logger.debug(`Key Up ${keyName}. Duration: ${duration}ms. State: ${ShortcutState[currentState]}`);

        if (currentState === ShortcutState.RECORDING_POTENTIAL_CLICK_OR_HOLD) {
            if (duration < HOLD_DURATION_THRESHOLD) {
                logger.info(`Quick Click Detected on ${keyName}. Cancelling recording.`);
                _sendRawShortcutAction('clickCancel', keyName);
                _cancelRecording();
                logger.debug(`Waiting for potential second click...`);
                currentState = ShortcutState.WAITING_FOR_SECOND_CLICK;
                firstClickUpTime = now;

                if (doubleClickTimeoutId) clearTimeout(doubleClickTimeoutId);
                doubleClickTimeoutId = setTimeout(() => {
                    if (currentState === ShortcutState.WAITING_FOR_SECOND_CLICK) {
                        logger.debug(`Double click timeout expired for ${keyName}. Confirmed single click (ignored). Resetting to IDLE.`);
                        resetShortcutState();
                        _sendRecordingStatus('idle');
                    }
                }, DOUBLE_CLICK_WINDOW);

            } else {
                logger.info(`Hold Released ${keyName}. Stopping PTT Recording.`);
                _sendRawShortcutAction('holdEnd', keyName);
                _stopRecording();
                _sendRecordingStatus('processing');
                resetShortcutState();
            }
        } else if (currentState === ShortcutState.TOGGLE_RECORDING) {
            if (ignoreNextUpInToggle) {
                logger.debug('Ignoring UP event immediately after double-click confirmation.');
                ignoreNextUpInToggle = false;
            } else {
                logger.info(`Stopping Toggle Recording due to UP event.`);
                _sendRawShortcutAction('toggleStop', keyName);
                _stopRecording();
                _sendRecordingStatus('processing');
                resetShortcutState();
            }
        } else {
             logger.debug(`Ignoring Key Up ${keyName} in state ${ShortcutState[currentState]}.`);
        }
    }
}

function handleEscapeKey(): void {
    logger.info('Escape key pressed (from Swift).');
    const currentStatus = mainProcessRecordingStatus;

    if (currentStatus === 'recording') {
        logger.info('🔴 Cancelling active recording via Escape key.');
        _cancelRecording();
        resetShortcutState();
        _sendRecordingStatus('idle');
    } else if (currentStatus === 'processing') {
        logger.info('🟡 Cancelling ongoing processing via Escape key.');
        _notifyProcessingCancelledByEscape();
        resetShortcutState();
        _sendRecordingStatus('idle');
    } else if (currentState === ShortcutState.WAITING_FOR_SECOND_CLICK) {
         logger.info('🟡 Cancelling wait for double-click via Escape key.');
         resetShortcutState();
         _sendRecordingStatus('idle');
    } else {
        logger.debug('Escape pressed, but not in a cancellable state.');
    }
}

export function startKeyMonitor(keysToWatch: string[]): void {
    if (keyMonitorProcess) {
        logger.debug('Stopping existing key monitor before starting new one...');
        stopKeyMonitor();
    }

    if (!keysToWatch || keysToWatch.length === 0) {
        logger.info("No keys specified to monitor. Key monitor not started.");
        currentlyMonitoredKeys = [];
        resetShortcutState();
        return;
    }

    const basePath = app.isPackaged
        ? path.join(process.resourcesPath)
        : path.join(app.getAppPath(), 'resources');
    const executablePath = path.join(basePath, 'key-monitor');

    logger.info(`Attempting to start key monitor at: ${executablePath} with keys: ${keysToWatch.join(', ')}`);
    currentlyMonitoredKeys = [...keysToWatch];
    resetShortcutState();

    try {
        keyMonitorProcess = spawn(executablePath, keysToWatch);

        keyMonitorProcess.stdout.on('data', (data: Buffer) => {
            const messages = data.toString().trim().split('\n');
            messages.forEach(message => {
                if (!message) return;

                if (message === 'ESCAPE_DOWN') {
                    handleEscapeKey();
                    return;
                }

                const parts = message.split('_');
                if (parts.length === 2) {
                    const keyName = parts[0];
                    const type = parts[1] as 'DOWN' | 'UP';
                    if ((type === 'DOWN' || type === 'UP') && currentlyMonitoredKeys.includes(keyName) && keyName !== 'ESCAPE') {
                        handleKeyEvent(keyName, type);
                    } else if (!currentlyMonitoredKeys.includes(keyName)) {
                        logger.warn(`Received event for unexpected key: ${keyName}`);
                    }
                } else if (message.startsWith('Monitoring') || message.startsWith('Event tap created')) {
                    logger.debug(`Key Monitor Helper: ${message}`);
                } else {
                     logger.warn(`Received unknown message from key monitor: ${message}`);
                }
            });
        });

        keyMonitorProcess.stderr.on('data', (data: Buffer) => {
            logger.error(`Key Monitor Error: ${data.toString().trim()}`);
        });

        keyMonitorProcess.on('close', (code) => {
            logger.warn(`Key monitor process exited with code ${code}`);
            if (keyMonitorProcess && code !== 0) {
                logger.info('Attempting to restart key monitor...');
                setTimeout(() => startKeyMonitor(currentlyMonitoredKeys), 5000);
            } else {
                keyMonitorProcess = null;
                currentlyMonitoredKeys = [];
                resetShortcutState();
            }
        });

        keyMonitorProcess.on('error', (err) => {
            logger.error('Failed to start key monitor process:', err);
            keyMonitorProcess = null;
            currentlyMonitoredKeys = [];
            resetShortcutState();
        });

    } catch (error) {
        logger.error('Error spawning key monitor process:', error);
        keyMonitorProcess = null;
        currentlyMonitoredKeys = [];
        resetShortcutState();
    }
}

export function stopKeyMonitor(): void {
    if (keyMonitorProcess) {
        logger.info('Stopping key monitor process...');
        keyMonitorProcess.removeAllListeners();
        keyMonitorProcess.kill();
        keyMonitorProcess = null;
        currentlyMonitoredKeys = [];
        resetShortcutState();
        logger.info('Key monitor stopped.');
    }
}

let mainProcessRecordingStatus: 'idle' | 'recording' | 'processing' | 'error' = 'idle';
export function updateMainProcessStatus(status: typeof mainProcessRecordingStatus): void {
    mainProcessRecordingStatus = status;
}