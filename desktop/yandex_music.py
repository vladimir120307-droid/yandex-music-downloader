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
- подкасты (/podcast/X, /podcast/X/episode/Y) — название шоу идёт как артист
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
    # Подкасты: шоу = альбом, эпизод = трек (у Яндекса та же модель данных)
    m = re.search(r'/podcast/(\d+)/episode/(\d+)', p)
    if m:
        return {'type': 'track', 'albumId': m.group(1), 'trackId': m.group(2)}
    m = re.search(r'/podcast/(\d+)', p)
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
    pos = album.get('trackPosition') or {}
    cover_uri = t.get('coverUri') or album.get('coverUri') or ''
    return {
        'trackId': str(t.get('id') or t.get('realId') or ''),
        'albumId': str(album.get('id') or default_album or ''),
        'title': t.get('title') or '',
        # У подкаст-эпизодов artists пустой — подставляем название шоу
        'artist': (', '.join(a.get('name', '') for a in (t.get('artists') or []) if a.get('name'))
                   or album.get('title', '')),
        'album': album.get('title', ''),
        'albumArtist': ', '.join(a.get('name', '') for a in (album.get('artists') or []) if a.get('name')),
        'year': album.get('year') or '',
        'genre': album.get('genre') or '',
        'trackNum': pos.get('index') or 0,
        'trackTotal': album.get('trackCount') or 0,
        'discNum': pos.get('volume') or 0,
        'coverUri': cover_uri,
    }


def _cover_url_https(uri: str, size: str = '600x600') -> Optional[str]:
    """avatars.yandex.net/.../%% → https://avatars.yandex.net/.../600x600"""
    if not uri:
        return None
    if not uri.startswith('http'):
        uri = 'https://' + uri
    return uri.replace('%%', size)


def _fetch_cover_bytes(uri: str, size: str = '600x600') -> Optional[bytes]:
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


def _fetch_lyrics(track_id: str, token: Optional[str]) -> str:
    """Текст песни (несинхронный) через /supplement — отдаётся анонимно."""
    try:
        data = _api_get(f'/tracks/{track_id}/supplement', token)
        lyr = data.get('lyrics') if isinstance(data, dict) else None
        if not lyr:
            return ''
        return lyr.get('fullLyrics') or lyr.get('lyrics') or ''
    except Exception as e:
        print(f'[YM] lyrics fetch failed: {e}')
        return ''


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
    album_artist = track.get('albumArtist') or ''
    year = str(track.get('year') or '') or None
    genre = track.get('genre') or ''
    track_num = track.get('trackNum') or 0
    track_total = track.get('trackTotal') or 0
    disc_num = track.get('discNum') or 0
    lyrics = track.get('lyrics') or ''

    is_mp3 = head[:3] == b'ID3' or (len(head) > 1 and head[0] == 0xff and (head[1] & 0xe0) == 0xe0)
    is_flac = head[:4] == b'fLaC'
    is_mp4 = len(head) > 8 and head[4:8] == b'ftyp'

    try:
        if is_mp3 or (codec == 'mp3' and not is_flac and not is_mp4):
            from mutagen.id3 import (ID3, APIC, TIT2, TPE1, TPE2, TALB, TDRC, TCON,
                                     TRCK, TPOS, USLT, ID3NoHeaderError)
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
            if album_artist: audio.add(TPE2(encoding=1, text=album_artist))
            if year: audio.add(TDRC(encoding=1, text=year))
            if genre: audio.add(TCON(encoding=1, text=genre))
            if track_num:
                audio.add(TRCK(encoding=1, text=(f'{track_num}/{track_total}' if track_total else str(track_num))))
            if disc_num: audio.add(TPOS(encoding=1, text=str(disc_num)))
            if lyrics:
                audio.delall('USLT')
                audio.add(USLT(encoding=1, lang='rus', desc='', text=lyrics))
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
            if album_artist: audio['albumartist'] = album_artist
            if year: audio['date'] = year
            if genre: audio['genre'] = genre
            if track_num: audio['tracknumber'] = str(track_num)
            if track_total: audio['tracktotal'] = str(track_total)
            if disc_num: audio['discnumber'] = str(disc_num)
            if lyrics: audio['lyrics'] = lyrics
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
            if album_artist: audio['aART'] = album_artist
            if year: audio['\xa9day'] = year
            if genre: audio['\xa9gen'] = genre
            if track_num: audio['trkn'] = [(track_num, track_total or 0)]
            if disc_num: audio['disk'] = [(disc_num, 0)]
            if lyrics: audio['\xa9lyr'] = lyrics
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
    if c in ('flac', 'flac-mp4'):
        return 'flac'
    if c in ('aac', 'he-aac', 'aac-mp4', 'he-aac-mp4'):
        return 'm4a'  # AAC-в-MP4 → .m4a (правильное расширение)
    if c == 'opus':
        return 'opus'
    return 'mp3'


def _detect_container(path: Path) -> Optional[str]:
    """Определить реальный контейнер по магическим байтам файла."""
    try:
        with open(path, 'rb') as f:
            head = f.read(12)
    except OSError:
        return None
    if head[:4] == b'fLaC':
        return 'flac'           # нативный FLAC
    if len(head) >= 8 and head[4:8] == b'ftyp':
        return 'm4a'            # MP4/M4A контейнер (FLAC-in-MP4 или AAC)
    if head[:3] == b'ID3':
        return 'mp3'
    if len(head) >= 2 and head[0] == 0xff and (head[1] & 0xe0) == 0xe0:
        return 'mp3'
    return None


def _remux_mp4_to_flac(src: Path, dst: Path, ffmpeg_path: str) -> bool:
    """FLAC-в-MP4 → нативный .flac без перекодирования (-c:a copy, lossless).
    Возвращает True если успех."""
    import subprocess
    try:
        proc = subprocess.run(
            [ffmpeg_path, '-y', '-i', str(src), '-c:a', 'copy', '-f', 'flac', str(dst)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120,
        )
        if proc.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
            return True
        print(f'[YM] ffmpeg remux failed: {proc.stderr.decode("utf-8","replace")[:200]}')
    except Exception as e:
        print(f'[YM] ffmpeg remux error: {e}')
    return False


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
    # V2 (/get-file-info) — путь ТОЛЬКО для FLAC. Принимаем результат
    # ИСКЛЮЧИТЕЛЬНО если это FLAC. Если V2 отдаёт aac-mp4/mp3 — это не то что
    # обещает "Авто" (FLAC → иначе MP3 320), откатываемся на V1 за чистым MP3.
    if quality in ('flac', 'auto', '', None):
        v2 = None
        try:
            v2 = _get_file_info_v2(track['trackId'], token)
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
            # quality='auto' → проглатываем, идём в V1 за MP3
        if v2:
            v2_codec = _norm_codec(v2.get('codec'))
            v2_urls = v2.get('urls')
            v2_url = v2_urls[0] if v2_urls else None
            v2_key = v2.get('key')
            is_flac = v2_codec in ('flac', 'flac-mp4')
            if v2_url and v2_key and is_flac:
                print(f"[YM] V2 FLAC: {v2_codec} {v2.get('bitrate')}kbps · encrypted")
                return (v2_url, 'flac', v2_key)
            # V2 не дал FLAC
            if quality == 'flac':
                raise RuntimeError(
                    f'FLAC недоступен для этого трека — нет lossless-мастера'
                    + (f' (API отдаёт только {v2_codec})' if v2_codec else '')
                    + '. Выбери «MP3 320» или «Авто».'
                )
            print(f"[YM] V2 без FLAC ({v2_codec}), беру MP3 320 через V1")

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
             quality: str = 'auto',
             want_lyrics: bool = False) -> str:
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
        return str(_download_one(track, Path(output_dir), token, progress_cb, cancel_check, quality, want_lyrics))

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
            p = _download_one(t, out_dir, token, progress_cb, cancel_check, quality, want_lyrics)
            last_path = str(p)
        except YMCancelled:
            raise
        except Exception as e:
            progress_cb({'status': 'error', 'message': f'пропущен: {e}'})
    progress_cb({'status': 'finished'})
    return last_path


def _download_one(track: dict, out_dir: Path, token: str,
                  progress_cb: Callable, cancel_check: Callable,
                  quality: str = 'auto', want_lyrics: bool = False) -> Path:
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
    # Определяем реальный контейнер по магическим байтам (codec из API ненадёжен:
    # Яндекс зовёт flac-mp4 «flac», но это MP4, не нативный FLAC).
    container = _detect_container(out_path)

    # FLAC-в-MP4 → нативный .flac через ffmpeg (lossless copy). Так файл откроют
    # FLAC-декодеры / спектрографы, и можно дописать VorbisComment + обложку.
    wants_flac = (codec or '').lower() in ('flac', 'flac-mp4')
    if container == 'm4a' and wants_flac:
        try:
            from ffmpeg_helper import find_ffmpeg
            ffmpeg_path = find_ffmpeg()
        except Exception:
            ffmpeg_path = None
        if ffmpeg_path:
            flac_path = out_path.with_suffix('.flac')
            if _remux_mp4_to_flac(out_path, flac_path, ffmpeg_path):
                try: out_path.unlink()
                except OSError: pass
                out_path = flac_path
                container = 'flac'
                print('[YM] FLAC-in-MP4 → нативный .flac (ffmpeg copy)')
            else:
                print('[YM] ремукс не удался, оставляю MP4 как .m4a')
        else:
            print('[YM] ffmpeg не найден — FLAC останется в MP4-контейнере (.m4a). '
                  'Для нативного .flac установите ffmpeg.')

    # Чиним расширение под реальный контейнер
    if container:
        want = out_path.with_suffix('.' + container)
        if want != out_path:
            try:
                if want.exists(): want.unlink()
                out_path.rename(want)
                out_path = want
            except OSError as e:
                print(f'[YM] rename failed: {e}')

    # Вшиваем теги и обложку (mutagen сам детектит формат по магии).
    if want_lyrics and not track.get('lyrics'):
        track['lyrics'] = _fetch_lyrics(track['trackId'], token)
    cover_uri = track.get('coverUri') or ''
    cover_bytes = _fetch_cover_bytes(cover_uri) if cover_uri else None
    _embed_metadata_and_cover(out_path, codec, track, cover_bytes)

    progress_cb({'status': 'finished'})
    return out_path
