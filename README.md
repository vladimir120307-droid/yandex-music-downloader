# 🎵 Music Downloader (Я.Музыка / Bandcamp / SoundCloud)

Расширение для Chromium-браузеров (Edge, Chrome, Яндекс.Браузер) для скачивания музыки с нескольких сервисов — на странице или по ссылке из попапа.

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

Помимо расширения есть отдельный downloader на Python для скачивания только с Я.Музыки:

```bash
pip install requests
python downloader.py
```

Нужен OAuth-токен Яндекса.

## Roadmap

- [ ] **VK Музыка** (HLS-AES decryption через Web Crypto)
- [ ] **YouTube Music** (signature decipher из player.js)
- [ ] **Spotify / Apple Music / Tidal / Deezer** через YouTube-matching (как `spotdl`) — метаданные публичные, поиск аналога на YouTube, скачивание оттуда
- [ ] On-page кнопки для Bandcamp / SoundCloud
- [ ] FLAC/HQ-селектор качества для Я.Музыки

## Лицензия

MIT
