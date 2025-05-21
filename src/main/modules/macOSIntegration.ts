import { systemPreferences, app } from 'electron';
import { execFile } from 'child_process';
import path from 'path';
import { logger } from '../logger';

export interface FocusedInputContext {
    text: string;
    selectedRange?: { start: number; length: number };
}

// Interface for the raw JSON output from the Swift helper
interface SwiftFocusedElementOutput {
    text?: string;
    selectionStart?: number;
    selectionLength?: number;
    error?: string;
    debugRole?: string;
}

/**
 * Determines the path to the compiled focused_input_helper executable.
 * @returns The path to the Swift helper executable.
 */
function getSwiftHelperPath(): string {
    const basePath = app.isPackaged
        ? path.join(process.resourcesPath)
        : path.join(app.getAppPath(), 'resources');
    return path.join(basePath, 'focused_input_helper');
}

/**
 * Retrieves the text content and selection range from the focused input element
 * on macOS using a native Swift helper.
 *
 * @returns A Promise that resolves to a string with `[]` marking the cursor position, or null otherwise.
 */
export async function getFocusedInputTextWithCursor(): Promise<FocusedInputContext | null> {
    if (process.platform !== 'darwin') {
        logger.warn('[macOSIntegration] getFocusedInputTextWithCursor is only available on macOS.');
        return null;
    }

    const hasAccessibility = systemPreferences.isTrustedAccessibilityClient(false);
    if (!hasAccessibility) {
        logger.warn(
            '[macOSIntegration] Accessibility permissions are not granted. ' +
            'Please enable this application in System Settings > Privacy & Security > Accessibility.'
        );
        return null;
    }

    const swiftHelperExecutablePath = getSwiftHelperPath();

    return new Promise((resolve) => {
        execFile(swiftHelperExecutablePath, (error, stdout, stderr) => {
            if (error) {
                logger.error('[macOSIntegration] Error executing Swift helper:', {
                    message: error.message,
                    code: (error as any).code,
                    signal: (error as any).signal,
                    path: swiftHelperExecutablePath,
                    stdout: stdout.toString().trim(),
                    stderr: stderr.toString().trim(),
                });
                resolve(null);
                return;
            }

            const stderrOutput = stderr.toString().trim();
            if (stderrOutput) {
                logger.warn('[macOSIntegration] Swift helper stderr output:', stderrOutput);
            }

            const stdoutOutput = stdout.toString().trim();
            if (!stdoutOutput) {
                logger.warn('[macOSIntegration] Swift helper stdout is empty.');
                resolve(null);
                return;
            }

            let parsedOutput: SwiftFocusedElementOutput;
            try {
                parsedOutput = JSON.parse(stdoutOutput);
            } catch (parseError: any) {
                logger.error('[macOSIntegration] Error parsing JSON from Swift helper:', {
                    errorMessage: parseError.message,
                    stdout: stdoutOutput.substring(0, 200)
                });
                resolve(null);
                return;
            }

            if (parsedOutput.error) {
                logger.info(`[macOSIntegration] Swift helper reported an error: ${parsedOutput.error}`, { debugRole: parsedOutput.debugRole });
                resolve(null);
                return;
            }
            
            let text = parsedOutput.text;
            if (text === undefined && 
                typeof parsedOutput.selectionStart === 'number' && 
                typeof parsedOutput.selectionLength === 'number') {
                text = "";
            }

            if (typeof text !== 'string') {
                 logger.warn('[macOSIntegration] Parsed text from Swift helper is not a string or is undefined, despite no error field.', { parsedOutput });
                 resolve(null);
                 return;
            }

            const context: FocusedInputContext = { text };

            if (typeof parsedOutput.selectionStart === 'number' &&
                typeof parsedOutput.selectionLength === 'number' &&
                parsedOutput.selectionStart >= 0 &&
                parsedOutput.selectionLength >= 0) {
                context.selectedRange = { start: parsedOutput.selectionStart, length: parsedOutput.selectionLength };
            }
            
            const textSnippet = (context.text || "").substring(0, 30).replace(/\n/g, '\\n');
            if (context.selectedRange) {
                logger.info(
                    `[macOSIntegration] Focused input (Swift): "${textSnippet}...", ` +
                    `Selection: ${context.selectedRange.start},${context.selectedRange.length}`
                );
            } else {
                 logger.info(
                    `[macOSIntegration] Focused input (Swift): "${textSnippet}..." (no valid selection data)`
                );
            }

            const raw = context.text;
            const startPos = context.selectedRange?.start ?? raw.length;
            const selLen = context.selectedRange?.length ?? 0;
            const textWithCursor = raw.slice(0, startPos) + "[[cursor]]" + raw.slice(startPos + selLen);

            resolve({ text: textWithCursor });
        });
    });
}