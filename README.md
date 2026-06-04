<div align="center">

# 🎵 Music Downloader

**Скачивай музыку с Яндекс.Музыки и не только — в FLAC и MP3, с обложкой, тегами и текстом песни.**

[![Release](https://img.shields.io/github/v/release/vladimir120307-droid/yandex-music-downloader?color=ffdb4d&label=release&style=flat-square)](https://github.com/vladimir120307-droid/yandex-music-downloader/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/vladimir120307-droid/yandex-music-downloader/total?style=flat-square&color=4caf50&label=downloads)](https://github.com/vladimir120307-droid/yandex-music-downloader/releases)
[![Stars](https://img.shields.io/github/stars/vladimir120307-droid/yandex-music-downloader?style=flat-square&color=f0c000&label=stars)](https://github.com/vladimir120307-droid/yandex-music-downloader/stargazers)
[![License](https://img.shields.io/github/license/vladimir120307-droid/yandex-music-downloader?style=flat-square&color=888&label=license)](LICENSE)

Бесплатно · Open source · Без рекламы · Русский интерфейс

</div>

---

## Что это

Две программы в одном репозитории:

| | Что качает | Платформа |
|---|---|---|
| 🧩 **Расширение** (Chrome/Edge/Я.Браузер) | Яндекс.Музыка (FLAC + MP3), Bandcamp, SoundCloud | любая ОС с Chromium |
| 🖥️ **Десктоп** (PySide6 + yt-dlp) | 1800+ сайтов: Я.Музыка, YouTube, SoundCloud, Bandcamp, VK, Twitch, Vimeo, RuTube… | Windows / macOS / Linux |

**Большинству нужно расширение** — оно качает Я.Музыку прямо в браузере, без сторонних программ.

## ✨ Возможности

- 🎧 **Lossless FLAC** из Яндекс.Музыки (нужен Я.Плюс) — настоящий нативный `.flac`, переупаковывается прямо в браузере без ffmpeg
- 🎵 **MP3 320 kbps** — работает у всех, даже без подписки
- 🖼️ **Обложка альбома** вшивается в файл (1000×1000)
- 🏷️ **Полные теги** — название, артист, альбом, исполнитель альбома, год, жанр, номер трека и диска
- 📝 **Текст песни** вшивается в трек (опционально)
- 📁 **Альбомы и плейлисты** целиком — кнопкой на странице или по ссылке
- 🔗 **Скачивание по ссылке** из попапа — вставил ссылку, получил файлы
- 🟡 **Кнопка на каждом треке** + перетаскиваемая плавающая кнопка

---

## ⚡ Быстрый старт (расширение)

1. Скачай **`music-downloader-extension-vX.Y.Z.zip`** из [**Releases**](https://github.com/vladimir120307-droid/yandex-music-downloader/releases/latest)
2. Распакуй архив в любую папку
3. Открой `chrome://extensions` (или `edge://extensions`)
4. Включи **«Режим разработчика»** (переключатель справа сверху)
5. Нажми **«Загрузить распакованное расширение»** → выбери распакованную папку
6. **Залогинься в свой Яндекс-аккаунт** на [music.yandex.ru](https://music.yandex.ru) — без этого Яндекс не отдаёт треки
7. Открой любой трек/альбом — расширение **само поймает токен**, появится жёлтая кнопка скачивания

> 💡 В попапе расширения (клик по иконке) можно выбрать качество (FLAC / MP3 320), включить текст песни и вставить ссылку для скачивания.

---

## 🔑 Токен Яндекс.Музыки

С мая 2026 Яндекс убрал старый веб-API — теперь скачивание работает только через **OAuth-токен**. Настраивается **один раз**.

**Автоматически (обычно так):** залогинься на [music.yandex.ru](https://music.yandex.ru) и открой любой трек — расширение перехватит токен из запроса страницы. Готово.

**Вручную (если авто не сработало):** клик по иконке расширения → раздел «Токен Я.Музыки» → **«Открыть страницу для получения токена»** → разреши доступ → скопируй `access_token` из адреса (или весь URL целиком) и вставь в поле.

Прямая ссылка: [oauth.yandex.ru/authorize…](https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d)

---

## 🎚️ Качество и форматы

В попапе расширения (и в десктопе) выбирается качество для Яндекс.Музыки:

| Опция | Что получишь |
|---|---|
| **Авто** (по умолчанию) | FLAC если у тебя Я.Плюс и у трека есть lossless, иначе MP3 320 |
| **FLAC** | Lossless 16/44.1 (CD-качество), нужен Я.Плюс |
| **MP3 320** | ~10 МБ/трек, работает у всех |

**Про FLAC:** Яндекс отдаёт lossless внутри MP4-контейнера. Расширение переупаковывает его в **нативный `.flac`** прямо в браузере (без потери качества — аудио бит-в-бит то же самое). Галка «FLAC → нативный .flac» в попапе включена по умолчанию; если выключить — сохранится `.m4a` (тот же lossless, чуть быстрее). Десктоп делает то же через ffmpeg.

> ℹ️ **Обложка не видна в проводнике Windows 11?** Это особенность проводника — он капризен с миниатюрами аудио. Сам тег с обложкой на месте: проверь в плеере (AIMP, foobar, VLC) или через ПКМ → Свойства → Подробно.

---

## 🖥️ Десктопная программа

Универсальный загрузчик на **PySide6 + yt-dlp** — 1800+ сайтов, аудио и видео.

```bash
cd desktop
pip install -r requirements.txt
python main.py
```

Сборка `.exe`: `python build.py` → `dist/MusicDownloader.exe`. Подробности — [desktop/README.md](desktop/README.md).

> ⚠️ Десктоп требует Windows 10+ (PySide6 не ставится на Win7).

### 🪟 Версия для Windows 7

Для Win7 есть отдельная лёгкая программа **`MusicDownloader-Lite.exe`** (в [Releases](https://github.com/vladimir120307-droid/yandex-music-downloader/releases/latest)) — только Яндекс.Музыка (FLAC / MP3 + обложка + теги + текст), на tkinter. Подробности — [lite/README.md](lite/README.md).

---

## 🌐 Поддерживаемые сервисы

| Сервис | Расширение | Десктоп |
|---|---|---|
| **Яндекс.Музыка** | ✅ FLAC + MP3, обложка, теги, текст | ✅ |
| **Bandcamp** | ✅ треки, альбомы, дискография | ✅ |
| **SoundCloud** | ✅ треки и плейлисты | ✅ |
| **YouTube / YouTube Music** | — | ✅ |
| **VK / Twitch / Vimeo / RuTube / +1800** | — | ✅ (через yt-dlp) |

> **Spotify / Apple Music / Tidal / Deezer** скачать напрямую невозможно (Widevine DRM расшифровывается в защищённом модуле браузера). Поддержка через YouTube-matching — в планах.

---

## 🧩 Архитектура (расширение)

```
manifest.json            # MV3 конфигурация
background.js            # Service Worker — скачивание, теги, расшифровка, токен
content.js              # UI на странице music.yandex.* (кнопки, FAB)
popup.html/js/css       # Попап: paste-link, качество, токен, настройки
offscreen.html/js       # Offscreen-документ для blob URL (большие файлы)
inject/
  yam-fetch-hook.js     # Перехват OAuth-токена из запросов страницы (MAIN world)
lib/
  core.js               # Реестр сервисов + утилиты
  md5.js                # MD5 (подпись audio URL)
  id3.js                # ID3v2 writer (теги + обложка + текст для MP3)
  flacremux.js          # FLAC-в-MP4 → нативный .flac + VorbisComment + Picture
  mp4cover.js           # MP4 covr atom (теги + обложка для .m4a)
services/
  yandex.js             # Яндекс.Музыка (api.music.yandex.net + V2 FLAC)
  bandcamp.js           # Bandcamp (data-tralbum)
  soundcloud.js         # SoundCloud (api-v2 + client_id)
```

**Адаптер сервиса** реализует: `parseUrl(url)`, `listTracks(parsed)`, `getAudioUrl(track, ctx)`, `getFilename(track)`. Новый сервис = один файл в `services/` + регистрация в манифесте. См. [CONTRIBUTING.md](CONTRIBUTING.md).

### Как работает FLAC без ffmpeg

Яндекс отдаёт FLAC зашифрованным (AES-CTR) внутри MP4. Расширение:
1. Расшифровывает поток (`crypto.subtle`, ключ из API)
2. Извлекает FLAC STREAMINFO + фреймы из MP4 (точно по таблицам `stsz/stco/stsc`)
3. Переупаковывает в нативный FLAC-контейнер + вшивает обложку/теги/текст

Всё в браузере, без перекодирования — результат байт-в-байт идентичен `ffmpeg -c:a copy`.

---

## ❓ FAQ

**Не появляется кнопка скачивания** — залогинься на music.yandex.ru и обнови страницу (F5). Расширение ловит токен из запросов залогиненной сессии.

**«Сохранить как» не открывает диалог** — проверь что галка стоит в попапе. Для альбомов/плейлистов диалог отключён (иначе он выскакивал бы на каждый трек).

**FLAC не качается** — нужен активный Я.Плюс. Без подписки доступен только MP3 320.

**Десктоп не запускается на Windows 7** — PySide6 требует Win10+. Используй расширение или **`MusicDownloader-Lite.exe`** (Я.Музыка, специально для Win7).

---

## 🗺️ Roadmap

- [ ] VK Музыка в расширении (HLS-AES)
- [ ] YouTube Music в расширении
- [ ] Spotify / Apple Music через YouTube-matching
- [ ] On-page кнопки для Bandcamp / SoundCloud

## Лицензия

[MIT](LICENSE) — используй как хочешь, сохраняй копирайт. Контрибьюции приветствуются ([CONTRIBUTING.md](CONTRIBUTING.md)).
