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

Программа сама находит ffmpeg в PATH или рядом с собой. Без ffmpeg будет работать только то, что отдаётся прямым mp3 (Bandcamp, частично Я.Музыка) — YouTube/SoundCloud/видео потребуют конвертации.

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

Яндекс снёс свой старый веб-API. Чтобы скачивать с Я.Музыки нужен **OAuth-токен** — получить один раз:

1. Нажми кнопку **«Получить»** рядом с полем «Я.Музыка токен» (откроет страницу Яндекса)
2. Залогинься, нажми «Разрешить»
3. Тебя перебросит на `music.yandex.ru/#access_token=ВОТ_ЭТО_СКОПИРУЙ&...`
4. Вставь `access_token` в поле «Я.Музыка токен», нажми **«Сохранить»**

Токен живёт долго (год +). Один раз получил — забыл. Поле остаётся пустым если ты не скачиваешь с Я.Музыки — остальные сайты работают без него.

### Cookies браузера

Для авторизованных YouTube Premium / приватных плейлистов выбери браузер в дропдауне «Cookies». yt-dlp прочитает куки прямо из его хранилища — логин делать не нужно.

⚠ **Chrome/Edge на Windows:** при первом обращении к cookies браузер должен быть закрыт (DPAPI блокирует чтение если процесс держит файл).

## Архитектура

```
desktop/
├── main.py            # Entry point
├── window.py          # PySide6 MainWindow + темa
├── core.py            # yt-dlp worker (QThread)
├── ffmpeg_helper.py   # detect / suggest install
├── settings.py        # JSON-config persistence
├── build.py           # PyInstaller builder
└── requirements.txt   # PySide6, yt-dlp
```

## DRM

Spotify / Apple Music / Tidal / Deezer / Amazon Music — Widevine DRM, **скачать нельзя ни одним инструментом** (см. README в корне). Для этих сервисов используйте режим matching через YouTube — этим занимаются отдельные инструменты типа `spotdl`. Возможно интегрируем в будущей версии.
