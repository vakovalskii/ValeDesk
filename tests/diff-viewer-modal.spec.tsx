import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./test-utils";
import { DiffViewerModal } from "../src/ui/components/DiffViewerModal";
import type { ChangedFile } from "../src/ui/components/ChangedFiles";

// Создаем мок для invoke функции
const mockInvoke = vi.fn();

// Мокаем весь модуль platform
vi.mock("../src/ui/platform", () => {
  return {
    getPlatform: vi.fn(() => ({
      sendClientEvent: vi.fn(),
      onServerEvent: vi.fn(() => () => {}),
      generateSessionTitle: vi.fn(),
      getRecentCwds: vi.fn(),
      selectDirectory: vi.fn(),
      invoke: mockInvoke,
      send: vi.fn(),
    })),
  };
});

describe("DiffViewerModal", () => {
  const mockFile: ChangedFile = {
    file_path: "src/test.ts",
    lines_added: 5,
    lines_removed: 2,
  };

  const mockOldContent = "line1\nline2\nline3";
  const mockNewContent = "line1\nline2\nline3\nline4\nline5";

  beforeEach(() => {
    mockInvoke.mockClear();
    // Мокаем scrollTo для элементов, так как jsdom не поддерживает его
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("не рендерится когда file равен null", () => {
    const { container } = renderWithI18n(
      <DiffViewerModal
        file={null}
        open={true}
        onClose={vi.fn()}
        cwd="/test"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("не загружает содержимое когда modal закрыт", async () => {
    renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={false}
        onClose={vi.fn()}
        cwd="/test"
      />
    );

    await waitFor(() => {
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  it("загружает старое и новое содержимое файла при открытии", async () => {
    mockInvoke
      .mockResolvedValueOnce(mockOldContent)
      .mockResolvedValueOnce(mockNewContent);

    renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={vi.fn()}
        cwd="/test"
      />
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "get-file-old-content", mockFile.file_path, "/test", true);
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "get-file-new-content", mockFile.file_path, "/test");
    });
  });

  it("отображает состояние загрузки во время получения содержимого", async () => {
    let resolveOld: (value: string) => void;
    let resolveNew: (value: string) => void;
    
    const oldPromise = new Promise<string>((resolve) => {
      resolveOld = resolve;
    });
    const newPromise = new Promise<string>((resolve) => {
      resolveNew = resolve;
    });

    mockInvoke
      .mockReturnValueOnce(oldPromise)
      .mockReturnValueOnce(newPromise);

    renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={vi.fn()}
        cwd="/test"
      />
    );

    expect(screen.getByText("Loading file contents...")).toBeInTheDocument();

    resolveOld!(mockOldContent);
    resolveNew!(mockNewContent);

    await waitFor(() => {
      expect(screen.queryByText("Loading file contents...")).not.toBeInTheDocument();
    });
  });

  it("отображает ошибку при неудачной загрузке нового содержимого", async () => {
    const errorMessage = "Permission denied";
    mockInvoke
      .mockResolvedValueOnce(mockOldContent)
      .mockRejectedValueOnce(new Error("Permission denied"));

    renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={vi.fn()}
        cwd="/test"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it("обрабатывает случай когда файл не существует в git (новый файл)", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("File not found"))
      .mockResolvedValueOnce(mockNewContent);

    renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={vi.fn()}
        cwd="/test"
      />
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      // Старое содержимое должно быть пустой строкой для нового файла
    });
  });

  it("отображает правильный заголовок с путем к файлу", async () => {
    mockInvoke
      .mockResolvedValueOnce(mockOldContent)
      .mockResolvedValueOnce(mockNewContent);

    renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={vi.fn()}
        cwd="/test"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(`Diff: ${mockFile.file_path}`)).toBeInTheDocument();
    });
  });

  it("вызывает onClose при закрытии модального окна", async () => {
    const mockOnClose = vi.fn();
    mockInvoke
      .mockResolvedValueOnce(mockOldContent)
      .mockResolvedValueOnce(mockNewContent);

    renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={mockOnClose}
        cwd="/test"
      />
    );

    await waitFor(() => {
      const closeButton = screen.getByLabelText("Close");
      expect(closeButton).toBeInTheDocument();
    });

    const closeButton = screen.getByLabelText("Close");
    closeButton.click();

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("сбрасывает состояние при закрытии модального окна", async () => {
    const mockOnClose = vi.fn();
    mockInvoke
      .mockResolvedValueOnce(mockOldContent)
      .mockResolvedValueOnce(mockNewContent);

    const { rerender } = renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={mockOnClose}
        cwd="/test"
      />
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    // Закрываем модальное окно
    rerender(
      <DiffViewerModal
        file={mockFile}
        open={false}
        onClose={mockOnClose}
        cwd="/test"
      />
    );

    // Открываем снова - должно загрузить содержимое заново
    rerender(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={mockOnClose}
        cwd="/test"
      />
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(4);
    });
  });

  it("не загружает содержимое когда cwd не передан", async () => {
    renderWithI18n(
      <DiffViewerModal
        file={mockFile}
        open={true}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });
});
