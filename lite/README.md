# Music Downloader Lite (для Windows 7)

Облегчённая версия **специально для Windows 7**, где полный десктоп (на PySide6) не запускается.

- Только **Яндекс.Музыка**: FLAC / MP3 320 + обложка + теги + текст песни
- GUI на **tkinter** (встроен в Python, работает на Win7)
- Переиспользует тот же движок что и полный десктоп (`yandex_music.py`)

> Нужна полная версия (1800 сайтов: YouTube, SoundCloud, VK…)? Она в [`desktop/`](../desktop) — но требует Windows 10+.

## Запуск из исходников

Нужен **Python 3.8** (последний с поддержкой Win7):

```bash
cd lite
pip install -r requirements.txt
python main.py
```

## Сборка .exe

```bash
pip install pyinstaller mutagen pycryptodome pillow
python build.py
```

Результат: `dist/MusicDownloader-Lite.exe` (~15-20 МБ). Собирай на **Python 3.8**, иначе exe не пойдёт на Win7.

## Использование

1. Запусти программу
2. Нажми **«Получить»** → залогинься в Яндекс → скопируй токен (или весь URL) → **«Сохранить»**
3. Вставь ссылку на трек / альбом / плейлист Я.Музыки
4. Выбери качество (Авто / FLAC / MP3 320), при желании включи «Текст песни»
5. **«Скачать»**

## FLAC

- **Нужен Я.Плюс** для lossless
- Для **нативного `.flac`** положи `ffmpeg.exe` рядом с программой (или в PATH) — она переупакует FLAC-в-MP4 в настоящий `.flac` без потери качества
- Без ffmpeg FLAC сохранится как `.m4a` (тот же lossless, играется везде)

ffmpeg для Win7: [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds/releases) → `ffmpeg-master-latest-win64-gpl.zip` → `ffmpeg.exe` из `bin/` положить рядом.

## Зависимости

- `mutagen` — теги и обложка
- `pycryptodome` — расшифровка FLAC-потока (AES-CTR)
- `tkinter` — встроен в Python
