"""Detect ffmpeg location, give install hints."""
from __future__ import annotations
import os
import shutil
import sys
from pathlib import Path


def find_ffmpeg() -> str | None:
    """Return path to ffmpeg binary, or None."""
    name = 'ffmpeg.exe' if os.name == 'nt' else 'ffmpeg'

    # 1. PATH
    found = shutil.which('ffmpeg')
    if found:
        return found

    # 2. Application-local
    try:
        app_dir = Path(sys.argv[0]).resolve().parent
    except Exception:
        app_dir = Path.cwd()
    candidates = [
        app_dir / name,
        app_dir / 'ffmpeg' / 'bin' / name,
        app_dir / 'bin' / name,
        Path(__file__).resolve().parent / name,
    ]
    for c in candidates:
        try:
            if c.exists() and c.is_file():
                return str(c)
        except OSError:
            continue

    # 3. Common Windows install locations
    if os.name == 'nt':
        for c in [
            r'C:\ffmpeg\bin\ffmpeg.exe',
            r'C:\Program Files\ffmpeg\bin\ffmpeg.exe',
            r'C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe',
        ]:
            if Path(c).exists():
                return c

    return None


def suggest_install() -> str:
    if os.name == 'nt':
        return (
            'Самый простой способ:\n'
            '1. Скачать архив: https://github.com/yt-dlp/FFmpeg-Builds/releases\n'
            '   (берите ffmpeg-master-latest-win64-gpl.zip)\n'
            '2. Распаковать, ffmpeg.exe из папки bin положить рядом с MusicDownloader.exe\n'
            '   (или добавить bin в системный PATH)\n\n'
            'Без ffmpeg будут работать только сайты с прямыми mp3 (Bandcamp, частично Я.Музыка). '
            'YouTube, SoundCloud, видео — нет.'
        )
    if sys.platform == 'darwin':
        return 'Установите ffmpeg через Homebrew:\n  brew install ffmpeg'
    return (
        'Установите ffmpeg:\n'
        '  Debian/Ubuntu: sudo apt install ffmpeg\n'
        '  Fedora: sudo dnf install ffmpeg\n'
        '  Arch: sudo pacman -S ffmpeg'
    )
