import React from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { I18nProvider } from "../src/ui/i18n";

export function renderWithI18n(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { initialLocale?: string }
): RenderResult {
  const { initialLocale = "en", ...renderOptions } = options ?? {};
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
  );

  return render(ui, {
    ...renderOptions,
    wrapper: Wrapper,
  });
}
