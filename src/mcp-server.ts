/**
 * MCP Server for PTT plugin configuration and status
 * Provides tools for getting/setting configuration and checking daemon status
 */
import * as readline from 'readline';
import { loadConfig, saveConfig, PTTConfig, updateConfig } from './config';
import { detectPlatform } from './keystroke/index';

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
];

class PTTMCPServer {
  private config: PTTConfig;

  constructor() {
    this.config = loadConfig();
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
      configured: {
        apiKey: !!this.config.whisper.openaiApiKey || !!process.env.OPENAI_API_KEY,
        localModel: !!this.config.whisper.localModelPath,
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
    process.exit(0);
  });
}

main().catch(console.error);
