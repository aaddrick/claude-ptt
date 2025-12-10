# Claude PTT - Push-to-Talk Voice Input for Claude Code

A Claude Code plugin that enables voice input via push-to-talk. Hold a hotkey to record your voice, release to transcribe and insert text into Claude Code.

## Features

- **Push-to-talk**: Hold `Ctrl+Space` to record, release to transcribe
- **Dual transcription backends**: OpenAI Whisper API and local whisper.cpp
- **Cross-platform**: Windows, macOS, Linux (X11 and Wayland)
- **Automatic fallback**: Falls back to alternative backend if preferred fails
- **Visual feedback**: Shows recording/transcribing status

## Installation

### From Marketplace

```bash
/plugin marketplace add aaddrick/claude-ptt
/plugin install ptt@claude-ptt-marketplace
```

### Manual Installation

```bash
git clone https://github.com/aaddrick/claude-ptt.git
cd claude-ptt
npm install
npm run build
```

## Configuration

Configuration is stored in `~/.claude/ptt-config.json`:

```json
{
  "hotkey": "Ctrl+Space",
  "whisper": {
    "openaiApiKey": null,
    "localModelPath": null,
    "preferredMode": "api",
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

### Whisper Configuration

**API Mode (Recommended for ease of use)**:
- Set `OPENAI_API_KEY` environment variable, or
- Set `openaiApiKey` in config

**Local Mode (Recommended for privacy)**:
- Install [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- Set `localModelPath` to your model file

### Setting Preferred Mode

Use `preferredMode` to choose which backend to try first:
- `"api"`: Try OpenAI API first
- `"local"`: Try local whisper.cpp first

Enable `enableFallback` to automatically try the other backend if the preferred one fails.

## Platform Setup

### Windows

No additional setup required. The plugin uses nut.js for keystroke simulation.

### macOS

Grant accessibility permissions to your terminal application:
1. Open System Preferences > Security & Privacy > Privacy > Accessibility
2. Add your terminal app (Terminal.app, iTerm2, etc.)

### Linux (X11)

Install libxtst for keystroke simulation:

```bash
sudo apt install libxtst-dev
```

### Linux (Wayland)

Install one of the following for keystroke simulation:

```bash
# Option 1: wtype (recommended, no daemon required)
sudo apt install wtype

# Option 2: ydotool (requires daemon)
sudo apt install ydotool
sudo systemctl enable --now ydotool

# Option 3: dotool
# Build from source: https://sr.ht/~geb/dotool/
```

### Audio Recording

The plugin uses system audio tools:
- **Linux**: `arecord` (ALSA, usually pre-installed)
- **macOS/Windows**: `sox` (install via `brew install sox` or download from http://sox.sourceforge.net/)

## Usage

### Starting the Daemon

```bash
# Via npm
npm start

# Or directly
node dist/daemon.js
```

### Using with Claude Code

1. Start the daemon in a separate terminal
2. In Claude Code, hold `Ctrl+Space` to record
3. Speak your message
4. Release `Ctrl+Space` to transcribe
5. Text appears in your input for review
6. Press Enter to submit

### MCP Tools

The plugin provides MCP tools for configuration:

- `ptt_get_config`: Get current configuration
- `ptt_set_config`: Update configuration
- `ptt_get_status`: Get daemon status
- `ptt_get_platform_info`: Get platform info and setup instructions

## Troubleshooting

### Hotkey not detected

- **Linux**: May need to run as root for global key capture
- **macOS**: Ensure accessibility permissions are granted
- **All platforms**: Check for conflicts with other applications

### Keystroke simulation not working

- **macOS**: Check accessibility permissions
- **Linux Wayland**: Ensure wtype or ydotool is installed
- **Linux X11**: Ensure libxtst-dev is installed

### Transcription fails

- **API mode**: Verify your OpenAI API key
- **Local mode**: Verify whisper.cpp is installed and model path is correct
- **All modes**: Check microphone permissions and audio recording

### No audio recorded

- Check microphone permissions in system settings
- Verify audio recording tool is installed:
  - Linux: `which arecord`
  - macOS/Windows: `which sox`

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode
npm run watch

# Run daemon
npm start

# Run MCP server
npm run mcp-server
```

## License

MIT

## Author

Aaddrick Williams <aaddrick@gmail.com>
