import { systemPreferences, app } from 'electron';
import { execFile } from 'child_process';
import path from 'path';
import { logger } from '../logger'; // Assuming logger is correctly set up

export interface FocusedInputContext {
    text: string;
    selectedRange?: { start: number; length: number }; // start is 0-indexed
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
 * @returns A Promise that resolves to FocusedInputContext if successful, or null otherwise.
 */
export async function getFocusedInputTextWithCursor(): Promise<FocusedInputContext | null> {
    if (process.platform !== 'darwin') {
        logger.warn('[macOSIntegration] getFocusedInputTextWithCursor is only available on macOS.');
        return null;
    }

    // Check for accessibility permissions without prompting
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
                // Log stderr as it might contain non-fatal accessibility warnings from Swift
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
                    stdout: stdoutOutput.substring(0, 200) // Log a snippet of the problematic stdout
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
            // As per prompt: If result.text is undefined but selection is valid, default to an empty string.
            // Note: The Swift script is designed to already do this, so `text` should ideally be a string.
            if (text === undefined && 
                typeof parsedOutput.selectionStart === 'number' && 
                typeof parsedOutput.selectionLength === 'number') {
                text = "";
            }

            // If text is still not a string, it's an unexpected state or no actual text data.
            if (typeof text !== 'string') {
                 logger.warn('[macOSIntegration] Parsed text from Swift helper is not a string or is undefined, despite no error field.', { parsedOutput });
                 resolve(null); // Or handle as "no text found" if appropriate
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

            resolve(context);
        });
    });
}