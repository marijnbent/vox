import Foundation
import CoreGraphics
import AppKit // For NSEvent.ModifierFlags constants

// --- Key Definitions ---
struct MonitoredKey {
    let name: String
    let keyCode: CGKeyCode      // Specific key code (e.g., 55 for Left Command)
    let flag: CGEventFlags?     // Corresponding flag mask (e.g., .maskCommand)
    var isDown: Bool = false
}

// Global mutable state
var keysToMonitor: [MonitoredKey] = []
var eventTap: CFMachPort?
var runLoopSource: CFRunLoopSource?

// --- Argument Parsing ---
let arguments = CommandLine.arguments
if arguments.count < 2 {
    FileHandle.standardError.write("Usage: \(arguments[0]) KEY1 KEY2 ... (e.g., COMMAND OPTION SHIFT)\n".data(using: .utf8)!)
    exit(1)
}
let requestedKeys = Set(arguments.dropFirst().map { $0.uppercased() })

// Map names to key codes AND flags
// 55: Left Command, 54: Right Command -> .maskCommand
// 58: Left Option, 61: Right Option -> .maskAlternate
// 56: Left Shift, 60: Right Shift -> .maskShift
// 59: Left Control, 62: Right Control -> .maskControl
// 63: Fn key -> .maskSecondaryFn
if requestedKeys.contains("COMMAND") {
    // keysToMonitor.append(MonitoredKey(name: "COMMAND", keyCode: 55, flag: .maskCommand)) // Left
    keysToMonitor.append(MonitoredKey(name: "COMMAND", keyCode: 54, flag: .maskCommand)) // Right
}

if requestedKeys.contains("OPTION") {
    // keysToMonitor.append(MonitoredKey(name: "OPTION", keyCode: 58, flag: .maskAlternate)) // Left
    keysToMonitor.append(MonitoredKey(name: "OPTION", keyCode: 61, flag: .maskAlternate)) // Right
}

if requestedKeys.contains("CONTROL") {
    // keysToMonitor.append(MonitoredKey(name: "CONTROL", keyCode: 59, flag: .maskControl)) // Left
    keysToMonitor.append(MonitoredKey(name: "CONTROL", keyCode: 62, flag: .maskControl)) // Right
}

if requestedKeys.contains("FN") {
    keysToMonitor.append(MonitoredKey(name: "FN", keyCode: 63, flag: .maskSecondaryFn))
}

// Add Escape key monitoring (keyCode 53)
keysToMonitor.append(MonitoredKey(name: "ESCAPE", keyCode: 53, flag: nil))

if keysToMonitor.isEmpty {
    FileHandle.standardError.write("No valid keys specified to monitor.\n".data(using: .utf8)!)
    exit(1)
}

// --- CGEventTap Callback ---
let eventCallback: CGEventTapCallBack = { (proxy, type, event, refcon) -> Unmanaged<CGEvent>? in

    // Handle Escape key separately on keyDown
    if type == .keyDown {
        let escapeKeyCode = CGKeyCode(53)
        let currentKeyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        if currentKeyCode == escapeKeyCode {
            FileHandle.standardOutput.write("ESCAPE_DOWN\n".data(using: .utf8)!)
            fflush(stdout)
        }
    }

    // Process modifier keys (Command, Option, etc.) for keyDown, keyUp, flagsChanged
    guard type == .keyDown || type == .keyUp || type == .flagsChanged else {
        return Unmanaged.passRetained(event) // Should not be reached if Escape was handled above, but keep for safety
    }

    var keyCode: CGKeyCode? = nil
    if type == .keyDown || type == .keyUp {
        keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
    }
    let currentFlags = event.flags

    // Iterate through the *modifier* keys we are specifically monitoring (excluding Escape)
    for i in 0..<keysToMonitor.count {
        // Skip processing Escape key here as it's handled above
        if keysToMonitor[i].name == "ESCAPE" {
            continue
        }

        var key = keysToMonitor[i] // Mutable copy
        var stateChanged = false
        var isKeyDownNow: Bool? = nil // Use optional to see if state was determined

        // Method 1: Direct KeyCode match (priority for modifiers)
        if let code = keyCode, key.keyCode == code {
             isKeyDownNow = (type == .keyDown)
        }
        // Method 2: FlagsChanged event - check corresponding flag (fallback for modifiers)
        else if type == .flagsChanged, let flag = key.flag {
             isKeyDownNow = currentFlags.contains(flag)
        }

        // If we determined a state for this modifier key in this event
        if let determinedState = isKeyDownNow {
            // Check if it's different from the last known state
            if key.isDown != determinedState {
                stateChanged = true
                key.isDown = determinedState // Update state
                keysToMonitor[i] = key      // Write back to global array
            }
        }

        // If the state for this specific modifier key actually changed
        if stateChanged {
            let stateString = key.isDown ? "DOWN" : "UP"
            FileHandle.standardOutput.write("\(key.name)_\(stateString)\n".data(using: .utf8)!)
            fflush(stdout)
        }
    }

    // Re-enable tap if it gets disabled
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
         if let tap = eventTap {
             CGEvent.tapEnable(tap: tap, enable: true)
         }
    }

    return Unmanaged.passRetained(event)
}

// --- Setup CGEventTap ---
// (Setup logic remains the same as the previous working version)
func setupEventTap() -> Bool {
    let eventMask = (1 << CGEventType.keyDown.rawValue) |
                    (1 << CGEventType.keyUp.rawValue) |
                    (1 << CGEventType.flagsChanged.rawValue)

    eventTap = CGEvent.tapCreate(tap: .cgSessionEventTap,
                                 place: .headInsertEventTap,
                                 options: .defaultTap,
                                 eventsOfInterest: CGEventMask(eventMask),
                                 callback: eventCallback,
                                 userInfo: nil)

    guard let eventTap = eventTap else {
        FileHandle.standardError.write("Failed to create event tap. Ensure Accessibility permissions are granted.\n".data(using: .utf8)!)
        fflush(stderr)
        return false
    }

    runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
    guard let runLoopSource = runLoopSource else {
        FileHandle.standardError.write("Failed to create run loop source.\n".data(using: .utf8)!)
        fflush(stderr)
        return false
    }
    CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)

    CGEvent.tapEnable(tap: eventTap, enable: true)
    FileHandle.standardOutput.write("Event tap created successfully (Listening to KeyDown/Up/FlagsChanged).\n".data(using: .utf8)!)
    fflush(stdout)
    return true
}

// --- Main Execution ---
if !setupEventTap() {
    exit(1)
}

let monitoredNames = Set(keysToMonitor.map { $0.name }).joined(separator: ", ")
FileHandle.standardOutput.write("Monitoring keys: \(monitoredNames)...\n".data(using: .utf8)!)
fflush(stdout)

CFRunLoopRun()

// Cleanup
FileHandle.standardOutput.write("Exiting...\n".data(using: .utf8)!)
fflush(stdout)
if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: false) }

exit(0)