/**
 * Global hotkey listener using uiohook-napi
 * Works on Windows, macOS, and Linux X11
 * Documentation: https://github.com/snosme/uiohook-napi
 *
 * Usage:
 * ```typescript
 * import { uIOhook, UiohookKey } from 'uiohook-napi'
 * uIOhook.on('keydown', (e) => {
 *   if (e.keycode === UiohookKey.Q && e.ctrlKey) {
 *     console.log('Ctrl+Q pressed')
 *   }
 * })
 * uIOhook.start()
 * ```
 */
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { EventEmitter } from 'events';
import type { HotkeyListenerInterface } from './index';

interface ParsedHotkey {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: number | null;
}

export class UiohookHotkeyListener extends EventEmitter implements HotkeyListenerInterface {
  private hotkey: string;
  private parsedHotkey: ParsedHotkey;
  private isHotkeyActive: boolean = false;
  private isRunning: boolean = false;

  constructor(hotkey: string = 'Ctrl+Space') {
    super();
    this.hotkey = hotkey;
    this.parsedHotkey = this.parseHotkey(hotkey);
  }

  private parseHotkey(hotkey: string): ParsedHotkey {
    const parts = hotkey.split('+').map(k => k.trim().toLowerCase());
    const result: ParsedHotkey = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: null,
    };

    for (const part of parts) {
      switch (part) {
        case 'ctrl':
        case 'control':
          result.ctrl = true;
          break;
        case 'shift':
          result.shift = true;
          break;
        case 'alt':
          result.alt = true;
          break;
        case 'meta':
        case 'cmd':
        case 'win':
        case 'super':
          result.meta = true;
          break;
        case 'space':
          result.key = UiohookKey.Space;
          break;
        case 'enter':
        case 'return':
          result.key = UiohookKey.Enter;
          break;
        case 'tab':
          result.key = UiohookKey.Tab;
          break;
        case 'escape':
        case 'esc':
          result.key = UiohookKey.Escape;
          break;
        default:
          // Try to match single character keys
          if (part.length === 1) {
            const upperPart = part.toUpperCase();
            const keyName = upperPart as keyof typeof UiohookKey;
            if (keyName in UiohookKey) {
              result.key = UiohookKey[keyName];
            }
          }
          break;
      }
    }

    return result;
  }

  private checkHotkeyMatch(
    ctrlKey: boolean,
    shiftKey: boolean,
    altKey: boolean,
    metaKey: boolean,
    keycode: number
  ): boolean {
    const { ctrl, shift, alt, meta, key } = this.parsedHotkey;

    // Check modifiers match expected state
    if (ctrl !== ctrlKey) return false;
    if (shift !== shiftKey) return false;
    if (alt !== altKey) return false;
    if (meta !== metaKey) return false;

    // Check key matches if specified
    if (key !== null && key !== keycode) return false;

    return true;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    uIOhook.on('keydown', (e) => {
      if (!this.isHotkeyActive && this.checkHotkeyMatch(
        e.ctrlKey,
        e.shiftKey,
        e.altKey,
        e.metaKey,
        e.keycode
      )) {
        this.isHotkeyActive = true;
        this.emit('hotkey:down');
      }
    });

    uIOhook.on('keyup', (e) => {
      if (this.isHotkeyActive) {
        // Check if the main key (non-modifier) was released
        const { key } = this.parsedHotkey;
        if (key !== null && e.keycode === key) {
          this.isHotkeyActive = false;
          this.emit('hotkey:up');
        }
      }
    });

    try {
      uIOhook.start();
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.isHotkeyActive = false;

    try {
      uIOhook.stop();
    } catch (error) {
      // Ignore errors on stop
    }
  }

  setHotkey(hotkey: string): void {
    this.hotkey = hotkey;
    this.parsedHotkey = this.parseHotkey(hotkey);
    this.isHotkeyActive = false;
  }

  isPressed(): boolean {
    return this.isHotkeyActive;
  }

  getHotkey(): string {
    return this.hotkey;
  }
}
