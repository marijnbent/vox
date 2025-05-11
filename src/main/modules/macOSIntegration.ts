import { systemPreferences } from 'electron';
import { exec } from 'child_process';
import { logger } from '../logger'; // Assuming logger is correctly set up

export interface FocusedInputContext {
    text: string;
    selectedRange?: { start: number; length: number }; // start is 0-indexed
}

/**
 * Retrieves the text content and selection range from the focused input element
 * on macOS using AppleScript.
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

    const appleScript = `
tell application "System Events"
    try
        set frontApp to first application process whose frontmost is true
        if frontApp is missing value then error "No_Front_App"

        set currentFocusedElement to value of attribute "AXFocusedUIElement" of frontApp
        if currentFocusedElement is missing value then error "No_Focused_UI_Element_For_App"

        -- Attempt to find a more specific focused element if the current one is a common container type
        try
            set elementRole to role of currentFocusedElement
            if elementRole is "AXWebArea" or elementRole is "AXScrollArea" or elementRole is "AXGroup" or elementRole is "AXWindow" or elementRole is "AXStandardWindow" then
                set deeperFocusedElement to value of attribute "AXFocusedUIElement" of currentFocusedElement
                -- If a deeper element exists and is different, assume it's more specific
                if deeperFocusedElement is not missing value and deeperFocusedElement is not currentFocusedElement then
                    set currentFocusedElement to deeperFocusedElement
                end if
            end if
        on error
            -- If there's an error querying role or deeper element, proceed with the currentFocusedElement
        end try
        
        set elementText to ""
        set selStart to -1
        set selLength to -1

        -- Try to get the text value of the focused element
        try
            if exists attribute "AXValue" of currentFocusedElement then
                set val to value of attribute "AXValue" of currentFocusedElement
                if val is not missing value then
                    set elementText to val as string -- Coerce to string
                end if
            end if
        on error
            -- Failed to get AXValue, elementText will remain ""
        end try

        -- Try to get the selection range
        try
            if exists attribute "AXSelectedTextRange" of currentFocusedElement then
                set selectedRange to value of attribute "AXSelectedTextRange" of currentFocusedElement
                if selectedRange is not missing value then
                    set selStart to item 1 of selectedRange
                    set selLength to item 2 of selectedRange
                end if
            end if
        on error
            -- Failed to get AXSelectedTextRange, selStart/selLength will remain -1
        end try
        
        -- Ensure elementText is a string (additional safeguard)
        if class of elementText is not string then
            set elementText to ""
        end if

        -- Return data only if we have some text or a valid selection range
        -- A valid selection could be (0,0) for a cursor in an empty field
        if (elementText is not "") or (selStart > -1 and selLength > -1) then
            return selStart & "\n" & selLength & "\n" & elementText
        else
            return "NODATA" -- Specific string indicating no relevant data found
        end if

    on error errMsg
        -- For debugging, one could return "ERROR_AS:" & errMsg
        return "ERROR" -- General error occurred within AppleScript
    end try
end tell
    `;

    return new Promise((resolve) => {
        // Important: Escape single quotes in the AppleScript string for shell execution
        const escapedAppleScript = appleScript.replace(/'/g, "'\\''");

        exec(`osascript -e '${escapedAppleScript}'`, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                logger.error('[macOSIntegration] Error executing AppleScript:', {
                    message: error.message,
                    stdout: stdout.toString().trim(),
                    stderr: stderr.toString().trim(),
                });
                resolve(null);
                return;
            }

            const stderrOutput = stderr.toString().trim();
            if (stderrOutput) {
                // AppleScript might "succeed" (exit code 0) but still print to stderr (e.g., from 'log' commands)
                logger.warn('[macOSIntegration] AppleScript stderr output:', stderrOutput);
            }

            const result = stdout.toString().trim();

            if (result === "NODATA" || result === "ERROR") {
                logger.info(`[macOSIntegration] AppleScript indicated no usable data or an error (${result}).`);
                resolve(null);
                return;
            }
            
            // Example of handling more detailed AppleScript errors if "ERROR_AS:" prefix was used
            // if (result.startsWith("ERROR_AS:")) {
            //      logger.warn(`[macOSIntegration] AppleScript reported an internal error: ${result}`);
            //      resolve(null);
            //      return;
            // }

            const lines = result.split('\n');
            
            // We expect at least 3 parts: selStart, selLength, and text (text itself can be empty or contain newlines)
            // Example: "0\n0\n" (empty text, cursor at start) -> lines = ["0", "0", ""] (length 3)
            // Example: "5\n3\nHello" -> lines = ["5", "3", "Hello"] (length 3)
            // Example: "0\n0\nLine1\nLine2" -> lines = ["0", "0", "Line1", "Line2"] (length 4)
            if (lines.length >= 3) {
                const selectionStartStr = lines[0];
                const selectionLengthStr = lines[1];
                // Reconstruct text content, which might itself contain newlines
                const textValue = lines.slice(2).join('\n');

                const selectionStart = parseInt(selectionStartStr, 10);
                const selectionLength = parseInt(selectionLengthStr, 10);

                const context: FocusedInputContext = { text: textValue };

                if (!isNaN(selectionStart) && selectionStart !== -1 && 
                    !isNaN(selectionLength) && selectionLength !== -1) {
                    context.selectedRange = { start: selectionStart, length: selectionLength };
                    logger.info(
                        `[macOSIntegration] Focused input: "${textValue.substring(0, 30).replace(/\n/g, '\\n')}...", ` +
                        `Selection: ${selectionStart},${selectionLength}`
                    );
                } else {
                    // Text was retrieved, but selection data was invalid or not present (-1)
                    logger.info(
                        `[macOSIntegration] Focused input: "${textValue.substring(0, 30).replace(/\n/g, '\\n')}..." (no valid selection data)`
                    );
                }
                resolve(context);

            } else {
                // This indicates an unexpected output format from the AppleScript
                logger.warn('[macOSIntegration] Unexpected AppleScript output format (not enough parts):', result.substring(0,100));
                resolve(null);
            }
        });
    });
}