# Claude Code Push-to-Talk Plugin Design

**Date:** 2025-12-10
**Status:** Approved
**Author:** Aaddrick Williams

## Overview

A Claude Code plugin that enables voice input via push-to-talk, allowing hands-free interaction with Claude Code. Primary use case: interacting with Claude Code while hands are occupied (e.g., holding a baby).

## Requirements

### Functional
- **Hotkey activation**: Hold `Ctrl+Space` to record, release to transcribe
- **Speech-to-text**: Support both OpenAI Whisper API and local Whisper
- **Text insertion**: Transcribed text appears in Claude Code input for review before submission
- **Cross-platform**: Windows, macOS, Linux (X11 and Wayland)
- **Visual feedback**: Show recording/transcribing status (no audio cues)

### Non-Functional
- Low latency transcription
- Minimal resource usage when idle
- Graceful fallback between transcription backends

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claude PTT Plugin                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   Hotkey     │───▶│   Recorder   │───▶│   Transcribe     │  │
│  │  Listener    │    │   (mic)      │    │  (Whisper)       │  │
│  │              │    │              │    │                  │  │
│  │ Ctrl+Space   │    │ Start/Stop   │    │ API ←→ Local     │  │
│  │ hold/release │    │ on hotkey    │    │ with fallback    │  │
│  └──────────────┘    └──────────────┘    └────────┬─────────┘  │
│                                                    │            │
│                                                    ▼            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Keystroke Driver                       │  │
│  │  ┌─────────────────────────────────────────────────────┐ │  │
│  │  │  Platform Detection                                 │ │  │
│  │  │  • Windows/macOS/X11 → nut.js                       │ │  │
│  │  │  • Wayland → wtype → ydotool fallback               │ │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│                    ┌──────────────────┐                        │
│                    │  Type into       │                        │
│                    │  Claude Code     │                        │
│                    │  terminal input  │                        │
│                    └──────────────────┘                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Visual Feedback                                         │  │
│  │  • Recording... (while hotkey held)                      │  │
│  │  • Transcribing... (after release)                       │  │
│  │  • Done (text inserted)                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Plugin Structure

```
claude-ptt/
├── .claude-plugin/
│   ├── plugin.json           # Plugin manifest
│   └── marketplace.json      # Marketplace definition
├── .mcp.json                 # MCP server config
├── commands/
│   └── ptt.md               # /ptt command
├── src/
│   ├── daemon.ts            # Main background process
│   ├── hotkey.ts            # Global hotkey listener
│   ├── recorder.ts          # Audio capture
│   ├── transcribe.ts        # Whisper API/local wrapper
│   ├── keystroke/
│   │   ├── index.ts         # Platform detection + abstraction
│   │   ├── nutjs.ts         # Windows/macOS/Linux-X11
│   │   └── wayland.ts       # ydotool/wtype wrapper
│   └── mcp-server.ts        # MCP server for config/status
├── config.json              # Default configuration
├── package.json
├── tsconfig.json
└── README.md
```

### 2. Configuration

```json
{
  "hotkey": "Ctrl+Space",
  "whisper": {
    "openaiApiKey": null,
    "localModelPath": null,
    "preferredMode": "local",
    "enableFallback": true,
    "language": "en"
  },
  "audio": {
    "sampleRate": 16000,
    "silenceThreshold": 0.5
  },
  "keystroke": {
    "waylandBackend": "wtype"
  },
  "feedback": {
    "showRecordingIndicator": true
  }
}
```

### 3. Transcription Logic

1. Try `preferredMode` if its config is set
2. If it fails and `enableFallback: true` → try the other mode
3. If both fail or fallback disabled → show error

### 4. Keystroke Driver Strategy

| Platform | Backend | Notes |
|----------|---------|-------|
| Windows | nut.js | Full support, pre-built binaries |
| macOS | nut.js | Full support, pre-built binaries |
| Linux X11 | nut.js | Requires `libxtst-dev` |
| Linux Wayland | wtype/ydotool | wtype preferred (no daemon), ydotool fallback |

### 5. MCP Server Tools

The MCP server exposes tools for configuration and status:

- `ptt_get_config` - Get current configuration
- `ptt_set_config` - Update configuration
- `ptt_get_status` - Get daemon status (running, recording, etc.)
- `ptt_start` - Start the daemon
- `ptt_stop` - Stop the daemon

### 6. Visual Feedback

Status shown via terminal notification or status line:
- `🎤 Recording...` - While hotkey held
- `⏳ Transcribing...` - After release, during transcription
- `✓ [text]` - Briefly show transcribed text before typing

## Dependencies

```json
{
  "dependencies": {
    "node-global-key-listener": "^0.3.0",
    "@anthropic-ai/sdk": "^0.39.0",
    "openai": "^4.0.0",
    "mic": "^2.1.2"
  },
  "optionalDependencies": {
    "@nut-tree/nut-js": "^4.0.0"
  }
}
```

Note: `@nut-tree/nut-js` is optional because Wayland systems use external tools instead.

## Platform Requirements

### All Platforms
- Node.js 18+
- Microphone access

### Windows
- No additional requirements

### macOS
- Accessibility permissions for keystroke simulation
- Microphone permissions

### Linux X11
- `libxtst-dev` for nut.js
- `sudo apt-get install libxtst-dev`

### Linux Wayland
- `wtype` (preferred): `sudo apt-get install wtype`
- `ydotool` (fallback): `sudo apt-get install ydotool`

## User Flow

1. User installs plugin: `/plugin install ptt@claude-ptt-marketplace`
2. User configures Whisper (API key or local model path)
3. User starts daemon: `/ptt start` or daemon auto-starts
4. User holds `Ctrl+Space` to record
5. User releases to transcribe
6. Transcribed text appears in input for review
7. User presses Enter to submit or edits first

## Future Enhancements (Out of Scope)

- Wake word activation (Porcupine)
- Multiple hotkey profiles
- Custom wake words
- Audio feedback option
- Noise cancellation

## References

- [nut.js](https://nutjs.dev/) - Cross-platform keystroke simulation
- [node-global-key-listener](https://www.npmjs.com/package/node-global-key-listener) - Hotkey detection
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [ydotool](https://github.com/ReimuNotMoe/ydotool) - Wayland automation
- [wtype](https://github.com/atx/wtype) - Wayland keyboard simulation
