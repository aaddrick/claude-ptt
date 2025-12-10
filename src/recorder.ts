/**
 * Audio recorder using Node.js child_process to capture audio
 * Uses system tools (arecord on Linux, sox on macOS, etc.)
 */
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RecorderConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

export class AudioRecorder extends EventEmitter {
  private config: RecorderConfig;
  private recordProcess: ChildProcess | null = null;
  private isRecording: boolean = false;
  private tempDir: string;
  private currentFile: string = '';

  constructor(config: Partial<RecorderConfig> = {}) {
    super();
    this.config = {
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
      bitDepth: config.bitDepth || 16,
    };
    this.tempDir = path.join(os.tmpdir(), 'claude-ptt');

    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private getRecordCommand(): { cmd: string; args: string[] } {
    const platform = process.platform;
    const { sampleRate, channels, bitDepth } = this.config;
    this.currentFile = path.join(this.tempDir, `recording-${Date.now()}.wav`);

    if (platform === 'linux') {
      // Use arecord (ALSA) on Linux
      return {
        cmd: 'arecord',
        args: [
          '-f', bitDepth === 16 ? 'S16_LE' : 'S32_LE',
          '-r', String(sampleRate),
          '-c', String(channels),
          '-t', 'wav',
          this.currentFile,
        ],
      };
    } else if (platform === 'darwin') {
      // Use sox on macOS
      return {
        cmd: 'sox',
        args: [
          '-d',  // default audio device
          '-r', String(sampleRate),
          '-c', String(channels),
          '-b', String(bitDepth),
          this.currentFile,
        ],
      };
    } else if (platform === 'win32') {
      // Use sox on Windows (requires sox to be installed)
      return {
        cmd: 'sox',
        args: [
          '-t', 'waveaudio', 'default',
          '-r', String(sampleRate),
          '-c', String(channels),
          '-b', String(bitDepth),
          this.currentFile,
        ],
      };
    }

    throw new Error(`Unsupported platform: ${platform}`);
  }

  start(): void {
    if (this.isRecording) {
      return;
    }

    try {
      const { cmd, args } = this.getRecordCommand();

      this.recordProcess = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.isRecording = true;
      this.emit('recording:start');

      this.recordProcess.on('error', (error) => {
        this.isRecording = false;
        this.emit('recording:error', error);
      });

      this.recordProcess.stderr?.on('data', (data) => {
        // arecord outputs to stderr, this is normal
        const output = data.toString();
        if (output.includes('error') || output.includes('Error')) {
          this.emit('recording:error', new Error(output));
        }
      });

      this.recordProcess.on('close', (code) => {
        if (this.isRecording) {
          this.isRecording = false;
          if (code === 0 || code === null) {
            this.emit('recording:stop', this.currentFile);
          }
        }
      });
    } catch (error) {
      this.isRecording = false;
      this.emit('recording:error', error as Error);
    }
  }

  async stop(): Promise<string> {
    if (!this.isRecording || !this.recordProcess) {
      return '';
    }

    const proc = this.recordProcess;

    return new Promise((resolve, reject) => {
      const filePath = this.currentFile;

      const onClose = () => {
        this.isRecording = false;
        this.recordProcess = null;

        // Wait a bit for file to be written
        setTimeout(() => {
          if (fs.existsSync(filePath)) {
            this.emit('recording:stop', filePath);
            resolve(filePath);
          } else {
            reject(new Error('Recording file not found'));
          }
        }, 100);
      };

      proc.once('close', onClose);

      // Send SIGINT to stop recording gracefully
      if (process.platform === 'win32') {
        proc.kill();
      } else {
        proc.kill('SIGINT');
      }

      // Timeout if process doesn't close
      setTimeout(() => {
        if (this.recordProcess) {
          this.recordProcess.kill('SIGKILL');
        }
      }, 2000);
    });
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }

  cleanup(): void {
    // Clean up temp files older than 1 hour
    if (fs.existsSync(this.tempDir)) {
      const files = fs.readdirSync(this.tempDir);
      const oneHourAgo = Date.now() - 60 * 60 * 1000;

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < oneHourAgo) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  }
}
