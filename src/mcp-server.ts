/**
 * MCP Server for PTT plugin with integrated daemon
 * Auto-starts hotkey listener when the MCP server loads
 */
import * as readline from 'readline';
import { loadConfig, PTTConfig, updateConfig } from './config';
import { detectPlatform, getKeystrokeDriver, KeystrokeDriver } from './keystroke/index';
import { createHotkeyListener, HotkeyListenerInterface, isWayland } from './hotkey/index';
import { AudioRecorder } from './recorder';
import { Transcriber } from './transcribe';

interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface DaemonState {
  isRunning: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  lastError: string | null;
  lastTranscription: string | null;
}

const TOOLS: Tool[] = [
  {
    name: 'ptt_get_config',
    description: 'Get the current PTT configuration',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ptt_set_config',
    description: 'Update PTT configuration values',
    inputSchema: {
      type: 'object',
      properties: {
        hotkey: {
          type: 'string',
          description: 'Hotkey combination (e.g., "Ctrl+Space")',
        },
        openaiApiKey: {
          type: 'string',
          description: 'OpenAI API key for Whisper API',
        },
        localModelPath: {
          type: 'string',
          description: 'Path to local Whisper model',
        },
        preferredMode: {
          type: 'string',
          enum: ['api', 'local'],
          description: 'Preferred transcription mode',
        },
        enableFallback: {
          type: 'boolean',
          description: 'Enable fallback to alternative transcription mode',
        },
        language: {
          type: 'string',
          description: 'Language code for transcription (e.g., "en")',
        },
        waylandBackend: {
          type: 'string',
          enum: ['wtype', 'ydotool', 'dotool'],
          description: 'Backend for Wayland keystroke simulation',
        },
      },
    },
  },
  {
    name: 'ptt_get_status',
    description: 'Get PTT daemon status and system information',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ptt_get_platform_info',
    description: 'Get platform detection and recommended configuration',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ptt_start',
    description: 'Start the PTT daemon (hotkey listener)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ptt_stop',
    description: 'Stop the PTT daemon (hotkey listener)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

class PTTMCPServer {
  private config: PTTConfig;
  private hotkeyListener: HotkeyListenerInterface | null = null;
  private recorder: AudioRecorder;
  private transcriber: Transcriber;
  private keystrokeDriver: KeystrokeDriver | null = null;
  private state: DaemonState = {
    isRunning: false,
    isRecording: false,
    isTranscribing: false,
    lastError: null,
    lastTranscription: null,
  };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.config = loadConfig();
    // hotkeyListener is created in startDaemon() since it needs async platform detection
    this.recorder = new AudioRecorder({
      sampleRate: this.config.audio.sampleRate,
    });
    this.transcriber = new Transcriber(this.config);
  }

  private setupEventHandlers(): void {
    if (!this.hotkeyListener) return;

    // Hotkey pressed - start recording
    this.hotkeyListener.on('hotkey:down', () => {
      this.startRecording();
    });

    // Hotkey released - stop recording and transcribe
    this.hotkeyListener.on('hotkey:up', () => {
      this.stopRecordingAndTranscribe();
    });

    // Hotkey error
    this.hotkeyListener.on('error', (error: Error) => {
      this.state.lastError = `Hotkey error: ${error.message}`;
      this.logError(this.state.lastError);
    });

    // Recording events
    this.recorder.on('recording:start', () => {
      this.state.isRecording = true;
      this.logStatus('Recording...');
    });

    this.recorder.on('recording:stop', () => {
      this.state.isRecording = false;
    });

    this.recorder.on('recording:error', (error: Error) => {
      this.state.isRecording = false;
      this.state.lastError = `Recording error: ${error.message}`;
      this.logError(this.state.lastError);
    });
  }

  private logStatus(message: string): void {
    // Log to stderr so it doesn't interfere with MCP protocol on stdout
    process.stderr.write(`[PTT] ${message}\n`);
  }

  private logError(message: string): void {
    process.stderr.write(`[PTT ERROR] ${message}\n`);
  }

  private startRecording(): void {
    if (this.state.isRecording || this.state.isTranscribing) return;

    try {
      this.recorder.start();
    } catch (error) {
      this.state.lastError = `Failed to start recording: ${(error as Error).message}`;
      this.logError(this.state.lastError);
    }
  }

  private async stopRecordingAndTranscribe(): Promise<void> {
    if (!this.state.isRecording) return;

    try {
      const audioPath = await this.recorder.stop();

      if (!audioPath) {
        this.state.lastError = 'No audio recorded';
        this.logError(this.state.lastError);
        return;
      }

      this.state.isTranscribing = true;
      this.logStatus('Transcribing...');

      const result = await this.transcriber.transcribe(audioPath);

      this.state.isTranscribing = false;

      if (result.text.trim()) {
        this.state.lastTranscription = result.text.trim();
        await this.typeText(result.text.trim());
        this.logStatus(`Done: "${result.text.trim().substring(0, 50)}${result.text.length > 50 ? '...' : ''}"`);
      } else {
        this.state.lastError = 'No speech detected';
        this.logError(this.state.lastError);
      }
    } catch (error) {
      this.state.isTranscribing = false;
      this.state.lastError = `Transcription error: ${(error as Error).message}`;
      this.logError(this.state.lastError);
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

  async startDaemon(): Promise<void> {
    if (this.state.isRunning) {
      return;
    }

    const onWayland = isWayland();
    this.logStatus(`Starting PTT daemon (hotkey: ${this.config.hotkey}, platform: ${onWayland ? 'Wayland' : 'X11/native'})...`);

    // Create hotkey listener with platform-appropriate backend
    try {
      this.hotkeyListener = await createHotkeyListener(this.config.hotkey);
      this.setupEventHandlers();

      if (onWayland) {
        this.logStatus('Using evdev-based hotkey listener for Wayland');
        this.logStatus('Note: User must be in "input" group for hotkey detection');
      } else {
        this.logStatus('Using uiohook-napi for hotkey detection');
      }
    } catch (error) {
      this.state.lastError = `Failed to create hotkey listener: ${(error as Error).message}`;
      this.logError(this.state.lastError);
      return;
    }

    // Initialize keystroke driver
    try {
      this.keystrokeDriver = await getKeystrokeDriver(this.config.keystroke);
      const isAvailable = await this.keystrokeDriver.isAvailable();
      if (!isAvailable) {
        this.logError('Warning: Keystroke driver not available. Text will not be typed.');
      }
    } catch (error) {
      this.logError(`Warning: Could not initialize keystroke driver: ${(error as Error).message}`);
    }

    // Start hotkey listener
    this.hotkeyListener.start();
    this.state.isRunning = true;

    // Cleanup old recordings periodically
    this.cleanupInterval = setInterval(() => {
      this.recorder.cleanup();
    }, 60 * 60 * 1000);

    this.logStatus('PTT daemon started. Press ' + this.config.hotkey + ' to record.');
  }

  stopDaemon(): void {
    if (!this.state.isRunning) return;

    this.logStatus('Stopping PTT daemon...');
    if (this.hotkeyListener) {
      this.hotkeyListener.stop();
    }
    this.recorder.cleanup();
    this.state.isRunning = false;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.logStatus('PTT daemon stopped.');
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id);

        case 'tools/list':
          return this.handleToolsList(id);

        case 'tools/call':
          return await this.handleToolCall(id, params as { name: string; arguments?: Record<string, unknown> });

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      };
    }
  }

  private handleInitialize(id: string | number): MCPResponse {
    // Auto-start the daemon when MCP initializes
    this.startDaemon().catch((error) => {
      this.logError(`Failed to auto-start daemon: ${error.message}`);
    });

    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'ptt',
          version: '1.0.0',
        },
      },
    };
  }

  private handleToolsList(id: string | number): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS,
      },
    };
  }

  private async handleToolCall(
    id: string | number,
    params: { name: string; arguments?: Record<string, unknown> }
  ): Promise<MCPResponse> {
    const { name, arguments: args = {} } = params;

    switch (name) {
      case 'ptt_get_config':
        return this.handleGetConfig(id);

      case 'ptt_set_config':
        return this.handleSetConfig(id, args);

      case 'ptt_get_status':
        return this.handleGetStatus(id);

      case 'ptt_get_platform_info':
        return this.handleGetPlatformInfo(id);

      case 'ptt_start':
        return await this.handleStart(id);

      case 'ptt_stop':
        return this.handleStop(id);

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Unknown tool: ${name}`,
          },
        };
    }
  }

  private handleGetConfig(id: string | number): MCPResponse {
    this.config = loadConfig();

    // Mask API key for display
    const displayConfig = {
      ...this.config,
      whisper: {
        ...this.config.whisper,
        openaiApiKey: this.config.whisper.openaiApiKey
          ? '***configured***'
          : null,
      },
    };

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(displayConfig, null, 2),
          },
        ],
      },
    };
  }

  private handleSetConfig(
    id: string | number,
    args: Record<string, unknown>
  ): MCPResponse {
    const updates: Partial<PTTConfig> = {};

    if (args.hotkey !== undefined) {
      updates.hotkey = String(args.hotkey);
    }

    if (
      args.openaiApiKey !== undefined ||
      args.localModelPath !== undefined ||
      args.preferredMode !== undefined ||
      args.enableFallback !== undefined ||
      args.language !== undefined
    ) {
      updates.whisper = { ...this.config.whisper };

      if (args.openaiApiKey !== undefined) {
        updates.whisper.openaiApiKey = args.openaiApiKey as string | null;
      }
      if (args.localModelPath !== undefined) {
        updates.whisper.localModelPath = args.localModelPath as string | null;
      }
      if (args.preferredMode !== undefined) {
        updates.whisper.preferredMode = args.preferredMode as 'api' | 'local';
      }
      if (args.enableFallback !== undefined) {
        updates.whisper.enableFallback = Boolean(args.enableFallback);
      }
      if (args.language !== undefined) {
        updates.whisper.language = String(args.language);
      }
    }

    if (args.waylandBackend !== undefined) {
      updates.keystroke = {
        ...this.config.keystroke,
        waylandBackend: args.waylandBackend as 'wtype' | 'ydotool' | 'dotool',
      };
    }

    this.config = updateConfig(updates);

    // Update hotkey listener if hotkey changed
    if (args.hotkey !== undefined && this.hotkeyListener) {
      this.hotkeyListener.setHotkey(String(args.hotkey));
    }

    // Update transcriber config
    this.transcriber.updateConfig(this.config);

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: 'Configuration updated successfully',
          },
        ],
      },
    };
  }

  private handleGetStatus(id: string | number): MCPResponse {
    const platformInfo = detectPlatform();

    const status = {
      daemon: {
        isRunning: this.state.isRunning,
        isRecording: this.state.isRecording,
        isTranscribing: this.state.isTranscribing,
        lastError: this.state.lastError,
        lastTranscription: this.state.lastTranscription,
      },
      configured: {
        apiKey: !!this.config.whisper.openaiApiKey || !!process.env.OPENAI_API_KEY,
        localModel: !!this.config.whisper.localModelPath,
        whisperExecutable: !!this.config.whisper.whisperExecutable,
      },
      platform: platformInfo,
      hotkey: this.config.hotkey,
      preferredMode: this.config.whisper.preferredMode,
    };

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      },
    };
  }

  private async handleStart(id: string | number): Promise<MCPResponse> {
    if (this.state.isRunning) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: 'PTT daemon is already running',
            },
          ],
        },
      };
    }

    await this.startDaemon();

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: `PTT daemon started. Hotkey: ${this.config.hotkey}`,
          },
        ],
      },
    };
  }

  private handleStop(id: string | number): MCPResponse {
    if (!this.state.isRunning) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: 'PTT daemon is not running',
            },
          ],
        },
      };
    }

    this.stopDaemon();

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: 'PTT daemon stopped',
          },
        ],
      },
    };
  }

  private handleGetPlatformInfo(id: string | number): MCPResponse {
    const info = detectPlatform();

    let instructions = '';
    if (info.displayServer === 'wayland') {
      instructions = `
Wayland detected. For keystroke simulation, install one of:
- wtype: sudo apt install wtype (recommended)
- ydotool: sudo apt install ydotool
- dotool: Available from source

Note: ydotool requires running ydotoold daemon.
      `.trim();
    } else if (info.platform === 'Linux') {
      instructions = `
X11 detected. Install libxtst for keystroke simulation:
  sudo apt install libxtst-dev

Then install nut.js (should work automatically).
      `.trim();
    } else if (info.platform === 'macOS') {
      instructions = `
macOS detected. Grant accessibility permissions to your terminal:
  System Preferences > Security & Privacy > Privacy > Accessibility
      `.trim();
    } else if (info.platform === 'Windows') {
      instructions = 'Windows detected. No additional setup required.';
    }

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: `Platform: ${info.platform}\nDisplay: ${info.displayServer}\nRecommended: ${info.recommended}\n\n${instructions}`,
          },
        ],
      },
    };
  }
}

// Main entry point - stdio transport for MCP
async function main() {
  const server = new PTTMCPServer();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    try {
      const request = JSON.parse(line) as MCPRequest;
      const response = await server.handleRequest(request);
      console.log(JSON.stringify(response));
    } catch (error) {
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      };
      console.log(JSON.stringify(errorResponse));
    }
  });

  rl.on('close', () => {
    server.stopDaemon();
    process.exit(0);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    server.stopDaemon();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.stopDaemon();
    process.exit(0);
  });
}

main().catch((error) => {
  process.stderr.write(`[PTT] Fatal error: ${error.message}\n`);
  process.exit(1);
});
