/**
 * nut.js keystroke driver for Windows, macOS, and Linux X11
 * Documentation: https://nutjs.dev/docs/keyboard
 */
import type { KeystrokeDriver } from './index';

export class NutJsDriver implements KeystrokeDriver {
  private keyboard: { type: (text: string) => Promise<void>; config: { autoDelayMs: number } } | null = null;
  private initialized: boolean = false;

  private async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import since nut.js is an optional dependency
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nutjs = await (Function('return import("@nut-tree/nut-js")')() as Promise<{ keyboard: { type: (text: string) => Promise<void>; config: { autoDelayMs: number } } }>);
      this.keyboard = nutjs.keyboard;

      // Configure typing delay for natural typing
      this.keyboard.config.autoDelayMs = 10;

      this.initialized = true;
    } catch (error) {
      throw new Error(
        'nut.js is not installed. Install it with: npm install @nut-tree/nut-js'
      );
    }
  }

  async type(text: string): Promise<void> {
    await this.init();

    if (!this.keyboard) {
      throw new Error('Keyboard not initialized');
    }

    // Type the text character by character
    await this.keyboard.type(text);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.init();
      return true;
    } catch {
      return false;
    }
  }
}
