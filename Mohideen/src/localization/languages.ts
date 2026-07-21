import AsyncStorage from "@react-native-async-storage/async-storage";

import i18n from "./index";

export const STORAGE_LANGUAGE_KEY = "@mohideen:language";

export type AppLanguage = "en" | "ta";

/**
 * Returns the saved language from AsyncStorage.
 */
export async function getStoredLanguage(): Promise<AppLanguage | null> {
  try {
    const language = await AsyncStorage.getItem(STORAGE_LANGUAGE_KEY);

    if (language === "en" || language === "ta") {
      return language;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Saves the selected language.
 */
export async function setStoredLanguage(
  language: AppLanguage
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_LANGUAGE_KEY, language);
  } catch (error) {
    console.warn("Failed to save language:", error);
  }
}

/**
 * Changes the application language
 * and persists it.
 */
export async function changeAppLanguage(
  language: AppLanguage
): Promise<void> {
  await i18n.changeLanguage(language);
  await setStoredLanguage(language);
}

/**
 * Returns the current application language.
 */
export function getCurrentLanguage(): AppLanguage {
  return i18n.language === "ta" ? "ta" : "en";
}