/**
 * Cross-platform keystroke simulation
 * - Windows/macOS/Linux X11: nut.js
 * - Linux Wayland: ydotool/wtype
 * Documentation: https://nutjs.dev/docs/keyboard
 */
import { KeystrokeConfig } from '../config';

export interface KeystrokeDriver {
  type(text: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export async function getKeystrokeDriver(config: KeystrokeConfig): Promise<KeystrokeDriver> {
  const platform = process.platform;
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' ||
                    process.env.WAYLAND_DISPLAY !== undefined;

  if (platform === 'linux' && isWayland) {
    const { WaylandDriver } = await import('./wayland');
    return new WaylandDriver(config.waylandBackend);
  }

  // Use nut.js for Windows, macOS, and Linux X11
  const { NutJsDriver } = await import('./nutjs');
  return new NutJsDriver();
}

export function detectPlatform(): {
  platform: string;
  displayServer: 'x11' | 'wayland' | 'native';
  recommended: string;
} {
  const platform = process.platform;

  if (platform === 'win32') {
    return {
      platform: 'Windows',
      displayServer: 'native',
      recommended: 'nut.js',
    };
  }

  if (platform === 'darwin') {
    return {
      platform: 'macOS',
      displayServer: 'native',
      recommended: 'nut.js',
    };
  }

  if (platform === 'linux') {
    const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' ||
                      process.env.WAYLAND_DISPLAY !== undefined;

    return {
      platform: 'Linux',
      displayServer: isWayland ? 'wayland' : 'x11',
      recommended: isWayland ? 'wtype/ydotool' : 'nut.js',
    };
  }

  return {
    platform: 'Unknown',
    displayServer: 'native',
    recommended: 'nut.js',
  };
}
