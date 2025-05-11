import AppKit
import Accessibility

// Define the output data structure
struct FocusedElementOutput: Codable {
    var text: String?
    var selectionStart: Int?
    var selectionLength: Int?
    var error: String?
    var debugRole: String? // Optional for debugging
}

func getFocusedElementInfo() -> FocusedElementOutput {
    // Get the frontmost application
    guard let frontmostApp = NSWorkspace.shared.frontmostApplication else {
        return FocusedElementOutput(error: "Error:NoFrontmostApplication")
    }
    let pid = frontmostApp.processIdentifier
    let appElement = AXUIElementCreateApplication(pid)

    // Get the initially focused UI element
    var focusedElementRef: CFTypeRef?
    var result = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedElementRef)
    var focusedElement = focusedElementRef as! AXUIElement?

    if result != AXError.success || focusedElement == nil {
        // Attempt to get focused window if no focused UI element at app level
        var focusedWindowRef: CFTypeRef?
        result = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &focusedWindowRef)
        if result == AXError.success, let windowElement = focusedWindowRef as! AXUIElement? {
            // Now try to get the focused UI element from the window
            focusedElementRef = nil // Reset for the next call
            result = AXUIElementCopyAttributeValue(windowElement, kAXFocusedUIElementAttribute as CFString, &focusedElementRef)
            focusedElement = focusedElementRef as! AXUIElement?
            if result != AXError.success || focusedElement == nil {
                 return FocusedElementOutput(error: "Error:NoFocusedUIElementInAppOrWindow")
            }
        } else {
            return FocusedElementOutput(error: "Error:NoFocusedUIElementOrWindow")
        }
    }
    
    guard var currentFocusedElement = focusedElement else {
        return FocusedElementOutput(error: "Error:CouldNotCastInitialFocusedElement")
    }

    // Iterative Drill-Down to find the deepest focused element
    // Max 8 iterations to prevent potential infinite loops in rare cases
    for _ in 0..<8 {
        var deeperFocusedElementRef: AnyObject?
        let drillResult = AXUIElementCopyAttributeValue(currentFocusedElement, kAXFocusedUIElementAttribute as CFString, &deeperFocusedElementRef)

        if drillResult == .success, let deeperFocusedElement = deeperFocusedElementRef as! AXUIElement?, deeperFocusedElement != currentFocusedElement {
            currentFocusedElement = deeperFocusedElement
        } else {
            // No deeper element, or it's the same, or an error occurred
            break
        }
    }
    
    let finalFocusedElement = currentFocusedElement

    // Extract Data from Final Focused Element
    var textValue: String?
    var selectionStart: Int?
    var selectionLength: Int?
    var debugRole: String?

    // Get Role for debugging
    var roleRef: AnyObject?
    if AXUIElementCopyAttributeValue(finalFocusedElement, kAXRoleAttribute as CFString, &roleRef) == .success {
        if let role = roleRef as? String {
            debugRole = role
        }
    }

    // Text Value
    var valueRef: AnyObject?
    if AXUIElementCopyAttributeValue(finalFocusedElement, kAXValueAttribute as CFString, &valueRef) == .success {
        if let strValue = valueRef as? String {
            textValue = strValue
        } else if let numValue = valueRef as? NSNumber {
            textValue = numValue.stringValue
        }
        // Add more type checks if necessary, e.g., for attributed strings
    }

    // Selection Range
    var selectedTextRangeRef: AnyObject?
    if AXUIElementCopyAttributeValue(finalFocusedElement, kAXSelectedTextRangeAttribute as CFString, &selectedTextRangeRef) == .success {
        if let axValue = selectedTextRangeRef as! AXValue? {
            var range = CFRange()
            if AXValueGetValue(axValue, AXValueType.cfRange, &range) {
                if range.location != kCFNotFound && range.length != kCFNotFound {
                    selectionStart = range.location
                    selectionLength = range.length
                } else if range.location != kCFNotFound {
                    selectionStart = range.location
                    selectionLength = 0 // Default to 0 if length is not found but location is
                }
            }
        }
    }
    
    if textValue == nil && selectionStart != nil {
        textValue = ""
    }

    // Construct Output
    if textValue != nil || (selectionStart != nil && selectionLength != nil) {
        return FocusedElementOutput(text: textValue, selectionStart: selectionStart, selectionLength: selectionLength, error: nil, debugRole: debugRole)
    } else {
        // If we have a debug role, include it in the NoDataFound error for better diagnostics
        let errorMsg = debugRole != nil ? "NoDataFound (Role: \(debugRole!))" : "NoDataFound"
        return FocusedElementOutput(error: errorMsg, debugRole: debugRole)
    }
}

// Main Execution Block
let output = getFocusedElementInfo()
let encoder = JSONEncoder()
encoder.outputFormatting = .prettyPrinted // Optional: for human-readable output during debugging

do {
    let jsonData = try encoder.encode(output)
    if let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
        fflush(stdout) // Ensure output is written immediately
        exit(0)
    } else {
        let errorOutput = FocusedElementOutput(error: "Error:FailedToConvertToUTF8String")
        let errorJsonData = try encoder.encode(errorOutput)
        if let errorJsonString = String(data: errorJsonData, encoding: .utf8) {
            print(errorJsonString)
        }
        fflush(stdout)
        exit(1)
    }
} catch {
    // Attempt to encode a simpler error if the main encoding fails
    let errorOutput = FocusedElementOutput(error: "Error:JSONEncodingFailed - \(error.localizedDescription)")
    // No easy way to guarantee this secondary encoding won't also fail, but it's a best effort.
    // For robustness, could print a hardcoded JSON error string here.
    if let jsonData = try? encoder.encode(errorOutput), let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
    } else {
        // Fallback to a very basic error string if all JSON encoding fails
        print("{\"error\":\"Critical: JSON encoding failed and could not produce error JSON.\"}")
    }
    fflush(stdout)
    exit(1)
}