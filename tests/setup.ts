import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import * as fs from "node:fs";
import * as path from "node:path";

// Расширяем expect с матчерами из jest-dom
expect.extend(matchers);

// Очищаем после каждого теста
afterEach(() => {
  cleanup();
});

// Mock fetch for I18nProvider locale loading (locales/*.json)
if (typeof globalThis.fetch === "undefined") {
  const localesDir = path.resolve(__dirname, "../locales");
  globalThis.fetch = vi.fn((url: string | URL) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const match = urlStr.match(/locales\/(en|ru)\.json/);
    if (match) {
      const loc = match[1];
      const filePath = path.join(localesDir, `${loc}.json`);
      try {
        const json = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));
      } catch {
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
    }
    return Promise.reject(new Error(`Unhandled fetch: ${urlStr}`));
  }) as typeof fetch;
} else {
  const originalFetch = globalThis.fetch;
  const localesDir = path.resolve(__dirname, "../locales");
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const match = urlStr.match(/locales\/(en|ru)\.json/);
    if (match) {
      const loc = match[1];
      const filePath = path.join(localesDir, `${loc}.json`);
      try {
        const json = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));
      } catch {
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

// Настройка для jsdom (только если window доступен)
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
