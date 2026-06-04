"""Сборка MusicDownloader-Lite.exe для Windows 7.

ВАЖНО: для Win7-совместимого exe собирай Python 3.8 (последний с поддержкой
Win7). На Python 3.9+ exe не запустится на Win7.

    pip install pyinstaller mutagen pycryptodome
    python build.py

Результат: dist/MusicDownloader-Lite.exe (~15-20 МБ, tkinter лёгкий).
Если рядом лежит ffmpeg.exe — он встроится (для нативного FLAC).
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


def main():
    here = Path(__file__).resolve().parent
    repo = here.parent

    add_data = []
    ffmpeg_local = here / 'ffmpeg.exe'
    if ffmpeg_local.exists():
        add_data += ['--add-binary', f'{ffmpeg_local};.']
        print(f'[build] bundling ffmpeg from {ffmpeg_local}')

    icon_arg = []
    ico = here / 'icon.ico'
    png = repo / 'icons' / 'icon128.png'
    if ico.exists():
        icon_arg = ['--icon', str(ico)]
    elif png.exists():
        try:
            from PIL import Image
            Image.open(png).save(ico, format='ICO',
                                 sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128)])
            icon_arg = ['--icon', str(ico)]
        except ImportError:
            pass

    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--name', 'MusicDownloader-Lite',
        '--onefile', '--windowed', '--noconfirm', '--clean',
        *icon_arg, *add_data,
        str(here / 'main.py'),
    ]
    print('[build]', ' '.join(cmd))
    subprocess.check_call(cmd, cwd=here)
    print('\n✓ Готово: dist/MusicDownloader-Lite.exe')


if __name__ == '__main__':
    main()
