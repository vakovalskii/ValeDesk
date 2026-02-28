import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SettingsModal } from "../src/ui/components/SettingsModal";
import { renderWithI18n } from "./test-utils";

const mockSendClientEvent = vi.fn();
const mockInvoke = vi.fn();

vi.mock("../src/ui/platform", () => ({
  getPlatform: vi.fn(() => ({
    sendClientEvent: mockSendClientEvent,
    invoke: mockInvoke,
    onServerEvent: vi.fn(() => () => {}),
  })),
}));

vi.mock("../src/ui/store/useAppStore", () => ({
  useAppStore: vi.fn((selector: (s: unknown) => unknown) => {
    const state = {
      llmProviders: [],
      llmModels: [],
    };
    return selector(state);
  }),
}));

describe("SettingsModal Language tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Language tab with locale selector", async () => {
    renderWithI18n(
      <SettingsModal
        onClose={vi.fn()}
        onSave={vi.fn()}
        currentSettings={null}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    const languageTab = screen.getByRole("button", { name: "Language" });
    fireEvent.click(languageTab);

    await waitFor(() => {
      expect(screen.getByText("Choose application language")).toBeInTheDocument();
    });

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("en");

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toContain("English");
    expect(options.map((o) => o.textContent)).toContain("Russian");
  });

});
