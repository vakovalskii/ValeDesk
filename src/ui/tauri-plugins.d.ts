declare module "tauri-plugin-locale-api" {
  export function getLocale(): Promise<string>;
}

declare module "@razein97/tauri-plugin-i18n" {
  interface I18nInstance {
    load(): Promise<void>;
    translate(key: string): string;
  }
  const I18n: {
    getInstance(): I18nInstance;
    setLocale(locale: string): Promise<void>;
  };
  export default I18n;
}
