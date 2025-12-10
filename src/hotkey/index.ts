/**
 * Cross-platform hotkey listener
 * - Windows/macOS/Linux X11: uiohook-napi
 * - Linux Wayland: evdev-based listener
 */
import { EventEmitter } from 'events';

export interface HotkeyEvents {
  'hotkey:down': () => void;
  'hotkey:up': () => void;
  'error': (error: Error) => void;
}

export interface HotkeyListenerInterface extends EventEmitter {
  start(): void;
  stop(): void;
  setHotkey(hotkey: string): void;
  isPressed(): boolean;
  getHotkey(): string;
}

export function isWayland(): boolean {
  return process.platform === 'linux' && (
    process.env.XDG_SESSION_TYPE === 'wayland' ||
    process.env.WAYLAND_DISPLAY !== undefined
  );
}

export async function createHotkeyListener(hotkey: string = 'Ctrl+Space'): Promise<HotkeyListenerInterface> {
  if (isWayland()) {
    const { WaylandHotkeyListener } = await import('./wayland-hotkey');
    return new WaylandHotkeyListener(hotkey);
  }

  // Use uiohook for Windows, macOS, and Linux X11
  const { UiohookHotkeyListener } = await import('./uiohook-hotkey');
  return new UiohookHotkeyListener(hotkey);
}

// Re-export the old class name for backwards compatibility
export { UiohookHotkeyListener as HotkeyListener } from './uiohook-hotkey';
