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

import base64
import hashlib
import hmac
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Optional

API_BASE = 'https://api.music.yandex.net'
SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA'
V2_HMAC_KEY = b'p93jhgh689SBReK6ghtw62'
V2_CODECS = 'flac,flac-mp4,mp3,aac,he-aac,aac-mp4,he-aac-mp4'
V2_TRANSPORTS = 'encraw'
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
    # UUID-плейлисты могут быть с префиксом типа `lk.` (личные плейлисты).
    # API /playlist/{uuid} принимает полный идентификатор с префиксом.
    m = re.search(r'/playlists/((?:[a-z]{1,4}\.)?[a-f0-9-]{32,40})', p, re.I)
    if m:
        return {'type': 'playlist', 'uuid': m.group(1)}
    raise ValueError(
        'Не удалось распознать ссылку Я.Музыки. Поддерживаются ссылки на трек, '
        'альбом и плейлист (включая UUID-плейлисты /playlists/{uuid}).'
    )


# ─────────────────────── HTTP ───────────────────────

def _headers(token: Optional[str], extra: Optional[dict] = None) -> dict:
    h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MusicDownloader/3.3',
        'Accept': 'application/json',
        # Мимикаем мобильное приложение — открывает FLAC в /download-info для Plus
        'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621',
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
    album = (t.get('albums') or [{}])[0] if t.get('albums') else {}
    # coverUri может быть на треке или на альбоме — берём что есть
    cover_uri = t.get('coverUri') or album.get('coverUri') or ''
    return {
        'trackId': str(t.get('id') or t.get('realId') or ''),
        'albumId': str(album.get('id') or default_album or ''),
        'title': t.get('title') or '',
        'artist': ', '.join(a.get('name', '') for a in (t.get('artists') or []) if a.get('name')),
        'album': album.get('title', ''),
        'year': album.get('year') or '',
        'coverUri': cover_uri,
    }


def _cover_url_https(uri: str, size: str = '400x400') -> Optional[str]:
    """avatars.yandex.net/.../%% → https://avatars.yandex.net/.../400x400"""
    if not uri:
        return None
    if not uri.startswith('http'):
        uri = 'https://' + uri
    return uri.replace('%%', size)


def _fetch_cover_bytes(uri: str, size: str = '400x400') -> Optional[bytes]:
    url = _cover_url_https(uri, size)
    if not url:
        return None
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 MusicDownloader/3.5',
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except Exception as e:
        print(f'[YM] cover fetch failed: {e}')
        return None


def _embed_metadata_and_cover(file_path: Path, codec: str, track: dict,
                              cover_bytes: Optional[bytes]) -> None:
    """Прописать ID3 / VorbisComment / MP4-atoms с обложкой и тегами."""
    try:
        # Авто-детект формата по магическим байтам
        with open(file_path, 'rb') as f:
            head = f.read(12)
    except OSError:
        return

    title = track.get('title') or ''
    artist = track.get('artist') or ''
    album = track.get('album') or ''
    year = str(track.get('year') or '') or None

    is_mp3 = head[:3] == b'ID3' or (len(head) > 1 and head[0] == 0xff and (head[1] & 0xe0) == 0xe0)
    is_flac = head[:4] == b'fLaC'
    is_mp4 = len(head) > 8 and head[4:8] == b'ftyp'

    try:
        if is_mp3 or (codec == 'mp3' and not is_flac and not is_mp4):
            from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, TDRC, ID3NoHeaderError
            try:
                audio = ID3(file_path)
            except ID3NoHeaderError:
                audio = ID3()
            audio.delall('APIC')
            # encoding=1 (UTF-16) валиден в ID3v2.3. encoding=3 (UTF-8) невалиден
            # в 2.3 и Windows Explorer игнорирует такие теги/обложку.
            if title: audio.add(TIT2(encoding=1, text=title))
            if artist: audio.add(TPE1(encoding=1, text=artist))
            if album: audio.add(TALB(encoding=1, text=album))
            if year: audio.add(TDRC(encoding=1, text=year))
            if cover_bytes:
                audio.add(APIC(encoding=0, mime='image/jpeg', type=3, desc='', data=cover_bytes))
            # v2_version=3 — пишем строго ID3v2.3 (Win Explorer читает лучше 2.4)
            audio.save(file_path, v2_version=3)
        elif is_flac:
            from mutagen.flac import FLAC, Picture
            audio = FLAC(file_path)
            if title: audio['title'] = title
            if artist: audio['artist'] = artist
            if album: audio['album'] = album
            if year: audio['date'] = year
            if cover_bytes:
                pic = Picture()
                pic.type = 3  # cover front
                pic.mime = 'image/jpeg'
                pic.data = cover_bytes
                audio.clear_pictures()
                audio.add_picture(pic)
            audio.save()
        elif is_mp4:
            # FLAC-in-MP4, AAC-in-MP4 — общие MP4-atoms
            from mutagen.mp4 import MP4, MP4Cover
            audio = MP4(file_path)
            if title: audio['\xa9nam'] = title
            if artist: audio['\xa9ART'] = artist
            if album: audio['\xa9alb'] = album
            if year: audio['\xa9day'] = year
            if cover_bytes:
                audio['covr'] = [MP4Cover(cover_bytes, imageformat=MP4Cover.FORMAT_JPEG)]
            audio.save()
        else:
            print(f'[YM] неизвестный формат для тегирования (head={head[:8].hex()})')
    except Exception as e:
        # Не валим скачивание из-за ошибки тегирования — файл уже на диске
        print(f'[YM] embed metadata failed: {type(e).__name__}: {e}')


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


# ─────────────────────── Quality selection ───────────────────────

def _ext_for_codec(codec: str) -> str:
    c = (codec or '').lower()
    if c == 'flac':
        return 'flac'
    if c in ('aac', 'he-aac'):
        return 'aac'
    if c == 'opus':
        return 'opus'
    return 'mp3'


def _norm_codec(s):
    return (s or '').lower()


def _is_flac(item):
    c = _norm_codec(item.get('codec'))
    return c in ('flac', 'los', 'lossless')


def _is_mp3(item):
    return _norm_codec(item.get('codec')) == 'mp3'


def _pick_stream(dl_info: list, quality: str) -> Optional[dict]:
    if not dl_info:
        return None
    by_br_desc = lambda x: -(x.get('bitrateInKbps') or 0)

    if quality in ('auto', '', None):
        flac = next((i for i in dl_info if _is_flac(i)), None)
        if flac:
            return flac
        mp3_320 = next((i for i in dl_info if _is_mp3(i) and i.get('bitrateInKbps') == 320), None)
        if mp3_320:
            return mp3_320
        return min(dl_info, key=by_br_desc)
    if quality == 'flac':
        return next((i for i in dl_info if _is_flac(i)), None)  # None — нет FLAC, обработать выше
    if quality == 'mp3-320':
        exact = next((i for i in dl_info if _is_mp3(i) and i.get('bitrateInKbps') == 320), None)
        if exact:
            return exact
        mp3s = sorted([i for i in dl_info if _is_mp3(i)], key=by_br_desc)
        if mp3s:
            return mp3s[0]
        return min(dl_info, key=by_br_desc)
    return min(dl_info, key=by_br_desc)


# ─────────────────────── Audio URL resolution ───────────────────────

def _make_v2_sign(ts: int, track_id: str) -> str:
    """Подпись base64(HMAC-SHA256)[:-1] от склейки значений без запятых."""
    codecs_nosep = V2_CODECS.replace(',', '')
    msg = f'{ts}{track_id}lossless{codecs_nosep}{V2_TRANSPORTS}'
    digest = hmac.new(V2_HMAC_KEY, msg.encode('utf-8'), hashlib.sha256).digest()
    return base64.b64encode(digest).decode('ascii')[:-1]


def _get_file_info_v2(track_id: str, token: str) -> Optional[dict]:
    """/get-file-info с правильной подписью. Возвращает downloadInfo dict
    (codec, urls[], key, bitrate, transport=encraw)."""
    ts = int(time.time())
    sign = _make_v2_sign(ts, track_id)
    params = urllib.parse.urlencode({
        'ts': ts,
        'trackId': track_id,
        'quality': 'lossless',
        'codecs': V2_CODECS,
        'transports': V2_TRANSPORTS,
        'sign': sign,
    })
    url = f'{API_BASE}/get-file-info?{params}'
    try:
        req = urllib.request.Request(url, headers=_headers(token))
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        info = data.get('result', data)
        # response shape: {"result": {"downloadInfo": {...}}} или просто {...}
        return info.get('downloadInfo', info) if isinstance(info, dict) else None
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode('utf-8', errors='replace')[:200]
        except Exception:
            pass
        raise RuntimeError(f'/get-file-info {e.code}: {body}')


def _aes_ctr_decrypt(data: bytes, hex_key: str) -> bytes:
    """AES-CTR расшифровка с zero-nonce (как в pycryptodome AES.MODE_CTR с nonce=bytes(12))."""
    try:
        from Crypto.Cipher import AES
    except ImportError:
        raise RuntimeError(
            'Для FLAC нужна библиотека pycryptodome. Установи: pip install pycryptodome'
        )
    key = bytes.fromhex(hex_key)
    cipher = AES.new(key=key, nonce=bytes(12), mode=AES.MODE_CTR)
    return cipher.decrypt(data)


def _resolve_audio_url(track: dict, token: str, quality: str = 'auto') -> Optional[tuple]:
    """Returns (url, codec, encrypted_key) or None.
    Если encrypted_key != None — поток зашифрован AES-CTR, надо расшифровать."""
    # V2 для FLAC и Auto: возвращает зашифрованный поток + ключ
    if quality in ('flac', 'auto', '', None):
        try:
            v2 = _get_file_info_v2(track['trackId'], token)
            v2_codec = _norm_codec(v2.get('codec') if v2 else '')
            v2_urls = v2.get('urls') if v2 else None
            v2_url = v2_urls[0] if v2_urls else None
            v2_key = v2.get('key') if v2 else None
            if v2_url and v2_codec and v2_key:
                is_flac = v2_codec in ('flac', 'flac-mp4')
                if quality != 'flac' or is_flac:
                    final_codec = 'flac' if is_flac else v2_codec
                    print(f"[YM] V2: {v2_codec} {v2.get('bitrate')}kbps · encrypted (AES-CTR)")
                    return (v2_url, final_codec, v2_key)
                print(f"[YM] V2 вернул не-FLAC ({v2_codec}), fallback на V1")
        except Exception as e:
            print(f"[YM] V2 failed: {e}")
            if quality == 'flac':
                msg = str(e)
                is_auth = '403' in msg or 'not-allowed' in msg
                raise RuntimeError(
                    'FLAC недоступен: токен без lossless-доступа. '
                    'Попробуй залогиниться на music.yandex.ru заново и пройти OAuth.'
                    if is_auth else f'FLAC недоступен: {msg}'
                )

    # V1 — /download-info
    dl_info = _api_get(f"/tracks/{track['trackId']}/download-info", token)
    if not isinstance(dl_info, list) or not dl_info:
        return None
    print(f"[YM] V1 download-info: " +
          ', '.join(f"{i.get('codec')}/{i.get('bitrateInKbps')}kbps" for i in dl_info) +
          f' · requested: {quality}')
    pick = _pick_stream(dl_info, quality)
    if not pick:
        if quality == 'flac':
            available = ', '.join(f"{i.get('codec')} {i.get('bitrateInKbps')}" for i in dl_info)
            raise RuntimeError(
                f'FLAC недоступен. API вернуло: {available}. Получи мобильный OAuth-токен.'
            )
        return None
    print(f"[YM] V1 picked: {pick.get('codec')} {pick.get('bitrateInKbps')}kbps")
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
    # V1 returns plain URL (no encryption key)
    return (f'https://{host}/get-mp3/{sign}/{ts}{path}', pick.get('codec', 'mp3'), None)


# ─────────────────────── Public entry point ───────────────────────

def download(url: str,
             output_dir: str,
             token: Optional[str],
             info_cb: Callable[[dict], None],
             progress_cb: Callable[[dict], None],
             cancel_check: Callable[[], bool],
             quality: str = 'auto') -> str:
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
        return str(_download_one(track, Path(output_dir), token, progress_cb, cancel_check, quality))

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
            p = _download_one(t, out_dir, token, progress_cb, cancel_check, quality)
            last_path = str(p)
        except YMCancelled:
            raise
        except Exception as e:
            progress_cb({'status': 'error', 'message': f'пропущен: {e}'})
    progress_cb({'status': 'finished'})
    return last_path


def _download_one(track: dict, out_dir: Path, token: str,
                  progress_cb: Callable, cancel_check: Callable,
                  quality: str = 'auto') -> Path:
    if cancel_check():
        raise YMCancelled()
    result = _resolve_audio_url(track, token, quality)
    if not result:
        raise RuntimeError(f'Я.Музыка: нет audio URL для трека {track["trackId"]}')
    audio_url, codec, encryption_key = result
    ext = _ext_for_codec(codec)

    artist = _sanitize(track.get('artist', ''))
    title = _sanitize(track.get('title', '')) or f"track_{track['trackId']}"
    name = f'{artist} - {title}.{ext}' if artist else f'{title}.{ext}'
    out_path = out_dir / name
    out_dir.mkdir(parents=True, exist_ok=True)

    req = urllib.request.Request(audio_url, headers=_headers(None))
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get('Content-Length') or 0) or None
        if encryption_key:
            # V2 поток — зашифрован, читаем всё в память, расшифровываем, пишем.
            chunks = []
            downloaded = 0
            while True:
                if cancel_check():
                    raise YMCancelled()
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
                downloaded += len(chunk)
                progress_cb({'status': 'downloading',
                             'downloaded_bytes': downloaded, 'total_bytes': total})
            encrypted = b''.join(chunks)
            decrypted = _aes_ctr_decrypt(encrypted, encryption_key)
            with open(out_path, 'wb') as f:
                f.write(decrypted)
        else:
            # V1 — поток нешифрованный, стримим напрямую в файл
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
                    progress_cb({'status': 'downloading',
                                 'downloaded_bytes': downloaded, 'total_bytes': total})
    # Вшиваем теги и обложку из Я.Музыки. Если что-то пойдёт не так — лог,
    # но скачивание всё равно успех.
    cover_uri = track.get('coverUri') or ''
    cover_bytes = _fetch_cover_bytes(cover_uri) if cover_uri else None
    _embed_metadata_and_cover(out_path, codec, track, cover_bytes)

    progress_cb({'status': 'finished'})
    return out_path
