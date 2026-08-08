/**
 * Cutout-aware status bar height for module-scope StyleSheet definitions.
 *
 * Prefer the useTopInset() hook (src/hooks/useSafeArea) inside components — it
 * updates on rotation. This constant exists for styles declared at module scope,
 * where hooks cannot run (e.g. absolutely-positioned close buttons on fullscreen
 * image viewers).
 *
 * Every screen used to declare its own:
 *
 *     const STATUSBAR_HEIGHT = IOS ? 48 : (StatusBar.currentHeight || 0) + 6;
 *
 * StatusBar.currentHeight does NOT include display-cutout insets, so on
 * punch-hole / notch devices it under-reports and content renders under the
 * camera. initialWindowMetrics comes from the platform's WindowInsets and is
 * populated synchronously at module load, so it is safe to read here and does
 * account for cutouts, tablets and every DPI.
 */

import { Platform, StatusBar } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";

const FALLBACK_TOP = Platform.OS === "ios" ? 44 : StatusBar.currentHeight || 0;

/** Status bar + display cutout inset, plus a small gutter. */
export const STATUSBAR_HEIGHT = (initialWindowMetrics?.insets?.top ?? FALLBACK_TOP) + 6;

export default STATUSBAR_HEIGHT;
