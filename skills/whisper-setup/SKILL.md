---
name: whisper-setup
description: Use when the user wants to set up whisper for PTT (push-to-talk) voice input. Guides through choosing API vs local mode and configuring whisper.cpp if local.
---

# Whisper Setup Skill

This skill guides users through setting up Whisper for the PTT plugin.

## Overview

The PTT plugin supports two transcription backends:
1. **OpenAI Whisper API** - Cloud-based, easy setup, costs ~$0.006/min
2. **Local whisper.cpp** - Free, private, works offline, requires setup

## Setup Flow

### Step 1: Ask User Preference

Ask the user which mode they prefer:

```
Which Whisper mode would you like to set up?

1. **OpenAI API** (Recommended for ease of use)
   - Requires OpenAI API key
   - Costs ~$0.006 per minute of audio
   - Best transcription quality
   - Requires internet connection

2. **Local whisper.cpp** (Recommended for privacy)
   - Free, no API costs
   - Works offline
   - Requires ~150MB-3GB disk space (depending on model)
   - Transcription speed depends on your hardware
```

### Step 2A: OpenAI API Setup

If user chooses API:

1. Check if OPENAI_API_KEY environment variable is set:
   ```bash
   echo $OPENAI_API_KEY | head -c 10
   ```

2. If not set, ask user to provide their API key

3. Update config:
   ```bash
   # Read current config and update
   cat ~/.claude/ptt-config.json
   ```

   Set `whisper.openaiApiKey` to the user's key or instruct them to set `OPENAI_API_KEY` env var.

4. Set `whisper.preferredMode` to `"api"`

### Step 2B: Local whisper.cpp Setup

If user chooses local:

#### Check System Resources

1. Check available RAM:
   ```bash
   free -h
   ```

2. Check available disk space:
   ```bash
   df -h ~
   ```

3. Check CPU info:
   ```bash
   lscpu | grep -E "(Model name|CPU\(s\)|Thread)"
   ```

4. Check for NVIDIA GPU (for CUDA acceleration):
   ```bash
   nvidia-smi 2>/dev/null || echo "No NVIDIA GPU detected"
   ```

#### Recommend Model Based on Resources

Present model options with recommendations based on system:

| Model | Size | RAM Required | Speed | Quality | Best For |
|-------|------|--------------|-------|---------|----------|
| tiny.en | 75MB | ~400MB | Fastest | Basic | Low-resource systems, quick tests |
| base.en | 142MB | ~500MB | Fast | Good | Most desktop systems (RECOMMENDED) |
| small.en | 466MB | ~1GB | Medium | Better | Systems with 8GB+ RAM |
| medium.en | 1.5GB | ~2.5GB | Slow | Great | Systems with 16GB+ RAM |
| large-v3 | 3GB | ~4GB | Slowest | Best | High-end systems, accuracy critical |

**Recommendations:**
- RAM < 4GB: Use `tiny.en`
- RAM 4-8GB: Use `base.en` (default recommendation)
- RAM 8-16GB: Use `small.en` for better quality
- RAM > 16GB: Use `medium.en` or `large-v3` if accuracy is critical

#### Install whisper.cpp

1. Install dependencies:
   ```bash
   sudo apt-get update && sudo apt-get install -y build-essential cmake
   ```

2. Clone and build:
   ```bash
   cd ~ && git clone https://github.com/ggerganov/whisper.cpp.git
   cd whisper.cpp && make -j$(nproc)
   ```

3. Download chosen model:
   ```bash
   ./models/download-ggml-model.sh <model_name>
   ```
   Replace `<model_name>` with: `tiny.en`, `base.en`, `small.en`, `medium.en`, or `large-v3`

4. Test the installation:
   ```bash
   ./build/bin/whisper-cli -m models/ggml-<model>.bin -f samples/jfk.wav
   ```

#### Update Config

Update `~/.claude/ptt-config.json`:
```json
{
  "whisper": {
    "localModelPath": "/home/<user>/whisper.cpp/models/ggml-<model>.bin",
    "whisperExecutable": "/home/<user>/whisper.cpp/build/bin/whisper-cli",
    "preferredMode": "local"
  }
}
```

### Step 3: Test Configuration

Verify the setup works:

1. For API mode, the MCP server should be able to make API calls
2. For local mode, test whisper-cli directly:
   ```bash
   # Record a short test
   arecord -f S16_LE -r 16000 -c 1 -d 3 /tmp/test.wav

   # Transcribe
   ~/whisper.cpp/build/bin/whisper-cli -m ~/whisper.cpp/models/ggml-base.en.bin -f /tmp/test.wav
   ```

### Step 4: Enable Fallback (Optional)

Ask if user wants fallback enabled:
- If both API key and local model are configured, enable `enableFallback: true`
- This provides resilience - if one method fails, the other is tried

## Troubleshooting

### Common Issues

1. **"whisper-cli not found"**
   - Ensure whisper.cpp was built successfully
   - Check the executable path in config

2. **"Model file not found"**
   - Verify the model was downloaded
   - Check the model path in config

3. **"API key invalid"**
   - Verify the API key is correct
   - Check for extra whitespace

4. **"Out of memory" during local transcription**
   - Use a smaller model
   - Close other applications

## Platform-Specific Notes

### macOS
- whisper.cpp builds with CoreML acceleration on Apple Silicon
- Use `make` without additional flags

### Linux with NVIDIA GPU
- Build with CUDA support:
  ```bash
  make GGML_CUDA=1
  ```

### Windows
- Use WSL2 for best compatibility
- Or download pre-built binaries from whisper.cpp releases
