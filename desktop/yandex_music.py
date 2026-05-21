"""Yandex Music — прямое скачивание mp3 (без ffmpeg).

Логика портирована из services/yandex.js (расширения). Использует публичный
API music.yandex.ru/handlers/* + signed-URL CDN. Cookies из браузера —
опционально, для премиум-качества и приватных плейлистов.
"""
from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Callable, Optional

SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA'
DEFAULT_ORIGIN = 'https://music.yandex.ru'

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


# ─────────────────────── Cookies (через yt-dlp) ───────────────────────

class _NullLogger:
    def warning(self, *a, **k): pass
    def error(self, *a, **k): pass
    def info(self, *a, **k): pass
    def debug(self, *a, **k): pass


def _get_cookiejar(browser: Optional[str]) -> CookieJar:
    if not browser:
        return CookieJar()
    try:
        from yt_dlp.cookies import extract_cookies_from_browser
    except ImportError:
        return CookieJar()
    # API yt-dlp менялся между версиями — пытаемся несколько сигнатур.
    for kwargs in ({}, {'logger': _NullLogger()}, {'logger': _NullLogger(), 'profile': None}):
        try:
            return extract_cookies_from_browser(browser, **kwargs)
        except TypeError:
            continue
        except Exception:
            return CookieJar()
    return CookieJar()


def _make_opener(cookies_browser: Optional[str]):
    cj = _get_cookiejar(cookies_browser)
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


# ─────────────────────── URL parser ───────────────────────

def _parse_url(url: str) -> dict:
    u = urllib.parse.urlparse(url)
    if not any(u.netloc == d or u.netloc.endswith('.' + d) for d in _HOST_DOMAINS):
        raise ValueError('Не Я.Музыка URL')
    origin = f'{u.scheme}://{u.netloc}'
    p = u.path
    m = re.search(r'/album/(\d+)/track/(\d+)', p)
    if m:
        return {'type': 'track', 'albumId': m.group(1), 'trackId': m.group(2), 'origin': origin}
    m = re.search(r'/track/(\d+)', p)
    if m:
        return {'type': 'track', 'albumId': None, 'trackId': m.group(1), 'origin': origin}
    m = re.search(r'/album/(\d+)', p)
    if m:
        return {'type': 'album', 'albumId': m.group(1), 'origin': origin}
    m = re.search(r'/users/([^/]+)/playlists/(\d+)', p)
    if m:
        return {'type': 'playlist', 'owner': m.group(1), 'kinds': m.group(2), 'origin': origin}
    raise ValueError('Не удалось распознать ссылку Я.Музыки')


# ─────────────────────── HTTP ───────────────────────

def _api_get_json(opener, url: str, origin: str) -> dict:
    req = urllib.request.Request(url, headers={
        'X-Retpath-Y': origin + '/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MusicDownloader/3.1',
        'Accept': 'application/json',
    })
    with opener.open(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


# ─────────────────────── Metadata ───────────────────────

def _track_from_api(t: dict, default_album: str, origin: str) -> dict:
    return {
        'trackId': str(t.get('id') or ''),
        'albumId': str(((t.get('albums') or [{}])[0]).get('id') or default_album or ''),
        'title': t.get('title') or '',
        'artist': ', '.join(a.get('name', '') for a in (t.get('artists') or [])),
        'origin': origin,
    }


def _fetch_album(opener, origin: str, album_id: str) -> list:
    url = f'{origin}/handlers/album/{album_id}/full.jsx'
    data = _api_get_json(opener, url, origin)
    out = []
    for vol in (data.get('volumes') or []):
        for t in vol:
            out.append(_track_from_api(t, album_id, origin))
    return [t for t in out if t['trackId']]


def _fetch_playlist(opener, origin: str, owner: str, kinds: str) -> list:
    url = f'{origin}/handlers/playlist/{owner}/{kinds}/full.jsx'
    data = _api_get_json(opener, url, origin)
    pl = data.get('playlist') or data
    out = []
    for entry in (pl.get('tracks') or []):
        tr = entry.get('track') or entry
        if tr.get('id'):
            out.append(_track_from_api(tr, '', origin))
    return out


def _fetch_single(opener, origin: str, track_id: str, album_id: Optional[str]) -> dict:
    if album_id:
        try:
            for t in _fetch_album(opener, origin, album_id):
                if t['trackId'] == str(track_id):
                    return t
        except Exception:
            pass
    return {'trackId': str(track_id), 'albumId': album_id or '', 'title': '',
            'artist': '', 'origin': origin}


# ─────────────────────── Audio URL resolution ───────────────────────

def _resolve_xml_to_mp3(opener, xml_url: str) -> Optional[str]:
    if 'format=' not in xml_url:
        xml_url += ('&' if '?' in xml_url else '?') + 'format=json'
    req = urllib.request.Request(xml_url, headers={
        'User-Agent': 'Mozilla/5.0 MusicDownloader/3.1',
    })
    with opener.open(req, timeout=30) as resp:
        text = resp.read().decode('utf-8', errors='replace')
    host = path = ts = s = None
    try:
        j = json.loads(text)
        host = j.get('host'); path = j.get('path'); ts = j.get('ts'); s = j.get('s')
    except Exception:
        def _tag(name):
            m = re.search(rf'<{name}>(.*?)</{name}>', text)
            return m.group(1) if m else None
        host, path, ts, s = _tag('host'), _tag('path'), _tag('ts'), _tag('s')
    if not host or not path or s is None or ts is None:
        return None
    sign = hashlib.md5((SIGN_SALT + path[1:] + s).encode('utf-8')).hexdigest()
    return f'https://{host}/get-mp3/{sign}/{ts}{path}'


def _get_audio_url(opener, track: dict) -> Optional[str]:
    origin = track.get('origin', DEFAULT_ORIGIN)
    host = urllib.parse.urlparse(origin).netloc
    tid = track['trackId']
    aid = track.get('albumId') or ''
    candidates = []
    if aid:
        candidates.append(
            f'{origin}/api/v2.1/handlers/track/{tid}:{aid}'
            f'/web-album_track-track-track-main/download/m'
            f'?hq=1&external-domain={host}&overembed=no'
        )
    candidates.append(
        f'{origin}/api/v2.1/handlers/track/{tid}'
        f'/web-album_track-track-track-main/download/m'
        f'?hq=1&external-domain={host}&overembed=no'
    )
    for ep in candidates:
        try:
            data = _api_get_json(opener, ep, origin)
            xml_url = data.get('src') or (data.get('result') or {}).get('src')
            if not xml_url:
                continue
            mp3 = _resolve_xml_to_mp3(opener, xml_url)
            if mp3:
                return mp3
        except Exception:
            continue
    return None


# ─────────────────────── Public entry point ───────────────────────

def download(url: str,
             output_dir: str,
             cookies_browser: Optional[str],
             info_cb: Callable[[dict], None],
             progress_cb: Callable[[dict], None],
             cancel_check: Callable[[], bool]) -> str:
    if cancel_check():
        raise YMCancelled()
    opener = _make_opener(cookies_browser)
    parsed = _parse_url(url)
    origin = parsed['origin']

    if parsed['type'] == 'track':
        track = _fetch_single(opener, origin, parsed['trackId'], parsed.get('albumId'))
        title = track.get('title') or f"Track {track['trackId']}"
        info_cb({
            'title': title,
            'uploader': track.get('artist', ''),
            'extractor_key': 'YandexMusic',
            'extractor': 'yandexmusic',
        })
        out_path = _download_one(opener, track, Path(output_dir), progress_cb, cancel_check)
        return str(out_path)

    if parsed['type'] == 'album':
        tracks = _fetch_album(opener, origin, parsed['albumId'])
        folder_label = f'album_{parsed["albumId"]}'
    elif parsed['type'] == 'playlist':
        tracks = _fetch_playlist(opener, origin, parsed['owner'], parsed['kinds'])
        folder_label = f'playlist_{parsed["owner"]}_{parsed["kinds"]}'
    else:
        raise RuntimeError('Неподдерживаемый тип Я.Музыки')

    if not tracks:
        raise RuntimeError(
            'Треки не найдены. Если это приватный/премиум плейлист — '
            'выберите Cookies → ваш браузер и попробуйте снова.'
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
            p = _download_one(opener, t, out_dir, progress_cb, cancel_check)
            last_path = str(p)
        except YMCancelled:
            raise
        except Exception as e:
            progress_cb({'status': 'error', 'message': f'пропущен: {e}'})
    progress_cb({'status': 'finished'})
    return last_path


def _download_one(opener, track: dict, out_dir: Path,
                  progress_cb: Callable, cancel_check: Callable) -> Path:
    if cancel_check():
        raise YMCancelled()
    audio_url = _get_audio_url(opener, track)
    if not audio_url:
        raise RuntimeError(f'нет аудио URL (трек {track["trackId"]}, возможно нужны cookies)')

    artist = _sanitize(track.get('artist', ''))
    title = _sanitize(track.get('title', '')) or f'track_{track["trackId"]}'
    name = f'{artist} - {title}.mp3' if artist else f'{title}.mp3'
    out_path = out_dir / name
    out_dir.mkdir(parents=True, exist_ok=True)

    req = urllib.request.Request(audio_url, headers={
        'User-Agent': 'Mozilla/5.0 MusicDownloader/3.1',
    })
    with opener.open(req, timeout=60) as resp:
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
