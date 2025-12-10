# /ptt

Push-to-talk voice input control.

## Usage

```
/ptt [command] [options]
```

## Commands

- `start` - Start the PTT daemon (runs in background)
- `stop` - Stop the PTT daemon
- `status` - Show daemon status and configuration
- `config` - Show or update configuration

## Examples

```bash
# Start the daemon
/ptt start

# Check status
/ptt status

# Stop the daemon
/ptt stop

# Show current config
/ptt config

# Update config (interactive)
/ptt config --set
```

## How It Works

1. Start the daemon with `/ptt start`
2. Hold `Ctrl+Space` to begin recording
3. Speak your message
4. Release `Ctrl+Space` to transcribe
5. Transcribed text appears in your input for review
6. Press Enter to submit or edit first

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

Set either `openaiApiKey` for API mode or `localModelPath` for local Whisper:

- **API mode**: Set `OPENAI_API_KEY` environment variable or `openaiApiKey` in config
- **Local mode**: Set `localModelPath` to your Whisper model (e.g., `/path/to/whisper.cpp/models/ggml-base.en.bin`)

Use `preferredMode` to choose which backend to try first. Enable `enableFallback` to automatically try the other if preferred fails.

## Platform Requirements

### Windows
- No additional setup required

### macOS
- Grant accessibility permissions to your terminal app
- Grant microphone permissions

### Linux (X11)
- Install libxtst: `sudo apt-get install libxtst-dev`

### Linux (Wayland)
- Install wtype: `sudo apt-get install wtype`
- Or ydotool: `sudo apt-get install ydotool`

## Troubleshooting

### Daemon won't start
- Check that Node.js 18+ is installed
- Verify microphone permissions

### Keystroke simulation not working
- **macOS**: Check System Preferences > Security & Privacy > Accessibility
- **Linux Wayland**: Ensure wtype or ydotool is installed and in PATH

### Transcription fails
- Verify Whisper configuration (API key or local model path)
- Check network connectivity for API mode
- Ensure audio is being captured (check microphone settings)

### Hotkey not detected
- Check for conflicts with other applications
- Try running terminal as administrator/root (temporary test only)
