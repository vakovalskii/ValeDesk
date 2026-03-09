# E2E тестирование ValeDesk

## Требования

- **xvfb** — виртуальный дисплей (для Electron)
- **Playwright browsers** — Chromium
- **Electron deps** (Linux): `libgtk-3-0 libnotify4 libnss3 libxss1 libasound2t64 libxtst6`

## Установка (Linux / devcontainer)

```bash
# xvfb + Electron runtime deps
sudo apt-get update && sudo apt-get install -y xvfb libgtk-3-0 libnotify4 libnss3 libxss1 libasound2t64 libxtst6 xauth

# Браузеры Playwright
npx playwright install chromium
```

## Сборка и запуск приложения

```bash
# Полная сборка (React + Electron + native modules)
npm run build:app

# Запуск собранного приложения
npm run start

# В headless (CI / devcontainer) — виртуальный дисплей
npm run start:xvfb
```

**Dev-режим:** `npm run dev` автоматически использует xvfb на Linux, если `DISPLAY` не задан.

## E2E тесты

```bash
# E2E тесты (Vite dev server + Chromium)
npm run test:e2e

# С UI (интерактивный режим)
npm run test:e2e:ui
```

## Текущие тесты

- `e2e/app.spec.ts` — smoke: загрузка приложения, sidebar, prompt input

## Ограничения

- Тесты идут против **Vite dev server** (WebPlatform mock) — без реального Electron backend
- Для полного E2E с Electron нужен `playwright._electron` + сборка приложения
