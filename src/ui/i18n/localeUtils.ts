/**
 * Map system locale (e.g. en-US, ru-RU) to supported locale codes (en, ru).
 */
const LOCALE_MAP: Record<string, string> = {
  en: "en",
  "en-US": "en",
  "en-GB": "en",
  ru: "ru",
  "ru-RU": "ru",
};

const SUPPORTED_LOCALES = ["en", "ru"];
const DEFAULT_LOCALE = "en";

export function mapSystemLocaleToSupported(systemLocale: string): string {
  const normalized = systemLocale.trim();
  if (!normalized) return DEFAULT_LOCALE;
  const mapped = LOCALE_MAP[normalized];
  if (mapped) return mapped;
  const langPart = normalized.split("-")[0]?.toLowerCase();
  if (SUPPORTED_LOCALES.includes(langPart)) return langPart;
  return DEFAULT_LOCALE;
}

export function getSupportedLocales(): string[] {
  return [...SUPPORTED_LOCALES];
}

export function isSupportedLocale(locale: string): boolean {
  return SUPPORTED_LOCALES.includes(locale);
}

export function getDefaultLocale(): string {
  return DEFAULT_LOCALE;
}
