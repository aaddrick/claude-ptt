import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WhisperConfig {
  openaiApiKey: string | null;
  localModelPath: string | null;
  whisperExecutable: string | null;
  preferredMode: 'api' | 'local';
  enableFallback: boolean;
  language: string;
}

export interface AudioConfig {
  sampleRate: number;
  silenceThreshold: number;
}

export interface KeystrokeConfig {
  waylandBackend: 'wtype' | 'ydotool' | 'dotool';
}

export interface FeedbackConfig {
  showRecordingIndicator: boolean;
}

export interface PTTConfig {
  hotkey: string;
  whisper: WhisperConfig;
  audio: AudioConfig;
  keystroke: KeystrokeConfig;
  feedback: FeedbackConfig;
}

const DEFAULT_CONFIG: PTTConfig = {
  hotkey: 'Ctrl+Space',
  whisper: {
    openaiApiKey: null,
    localModelPath: null,
    whisperExecutable: null,
    preferredMode: 'api',
    enableFallback: true,
    language: 'en',
  },
  audio: {
    sampleRate: 16000,
    silenceThreshold: 0.5,
  },
  keystroke: {
    waylandBackend: 'wtype',
  },
  feedback: {
    showRecordingIndicator: true,
  },
};

function getConfigPath(): string {
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  return path.join(claudeDir, 'ptt-config.json');
}

export function loadConfig(): PTTConfig {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const userConfig = JSON.parse(fileContent);
      return deepMerge(DEFAULT_CONFIG, userConfig);
    } catch (error) {
      console.error('Error loading config, using defaults:', error);
      return DEFAULT_CONFIG;
    }
  }

  // Create default config file
  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

export function saveConfig(config: PTTConfig): void {
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function updateConfig(updates: Partial<PTTConfig>): PTTConfig {
  const current = loadConfig();
  const updated = deepMerge(current, updates);
  saveConfig(updated);
  return updated;
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        (result as Record<string, unknown>)[key] = deepMerge(
          target[key] as object,
          source[key] as object
        );
      } else {
        (result as Record<string, unknown>)[key] = source[key];
      }
    }
  }

  return result;
}

export function getOpenAIKey(config: PTTConfig): string | null {
  return config.whisper.openaiApiKey || process.env.OPENAI_API_KEY || null;
}
