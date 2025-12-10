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
    const modelPath = this.config.whisper.localModelPath;
    if (!modelPath) {
      throw new Error('Local Whisper model path not configured');
    }

    // Check if model path is a whisper.cpp executable or model file
    const isWhisperCpp = modelPath.endsWith('main') || modelPath.includes('whisper.cpp');

    if (isWhisperCpp) {
      return await this.transcribeWithWhisperCpp(audioPath, modelPath);
    }

    // Assume it's a model file path for whisper.cpp
    return await this.transcribeWithWhisperCppModel(audioPath, modelPath);
  }

  private async transcribeWithWhisperCpp(
    audioPath: string,
    executablePath: string
  ): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      const args = [
        '-f', audioPath,
        '-l', this.config.whisper.language,
        '--output-txt',
        '--no-timestamps',
      ];

      const process = spawn(executablePath, args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            text: stdout.trim(),
            source: 'local',
          });
        } else {
          reject(new Error(`whisper.cpp failed: ${stderr}`));
        }
      });

      process.on('error', reject);
    });
  }

  private async transcribeWithWhisperCppModel(
    audioPath: string,
    modelPath: string
  ): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      // Assume whisper.cpp main executable is in PATH or same directory as model
      const whisperPath = 'whisper';
      const args = [
        '-m', modelPath,
        '-f', audioPath,
        '-l', this.config.whisper.language,
        '--output-txt',
        '--no-timestamps',
      ];

      const process = spawn(whisperPath, args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            text: stdout.trim(),
            source: 'local',
          });
        } else {
          reject(new Error(`whisper failed: ${stderr}`));
        }
      });

      process.on('error', reject);
    });
  }

  canUseAPI(): boolean {
    return !!getOpenAIKey(this.config);
  }

  canUseLocal(): boolean {
    return !!this.config.whisper.localModelPath;
  }
}
