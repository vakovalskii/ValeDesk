import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { I18nProvider, useI18n } from "../src/ui/i18n";

function Consumer() {
  const { t, locale, setLocale, availableLocales, isReady } = useI18n();
  return (
    <div>
      <span data-testid="t-result">{t("sidebar.newTask")}</span>
      <span data-testid="t-params">{t("sidebar.threadsReady", { count: 5 })}</span>
      <span data-testid="t-unknown">{t("unknown.key")}</span>
      <span data-testid="locale">{locale}</span>
      <span data-testid="is-ready">{String(isReady)}</span>
      <span data-testid="available">{availableLocales.join(",")}</span>
      <button onClick={() => setLocale("ru")}>Set RU</button>
    </div>
  );
}

describe("I18nProvider and useI18n", () => {
  const originalTauri = (window as unknown as { __TAURI__?: unknown }).__TAURI__;

  beforeEach(() => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (originalTauri !== undefined) {
      (window as unknown as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
    }
  });

  it("throws when useI18n is used outside I18nProvider", () => {
    expect(() => render(<Consumer />)).toThrow("useI18n must be used within I18nProvider");
  });

  it("provides t() that returns translation from loaded JSON (Electron path)", async () => {
    render(
      <I18nProvider initialLocale="en">
        <Consumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("t-result")).toHaveTextContent("New Task");
    });
  });

  it("provides t() with param interpolation", async () => {
    render(
      <I18nProvider initialLocale="en">
        <Consumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("t-params")).toHaveTextContent("5 threads ready");
    });
  });

  it("provides t() that returns key for unknown key", async () => {
    render(
      <I18nProvider initialLocale="en">
        <Consumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("t-unknown")).toHaveTextContent("unknown.key");
    });
  });

  it("provides availableLocales as [en, ru]", async () => {
    render(
      <I18nProvider initialLocale="en">
        <Consumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("available")).toHaveTextContent("en,ru");
    });
  });

  it("respects initialLocale", async () => {
    render(
      <I18nProvider initialLocale="ru">
        <Consumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("locale")).toHaveTextContent("ru");
    });
  });

  it("loads Russian translations when initialLocale is ru", async () => {
    render(
      <I18nProvider initialLocale="ru">
        <Consumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("t-result")).toHaveTextContent("Новая задача");
    });
  });

  it("setLocale loads new translations and calls onLocaleChange when locale changes", async () => {
    const onLocaleChange = vi.fn();

    render(
      <I18nProvider onLocaleChange={onLocaleChange}>
        <Consumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("t-result")).toBeInTheDocument();
    });

    const btn = screen.getByRole("button", { name: "Set RU" });
    fireEvent.click(btn);

    await waitFor(
      () => {
        expect(screen.getByTestId("locale")).toHaveTextContent("ru");
      },
      { timeout: 2000 }
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("t-result")).toHaveTextContent("Новая задача");
      },
      { timeout: 2000 }
    );

    expect(onLocaleChange).toHaveBeenCalledWith("ru");
  });

  it("setLocale ignores unsupported locale", async () => {
    function SetDeConsumer() {
      const { setLocale, locale } = useI18n();
      return (
        <div>
          <span data-testid="locale">{locale}</span>
          <button onClick={() => setLocale("de")}>Set DE</button>
        </div>
      );
    }

    render(
      <I18nProvider initialLocale="en">
        <SetDeConsumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("locale")).toHaveTextContent("en");
    });

    screen.getByText("Set DE").click();

    await waitFor(() => {
      expect(screen.getByTestId("locale")).toHaveTextContent("en");
    });
  });

  it("sets isReady after loading translations", async () => {
    render(
      <I18nProvider initialLocale="en">
        <Consumer />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("is-ready")).toHaveTextContent("true");
    });
  });
});
