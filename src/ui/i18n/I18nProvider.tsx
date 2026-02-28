import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import enLocale from "../../../locales/en.json";
import {
  getDefaultLocale,
  getSupportedLocales,
  mapSystemLocaleToSupported,
} from "./localeUtils";
import type { I18nContextValue } from "./types";

function toDict(data: Record<string, unknown>): Record<string, string> {
  const dict: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k !== "_version" && typeof v === "string") dict[k] = v;
  }
  return dict;
}

const enDict = toDict(enLocale as Record<string, unknown>);

function hasTauriApi(): boolean {
  return typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";
}

function interpolate(
  str: string,
  params?: Record<string, string | number>
): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

type I18nProviderProps = {
  children: ReactNode;
  initialLocale?: string;
  onLocaleChange?: (locale: string) => void;
};

let tauriTranslateFn: ((key: string) => string) | null = null;

export function I18nProvider({
  children,
  initialLocale,
  onLocaleChange,
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<string>(() => initialLocale ?? getDefaultLocale());
  const [isReady, setIsReady] = useState(false);
  const [electronTranslations, setElectronTranslations] = useState<Record<string, string>>({});

  const availableLocales = useMemo(() => getSupportedLocales(), []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      if (hasTauriApi() && tauriTranslateFn) {
        const raw = tauriTranslateFn(key);
        if (raw !== key) return interpolate(raw, params);
      }
      const raw = electronTranslations[key] ?? key;
      return interpolate(raw, params);
    },
    [electronTranslations]
  );

  const loadElectronTranslations = useCallback(async (loc: string) => {
    if (!hasTauriApi() && loc === "en") {
      setElectronTranslations(enDict);
      return;
    }
    try {
      const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) ?? "/";
      const url = `${base}locales/${loc}.json`;
      const res = await fetch(url);
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        setElectronTranslations(toDict(data));
      } else {
        setElectronTranslations(enDict);
      }
    } catch (e) {
      console.warn("[i18n] Failed to load locale:", loc, e);
      setElectronTranslations(enDict);
    }
  }, []);

  const setLocale = useCallback(
    async (newLocale: string) => {
      if (!availableLocales.includes(newLocale)) return;
      setLocaleState(newLocale);

      if (hasTauriApi()) {
        try {
          const { default: I18n } = await import("@razein97/tauri-plugin-i18n");
          await I18n.setLocale(newLocale);
        } catch (e) {
          console.warn("[i18n] Tauri setLocale failed:", e);
        }
      }
      await loadElectronTranslations(newLocale);
      onLocaleChange?.(newLocale);
    },
    [availableLocales, loadElectronTranslations, onLocaleChange]
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const effectiveLocale =
        initialLocale ??
        (() => {
          if (hasTauriApi()) return getDefaultLocale();
          return mapSystemLocaleToSupported(navigator.language);
        })();

      const safeLocale = availableLocales.includes(effectiveLocale)
        ? effectiveLocale
        : getDefaultLocale();
      setLocaleState(safeLocale);

      if (hasTauriApi()) {
        try {
          const { default: I18n } = await import("@razein97/tauri-plugin-i18n");
          await I18n.getInstance().load();
          await I18n.setLocale(safeLocale);
          tauriTranslateFn = (k: string) => I18n.getInstance().translate(k);
        } catch (e) {
          console.warn("[i18n] Tauri init failed:", e);
        }
      }
      await loadElectronTranslations(safeLocale);

      if (!cancelled) setIsReady(true);
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [availableLocales, initialLocale, loadElectronTranslations]);

  useEffect(() => {
    if (initialLocale && initialLocale !== locale && availableLocales.includes(initialLocale)) {
      setLocaleState(initialLocale);
      if (hasTauriApi()) {
        import("@razein97/tauri-plugin-i18n").then(({ default: I18n }) =>
          I18n.setLocale(initialLocale)
        );
      } else {
        loadElectronTranslations(initialLocale);
      }
    }
  }, [initialLocale, availableLocales, loadElectronTranslations, locale]);

  const value: I18nContextValue = useMemo(
    () => ({
      t,
      locale,
      setLocale,
      availableLocales,
      isReady,
    }),
    [t, locale, setLocale, availableLocales, isReady]
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
      {!isReady && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-ink-900/80 backdrop-blur-sm"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="text-lg font-medium text-white">Please Wait</span>
        </div>
      )}
    </I18nContext.Provider>
  );
}
