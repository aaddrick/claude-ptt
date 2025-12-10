/**
 * Wayland-compatible hotkey listener using evdev
 *
 * On Wayland, X11-based hotkey libraries don't work. This implementation
 * reads directly from /dev/input/event* devices using evdev.
 *
 * Requirements:
 * - User must be in the 'input' group: sudo usermod -aG input $USER
 * - Or run with elevated permissions
 *
 * Key codes reference: https://github.com/torvalds/linux/blob/master/include/uapi/linux/input-event-codes.h
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { HotkeyListenerInterface } from './index';

// Linux evdev key codes (from input-event-codes.h)
const KEY_CODES: Record<string, number> = {
  // Modifiers
  'leftctrl': 29,
  'leftshift': 42,
  'leftalt': 56,
  'leftmeta': 125,
  'rightctrl': 97,
  'rightshift': 54,
  'rightalt': 100,
  'rightmeta': 126,
  // Common keys
  'space': 57,
  'enter': 28,
  'tab': 15,
  'escape': 1,
  'backspace': 14,
  // Letters
  'a': 30, 'b': 48, 'c': 46, 'd': 32, 'e': 18, 'f': 33, 'g': 34, 'h': 35,
  'i': 23, 'j': 36, 'k': 37, 'l': 38, 'm': 50, 'n': 49, 'o': 24, 'p': 25,
  'q': 16, 'r': 19, 's': 31, 't': 20, 'u': 22, 'v': 47, 'w': 17, 'x': 45,
  'y': 21, 'z': 44,
  // Numbers
  '1': 2, '2': 3, '3': 4, '4': 5, '5': 6, '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
  // Function keys
  'f1': 59, 'f2': 60, 'f3': 61, 'f4': 62, 'f5': 63, 'f6': 64,
  'f7': 65, 'f8': 66, 'f9': 67, 'f10': 68, 'f11': 87, 'f12': 88,
};

// evdev event types
const EV_KEY = 1;
const KEY_RELEASE = 0;
const KEY_PRESS = 1;

interface ParsedHotkey {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: number | null;
}

interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export class WaylandHotkeyListener extends EventEmitter implements HotkeyListenerInterface {
  private hotkey: string;
  private parsedHotkey: ParsedHotkey;
  private isHotkeyActive: boolean = false;
  private isRunning: boolean = false;
  private fileHandles: fs.promises.FileHandle[] = [];
  private readLoops: Promise<void>[] = [];
  private abortController: AbortController | null = null;
  private modifierState: ModifierState = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

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
        default:
          // Look up key code
          const keyCode = KEY_CODES[part];
          if (keyCode !== undefined) {
            result.key = keyCode;
          }
          break;
      }
    }

    return result;
  }

  private findKeyboardDevices(): string[] {
    const devices: string[] = [];
    const inputDir = '/dev/input';

    try {
      const files = fs.readdirSync(inputDir);
      for (const file of files) {
        if (file.startsWith('event')) {
          const devicePath = path.join(inputDir, file);
          // Check if this is a keyboard by looking at /sys/class/input/*/device/capabilities/key
          const eventNum = file.replace('event', '');
          const capPath = `/sys/class/input/event${eventNum}/device/capabilities/key`;

          try {
            const caps = fs.readFileSync(capPath, 'utf8').trim();
            // Keyboards have extensive key capabilities (long hex string)
            // A mouse typically has very short capability string
            if (caps.length > 10) {
              devices.push(devicePath);
            }
          } catch {
            // If we can't read capabilities, try the device anyway
            devices.push(devicePath);
          }
        }
      }
    } catch (error) {
      this.emit('error', new Error(`Cannot read /dev/input: ${(error as Error).message}. Make sure you are in the 'input' group.`));
    }

    return devices;
  }

  private updateModifierState(keyCode: number, pressed: boolean): void {
    switch (keyCode) {
      case KEY_CODES['leftctrl']:
      case KEY_CODES['rightctrl']:
        this.modifierState.ctrl = pressed;
        break;
      case KEY_CODES['leftshift']:
      case KEY_CODES['rightshift']:
        this.modifierState.shift = pressed;
        break;
      case KEY_CODES['leftalt']:
      case KEY_CODES['rightalt']:
        this.modifierState.alt = pressed;
        break;
      case KEY_CODES['leftmeta']:
      case KEY_CODES['rightmeta']:
        this.modifierState.meta = pressed;
        break;
    }
  }

  private checkHotkeyMatch(keyCode: number): boolean {
    const { ctrl, shift, alt, meta, key } = this.parsedHotkey;

    // Check modifiers match expected state
    if (ctrl !== this.modifierState.ctrl) return false;
    if (shift !== this.modifierState.shift) return false;
    if (alt !== this.modifierState.alt) return false;
    if (meta !== this.modifierState.meta) return false;

    // Check key matches if specified
    if (key !== null && key !== keyCode) return false;

    return true;
  }

  private async readEventsFromDevice(devicePath: string, signal: AbortSignal): Promise<void> {
    let handle: fs.promises.FileHandle | null = null;

    try {
      handle = await fs.promises.open(devicePath, 'r');
      this.fileHandles.push(handle);

      // evdev event structure: struct input_event { time (16 bytes), type (2), code (2), value (4) }
      // On 64-bit systems: time is two 8-byte values (seconds, microseconds)
      const eventSize = 24; // 64-bit systems
      const buffer = Buffer.alloc(eventSize);

      while (!signal.aborted) {
        try {
          const { bytesRead } = await handle.read(buffer, 0, eventSize, null);

          if (bytesRead === 0 || signal.aborted) break;
          if (bytesRead !== eventSize) continue;

          // Parse event
          const type = buffer.readUInt16LE(16);
          const code = buffer.readUInt16LE(18);
          const value = buffer.readInt32LE(20);

          if (type === EV_KEY) {
            // Update modifier state for all key events
            this.updateModifierState(code, value === KEY_PRESS);

            if (value === KEY_PRESS) {
              // Key pressed
              if (!this.isHotkeyActive && this.checkHotkeyMatch(code)) {
                this.isHotkeyActive = true;
                this.emit('hotkey:down');
              }
            } else if (value === KEY_RELEASE) {
              // Key released
              if (this.isHotkeyActive) {
                // Check if the main key (non-modifier) was released
                const { key } = this.parsedHotkey;
                if (key !== null && code === key) {
                  this.isHotkeyActive = false;
                  this.emit('hotkey:up');
                }
              }
            }
          }
        } catch (error) {
          if (signal.aborted) break;
          // EAGAIN or similar - just continue
          if ((error as NodeJS.ErrnoException).code === 'EAGAIN') continue;
          throw error;
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        // Only emit error if not intentionally stopped
        const errMsg = (error as Error).message;
        if (errMsg.includes('EACCES') || errMsg.includes('permission')) {
          this.emit('error', new Error(
            `Permission denied reading ${devicePath}. ` +
            `Add user to input group: sudo usermod -aG input $USER (then log out and back in)`
          ));
        } else {
          this.emit('error', error as Error);
        }
      }
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const devices = this.findKeyboardDevices();

    if (devices.length === 0) {
      this.emit('error', new Error(
        'No keyboard devices found in /dev/input. ' +
        'Make sure you have permission to read input devices.'
      ));
      return;
    }

    this.abortController = new AbortController();

    // Start reading from all keyboard devices
    for (const device of devices) {
      const loop = this.readEventsFromDevice(device, this.abortController.signal);
      this.readLoops.push(loop);
    }

    // Handle any read loop errors
    Promise.allSettled(this.readLoops).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected' && this.isRunning) {
          this.emit('error', result.reason);
        }
      }
    });
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.isHotkeyActive = false;

    // Signal all read loops to stop
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Close all file handles
    for (const handle of this.fileHandles) {
      handle.close().catch(() => {});
    }
    this.fileHandles = [];
    this.readLoops = [];

    // Reset modifier state
    this.modifierState = {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
    };
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
