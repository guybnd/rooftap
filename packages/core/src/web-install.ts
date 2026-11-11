// Where the web app runs, for the install and notification hints. iPhone and
// iPad have no native Rooftap app yet, so there the installed web app is the
// app: Safari delivers web push only to a site added to the Home Screen
// (iOS 16.4 and later). Callers pass what the browser reports; this file
// reads no browser globals.

export type WebDevice =
  /** iPhone or iPad in a browser tab: notifications need Add to Home Screen. */
  | 'ios-browser'
  /** iPhone or iPad, opened from the Home Screen. */
  | 'ios-installed'
  /** An Android phone in a browser: the native app is the better fit. */
  | 'android-browser'
  /** Installed from any other browser (Android or desktop). */
  | 'installed'
  /** A computer in a browser tab. */
  | 'desktop';

export interface WebDeviceInput {
  userAgent: string;
  /** navigator.maxTouchPoints: iPadOS reports a Mac user agent, but a touch screen. */
  maxTouchPoints: number;
  /** display-mode: standalone, or Safari's navigator.standalone. */
  standalone: boolean;
}

export function isIosUserAgent(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return userAgent.includes('Macintosh') && maxTouchPoints > 1;
}

export function webDevice(input: WebDeviceInput): WebDevice {
  if (isIosUserAgent(input.userAgent, input.maxTouchPoints)) {
    return input.standalone ? 'ios-installed' : 'ios-browser';
  }
  if (input.standalone) return 'installed';
  if (/Android/i.test(input.userAgent)) return 'android-browser';
  return 'desktop';
}

/** The Add to Home Screen steps, in the words of the Share sheet on iPhone. */
export const IOS_HOME_SCREEN_STEPS =
  'In Safari, tap the Share button, then Add to Home Screen. Then open Rooftap from your Home Screen.';

/** What an iPhone that is too old for web push needs. */
export const IOS_PUSH_VERSION_HINT =
  'Notifications on iPhone and iPad need iOS 16.4 or later. Update in the Settings app, then open Rooftap again.';
