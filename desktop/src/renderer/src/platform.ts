// The platform of the renderer, for the macOS window parts of docs/design.md 8.1. The renderer has
// no Node access, so it reads the user agent of Chromium.

/** The height of the title row: the traffic lights of macOS sit in it, and it moves the window. */
export const TITLE_ROW = 44;

/** The width that the traffic lights need at the left of the title row (macOS 26: x 16 to 76). */
export const TRAFFIC_LIGHTS_WIDTH = 80;

export function isMac(userAgent: string = navigator.userAgent): boolean {
  return /Macintosh|Mac OS X/.test(userAgent);
}
