/**
 * Whisper transcription module
 * Supports both OpenAI API and local whisper.cpp
 * Documentation: https://github.com/openai/openai-node
 */
import OpenAI from 'openai';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { PTTConfig, getOpenAIKey } from './config';

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  source: 'api' | 'local';
}

export class Transcriber {
  private config: PTTConfig;
  private openaiClient: OpenAI | null = null;

  constructor(config: PTTConfig) {
    this.config = config;
    this.initOpenAI();
  }

  private initOpenAI(): void {
    const apiKey = getOpenAIKey(this.config);
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
    }
  }

  updateConfig(config: PTTConfig): void {
    this.config = config;
    this.initOpenAI();
  }

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const { preferredMode, enableFallback } = this.config.whisper;

    if (preferredMode === 'api') {
      try {
        return await this.transcribeWithAPI(audioPath);
      } catch (error) {
        if (enableFallback && this.config.whisper.localModelPath) {
          console.error('API transcription failed, falling back to local:', error);
          return await this.transcribeLocal(audioPath);
        }
        throw error;
      }
    } else {
      try {
        return await this.transcribeLocal(audioPath);
      } catch (error) {
        if (enableFallback && getOpenAIKey(this.config)) {
          console.error('Local transcription failed, falling back to API:', error);
          return await this.transcribeWithAPI(audioPath);
        }
        throw error;
      }
    }
  }

  private async transcribeWithAPI(audioPath: string): Promise<TranscriptionResult> {
    const apiKey = getOpenAIKey(this.config);
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!this.openaiClient) {
      this.openaiClient = new OpenAI({ apiKey });
    }

    const audioFile = fs.createReadStream(audioPath);

    const transcription = await this.openaiClient.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: this.config.whisper.language,
      response_format: 'verbose_json',
    });

    return {
      text: transcription.text,
      language: transcription.language,
      duration: transcription.duration,
      source: 'api',
    };
  }

  private async transcribeLocal(audioPath: string): Promise<TranscriptionResult> {
    const { localModelPath, whisperExecutable } = this.config.whisper;

    if (!localModelPath && !whisperExecutable) {
      throw new Error('Local Whisper not configured. Set localModelPath and/or whisperExecutable.');
    }

    // If we have an executable configured, use it with the model
    if (whisperExecutable) {
      return await this.transcribeWithWhisperCli(audioPath, whisperExecutable, localModelPath);
    }

    // If only model path is set, try to find whisper-cli in PATH
    return await this.transcribeWithWhisperCli(audioPath, 'whisper-cli', localModelPath);
  }

  private async transcribeWithWhisperCli(
    audioPath: string,
    executablePath: string,
    modelPath: string | null
  ): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      const args: string[] = [];

      // Add model path if specified
      if (modelPath) {
        args.push('-m', modelPath);
      }

      args.push(
        '-f', audioPath,
        '-l', this.config.whisper.language,
        '--no-timestamps',
        '--no-prints'  // Suppress progress output
      );

      const proc = spawn(executablePath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Clean up the output - whisper-cli outputs the transcription
          const text = stdout
            .split('\n')
            .filter(line => !line.startsWith('[') && line.trim())
            .join(' ')
            .trim();

          resolve({
            text,
            source: 'local',
          });
        } else {
          reject(new Error(`whisper-cli failed (code ${code}): ${stderr || stdout}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run whisper-cli: ${err.message}`));
      });
    });
  }

  canUseAPI(): boolean {
    return !!getOpenAIKey(this.config);
  }

  canUseLocal(): boolean {
    return !!this.config.whisper.localModelPath;
  }
}
