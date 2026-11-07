"""Проверка запросов десктопа и Lite к API Яндекс.Музыки (без токена).

Расширение проверяет tests/e2e.mjs. Здесь отдельный код: он ходит через urllib
и запрашивает один трек по-другому, поэтому может сломаться независимо от него.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))

import yandex_music  # noqa: E402

TRACK_ID = '152453654'
ALBUM_ID = '42555963'

track = yandex_music._fetch_single_track(TRACK_ID, ALBUM_ID, None)
assert track['title'] and track['artist'], f'пустые метаданные трека: {track}'
print('ok    трек:', track['artist'], '-', track['title'])

album = yandex_music._fetch_album(ALBUM_ID, None)
assert album, 'в альбоме нет треков'
print('ok    альбом:', len(album), 'треков')
