# Vox Transcriber Application Plan

## TODO
Hide widget window when not recording Make sure you can't, if you click on it, something happens in the app, not that you go to the other app Add escape to cancel current transcription Add enhancements prompt to better wave animation

## I. Project Goal

Create an Electron desktop application named "Vox" that:
*   Transcribes audio input using a configurable backend (initially `nodejs-whisper`, with future support for a Whisper API).
*   Supports push-to-talk and toggle recording via configurable global keyboard shortcuts (using a native helper for macOS modifier keys).
*   Pastes the transcribed text into the currently active application (system-wide).
*   Optionally enhances the transcription using LLMs (Gemini, OpenAI, Custom).
*   Provides a settings interface built with Svelte, Tailwind CSS (v4), and DaisyUI (v5) for managing shortcuts, transcription backend, LLM enhancements, custom dictionary, permissions, and viewing history.

## II. Technology Stack

*   **Framework:** Electron
*   **UI:** Svelte
*   **Styling:** Tailwind CSS v4, DaisyUI v5
*   **Transcription Backend (Initial):** `nodejs-whisper` (Node.js native addon)
*   **Transcription Backend (Alternative option):** Whisper API (via HTTP requests)
*   **Global Shortcuts (macOS):** Custom Swift helper tool (`key-monitor`) using `CGEventTap`, managed via `child_process`. Requires Accessibility permissions.
*   **System Paste:** Electron's `clipboard` API + `robotjs` or platform-specific scripts.
*   **State Management:** Svelte Stores (for UI state), simple state management in Main Process.
*   **Audio Recording:** A Node.js compatible library (e.g., `node-audiorecorder`).
*   **Settings Storage:** `electron-store`
*   **Logging:** `electron-log`

## III. High-Level Architecture (with Abstraction)

```mermaid
graph TD
    subgraph Electron Main Process
        subgraph macOS Shortcut Handling
            direction TB
            Z[key-monitor Process (Swift)] -- stdout (KEY_DOWN/UP) --> A;
        end
        A[Shortcut Event Handler] --> B{Transcription Manager};
        G[Settings Storage] --> B;
        B -- Reads Setting --> Selects((Transcription Mode));
        Selects -- Local --> D[LocalWhisperService (nodejs-whisper)];
        Selects -- API --> L[ApiWhisperService (Future)];
        B -- Delegates to --> K{Active Transcription Service};
        D --> K;
        L --> K;
        B --> C[Audio Recorder (Node.js)];
        C -- Audio Data --> K;
        K -- Transcribed Text --> B;
        B --> E[System Paste Handler];
        B --> F[Permissions Manager];
        G --> H[LLM API Handler];
        H --> B;
        B -- Status Updates / Text --> I(Renderer Process);
        E -- Paste Command --> J[OS Clipboard/Input];
        F -- Request Permissions (Mic, Accessibility, Screen Recording) --> M[OS Permissions];
        F -- Starts/Stops --> Z;
        F -- Reads Settings --> Z;
    end

    subgraph Electron Renderer Process (Svelte UI)
        I -- Display Data --> N[Svelte App];
        N -- Settings Changes (incl. Shortcut Keys, Transcription Mode & API details) --> G;
        N -- Request Permission --> F;
        N -- Update Monitored Keys --> A;
        N -- UI Events (e.g., manual start/stop) --> B;
        N -- Display Status/History/Permissions --> O[UI Components];
    end

    style Electron Main Process fill:#f9f,stroke:#333,stroke-width:2px
    style Electron Renderer Process fill:#ccf,stroke:#333,stroke-width:2px
```

**Architecture Notes:**
*   The `Transcription Manager` in the main process selects the active `Transcription Service`.
*   Audio recording and transcription logic reside primarily in the main process.
*   **macOS Shortcut Handling:** A separate Swift process (`key-monitor`) monitors low-level modifier key events and communicates via stdout to the main Electron process (`Shortcut Event Handler`), which implements click/hold/double-click logic. This requires Accessibility permissions for the `key-monitor` executable.
*   The renderer process (Svelte UI) handles displaying information and configuring settings via IPC.

## IV. Detailed Plan

1.  **Phase 1: Project Setup & Core Dependencies [COMPLETED]**
    *   Initialize Svelte, Tailwind CSS v4, DaisyUI v5.
    *   Install `nodejs-whisper` (requires build tools).
    *   Install `robotjs` (or alternative) for system paste simulation.
    *   Install `electron-store`.
    *   Install `electron-log`.
    *   Refine `index.js` and `preload.js` for secure IPC.

2.  **Phase 2: Transcription Core (Main Process)**
    *   Define `TranscriptionService` interface.
    *   Implement `OpenaiWhisperService` using `openai` package.
    *   Implement audio input/recording via Web Audio API (navigator.mediaDevices.getUserMedia)
    *   Implement `Transcription Manager` to select and use the active service based on settings.
    *   Establish IPC for status updates, results, and settings.
    *   Implement recording start/stop on shortcut press/release

3.  **Phase 3: Current Work - OpenAI Whisper API Integration**
    *   Stream audio to OpenAI Whisper API
    *   Handle API responses and display transcription
    *   Implement system paste of transcribed text

4.  **Phase 4: Local Whisper Service & Enhancements**
    *   Implement `LocalWhisperService` using `nodejs-whisper`
    *   Add LLM API calls for text enhancement
    *   Integrate enhancement into transcription flow
    *   Implement history storage using `electron-store`

5.  **Phase 5: Refinement & Packaging**
    *   Add error handling
    *   Optimize performance
    *   Test thoroughly on macOS
    *   Configure Electron Forge/Builder for packaging

## V. Future Considerations
*   Add features utilizing screen recording permission (e.g., screenshot capture).
*   Implement cross-platform global shortcuts using Electron's `globalShortcut`.