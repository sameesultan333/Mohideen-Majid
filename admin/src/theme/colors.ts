/**
 * MOHIDEEN MASJID — ADMIN DASHBOARD
 * Design Tokens
 *
 * Palette inspired by classical Islamic manuscript illumination:
 * deep emerald (mihrab tilework), antique gold leaf, ivory vellum,
 * and lapis navy — the four pigments that dominate Quranic
 * illumination and mosque tilework alike.
 *
 * Deliberately NOT a flat "green + gold SaaS" palette — the third
 * accent (lapis navy) and the warm ivory base (not stark white) are
 * what keep this from reading as a template.
 */

const COLORS = {
  // ==========================================================
  // BRAND — Emerald (primary action, identity)
  // ==========================================================
  primary: "#0F5C4C",        // deep emerald — mihrab tile green, not mint/SaaS green
  primaryHover: "#0B4A3D",
  primaryPressed: "#083D32",
  primaryLight: "#E9F5F0",
  primaryLighter: "#F4FAF7",
  primaryBorder: "#BFE0D4",

  // ==========================================================
  // ACCENT — Antique gold leaf (celebratory / highlight only)
  // ==========================================================
  accent: "#A9812E",         // muted gilding gold, not bright yellow-gold
  accentHover: "#8F6C24",
  accentPressed: "#78591D",
  accentLight: "#FAF3E1",
  accentLighter: "#FDF9EF",
  accentBorder: "#E8D6A5",

  // ==========================================================
  // SECONDARY ACCENT — Lapis navy (the differentiator)
  // used sparingly: links, info states, secondary data series
  // ==========================================================
  lapis: "#1E3A5F",
  lapisHover: "#17304E",
  lapisLight: "#EBF1F8",

  // Deep maroon — reserved for rare emphasis (e.g. overdue chanda)
  maroon: "#7A2E2E",
  maroonLight: "#FAEEEE",

  // ==========================================================
  // BACKGROUNDS — warm ivory, never stark white/grey
  // ==========================================================
  background: "#F7F5EF",     // ivory vellum, warm undertone
  backgroundAlt: "#F1EEE4",
  surface: "#FFFFFF",
  elevated: "#FFFFFF",

  sidebar: "#0C2E27",        // near-black emerald, not flat black
  sidebarHover: "#123D34",
  sidebarActive: "#155A48",
  sidebarBorder: "#1A4A3E",
  sidebarText: "#CFE3DC",
  sidebarTextMuted: "#7FA398",

  header: "#FFFFFF",
  headerBorder: "#EAE6D9",

  // ==========================================================
  // TEXT
  // ==========================================================
  text: "#1C231F",           // warm near-black, not pure #000
  textSecondary: "#5B6660",
  textMuted: "#93998F",
  textOnDark: "#F7F5EF",
  textOnPrimary: "#FFFFFF",
  white: "#FFFFFF",

  // ==========================================================
  // BORDERS
  // ==========================================================
  border: "#E7E2D3",
  borderStrong: "#D8D1BD",
  divider: "#F0ECE0",

  // ==========================================================
  // STATUS
  // ==========================================================
  success: "#0F5C4C",
  successLight: "#E9F5F0",
  warning: "#B07A1E",
  warningLight: "#FAF0DD",
  danger: "#A13A3A",
  dangerLight: "#F8E9E9",
  info: "#1E3A5F",
  infoLight: "#EBF1F8",

  // ==========================================================
  // CARD
  // ==========================================================
  card: "#FFFFFF",
  cardHover: "#FEFDFA",
  cardBorder: "#EAE6D9",

  // ==========================================================
  // ICON CHIP BACKGROUNDS
  // ==========================================================
  iconGreen: "#E9F5F0",
  iconGold: "#FAF3E1",
  iconLapis: "#EBF1F8",
  iconMaroon: "#FAEEEE",
  iconOrange: "#FBEEDE",

  // ==========================================================
  // TABLE
  // ==========================================================
  tableHeader: "#FAF8F2",
  tableHeaderText: "#5B6660",
  tableHover: "#FAF8F2",
  tableBorder: "#EFEBDE",

  // ==========================================================
  // BUTTONS
  // ==========================================================
  buttonPrimary: "#0F5C4C",
  buttonPrimaryHover: "#0B4A3D",
  buttonGold: "#A9812E",
  buttonGoldHover: "#8F6C24",
  buttonDanger: "#A13A3A",
  buttonDangerHover: "#8A2F2F",
  buttonOutlineBorder: "#D8D1BD",

  // ==========================================================
  // EFFECTS
  // ==========================================================
  shadowXs: "0 1px 2px rgba(28, 35, 31, .04)",
  shadowSm: "0 2px 6px rgba(28, 35, 31, .05)",
  shadow: "0 8px 20px rgba(28, 35, 31, .07)",
  shadowLg: "0 16px 40px rgba(28, 35, 31, .10)",
  shadowGold: "0 4px 14px rgba(169, 129, 46, .18)",   // for gold CTA emphasis
  shadowPrimary: "0 4px 14px rgba(15, 92, 76, .20)",  // for primary CTA emphasis

  ring: "rgba(15, 92, 76, .18)",     // focus ring, matches primary
  overlay: "rgba(12, 46, 39, .45)",  // modal backdrop, tinted emerald not flat black

  transparent: "transparent",
} as const;

// ================================================================
// TYPOGRAPHY
// A serif with real character carries headings and figures
// (donation totals deserve weight); a clean sans carries UI
// chrome; a tabular mono keeps currency columns aligned.
// ================================================================

const TYPOGRAPHY = {
  fontDisplay: "'DM Serif Display', 'Georgia', serif",   // headings, big stat numbers
  fontBody: "'Manrope', 'Inter', system-ui, sans-serif", // labels, body, nav, buttons
  fontMono: "'IBM Plex Mono', ui-monospace, Consolas, monospace", // ₹ amounts, dates, IDs

  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    displayBold: 600, // Fraunces reads heavy even at 600 — avoid 700 in large sizes
  },

  size: {
    xs: "12px",
    sm: "13px",
    base: "15px",
    md: "16px",
    lg: "18px",
    xl: "22px",
    "2xl": "28px",
    "3xl": "34px",   // stat card values
    "4xl": "42px",   // page hero numbers, if ever needed
  },

  letterSpacing: {
    tight: "-0.02em",   // headings
    normal: "0",
    wide: "0.02em",     // eyebrows / uppercase labels
  },
} as const;

// ================================================================
// RADII & SPACING
// ================================================================

const RADIUS = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  pill: "999px",
} as const;

const SPACE = {
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
} as const;

export { COLORS, TYPOGRAPHY, RADIUS, SPACE };
export default COLORS;