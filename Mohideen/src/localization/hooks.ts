import { useTranslation } from "react-i18next";

import {
  changeAppLanguage,
  getCurrentLanguage,
  type AppLanguage,
} from "./languages";

/**
 * Application translation hook.
 *
 * Use this everywhere instead of importing
 * react-i18next directly.
 */
export function useAppTranslation() {
  const translation = useTranslation();

  return {
    ...translation,

    language: getCurrentLanguage(),

    changeLanguage: async (language: AppLanguage) => {
      await changeAppLanguage(language);
    },
  };
}

export default useAppTranslation;