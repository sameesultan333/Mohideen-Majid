import i18n from "../localization/index";
import { useAppTranslation } from "../localization/hooks";
import { initializeI18n, SUPPORTED_LANGUAGES } from "../localization/index";
import { changeAppLanguage, getStoredLanguage } from "../localization/languages";

// Export the t function for direct usage
export const t = (key: string, options?: any) => i18n.t(key, options);

// Export the hook for component usage
export const useTranslation = useAppTranslation;

// Export other utilities
export { initializeI18n, SUPPORTED_LANGUAGES, changeAppLanguage as changeLanguage, getStoredLanguage };

export default i18n;
