import en from "./locales/en.json";
import ta from "./locales/ta.json";


/**
 * Translation resources used by i18next.
 */
export const resources = {
  en: {
    translation: en,
  },

  ta: {
    translation: ta,
  },

} as const;

export type SupportedLanguage = keyof typeof resources;

export default resources;