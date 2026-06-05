# Music Downloader для Windows 7

Полнофункциональная версия **для Windows 7**, где основной десктоп (на PySide6) не запускается. GUI на **tkinter** (работает на Win7).

- **Яндекс.Музыка** — FLAC / MP3 320 + обложка + теги + текст песни (наш движок `yandex_music.py`)
- **YouTube, SoundCloud, Bandcamp, VK и др.** — через yt-dlp

> ⚠️ **Важно про yt-dlp:** Win7 застрял на Python 3.8, а свежий yt-dlp требует 3.10+. Поэтому здесь закреплён **yt-dlp 2024.10.22** — последний с поддержкой 3.8. Стабильные сайты (Bandcamp, SoundCloud, VK) работают, но **YouTube может не качаться** (он часто меняет защиту, а старый экстрактор не обновляется). Яндекс.Музыка работает всегда — она на нашем коде, не на yt-dlp.
>
> Нужен надёжный YouTube? Используй [полный десктоп](../desktop) на Windows 10+.

## Запуск из исходников

Нужен **Python 3.8** (последний с поддержкой Win7):

```bash
cd lite
pip install -r requirements.txt
python main.py
```

## Сборка .exe

```bash
pip install pyinstaller pillow
python build.py
```

Результат: `dist/MusicDownloader-Lite.exe`. Собирай на **Python 3.8**, иначе exe не пойдёт на Win7.

## Использование

1. Запусти программу
2. Для Яндекс.Музыки: **«Получить»** → залогинься → скопируй токен (или URL) → **«Сохранить»**
3. Вставь ссылку (Я.Музыка / YouTube / SoundCloud / Bandcamp / VK …)
4. Выбери формат:
   - **Я.Музыка** — Авто / FLAC / MP3 320 (+ галка «Текст песни»)
   - **Др. сайты** — MP3 / M4A / FLAC / Opus / видео
5. **«Скачать»**

## ffmpeg

Нужен для:
- нативного `.flac` из Я.Музыки (без него FLAC сохранится как `.m4a`)
- конвертации с YouTube / SoundCloud / видео

Положи `ffmpeg.exe` рядом с программой или в PATH. Где взять: [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds/releases) → `ffmpeg-master-latest-win64-gpl.zip` → `ffmpeg.exe` из `bin/`.

## Зависимости

- `mutagen` — теги и обложка
- `pycryptodome` — расшифровка FLAC (AES-CTR)
- `yt-dlp==2024.10.22` — другие сайты (последний с Python 3.8)
- `tkinter` — встроен в Python
