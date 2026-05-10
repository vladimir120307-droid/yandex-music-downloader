"""Build standalone binary via PyInstaller.

Usage:
    pip install pyinstaller
    python build.py

Output: dist/MusicDownloader(.exe)
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


def main():
    here = Path(__file__).resolve().parent
    repo_root = here.parent

    # If a local ffmpeg.exe is present next to build.py, bundle it.
    ffmpeg_local = here / ('ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg')
    add_data = []
    if ffmpeg_local.exists():
        sep = ';' if sys.platform == 'win32' else ':'
        add_data.extend(['--add-binary', f'{ffmpeg_local}{sep}.'])
        print(f'[build] Bundling ffmpeg from {ffmpeg_local}')

    icon_arg = []
    icon_path_png = repo_root / 'icons' / 'icon128.png'
    icon_path_ico = here / 'icon.ico'
    if icon_path_ico.exists():
        icon_arg = ['--icon', str(icon_path_ico)]
    elif icon_path_png.exists() and sys.platform == 'win32':
        # Convert PNG to ICO if Pillow is available
        try:
            from PIL import Image
            img = Image.open(icon_path_png)
            img.save(icon_path_ico, format='ICO',
                     sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128)])
            icon_arg = ['--icon', str(icon_path_ico)]
            print(f'[build] Converted {icon_path_png} → {icon_path_ico}')
        except ImportError:
            print('[build] Pillow not installed, skipping icon')

    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--name', 'MusicDownloader',
        '--onefile',
        '--windowed',
        '--noconfirm',
        '--clean',
        *icon_arg,
        *add_data,
        str(here / 'main.py'),
    ]
    print('[build] Running:', ' '.join(cmd))
    subprocess.check_call(cmd, cwd=here)

    out_dir = here / 'dist'
    print(f'\n✓ Built. Output: {out_dir}')
    if (out_dir / 'MusicDownloader.exe').exists():
        print('  ', out_dir / 'MusicDownloader.exe')
    elif (out_dir / 'MusicDownloader').exists():
        print('  ', out_dir / 'MusicDownloader')


if __name__ == '__main__':
    main()
