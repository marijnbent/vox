# Vox

Vox is an open-source Electron application designed for voice transcription. It allows users to record audio, transcribe it using services like Deepgram or OpenAI Whisper, and enhance the resulting text. The application is built with Svelte and TypeScript, and it integrates with the operating system for features like global shortcuts and a system tray icon for easy access.

## Project Setup

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