/**
 * Status-bar appearance, derived rather than hardcoded.
 *
 * The problem this solves: the strip behind the Android status bar has to match
 * whatever the screen paints directly beneath it, and the system icons (clock,
 * battery, signal) have to stay readable against it. Picking one colour for the
 * whole app cannot satisfy both — an ivory strip above this app's dark emerald
 * headers looked wrong AND left the icons invisible.
 *
 * So a screen declares the colour at its top edge and the icon style is
 * *computed* from that colour's luminance. No screen ever specifies
 * "light-content" or "dark-content" by hand, so the two can never disagree.
 *
 *     useScreenStatusBar(H.bg)   // ivory screen -> dark icons, automatically
 *
 * Screens that do not call the hook inherit DEFAULT_TOP_COLOR, which is the
 * emerald header the large majority of this app's screens start with.
 */

import React, { createContext, useContext, useMemo, useState, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { COLORS } from "../config/theme";

/** Most screens open with the emerald gradient header. */
export const DEFAULT_TOP_COLOR = COLORS.bg;

/** #RGB / #RRGGBB / rgb() / rgba() -> {r,g,b}, or null if unparseable. */
function parseColor(color) {
  if (typeof color !== "string") return null;
  const c = color.trim();

  const hex = c.replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };

  return null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(color) {
  const rgb = parseColor(color);
  if (!rgb) return 0;                       // unknown -> assume dark, light icons
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two luminances, 1:1 to 21:1. */
function contrast(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Icon style with the better contrast against `color`.
 *
 * Compares the actual contrast ratio of dark icons vs light icons rather than
 * thresholding luminance. A midpoint threshold gets mid-tones wrong: this app's
 * gold (#D4AF37) sits at luminance 0.45, so "> 0.5 means dark icons" would put
 * white icons on it at ~2:1 contrast when black gives ~10:1. The crossover
 * where the two are equal is near luminance 0.18, not 0.5.
 */
export function barStyleFor(color) {
  const l = luminance(color);
  return contrast(l, 0) >= contrast(l, 1) ? "dark-content" : "light-content";
}

const StatusBarContext = createContext({
  topColor: DEFAULT_TOP_COLOR,
  barStyle: barStyleFor(DEFAULT_TOP_COLOR),
  setTopColor: () => {},
});

export function StatusBarProvider({ children }) {
  const [topColor, setTopColor] = useState(DEFAULT_TOP_COLOR);
  const value = useMemo(
    () => ({ topColor, barStyle: barStyleFor(topColor), setTopColor }),
    [topColor],
  );
  return <StatusBarContext.Provider value={value}>{children}</StatusBarContext.Provider>;
}

export function useStatusBarAppearance() {
  return useContext(StatusBarContext);
}

/**
 * Declare the colour at this screen's top edge.
 *
 * Applied on focus and restored to the default on blur, so going back always
 * leaves the bar matching whatever is actually on screen.
 */
export function useScreenStatusBar(color) {
  const { setTopColor } = useContext(StatusBarContext);
  useFocusEffect(
    useCallback(() => {
      setTopColor(color || DEFAULT_TOP_COLOR);
      return () => setTopColor(DEFAULT_TOP_COLOR);
    }, [color, setTopColor]),
  );
}
