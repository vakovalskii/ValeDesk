export type I18nContextValue = {
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: string;
  setLocale: (locale: string) => Promise<void>;
  availableLocales: string[];
  isReady: boolean;
};
