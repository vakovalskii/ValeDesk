import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "./test-utils";
import { FileBrowser } from "../src/ui/components/FileBrowser";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSend = vi.fn();
const mockInvoke = vi.fn();

vi.mock("../src/ui/platform", () => ({
  getPlatform: vi.fn(() => ({
    invoke: mockInvoke,
    send: mockSend,
    sendClientEvent: vi.fn(),
    onServerEvent: vi.fn(() => () => {}),
  })),
}));

// IntersectionObserver не существует в jsdom
// Используем vi.stubGlobal чтобы мок был правильным конструктором
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
const mockUnobserve = vi.fn();

class MockIntersectionObserver {
  constructor(public callback: IntersectionObserverCallback) {}
  observe = mockObserve;
  disconnect = mockDisconnect;
  unobserve = mockUnobserve;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Устанавливаем дефолтный мок; отдельные тесты могут заменить его на TriggeringObserver
  globalThis.IntersectionObserver = MockIntersectionObserver as any;
});

// ─── Данные ───────────────────────────────────────────────────────────────────

const CWD = "/home/user/project";

const FILES = [
  { name: "src",       path: `${CWD}/src`,       isDirectory: true,  size: undefined },
  { name: "photo.jpg", path: `${CWD}/photo.jpg`,  isDirectory: false, size: 204800 },
  { name: "readme.md", path: `${CWD}/readme.md`,  isDirectory: false, size: 1024 },
  { name: ".hidden",   path: `${CWD}/.hidden`,    isDirectory: false, size: 100 },
];

// ─── Тесты ────────────────────────────────────────────────────────────────────

describe("FileBrowser", () => {
  describe("базовый рендер и список файлов", () => {
    it("показывает спиннер пока грузит файлы", async () => {
      mockInvoke.mockReturnValue(new Promise(() => {}));

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("Loading...")).toBeInTheDocument();
      });
    });

    it("рендерит список файлов и папок", async () => {
      mockInvoke.mockResolvedValue(FILES);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("src")).toBeInTheDocument();
        expect(screen.getByText("photo.jpg")).toBeInTheDocument();
        expect(screen.getByText("readme.md")).toBeInTheDocument();
      });
    });

    it("скрывает скрытые файлы по умолчанию", async () => {
      mockInvoke.mockResolvedValue(FILES);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("photo.jpg")).toBeInTheDocument();
      });

      expect(screen.queryByText(".hidden")).not.toBeInTheDocument();
    });

    it("показывает скрытые файлы при включении чекбокса", async () => {
      mockInvoke.mockResolvedValue(FILES);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("photo.jpg")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("checkbox"));

      await waitFor(() => {
        expect(screen.getByText(".hidden")).toBeInTheDocument();
      });
    });

    it("показывает размер файла", async () => {
      mockInvoke.mockResolvedValue(FILES);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("200.0 KB")).toBeInTheDocument();
        expect(screen.getByText("1.0 KB")).toBeInTheDocument();
      });
    });

    it("показывает сообщение о пустой директории", async () => {
      mockInvoke.mockResolvedValue([]);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.getByText("Empty directory")).toBeInTheDocument();
      });
    });
  });

  describe("навигация", () => {
    it("входит в директорию по клику", async () => {
      const dirsOnly = [{ name: "src", path: `${CWD}/src`, isDirectory: true }];
      mockInvoke
        .mockResolvedValueOnce(dirsOnly)
        .mockResolvedValueOnce([]);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());
      fireEvent.click(screen.getByText("src"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenNthCalledWith(2, "list-directory", `${CWD}/src`);
      });
    });

    it("кнопка «Go up» задизейблена в корне cwd", async () => {
      mockInvoke.mockResolvedValue([]);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => {
        expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
      });

      const upBtn = screen.getByTitle("Go up");
      expect(upBtn).toBeDisabled();
    });

    it("кнопка «Go up» активна внутри поддиректории", async () => {
      const dirsOnly = [{ name: "src", path: `${CWD}/src`, isDirectory: true }];
      const subFiles = [{ name: "index.ts", path: `${CWD}/src/index.ts`, isDirectory: false, size: 512 }];
      mockInvoke
        .mockResolvedValueOnce(dirsOnly)
        .mockResolvedValueOnce(subFiles);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());
      fireEvent.click(screen.getByText("src"));

      await waitFor(() => expect(screen.getByText("index.ts")).toBeInTheDocument());

      expect(screen.getByTitle("Go up")).not.toBeDisabled();
    });

    it("панель превью сбрасывается при переходе в другую директорию", async () => {
      const dirsOnly = [{ name: "src", path: `${CWD}/src`, isDirectory: true }];
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 512 }];
      const subFiles = [{ name: "index.ts", path: `${CWD}/src/index.ts`, isDirectory: false, size: 512 }];

      mockInvoke
        .mockResolvedValueOnce([...dirsOnly, ...textOnly])  // корень
        .mockResolvedValueOnce("text content")               // get-file-text-preview
        .mockResolvedValueOnce(subFiles);                    // src/

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={true} />
      );

      await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());

      // Открываем превью readme
      fireEvent.click(screen.getByText("readme.md"));
      await waitFor(() => {
        expect(screen.getAllByText("readme.md").length).toBeGreaterThan(1);
      });

      // Переходим в src/
      fireEvent.click(screen.getByText("src"));
      await waitFor(() => expect(screen.getByText("index.ts")).toBeInTheDocument());

      // Превью должно закрыться
      expect(screen.queryAllByText("readme.md").length).toBe(0);
    });
  });

  describe("режим useBuiltinViewer=true (встроенный просмотрщик)", () => {
    it("одиночный клик по файлу открывает панель превью", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke
        .mockResolvedValueOnce(textOnly)
        .mockResolvedValue("text content");

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={true} />
      );

      await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());
      fireEvent.click(screen.getByText("readme.md"));

      // FilePreviewPanel рендерится — имя дублируется в заголовке панели
      await waitFor(() => {
        expect(screen.getAllByText("readme.md").length).toBeGreaterThan(1);
      });
    });

    it("повторный клик по тому же файлу закрывает панель превью", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke
        .mockResolvedValueOnce(textOnly)
        .mockResolvedValue("text content");

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={true} />
      );

      await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());

      // Открываем
      fireEvent.click(screen.getByText("readme.md"));
      await waitFor(() => {
        expect(screen.getAllByText("readme.md").length).toBeGreaterThan(1);
      });

      // Закрываем повторным кликом (берём первое совпадение — строку в списке)
      fireEvent.click(screen.getAllByText("readme.md")[0]);
      await waitFor(() => {
        expect(screen.getAllByText("readme.md").length).toBe(1);
      });
    });

    it("одиночный клик НЕ вызывает open-file", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke
        .mockResolvedValueOnce(textOnly)
        .mockResolvedValue("text content");

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={true} />
      );

      await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());
      fireEvent.click(screen.getByText("readme.md"));

      // Ждём чуть дольше чтобы убедиться что send не вызывался
      await new Promise(r => setTimeout(r, 50));
      expect(mockSend).not.toHaveBeenCalledWith("open-file", expect.anything());
    });

    it("двойной клик открывает файл в ОС", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke.mockResolvedValue(textOnly);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={true} />
      );

      await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());
      fireEvent.dblClick(screen.getByText("readme.md"));

      expect(mockSend).toHaveBeenCalledWith("open-file", `${CWD}/readme.md`);
    });

    it("показывает подсказку про превью", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke.mockResolvedValue(textOnly);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={true} />
      );

      await waitFor(() => {
        expect(screen.getByText("Click to preview · Double-click to open")).toBeInTheDocument();
      });
    });
  });

  describe("режим useBuiltinViewer=false (открывать в ОС)", () => {
    it("одиночный клик вызывает open-file", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke.mockResolvedValue(textOnly);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={false} />
      );

      await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());
      fireEvent.click(screen.getByText("readme.md"));

      expect(mockSend).toHaveBeenCalledWith("open-file", `${CWD}/readme.md`);
    });

    it("панель превью не появляется при клике", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke.mockResolvedValue(textOnly);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={false} />
      );

      await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());
      fireEvent.click(screen.getByText("readme.md"));

      await new Promise(r => setTimeout(r, 50));
      // Панель не рендерится — имя встречается только в строке списка
      expect(screen.getAllByText("readme.md").length).toBe(1);
    });

    it("показывает подсказку про открытие в ОС", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke.mockResolvedValue(textOnly);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} useBuiltinViewer={false} />
      );

      await waitFor(() => {
        expect(screen.getByText("Click to open in system app")).toBeInTheDocument();
      });
    });
  });

  describe("inline thumbnails", () => {
    it("для изображений создаётся IntersectionObserver", async () => {
      const imgOnly = [{ name: "photo.jpg", path: `${CWD}/photo.jpg`, isDirectory: false, size: 204800 }];
      mockInvoke.mockResolvedValue(imgOnly);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => expect(screen.getByText("photo.jpg")).toBeInTheDocument());

      // FileThumbnail должен подключить IntersectionObserver
      expect(mockObserve).toHaveBeenCalled();
    });

    it("загружает thumbnail через IPC когда элемент становится видимым", async () => {
      // Заменяем дефолтный мок на TriggeringObserver который сразу вызывает callback
      class TriggeringObserver {
        constructor(private cb: IntersectionObserverCallback) {}
        observe = (el: Element) => {
          this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as any);
        };
        disconnect = vi.fn();
        unobserve = vi.fn();
      }
      globalThis.IntersectionObserver = TriggeringObserver as any;

      const thumbnailDataUrl = "data:image/webp;base64,ABC";
      const imgOnly = [{ name: "photo.jpg", path: `${CWD}/photo.jpg`, isDirectory: false, size: 204800 }];

      // Setup invoke AFTER stub so order is: stub → setup mocks → render
      mockInvoke
        .mockResolvedValueOnce(imgOnly)
        .mockResolvedValueOnce(thumbnailDataUrl);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => expect(screen.getByText("photo.jpg")).toBeInTheDocument());

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get-thumbnail", `${CWD}/photo.jpg`, 64);
      });
    });

    it("thumbnail-запрос не вызывается для директорий", async () => {
      const dirsOnly = [{ name: "src", path: `${CWD}/src`, isDirectory: true }];
      mockInvoke.mockResolvedValue(dirsOnly);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());

      // IntersectionObserver не должен быть создан для директорий
      expect(mockObserve).not.toHaveBeenCalled();
    });

    it("thumbnail-запрос не вызывается для не-изображений", async () => {
      const textOnly = [{ name: "readme.md", path: `${CWD}/readme.md`, isDirectory: false, size: 1024 }];
      mockInvoke.mockResolvedValue(textOnly);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => expect(screen.getByText("readme.md")).toBeInTheDocument());

      expect(mockObserve).not.toHaveBeenCalled();
    });

    it("показывает thumbnail в <img> после загрузки", async () => {
      class TriggeringObserver {
        constructor(private cb: IntersectionObserverCallback) {}
        observe = (el: Element) => {
          this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as any);
        };
        disconnect = vi.fn();
        unobserve = vi.fn();
      }
      globalThis.IntersectionObserver = TriggeringObserver as any;

      const dataUrl = "data:image/webp;base64,XYZ";
      const imgOnly = [{ name: "photo.png", path: `${CWD}/photo.png`, isDirectory: false, size: 512 }];
      mockInvoke
        .mockResolvedValueOnce(imgOnly)
        .mockResolvedValueOnce(dataUrl);

      renderWithI18n(
        <FileBrowser cwd={CWD} onClose={vi.fn()} />
      );

      await waitFor(() => {
        const img = document.querySelector('img[src="' + dataUrl + '"]');
        expect(img).toBeInTheDocument();
      });
    });
  });

  describe("throttling и дебаунс thumbnail-запросов", () => {
    // Контролируемый observer: сохраняет callback и target,
    // но НЕ вызывает его автоматически — тест делает это вручную
    let savedCb: IntersectionObserverCallback | null = null;
    let savedEl: Element | null = null;

    class ControllableObserver {
      constructor(cb: IntersectionObserverCallback) { savedCb = cb; }
      observe = (el: Element) => { savedEl = el; };
      disconnect = vi.fn();
      unobserve = vi.fn();
    }

    // Хелпер: симулировать вход/уход элемента из viewport
    const triggerVisible = () =>
      savedCb!([{ isIntersecting: true,  target: savedEl! } as IntersectionObserverEntry], {} as any);
    const triggerHidden = () =>
      savedCb!([{ isIntersecting: false, target: savedEl! } as IntersectionObserverEntry], {} as any);

    beforeEach(() => {
      savedCb = null;
      savedEl = null;
      globalThis.IntersectionObserver = ControllableObserver as any;
    });

    it("НЕ вызывает get-thumbnail в первые 199ms после появления в viewport", async () => {
      const imgOnly = [{ name: "debounce-test.jpg", path: `${CWD}/debounce-test.jpg`, isDirectory: false, size: 512 }];
      mockInvoke.mockResolvedValueOnce(imgOnly).mockResolvedValue("data:image/webp;base64,A");

      renderWithI18n(<FileBrowser cwd={CWD} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("debounce-test.jpg")).toBeInTheDocument();
        expect(savedCb).not.toBeNull();
      });

      mockInvoke.mockClear();

      // Симулируем появление в viewport
      act(() => { triggerVisible(); });

      // Немедленно после triggerVisible — IPC ещё не должен быть вызван
      expect(mockInvoke).not.toHaveBeenCalledWith("get-thumbnail", expect.anything(), expect.anything());
    });

    it("вызывает get-thumbnail после истечения дебаунса 200ms", async () => {
      const imgOnly = [{ name: "debounce-fire.jpg", path: `${CWD}/debounce-fire.jpg`, isDirectory: false, size: 512 }];
      mockInvoke.mockResolvedValueOnce(imgOnly).mockResolvedValue("data:image/webp;base64,A");

      renderWithI18n(<FileBrowser cwd={CWD} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("debounce-fire.jpg")).toBeInTheDocument();
        expect(savedCb).not.toBeNull();
      });

      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue("data:image/webp;base64,A");

      // Входим в viewport и ждём дебаунс
      act(() => { triggerVisible(); });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get-thumbnail", `${CWD}/debounce-fire.jpg`, 64);
      }, { timeout: 500 });
    });

    it("отменяет запрос если элемент ушёл из вьюпорта до истечения дебаунса", async () => {
      const imgOnly = [{ name: "cancel-test.jpg", path: `${CWD}/cancel-test.jpg`, isDirectory: false, size: 512 }];
      mockInvoke.mockResolvedValueOnce(imgOnly).mockResolvedValue("data:image/webp;base64,A");

      renderWithI18n(<FileBrowser cwd={CWD} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("cancel-test.jpg")).toBeInTheDocument();
        expect(savedCb).not.toBeNull();
      });

      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue("data:image/webp;base64,A");

      // Элемент входит в viewport — дебаунс стартует (200ms)
      act(() => { triggerVisible(); });

      // Сразу уходит из viewport — дебаунс должен отмениться
      act(() => { triggerHidden(); });

      // Ждём дольше чем дебаунс — IPC не должен вызваться
      await new Promise(r => setTimeout(r, 300));
      expect(mockInvoke).not.toHaveBeenCalledWith("get-thumbnail", expect.anything(), expect.anything());
    });

    it("не вызывает get-thumbnail повторно для одного элемента", async () => {
      const imgOnly = [{ name: "no-repeat.jpg", path: `${CWD}/no-repeat.jpg`, isDirectory: false, size: 512 }];
      mockInvoke.mockResolvedValueOnce(imgOnly).mockResolvedValue("data:image/webp;base64,A");

      renderWithI18n(<FileBrowser cwd={CWD} onClose={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText("no-repeat.jpg")).toBeInTheDocument();
        expect(savedCb).not.toBeNull();
      });

      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue("data:image/webp;base64,A");

      // Первый вход → ждём IPC
      act(() => { triggerVisible(); });
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get-thumbnail", `${CWD}/no-repeat.jpg`, 64);
      }, { timeout: 500 });

      const firstCount = mockInvoke.mock.calls.filter(c => c[0] === "get-thumbnail").length;
      expect(firstCount).toBe(1);

      mockInvoke.mockClear();

      // Второй вход в viewport — triedRef уже true
      act(() => { triggerVisible(); });
      await new Promise(r => setTimeout(r, 300));

      expect(mockInvoke).not.toHaveBeenCalledWith("get-thumbnail", expect.anything(), expect.anything());
    });

    it("при concurrency=1 второй запрос ждёт завершения первого", async () => {
      // Используем TriggeringObserver — оба элемента сразу видны в viewport
      class TriggeringObserver {
        constructor(private cb: IntersectionObserverCallback) {}
        observe = (el: Element) => {
          this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as any);
        };
        disconnect = vi.fn();
        unobserve = vi.fn();
      }
      globalThis.IntersectionObserver = TriggeringObserver as any;

      const twoImages = [
        { name: "queue-a.jpg", path: `${CWD}/queue-a.jpg`, isDirectory: false, size: 100 },
        { name: "queue-b.jpg", path: `${CWD}/queue-b.jpg`, isDirectory: false, size: 100 },
      ];

      let resolveFirst!: (v: string) => void;
      const firstPromise = new Promise<string>(r => { resolveFirst = r; });

      mockInvoke
        .mockResolvedValueOnce(twoImages)  // list-directory
        .mockReturnValueOnce(firstPromise) // get-thumbnail queue-a.jpg — зависает
        .mockResolvedValue("data:image/webp;base64,B"); // get-thumbnail queue-b.jpg

      renderWithI18n(<FileBrowser cwd={CWD} onClose={vi.fn()} />);

      await waitFor(() => expect(screen.getByText("queue-a.jpg")).toBeInTheDocument());

      // После дебаунса (200ms) — ждём первый вызов
      await waitFor(() => {
        const calls = mockInvoke.mock.calls.filter(c => c[0] === "get-thumbnail");
        expect(calls.length).toBe(1);
        expect(calls[0][1]).toBe(`${CWD}/queue-a.jpg`);
      }, { timeout: 500 });

      // b.jpg ещё в очереди — не вызван
      const beforeResolve = mockInvoke.mock.calls.filter(c => c[0] === "get-thumbnail").length;
      expect(beforeResolve).toBe(1);

      // Резолвим первый — очередь должна выпустить второй
      resolveFirst("data:image/webp;base64,A");

      await waitFor(() => {
        const calls = mockInvoke.mock.calls.filter(c => c[0] === "get-thumbnail");
        expect(calls.length).toBe(2);
        expect(calls[1][1]).toBe(`${CWD}/queue-b.jpg`);
      }, { timeout: 500 });
    });
  });
});
