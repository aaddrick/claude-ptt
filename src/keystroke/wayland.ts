/**
 * Wayland keystroke driver using wtype or ydotool
 * Documentation:
 * - ydotool: https://github.com/ReimuNotMoe/ydotool
 * - wtype: https://github.com/atx/wtype
 */
import { spawn, execSync } from 'child_process';
import type { KeystrokeDriver } from './index';

type WaylandBackend = 'wtype' | 'ydotool' | 'dotool';

export class WaylandDriver implements KeystrokeDriver {
  private backend: WaylandBackend;
  private availableBackend: WaylandBackend | null = null;

  constructor(preferredBackend: WaylandBackend = 'wtype') {
    this.backend = preferredBackend;
  }

  private isCommandAvailable(cmd: string): boolean {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private async detectBackend(): Promise<WaylandBackend | null> {
    if (this.availableBackend) {
      return this.availableBackend;
    }

    // Try preferred backend first
    if (this.isCommandAvailable(this.backend)) {
      this.availableBackend = this.backend;
      return this.backend;
    }

    // Fall back to alternatives
    const backends: WaylandBackend[] = ['wtype', 'ydotool', 'dotool'];
    for (const backend of backends) {
      if (backend !== this.backend && this.isCommandAvailable(backend)) {
        this.availableBackend = backend;
        return backend;
      }
    }

    return null;
  }

  async type(text: string): Promise<void> {
    const backend = await this.detectBackend();

    if (!backend) {
      throw new Error(
        'No Wayland keystroke backend found. Install wtype, ydotool, or dotool.'
      );
    }

    switch (backend) {
      case 'wtype':
        await this.typeWithWtype(text);
        break;
      case 'ydotool':
        await this.typeWithYdotool(text);
        break;
      case 'dotool':
        await this.typeWithDotool(text);
        break;
    }
  }

  private async typeWithWtype(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('wtype', [text]);

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`wtype exited with code ${code}`));
        }
      });

      process.on('error', reject);
    });
  }

  private async typeWithYdotool(text: string): Promise<void> {
    // ydotool type command with escape sequences disabled for safety
    return new Promise((resolve, reject) => {
      const process = spawn('ydotool', ['type', '--', text]);

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ydotool exited with code ${code}`));
        }
      });

      process.on('error', reject);
    });
  }

  private async typeWithDotool(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('dotool', [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      process.stdin.write(`type ${text}\n`);
      process.stdin.end();

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`dotool exited with code ${code}`));
        }
      });

      process.on('error', reject);
    });
  }

  async isAvailable(): Promise<boolean> {
    const backend = await this.detectBackend();
    return backend !== null;
  }

  getBackend(): WaylandBackend | null {
    return this.availableBackend;
  }
}
