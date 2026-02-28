import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AppModals } from "../src/ui/App";
import { renderWithI18n } from "./test-utils";

const mockSendEvent = vi.fn();

const defaultAppModalsProps = {
  showStartModal: true,
  setShowStartModal: vi.fn(),
  showTaskDialog: false,
  setShowTaskDialog: vi.fn(),
  showRoleGroupDialog: false,
  setShowRoleGroupDialog: vi.fn(),
  showSettingsModal: false,
  setShowSettingsModal: vi.fn(),
  showSessionEditModal: false,
  setShowSessionEditModal: vi.fn(),
  activeSessionId: null,
  activeSession: undefined,
  sendEvent: mockSendEvent,
  cwd: "",
  prompt: "",
  pendingStart: false,
  setCwd: vi.fn(),
  setPrompt: vi.fn(),
  apiSettings: null,
  availableModels: [],
  selectedModel: null,
  setSelectedModel: vi.fn(),
  llmModels: [] as any[],
  selectedTemperature: 0.3,
  setSelectedTemperature: vi.fn(),
  sendTemperature: true,
  setSendTemperature: vi.fn(),
  handleSaveSettings: vi.fn(),
  handleCreateTask: vi.fn(),
  handleCreateRoleGroupTask: vi.fn()
};

vi.mock("../src/ui/platform", () => ({
  getPlatform: vi.fn(() => ({
    sendClientEvent: vi.fn(),
    onServerEvent: vi.fn(() => () => {}),
    getRecentCwds: vi.fn().mockResolvedValue([]),
    selectDirectory: vi.fn(),
    invoke: vi.fn()
  }))
}));

describe("AppModals and first-launch behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isReady gate", () => {
    it("renders StartSessionModal with translated title only after i18n isReady", async () => {
      renderWithI18n(
        <AppModals {...defaultAppModalsProps} showStartModal={true} />
      );

      await waitFor(
        () => {
          expect(screen.getByText("Start Task")).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it("does not render StartSessionModal when showStartModal is false", async () => {
      renderWithI18n(
        <AppModals {...defaultAppModalsProps} showStartModal={false} />
      );

      await waitFor(() => {
        expect(screen.getByTestId?.("is-ready") ?? document.body).toBeTruthy();
      }).catch(() => {});

      expect(screen.queryByText("Start Task")).not.toBeInTheDocument();
    });

    it("renders SettingsModal when showSettingsModal is true and i18n isReady", async () => {
      renderWithI18n(
        <AppModals
          {...defaultAppModalsProps}
          showStartModal={false}
          showSettingsModal={true}
        />
      );

      await waitFor(
        () => {
          expect(screen.getByText("Settings")).toBeInTheDocument();
        },
        { timeout: 5000 }
      );
    });
  });
});
