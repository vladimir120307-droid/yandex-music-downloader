# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Проект

Два независимых компонента в одном репозитории:

1. **Расширение для браузера** (Chromium, Manifest V3) — скачивание с Я.Музыки, Bandcamp, SoundCloud прямо со страницы или по paste-link из попапа.
2. **Десктопная программа** (`desktop/`) — PySide6 GUI поверх yt-dlp, 1800+ сайтов, кросс-платформенно. `downloader.py` в корне — legacy-версия на tkinter только для Я.Музыки.

## Команды

### Десктоп (Python)

```bash
cd desktop
pip install -r requirements.txt
python main.py                          # запуск GUI

pip install pyinstaller pillow
python build.py                         # сборка .exe → desktop/dist/MusicDownloader.exe
```

### Расширение

Нет шага сборки — загружается распакованной папкой через `chrome://extensions` → "Загрузить распакованное".

Проверить валидность `manifest.json`:
```bash
python -c "import json; json.load(open('manifest.json'))"
```

### Релиз

Тег `v*` запускает GitHub Actions (`release.yml`): собирает `.zip` расширения и `.exe` десктопа, публикует Release. Ручной запуск — через `workflow_dispatch` с полем `tag`.

## Архитектура расширения

**Глобальный namespace:** `globalThis.YMD` — инициализируется в `lib/core.js`, доступен во всех скриптах.

**Service registry** (`lib/core.js`):
- `YMD.registry.register(svc)` — регистрирует адаптер
- `YMD.registry.detectByUrl(url)` → `{service, parsed}` — автодетект по URL
- `YMD.registry.detectByHost(hostname)` → service — для in-page кнопок

**Адаптер-паттерн** (каждый файл в `services/`):
- `parseUrl(url)` → `{type, ...}` | `null`
- `listTracks(parsed)` → массив треков
- `getAudioUrl(track, ctx)` → mp3 URL
- `getFilename(track)` → строка
- поля `name`, `displayName`, `domains`

**Загрузка скриптов:**
- `background.js` (Service Worker) — `importScripts(lib/md5.js, lib/core.js, services/*.js)`, координирует скачивание, перехватывает аудио через `chrome.webRequest`
- `content.js` — content script только для `music.yandex.*`, строит UI на странице (FAB, кнопки на треках, MutationObserver для SPA-навигации). Скрипты для content script перечислены в `manifest.json → content_scripts[0].js`

**Paste-link flow** (`background.js → downloadByUrl`): детект сервиса → `listTracks` → перебор треков → `getAudioUrl` → `chrome.downloads.download`. Прогресс идёт через `chrome.runtime.sendMessage({action: 'pasteProgress', ...})` в `popup.js`.

**Перехват аудио Я.Музыки:** `chrome.webRequest.onBeforeRequest` слушает `*.storage.mds.yandex.net`, `*.strm.yandex.net`, кеширует URL по `tabId` (последние 20, TTL 5 мин). Запрос через `{action: 'getCapturedAudio'}`.

**MD5** (`lib/md5.js`) — используется в `services/yandex.js` для подписи URL аудио.

## Архитектура десктопа

| Файл | Роль |
|---|---|
| `main.py` | Entry point |
| `window.py` | `MainWindow` (PySide6), тема, очередь заданий |
| `core.py` | `DownloadWorker(QObject)` — работает в `QThread`, сигналы: `info_ready`, `progress`, `done`, `error` |
| `ffmpeg_helper.py` | Поиск ffmpeg в PATH и рядом с бинарником |
| `settings.py` | JSON-конфиг (папка, формат, cookies-браузер) |
| `build.py` | PyInstaller-сборка |

`DownloadWorker` принимает `options` dict: `output_dir`, `audio_only`, `audio_format`, `audio_quality`, `video_format`, `cookies_browser`, `ffmpeg_path`. Опция `cookiesfrombrowser` пробрасывается напрямую в yt-dlp.

## Добавление нового сервиса в расширение

1. Создать `services/newservice.js` — реализовать адаптер и вызвать `YMD.registry.register(...)` в конце.
2. Добавить домены в `manifest.json → host_permissions`.
3. Добавить скрипт в `manifest.json → background.service_worker` — нет, background грузит через `importScripts`; добавить в `background.js → importScripts(...)`.
4. Если нужен in-page UI — добавить в `content_scripts[0].js` и домены в `content_scripts[0].matches`.
