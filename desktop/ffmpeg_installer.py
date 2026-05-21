"""Авто-установка ffmpeg.exe (Windows). Скачивает релиз yt-dlp/FFmpeg-Builds."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, Optional

FFMPEG_WIN_URL = (
    'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/'
    'ffmpeg-master-latest-win64-gpl.zip'
)


def get_install_target() -> Path:
    """Папка, рядом с которой положить ffmpeg.exe."""
    try:
        if getattr(sys, 'frozen', False):
            return Path(sys.executable).resolve().parent
        return Path(sys.argv[0]).resolve().parent
    except Exception:
        return Path.cwd()


def install_ffmpeg(target_dir: Path,
                   progress_cb: Optional[Callable[[dict], None]] = None,
                   cancel_check: Optional[Callable[[], bool]] = None) -> Path:
    """Скачать архив ffmpeg, извлечь ffmpeg.exe в target_dir.
    Возвращает путь к ffmpeg.exe.

    progress_cb({'status': 'downloading'|'extracting'|'done',
                 'downloaded': int, 'total': int, 'message': str})
    """
    if os.name != 'nt':
        raise RuntimeError(
            'Авто-установка ffmpeg сейчас работает только на Windows.\n'
            'На macOS:  brew install ffmpeg\n'
            'На Linux:  sudo apt install ffmpeg'
        )

    cancel_check = cancel_check or (lambda: False)
    target_dir = Path(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / 'ffmpeg.exe'

    if progress_cb:
        progress_cb({'status': 'downloading', 'message': 'Скачиваю архив ffmpeg…',
                     'downloaded': 0, 'total': 0})

    tmp_zip = Path(tempfile.mkstemp(suffix='.zip', prefix='ffmpeg-')[1])
    try:
        req = urllib.request.Request(FFMPEG_WIN_URL,
                                     headers={'User-Agent': 'MusicDownloader/3.0'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get('Content-Length') or 0)
            downloaded = 0
            with open(tmp_zip, 'wb') as f:
                while True:
                    if cancel_check():
                        raise RuntimeError('Отменено')
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if progress_cb:
                        progress_cb({
                            'status': 'downloading',
                            'message': 'Скачиваю архив ffmpeg…',
                            'downloaded': downloaded,
                            'total': total,
                        })

        if progress_cb:
            progress_cb({'status': 'extracting',
                         'message': 'Распаковываю ffmpeg.exe…'})

        with zipfile.ZipFile(tmp_zip) as zf:
            member = next(
                (m for m in zf.namelist()
                 if m.lower().endswith('bin/ffmpeg.exe')),
                None,
            )
            if member is None:
                raise RuntimeError('ffmpeg.exe не найден в архиве')
            with zf.open(member) as src, open(target_path, 'wb') as dst:
                shutil.copyfileobj(src, dst, length=256 * 1024)

        if progress_cb:
            progress_cb({'status': 'done',
                         'message': f'Готово: {target_path}',
                         'path': str(target_path)})
        return target_path
    finally:
        try:
            tmp_zip.unlink()
        except OSError:
            pass
