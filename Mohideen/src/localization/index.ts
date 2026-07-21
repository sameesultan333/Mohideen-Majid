import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { resources } from "./resource";
import { getStoredLanguage } from "./languages";

/**
 * Supported application languages.
 */
export const SUPPORTED_LANGUAGES = [
  "en",
  "ta",
] as const;

export type AppLanguage = typeof SUPPORTED_LANGUAGES[number];

/**
 * Returns the initial language.
 *
 * Priority:
 * 1. Saved language from AsyncStorage
 * 2. English (default)
 */
async function getInitialLanguage(): Promise<AppLanguage> {
  const storedLanguage = await getStoredLanguage();

  if (
    storedLanguage &&
    SUPPORTED_LANGUAGES.includes(storedLanguage)
  ) {
    return storedLanguage;
  }

  return "en";
}

/**
 * Initializes i18next.
 * Call this once before rendering the application.
 */
export async function initializeI18n() {
  const language = await getInitialLanguage();

  await i18n
    .use(initReactI18next)
    .init({
      compatibilityJSON: "v4",

      resources,

      lng: language,

      fallbackLng: "en",

      supportedLngs: SUPPORTED_LANGUAGES,

      interpolation: {
        escapeValue: false,
      },

      react: {
        useSuspense: false,
      },

      returnNull: false,
      returnEmptyString: false,
    });

  return i18n;
}

export default i18n;