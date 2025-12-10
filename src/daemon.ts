/**
 * PTT Daemon - Main background process
 * Listens for hotkey, records audio, transcribes, and types text
 */
import { loadConfig, PTTConfig } from './config';
import { HotkeyListener } from './hotkey';
import { AudioRecorder } from './recorder';
import { Transcriber } from './transcribe';
import { getKeystrokeDriver, KeystrokeDriver } from './keystroke/index';

interface DaemonState {
  isRunning: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  lastError: string | null;
}

class PTTDaemon {
  private config: PTTConfig;
  private hotkeyListener: HotkeyListener;
  private recorder: AudioRecorder;
  private transcriber: Transcriber;
  private keystrokeDriver: KeystrokeDriver | null = null;
  private state: DaemonState = {
    isRunning: false,
    isRecording: false,
    isTranscribing: false,
    lastError: null,
  };

  constructor() {
    this.config = loadConfig();
    this.hotkeyListener = new HotkeyListener(this.config.hotkey);
    this.recorder = new AudioRecorder({
      sampleRate: this.config.audio.sampleRate,
    });
    this.transcriber = new Transcriber(this.config);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Hotkey pressed - start recording
    this.hotkeyListener.on('hotkey:down', () => {
      this.startRecording();
    });

    // Hotkey released - stop recording and transcribe
    this.hotkeyListener.on('hotkey:up', () => {
      this.stopRecordingAndTranscribe();
    });

    // Hotkey error
    this.hotkeyListener.on('error', (error) => {
      this.state.lastError = `Hotkey error: ${error.message}`;
      console.error(this.state.lastError);
    });

    // Recording events
    this.recorder.on('recording:start', () => {
      this.state.isRecording = true;
      this.showFeedback('recording');
    });

    this.recorder.on('recording:stop', () => {
      this.state.isRecording = false;
    });

    this.recorder.on('recording:error', (error) => {
      this.state.isRecording = false;
      this.state.lastError = `Recording error: ${error.message}`;
      console.error(this.state.lastError);
      this.showFeedback('error', error.message);
    });
  }

  private showFeedback(type: 'recording' | 'transcribing' | 'done' | 'error', message?: string): void {
    if (!this.config.feedback.showRecordingIndicator) return;

    switch (type) {
      case 'recording':
        process.stdout.write('\r\x1b[K[PTT] Recording...');
        break;
      case 'transcribing':
        process.stdout.write('\r\x1b[K[PTT] Transcribing...');
        break;
      case 'done':
        process.stdout.write(`\r\x1b[K[PTT] Done: "${message?.substring(0, 50)}${(message?.length || 0) > 50 ? '...' : ''}"\n`);
        break;
      case 'error':
        process.stdout.write(`\r\x1b[K[PTT] Error: ${message}\n`);
        break;
    }
  }

  private startRecording(): void {
    if (this.state.isRecording || this.state.isTranscribing) return;

    try {
      this.recorder.start();
    } catch (error) {
      this.state.lastError = `Failed to start recording: ${(error as Error).message}`;
      console.error(this.state.lastError);
    }
  }

  private async stopRecordingAndTranscribe(): Promise<void> {
    if (!this.state.isRecording) return;

    try {
      const audioPath = await this.recorder.stop();

      if (!audioPath) {
        this.showFeedback('error', 'No audio recorded');
        return;
      }

      this.state.isTranscribing = true;
      this.showFeedback('transcribing');

      const result = await this.transcriber.transcribe(audioPath);

      this.state.isTranscribing = false;

      if (result.text.trim()) {
        await this.typeText(result.text.trim());
        this.showFeedback('done', result.text.trim());
      } else {
        this.showFeedback('error', 'No speech detected');
      }
    } catch (error) {
      this.state.isTranscribing = false;
      this.state.lastError = `Transcription error: ${(error as Error).message}`;
      console.error(this.state.lastError);
      this.showFeedback('error', (error as Error).message);
    }
  }

  private async typeText(text: string): Promise<void> {
    if (!this.keystrokeDriver) {
      this.keystrokeDriver = await getKeystrokeDriver(this.config.keystroke);
    }

    const isAvailable = await this.keystrokeDriver.isAvailable();
    if (!isAvailable) {
      throw new Error('Keystroke driver not available');
    }

    await this.keystrokeDriver.type(text);
  }

  async start(): Promise<void> {
    if (this.state.isRunning) {
      console.log('Daemon already running');
      return;
    }

    console.log('Starting PTT daemon...');
    console.log(`Hotkey: ${this.config.hotkey}`);
    console.log(`Transcription mode: ${this.config.whisper.preferredMode}`);

    // Initialize keystroke driver
    try {
      this.keystrokeDriver = await getKeystrokeDriver(this.config.keystroke);
      const isAvailable = await this.keystrokeDriver.isAvailable();
      if (!isAvailable) {
        console.warn('Warning: Keystroke driver not available. Text will not be typed.');
      }
    } catch (error) {
      console.warn('Warning: Could not initialize keystroke driver:', (error as Error).message);
    }

    // Start hotkey listener
    this.hotkeyListener.start();
    this.state.isRunning = true;

    console.log('PTT daemon started. Press', this.config.hotkey, 'to record.');
    console.log('Press Ctrl+C to stop.');

    // Cleanup old recordings periodically
    setInterval(() => {
      this.recorder.cleanup();
    }, 60 * 60 * 1000); // Every hour
  }

  stop(): void {
    if (!this.state.isRunning) return;

    console.log('\nStopping PTT daemon...');
    this.hotkeyListener.stop();
    this.recorder.cleanup();
    this.state.isRunning = false;
    console.log('PTT daemon stopped.');
  }

  getState(): DaemonState {
    return { ...this.state };
  }
}

// Main entry point
async function main() {
  const daemon = new PTTDaemon();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    daemon.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    daemon.stop();
    process.exit(0);
  });

  try {
    await daemon.start();
  } catch (error) {
    console.error('Failed to start daemon:', error);
    process.exit(1);
  }
}

main().catch(console.error);
