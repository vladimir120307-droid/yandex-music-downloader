# 🎵 Music Downloader

[![Release](https://img.shields.io/github/v/release/vladimir120307-droid/yandex-music-downloader?color=ffdb4d&label=latest&style=flat-square)](https://github.com/vladimir120307-droid/yandex-music-downloader/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/vladimir120307-droid/yandex-music-downloader/total?style=flat-square&color=4caf50)](https://github.com/vladimir120307-droid/yandex-music-downloader/releases)
[![Stars](https://img.shields.io/github/stars/vladimir120307-droid/yandex-music-downloader?style=flat-square&color=f0c000)](https://github.com/vladimir120307-droid/yandex-music-downloader/stargazers)
[![License](https://img.shields.io/github/license/vladimir120307-droid/yandex-music-downloader?style=flat-square&color=888)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/vladimir120307-droid/yandex-music-downloader/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/vladimir120307-droid/yandex-music-downloader/actions)

Универсальный загрузчик музыки и видео — **расширение для браузера** + **десктопная программа**, в одном репозитории.

| | Что качает | Где работает |
|---|---|---|
| **Расширение** (Chromium) | Я.Музыка, Bandcamp, SoundCloud | прямо на странице или по ссылке из попапа |
| **Desktop** (PySide6 + yt-dlp) | 1800+ сайтов: Я.Музыка, YouTube, SoundCloud, Bandcamp, VK, Twitch, Vimeo, RuTube, … | Windows / macOS / Linux |

---

## ⚡ Быстрый старт

### Если ты просто хочешь качать (не разработчик)

1. Зайди в [**Releases**](https://github.com/vladimir120307-droid/yandex-music-downloader/releases/latest) на гитхабе
2. Скачай **`MusicDownloader-vX.Y.Z.exe`** (для Windows) — это десктопная программа
3. Запусти `MusicDownloader.exe`
4. Вставь ссылку (на трек / альбом / плейлист / видео) и нажми **«Скачать»**
5. Готово — файл лежит в папке `Downloads/MusicDownloader/`

**Когда нужны дополнительные действия:**

- 🟡 **Для YouTube / SoundCloud / видео** → нажми кнопку **«Установить ffmpeg»** внизу окна. Программа скачает его сама (~80 МБ, один раз). Без ffmpeg работают только Я.Музыка и Bandcamp.
- 🟡 **Для Я.Музыки** (с мая 2026) нужен **OAuth-токен** — Яндекс снёс старый веб-API. См. секцию [«Получение токена Я.Музыки»](#получение-токена-яндекс-музыки) ниже.

### Получение токена Яндекс Музыки

С мая 2026 Яндекс убрал старый веб-API и теперь скачивание возможно только через OAuth-токен. Сделать это нужно **один раз**, потом работает.

**В расширении:**
1. Открой music.yandex.ru — расширение **попробует поймать токен автоматически**, если ты залогинен. Готово.
2. Если не поймало — клик по иконке расширения → раздел «Токен Я.Музыки» → кнопка «Открыть страницу для получения токена» → разреши доступ → скопируй `access_token` из URL и вставь в поле.

**В десктопе:** аналогично, поле «Токен» в настройках.

Прямая ссылка на OAuth: <https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d>

### Если хочешь скачивать прямо в браузере

1. Скачай **`music-downloader-extension-vX.Y.Z.zip`** из [Releases](https://github.com/vladimir120307-droid/yandex-music-downloader/releases/latest)
2. Распакуй архив куда-нибудь
3. Открой `chrome://extensions` (или `edge://extensions`)
4. Включи **«Режим разработчика»** в правом верхнем углу
5. Нажми **«Загрузить распакованное расширение»** и выбери папку с распакованным архивом
6. Зайди на [music.yandex.ru](https://music.yandex.ru), [bandcamp.com](https://bandcamp.com) или [soundcloud.com](https://soundcloud.com) — увидишь жёлтую кнопку скачивания

---

## Поддерживаемые сервисы (v3.0)

| Сервис | На странице | По ссылке (paste-link) |
|---|---|---|
| **Яндекс Музыка** | ✅ кнопка на каждом треке + FAB + альбомы/плейлисты | ✅ |
| **Bandcamp** | — | ✅ треки, альбомы, дискография |
| **SoundCloud** | — | ✅ треки и плейлисты |

> **DRM-сервисы** (Spotify, Apple Music, Tidal, Deezer) физически нельзя скачать из расширения — Widevine расшифровывает аудио в защищённом модуле браузера. Поддержка через **YouTube-matching** запланирована в v3.1+.

## Возможности

- **Перехват реального аудио-потока** на Я.Музыке (через `chrome.webRequest`) — полное качество, не превью
- **Перетаскиваемая кнопка** скачивания (FAB) — позиция запоминается в localStorage
- **Кнопки на каждом треке** в списках (Я.Музыка)
- **Скачивание альбомов и плейлистов** — кнопка на странице альбома/плейлиста
- **Paste-link в попапе** — вставь ссылку на трек/альбом/плейлист с любого поддерживаемого сервиса, авто-детект сервиса, прогресс-бар
- **Выбор папки** — диалог "Сохранить как" опционально
- **Поддержка доменов Я.Музыки** — `.ru`, `.kz`, `.by`, `.ua`, `.com`

## Установка

### Готовые сборки (рекомендуется)

[**📥 Скачать с Releases →**](https://github.com/vladimir120307-droid/yandex-music-downloader/releases/latest)

- `music-downloader-extension-vX.Y.Z.zip` — расширение для браузера
- `MusicDownloader-vX.Y.Z.exe` — десктопная программа для Windows

### Расширение из исходников

1. Скачай или клонируй этот репозиторий
2. Открой `edge://extensions` (или `chrome://extensions`)
3. Включи **Режим разработчика**
4. Нажми **"Загрузить распакованное расширение"**
5. Выбери папку с файлами расширения

## Использование

### На странице Я.Музыки
- Зайди на [music.yandex.ru](https://music.yandex.ru), включи трек
- Кликни жёлтую кнопку ⬇ справа снизу (можно перетащить куда удобно)
- Или жми ⬇ рядом с любым треком в списке
- На страницах альбомов/плейлистов появится кнопка «Скачать альбом/плейлист»

### По ссылке (любой сервис)
- Кликни иконку расширения
- Вставь ссылку в поле «Скачать по ссылке»
- Нажми «Скачать» — батч пойдёт в подпапку с именем сервиса (`bandcamp/`, `soundcloud/`, …)

## Архитектура

```
├── manifest.json          # MV3 конфигурация
├── background.js          # Service Worker — координатор, импортит lib/ + services/
├── content.js             # Content Script для music.yandex.* — UI на странице
├── content.css            # Стили кнопок/нотификаций на странице
├── popup.html / .js / .css # Popup с paste-link и текущим треком
│
├── lib/
│   ├── md5.js             # MD5 (Yandex audio URL signing)
│   └── core.js            # Service registry + utils
│
├── services/
│   ├── yandex.js          # Yandex Music adapter
│   ├── bandcamp.js        # Bandcamp adapter (data-tralbum parsing)
│   └── soundcloud.js      # SoundCloud adapter (api-v2 + extracted client_id)
│
├── downloader.py          # Десктопная программа (Python + tkinter)
└── icons/                 # Иконки
```

### Адаптер-паттерн

Каждый сервис в `services/` регистрируется в общем реестре и реализует:
- `parseUrl(url)` → `{type, ...}` или `null`
- `listTracks(parsed)` → массив треков
- `getAudioUrl(track, ctx)` → mp3 URL
- `getFilename(track)` → имя файла

Добавить новый сервис = создать один файл в `services/` + прописать его в `manifest.json` (host_permissions + scripts массив в background и при необходимости content_scripts).

## Технологии

- **Manifest V3** — актуальный формат
- **chrome.webRequest** — перехват аудио-потоков Я.Музыки
- **chrome.downloads** — сохранение файлов
- **Pointer Events** — drag & drop FAB
- **MutationObserver** — отслеживание SPA-навигации
- **Web Crypto API** — ready для будущего HLS-AES (VK Музыка)

## Десктопная программа

В репо есть **два** варианта десктопа:

### `desktop/` — универсальный (новый)

GUI на PySide6 поверх **yt-dlp** (1800+ сайтов: Я.Музыка, YouTube, SoundCloud, Bandcamp, VK, Twitch, Vimeo, RuTube, и т.д.). Аудио (mp3/m4a/flac/opus) и видео (mp4 до 4K). Поддержка cookies из браузера для авторизованных сервисов.

```bash
cd desktop
pip install -r requirements.txt
python main.py
```

Сборка `.exe`: `python build.py` → `dist/MusicDownloader.exe`. Подробности — [desktop/README.md](desktop/README.md).

### `downloader.py` — Я.Музыка-only (legacy)

Простая программа на tkinter, только для Я.Музыки, без зависимостей кроме `requests`. Нужен OAuth-токен.

```bash
pip install requests
python downloader.py
```

## Roadmap

- [ ] **VK Музыка** (HLS-AES decryption через Web Crypto)
- [ ] **YouTube Music** (signature decipher из player.js)
- [ ] **Spotify / Apple Music / Tidal / Deezer** через YouTube-matching (как `spotdl`) — метаданные публичные, поиск аналога на YouTube, скачивание оттуда
- [ ] On-page кнопки для Bandcamp / SoundCloud
- [ ] FLAC/HQ-селектор качества для Я.Музыки

## Лицензия

MIT
