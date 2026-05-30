"""Yandex Music — прямое скачивание через api.music.yandex.net + OAuth-токен.

Я.Музыка снесла свой старый веб-API (music.yandex.ru/handlers/*.jsx) в мае 2026.
Теперь рабочий путь — mobile API на api.music.yandex.net с OAuth-токеном.

Получение токена (один раз):
1. Открыть в браузере:
   https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d
2. Залогиниться, разрешить доступ
3. Скопировать значение access_token из URL после редиректа
4. Вставить в поле «Токен Я.Музыки» в настройках программы

Поддерживает:
- треки  (/album/X/track/Y, /track/Y)
- альбомы (/album/X)
- плейлисты — старые (/users/owner/playlists/N) и новые UUID (/playlists/{uuid})
- mp3 напрямую, без ffmpeg
"""
from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Optional

API_BASE = 'https://api.music.yandex.net'
SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA'
OAUTH_URL = (
    'https://oauth.yandex.ru/authorize?response_type=token'
    '&client_id=23cabbbdc6cd418abb4b39c32c41195d'
)

_HOST_DOMAINS = (
    'music.yandex.ru', 'music.yandex.com', 'music.yandex.kz',
    'music.yandex.by', 'music.yandex.ua',
)
_YM_RE = re.compile(r'^https?://music\.yandex\.\w+/', re.I)


class YMCancelled(Exception):
    pass


def is_yandex_music_url(url: str) -> bool:
    return bool(_YM_RE.match((url or '').strip()))


def _sanitize(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name or '').strip().rstrip('.')
    return name[:180] or 'track'


# ─────────────────────── URL parsing ───────────────────────

def _parse_url(url: str) -> dict:
    u = urllib.parse.urlparse(url)
    if not any(u.netloc == d or u.netloc.endswith('.' + d) for d in _HOST_DOMAINS):
        raise ValueError('Не Я.Музыка URL')
    p = u.path
    m = re.search(r'/album/(\d+)/track/(\d+)', p)
    if m:
        return {'type': 'track', 'albumId': m.group(1), 'trackId': m.group(2)}
    m = re.search(r'/track/(\d+)', p)
    if m:
        return {'type': 'track', 'albumId': None, 'trackId': m.group(1)}
    m = re.search(r'/album/(\d+)', p)
    if m:
        return {'type': 'album', 'albumId': m.group(1)}
    m = re.search(r'/users/([^/]+)/playlists/(\d+)', p)
    if m:
        return {'type': 'playlist', 'owner': m.group(1), 'kinds': m.group(2)}
    m = re.search(r'/playlists/([a-f0-9-]{32,40})', p, re.I)
    if m:
        return {'type': 'playlist', 'uuid': m.group(1)}
    raise ValueError(
        'Не удалось распознать ссылку Я.Музыки. Поддерживаются ссылки на трек, '
        'альбом и плейлист (включая UUID-плейлисты /playlists/{uuid}).'
    )


# ─────────────────────── HTTP ───────────────────────

def _headers(token: Optional[str], extra: Optional[dict] = None) -> dict:
    h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MusicDownloader/3.2',
        'Accept': 'application/json',
    }
    if token:
        h['Authorization'] = f'OAuth {token}'
    if extra:
        h.update(extra)
    return h


def _api_get(path: str, token: Optional[str]) -> dict:
    req = urllib.request.Request(f'{API_BASE}{path}', headers=_headers(token))
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    return data.get('result', data)


def _api_post(path: str, body: str, token: Optional[str]) -> dict:
    req = urllib.request.Request(
        f'{API_BASE}{path}',
        data=body.encode('utf-8'),
        method='POST',
        headers=_headers(token, {'Content-Type': 'application/x-www-form-urlencoded'}),
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    return data.get('result', data)


# ─────────────────────── Metadata ───────────────────────

def _shape_track(t: dict, default_album: str = '') -> dict:
    return {
        'trackId': str(t.get('id') or t.get('realId') or ''),
        'albumId': str(((t.get('albums') or [{}])[0]).get('id') or default_album or ''),
        'title': t.get('title') or '',
        'artist': ', '.join(a.get('name', '') for a in (t.get('artists') or []) if a.get('name')),
    }


def _fetch_album(album_id: str, token: Optional[str]) -> list:
    data = _api_get(f'/albums/{album_id}/with-tracks', token)
    out = []
    for vol in (data.get('volumes') or []):
        for t in vol:
            tr = _shape_track(t, album_id)
            if tr['trackId']:
                out.append(tr)
    return out


def _fetch_playlist_legacy(owner: str, kinds: str, token: Optional[str]) -> list:
    pl = _api_get(f'/users/{owner}/playlists/{kinds}', token)
    items = pl.get('tracks') or []
    return [_shape_track(e.get('track', e)) for e in items if (e.get('track') or e).get('id')]


def _fetch_playlist_uuid(uuid: str, token: Optional[str]) -> list:
    pl = _api_get(f'/playlist/{uuid}', token)
    items = pl.get('tracks') or []
    return [_shape_track(e.get('track', e)) for e in items if (e.get('track') or e).get('id')]


def _fetch_single_track(track_id: str, album_id: Optional[str], token: Optional[str]) -> dict:
    arr = _api_post('/tracks', f'track-ids={urllib.parse.quote(str(track_id))}', token)
    if isinstance(arr, list) and arr:
        return _shape_track(arr[0], album_id or '')
    return {'trackId': str(track_id), 'albumId': album_id or '', 'title': '', 'artist': ''}


# ─────────────────────── Audio URL resolution ───────────────────────

def _resolve_audio_url(track: dict, token: str) -> Optional[str]:
    dl_info = _api_get(f"/tracks/{track['trackId']}/download-info", token)
    if not isinstance(dl_info, list) or not dl_info:
        return None
    mp3s = [i for i in dl_info if i.get('codec') == 'mp3']
    pool = mp3s if mp3s else dl_info
    pick = max(pool, key=lambda i: i.get('bitrateInKbps', 0))
    info_url = pick['downloadInfoUrl']
    info_url += ('&' if '?' in info_url else '?') + 'format=json'
    req = urllib.request.Request(info_url, headers=_headers(None))  # storage.mds.* без авторизации
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode('utf-8', errors='replace')
    try:
        j = json.loads(text)
        host, path, ts, s = j.get('host'), j.get('path'), j.get('ts'), j.get('s')
    except Exception:
        def _tag(name):
            m = re.search(rf'<{name}>(.*?)</{name}>', text)
            return m.group(1) if m else None
        host, path, ts, s = _tag('host'), _tag('path'), _tag('ts'), _tag('s')
    if not host or not path or s is None or ts is None:
        return None
    sign = hashlib.md5((SIGN_SALT + path[1:] + s).encode('utf-8')).hexdigest()
    return f'https://{host}/get-mp3/{sign}/{ts}{path}'


# ─────────────────────── Public entry point ───────────────────────

def download(url: str,
             output_dir: str,
             token: Optional[str],
             info_cb: Callable[[dict], None],
             progress_cb: Callable[[dict], None],
             cancel_check: Callable[[], bool]) -> str:
    if cancel_check():
        raise YMCancelled()

    parsed = _parse_url(url)

    # Single track
    if parsed['type'] == 'track':
        track = _fetch_single_track(parsed['trackId'], parsed.get('albumId'), token)
        title = track.get('title') or f"Track {track['trackId']}"
        info_cb({
            'title': title,
            'uploader': track.get('artist', ''),
            'extractor_key': 'YandexMusic',
            'extractor': 'yandexmusic',
        })
        if not token:
            raise RuntimeError(
                'Я.Музыка требует OAuth-токен для скачивания (download-info → 403). '
                'Получите токен: ' + OAUTH_URL + ' и вставьте в поле «Я.Музыка токен».'
            )
        return str(_download_one(track, Path(output_dir), token, progress_cb, cancel_check))

    # Album / playlist (batch)
    if parsed['type'] == 'album':
        tracks = _fetch_album(parsed['albumId'], token)
        folder_label = f"album_{parsed['albumId']}"
    elif parsed['type'] == 'playlist':
        if parsed.get('uuid'):
            tracks = _fetch_playlist_uuid(parsed['uuid'], token)
            folder_label = f"playlist_{parsed['uuid'][:8]}"
        else:
            tracks = _fetch_playlist_legacy(parsed['owner'], parsed['kinds'], token)
            folder_label = f"playlist_{parsed['owner']}_{parsed['kinds']}"
    else:
        raise RuntimeError('Неподдерживаемый тип Я.Музыки')

    if not tracks:
        raise RuntimeError(
            'Треки не найдены. Если плейлист приватный — нужен токен '
            'с доступом этого юзера (вставьте в поле «Я.Музыка токен»).'
        )

    if not token:
        raise RuntimeError(
            'Метаданные получены, но для скачивания нужен OAuth-токен. '
            'Получите: ' + OAUTH_URL + ' и вставьте в поле «Я.Музыка токен».'
        )

    artist0 = tracks[0].get('artist') or 'Yandex Music'
    folder_name = _sanitize(f'{artist0} - {folder_label}')
    out_dir = Path(output_dir) / folder_name
    out_dir.mkdir(parents=True, exist_ok=True)

    info_cb({
        'title': folder_name,
        'uploader': artist0,
        'extractor_key': 'YandexMusic',
        'extractor': 'yandexmusic',
    })

    last_path = str(out_dir)
    total = len(tracks)
    for i, t in enumerate(tracks, 1):
        if cancel_check():
            raise YMCancelled()
        label = f'[{i}/{total}] {t.get("artist", "")} — {t.get("title", "")}'
        progress_cb({'status': 'downloading', 'message': label,
                     'batch_current': i, 'batch_total': total})
        try:
            p = _download_one(t, out_dir, token, progress_cb, cancel_check)
            last_path = str(p)
        except YMCancelled:
            raise
        except Exception as e:
            progress_cb({'status': 'error', 'message': f'пропущен: {e}'})
    progress_cb({'status': 'finished'})
    return last_path


def _download_one(track: dict, out_dir: Path, token: str,
                  progress_cb: Callable, cancel_check: Callable) -> Path:
    if cancel_check():
        raise YMCancelled()
    audio_url = _resolve_audio_url(track, token)
    if not audio_url:
        raise RuntimeError(f'Я.Музыка: нет audio URL для трека {track["trackId"]}')

    artist = _sanitize(track.get('artist', ''))
    title = _sanitize(track.get('title', '')) or f"track_{track['trackId']}"
    name = f'{artist} - {title}.mp3' if artist else f'{title}.mp3'
    out_path = out_dir / name
    out_dir.mkdir(parents=True, exist_ok=True)

    req = urllib.request.Request(audio_url, headers=_headers(None))
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get('Content-Length') or 0) or None
        downloaded = 0
        with open(out_path, 'wb') as f:
            while True:
                if cancel_check():
                    raise YMCancelled()
                chunk = resp.read(128 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                progress_cb({
                    'status': 'downloading',
                    'downloaded_bytes': downloaded,
                    'total_bytes': total,
                })
    progress_cb({'status': 'finished'})
    return out_path
