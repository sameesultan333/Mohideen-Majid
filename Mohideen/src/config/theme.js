// ── MERGE INTO src/config/theme.js ──────────────────────────────────────
// Per your project rule: merge into the existing file, do not replace it.
// This adds a richer emerald/gold/white palette on top of what's there.
// Anything already consumed elsewhere as C.bg / C.bgVivid / C.gold etc.
// keeps working — these are just stronger values for the same keys, plus
// a couple of new ones (glow, ivory, border) that CollectorScreen now uses.

import { Platform } from "react-native";

const palette = {
  emerald: {
    deep: "#053B26",   // screen background
    base: "#0E6B45",   // vivid mid-green, glows / secondary fills
    light: "#3FAE7C",  // bright accent green, used sparingly
    pale: "#EAF7F0",   // faint green tint for subtle surfaces
  },
  gold: {
    deep: "#9C7A1E",
    base: "#D4AF37",   // true metallic gold
    light: "#F3D77B",
    pale: "#FBF3DC",
  },
  neutral: {
    white: "#FFFFFF",
    ivory: "#FFFDF7",
    charcoal: "#152219",
    slate: "#5B6B62",
  },
  semantic: {
    success: "#0E6B45",
    warning: "#D4AF37",
    info: "#1F3F73",
    error: "#B5432E",
  },
};

export const colors = palette;

export const COLORS = {
  bg: palette.emerald.deep,
  bgVivid: palette.emerald.base,
  glow: palette.emerald.light,
  white: palette.neutral.white,
  ivory: palette.neutral.ivory,
  textDark: palette.neutral.charcoal,
  textMuted: palette.neutral.slate,
  gold: palette.gold.base,
  goldDeep: palette.gold.deep,
  goldLight: palette.gold.light,
  border: "rgba(212,175,55,0.4)",
  error: palette.semantic.error,
  errorBg: "rgba(181,67,46,0.12)",
};

export const RADII = { sm: 10, md: 14, xl: 22 };
export const SPACING = { sm: 8, md: 12, lg: 18, xl: 24, xxl: 32 };
export const FONTS = {
  display: Platform.OS === "ios" ? "Georgia" : "serif",
  body: undefined,
};