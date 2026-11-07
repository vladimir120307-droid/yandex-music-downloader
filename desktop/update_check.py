"""Проверка новой версии на GitHub — в фоне, при запуске программы.

Копия этого файла лежит в desktop/ и lite/ (как и yandex_music.py).
Ошибки сети молча игнорируются: программа должна работать и без интернета.
"""
from __future__ import annotations

import json
import urllib.request
from typing import List, Optional

RELEASES_API = 'https://api.github.com/repos/vladimir120307-droid/yandex-music-downloader/releases/latest'


def parse_version(version: str) -> List[int]:
    parts = version.strip().lstrip('vV').split('.')
    return [int(p) if p.isdigit() else 0 for p in parts]


def is_newer(latest: str, current: str, parts: int) -> bool:
    """Сравнивает первые parts чисел версии.

    Четвёртое число — автоматическая пересборка со свежим yt-dlp (v3.14.0.1):
    важна только десктопу (parts=4), а Lite с закреплённым yt-dlp её не касается (parts=3).
    """
    def norm(v: str) -> List[int]:
        return (parse_version(v) + [0] * parts)[:parts]
    return norm(latest) > norm(current)


def check(current: str, parts: int, asset_prefix: str) -> Optional[dict]:
    """Возвращает {'version', 'url'}, если вышла новая версия, иначе None."""
    if current == 'dev':  # запуск из исходников
        return None
    try:
        req = urllib.request.Request(RELEASES_API, headers={
            'User-Agent': 'MusicDownloader/' + current,
            'Accept': 'application/vnd.github+json',
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            release = json.load(r)
        latest = release['tag_name'].lstrip('vV')
        if not is_newer(latest, current, parts):
            return None
        url = release['html_url']
        for asset in release.get('assets', []):
            # .exe обязательно: у APK то же начало имени, что и у десктопа
            if asset['name'].startswith(asset_prefix) and asset['name'].endswith('.exe'):
                url = asset['browser_download_url']
                break
        return {'version': latest, 'url': url}
    except Exception:
        return None
