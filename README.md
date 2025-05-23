# Vox

Vox is an open-source Electron application designed for voice transcription. It allows users to record audio, transcribe it using services like Deepgram or OpenAI Whisper, and enhance the resulting text. The application is built with Svelte and TypeScript, and it integrates with the operating system for features like global shortcuts and a system tray icon for easy access.

## Alternatives

I started building this application when another open-source app didn't quite meet my needs, but it's still a very good application. If you prefer a native-built open-source transcriber app, I recommend checking out [VoiceInk](https://github.com/Beingpax/VoiceInk).

There's another app I really like, [Spokenly](https://spokenly.app/). While it's not open-source and I miss some customizability, it's also worth a look.

Both these applications support local models as well, which this one doesn't. 

## Installation Instructions

Because this app is open-source and not distributed through the Mac App Store or signed with an Apple Developer ID (to avoid subscription fees), macOS Gatekeeper may show some warnings when you first try to open it. Here's how to install and run **Vox**:

1.  **Download:**
    Download the `vox-{version}.dmg` file from release.

2.  **Install:**
    *   Open the downloaded `.dmg` file.
    *   Drag the **Vox.app** icon into your **Applications** folder.
    *   You can now eject the mounted disk image.

3.  **First Run - Bypassing Gatekeeper:**

    * "Vox.app is damaged and can’t be opened. You should move it to the Trash."**
        This message can be misleading; the app is **NOT** damaged. It's a stricter Gatekeeper response for unsigned apps downloaded from the internet. To fix this:
        1.  Ensure **Vox.app** is in your **Applications** folder.
        2.  Open **Terminal**. (You can find it via Spotlight: press `Cmd + Space`, type `Terminal`, and press Enter).
        3.  Copy and paste the following command into Terminal and press Enter:
            ```bash
            sudo xattr -cr /Applications/Vox.app
            ```
        4.  You may be prompted for your macOS user password. Type it and press Enter.
        5.  After running the command, try opening **Vox.app** again. It should now open normally.

**Why these steps?**
macOS Gatekeeper is designed to protect users. Since this app isn't notarized by Apple (which requires a paid developer subscription), Gatekeeper flags it. The steps above tell macOS that you trust this application.

## For Developers

### Install

```bash
$ npm install
```

```bash
swiftc resources/key-monitor.swift -o resources/key-monitor -framework CoreGraphics -framework AppKit
swiftc resources/focused_input_helper.swift -o resources/focused_input_helper -framework AppKit -framework Accessibility
```

### Development

```bash
$ npm run dev
```

### Build

```bash
$ npm run build:mac
```