# Music Downloader (Desktop)

Универсальный загрузчик музыки и видео. Под капотом — **yt-dlp** (1800+ сайтов), GUI на **PySide6**, кросс-платформенно (Windows/macOS/Linux).

Поддержка: Я.Музыка, YouTube, YouTube Music, SoundCloud, Bandcamp, VK, Twitch, Vimeo, RuTube, Twitter/X, Reddit, Coub, и сотни других. Полный список: <https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md>.

## Установка из исходников

```bash
cd desktop
pip install -r requirements.txt
python main.py
```

Требуется Python 3.10+.

## Сборка одного .exe

```bash
pip install pyinstaller pillow
python build.py
```

Результат: `dist/MusicDownloader.exe` (~80 MB, всё включено). Если рядом с `build.py` лежит `ffmpeg.exe`, он встроится в бинарник.

## ffmpeg

Программа сама находит ffmpeg в PATH или рядом с собой (или скачивает кнопкой «Установить ffmpeg»).

- **Я.Музыка** — MP3 и FLAC качаются **без ffmpeg** (ffmpeg нужен только чтобы превратить FLAC-в-MP4 в нативный `.flac`, см. ниже).
- **Bandcamp** — прямой mp3, без ffmpeg.
- **YouTube / SoundCloud / видео** — ffmpeg нужен для склейки/конвертации.

> 🎵 **FLAC из Я.Музыки:** Яндекс отдаёт lossless внутри MP4-контейнера. С ffmpeg программа автоматически ремуксит его в **нативный `.flac`** (без потери качества — спектрограф и FLAC-тулзы открывают). Без ffmpeg файл сохранится как `.m4a` (тоже lossless, но не нативный FLAC).

**Где взять:**
- **Windows:** [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds/releases) → `ffmpeg-master-latest-win64-gpl.zip` → распаковать → `ffmpeg.exe` рядом с `MusicDownloader.exe` (либо в PATH).
- **macOS:** `brew install ffmpeg`
- **Linux:** `sudo apt install ffmpeg` / `sudo dnf install ffmpeg` / `sudo pacman -S ffmpeg`

## Использование

1. Запусти программу.
2. Вставь ссылку (можно несколько через пробел) → нажми **Скачать**.
3. Выбери формат: аудио (mp3 / m4a / flac / opus) или видео (mp4 best / 1080p / 720p / 480p).
4. Очередь скачивает параллельно по одному (yt-dlp всё равно умеет параллелить фрагменты). Прогресс-бар показывает скорость.
5. Двойной клик по строке — открывает файл в проводнике. Правый клик — меню (повторить, удалить, открыть).

### Я.Музыка токен (с мая 2026)

> ⚠️ **ОБЯЗАТЕЛЬНО:** нужен **активный аккаунт Яндекса** — без него скачивание не работает (Яндекс не отдаёт треки анонимным пользователям).

Яндекс снёс свой старый веб-API. Чтобы скачивать с Я.Музыки нужен **OAuth-токен** — получить один раз:

1. Нажми кнопку **«Получить»** рядом с полем «Я.Музыка токен» (откроет страницу Яндекса в браузере)
2. **Залогинься в свой Яндекс-аккаунт** (если ещё не залогинен в браузере), нажми «Разрешить доступ»
3. Тебя перебросит на адрес содержащий `#access_token=ВОТ_ЭТА_ДЛИННАЯ_СТРОКА&...`
4. Вставь в поле «Я.Музыка токен» **либо сам токен**, **либо весь URL целиком** (программа сама вытащит токен). Нажми **«Сохранить»**.

> 💡 **Если страница быстро редиректнула** и не успел скопировать — открой **историю браузера** (`Ctrl+H`), найди URL содержащий `access_token` (он там сохранился), скопируй полностью, вставь в поле.

Токен живёт долго (год +). Один раз получил — забыл. Поле остаётся пустым если ты не скачиваешь с Я.Музыки — остальные сайты работают без него.

### Cookies браузера

Для авторизованных YouTube Premium / приватных плейлистов выбери браузер в дропдауне «Cookies». yt-dlp прочитает куки прямо из его хранилища — логин делать не нужно.

⚠ **Chrome/Edge на Windows:** при первом обращении к cookies браузер должен быть закрыт (DPAPI блокирует чтение если процесс держит файл).

## Архитектура

```
desktop/
├── main.py             # Entry point
├── window.py           # PySide6 MainWindow + тема
├── core.py             # Worker (QThread): yt-dlp для большинства, yandex_music для Я.М.
├── yandex_music.py     # Движок Я.Музыки: api.music.yandex.net, FLAC/MP3,
│                       #   обложка, теги, текст, ремукс FLAC-в-MP4 → .flac
├── ffmpeg_helper.py    # поиск ffmpeg
├── ffmpeg_installer.py # авто-скачивание ffmpeg
├── settings.py         # хранение настроек
├── build.py            # PyInstaller builder
└── requirements.txt    # PySide6, yt-dlp, mutagen, pycryptodome
```

> Тот же `yandex_music.py` переиспользуется в [`lite/`](../lite) — версии для Windows 7 на tkinter.

## DRM

Spotify / Apple Music / Tidal / Deezer / Amazon Music — Widevine DRM, **скачать нельзя ни одним инструментом** (см. README в корне). Для этих сервисов используйте режим matching через YouTube — этим занимаются отдельные инструменты типа `spotdl`. Возможно интегрируем в будущей версии.
