/**
 * Safe-area insets for custom headers.
 *
 * Why this exists
 * ---------------
 * From targetSdk 35 Android force-enables edge-to-edge, so the app draws behind
 * the status bar and the display cutout. Every screen with a custom header used
 * to compute its own top padding as:
 *
 *     const STATUSBAR_HEIGHT = IOS ? 48 : (StatusBar.currentHeight || 0) + 6;
 *
 * That is wrong on modern devices for three reasons:
 *   1. StatusBar.currentHeight does NOT include display-cutout insets, so on
 *      punch-hole / notch / waterdrop devices it under-reports by 20-30dp and
 *      the header renders under the camera.
 *   2. It is a static module-scope value, so it never updates on rotation —
 *      in landscape the cutout moves aside and the top inset shrinks.
 *   3. The magic numbers (48, +6, +4) differed per screen, which is why the
 *      overlap looked inconsistent between Home and everything else.
 *
 * useTopInset() reads the real inset from react-native-safe-area-context, which
 * is fed by the platform's WindowInsets and therefore accounts for cutouts,
 * varying status bar heights, tablets and every DPI. It re-renders on rotation.
 *
 * Requires <SafeAreaProvider> at the root — mounted in App.jsx.
 */

import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Minimum breathing room between the system bar and header content. */
const HEADER_TOP_GUTTER = 6;

/**
 * Top padding a custom header should use so it always starts below the status
 * bar and any display cutout.
 *
 * @param {number} [gutter] extra space below the inset. Defaults to 6.
 */
export function useTopInset(gutter = HEADER_TOP_GUTTER) {
  const insets = useSafeAreaInsets();
  return insets.top + gutter;
}

/**
 * Bottom inset for gesture-navigation devices. Use on screens with content or
 * an action bar pinned to the bottom, so the gesture pill never covers it.
 */
export function useBottomInset(gutter = 0) {
  const insets = useSafeAreaInsets();
  return insets.bottom + gutter;
}

/** All four insets, for the rare screen that needs left/right (landscape cutouts). */
export function useScreenInsets() {
  return useSafeAreaInsets();
}
