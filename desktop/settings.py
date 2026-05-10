"""Persistent settings — JSON in user config dir."""
import json
import os
import sys
from pathlib import Path


def _config_dir() -> Path:
    if os.name == 'nt':
        base = Path(os.environ.get('APPDATA', Path.home())) / 'MusicDownloader'
    elif sys.platform == 'darwin':
        base = Path.home() / 'Library' / 'Application Support' / 'MusicDownloader'
    else:
        base = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'music-downloader'
    base.mkdir(parents=True, exist_ok=True)
    return base


class Settings:
    def __init__(self):
        self.path = _config_dir() / 'settings.json'
        self.data: dict = {}
        self._load()

    def _load(self):
        if not self.path.exists():
            return
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                self.data = json.load(f)
        except Exception:
            self.data = {}

    def _save(self):
        try:
            with open(self.path, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def get(self, key, default=None):
        return self.data.get(key, default)

    def set(self, key, value):
        self.data[key] = value
        self._save()
