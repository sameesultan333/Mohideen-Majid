/**
 * logger.js — production-safe console wrapper.
 *
 * `log`/`warn`/`info` are no-ops outside of __DEV__ so release builds never
 * write diagnostic output (request payloads, FCM tokens, server error
 * bodies, etc.) to device logcat, where it's readable by anything with USB
 * debugging / ADB access to the phone.
 *
 * `error` still writes in release too — crash/error visibility is more
 * valuable in production than the (already-mild) exposure risk of an error
 * message, and this is the natural hook point for a future crash reporter
 * (Sentry/Crashlytics) without touching every call site again.
 */

export const logger = {
  log: (...args) => { if (__DEV__) console.log(...args); },
  warn: (...args) => { if (__DEV__) console.warn(...args); },
  info: (...args) => { if (__DEV__) console.info(...args); },
  error: (...args) => { console.error(...args); },
};
