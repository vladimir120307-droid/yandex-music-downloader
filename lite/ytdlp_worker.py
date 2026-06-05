"""Обёртка над yt-dlp для Win7-версии (Python 3.8).

Используется для всех сайтов КРОМЕ Яндекс.Музыки (та через yandex_music.py).
yt-dlp закреплён на 2024.10.22 — последняя версия с поддержкой Python 3.8.
Поэтому экстракторы ~октября 2024: стабильные сайты (Bandcamp, SoundCloud,
VK) работают, YouTube может ломаться (часто меняет защиту).
"""
from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional


class YtCancelled(Exception):
    pass


def is_supported(url: str) -> bool:
    """yt-dlp поддерживает почти всё. Грубая проверка что это http(s) ссылка."""
    u = (url or '').strip().lower()
    return u.startswith('http://') or u.startswith('https://')


def download(url: str,
             output_dir: str,
             audio_format: str,        # 'mp3' | 'm4a' | 'flac' | 'opus' | '' (видео)
             audio_quality: str,       # '320' | '192' | '0'
             video_max_height: str,    # '' для аудио, иначе 'best'/'1080'/'720'/'480'
             ffmpeg_path: Optional[str],
             cookies_browser: Optional[str],
             info_cb: Callable[[dict], None],
             progress_cb: Callable[[dict], None],
             cancel_check: Callable[[], bool]) -> str:
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError('yt-dlp не установлен. pip install "yt-dlp==2024.10.22"')

    out_tmpl = str(Path(output_dir) / '%(uploader,channel,artist|Unknown)s - %(title).100s.%(ext)s')

    def hook(d):
        if cancel_check():
            raise YtCancelled()
        progress_cb(d)

    opts = {
        'outtmpl': out_tmpl,
        'progress_hooks': [hook],
        'quiet': True,
        'no_warnings': True,
        'noprogress': True,
        'retries': 3,
        'fragment_retries': 3,
        'concurrent_fragment_downloads': 4,
    }
    if ffmpeg_path:
        opts['ffmpeg_location'] = ffmpeg_path
    if cookies_browser:
        opts['cookiesfrombrowser'] = (cookies_browser,)

    if video_max_height:
        if video_max_height == 'best':
            opts['format'] = 'bestvideo*+bestaudio/best'
        else:
            opts['format'] = f'bestvideo[height<={video_max_height}]+bestaudio/best[height<={video_max_height}]'
        opts['merge_output_format'] = 'mp4'
        opts['postprocessors'] = [{'key': 'FFmpegMetadata'}]
    else:
        opts['format'] = 'bestaudio/best'
        pps = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': audio_format or 'mp3',
            'preferredquality': audio_quality or '0',
        }, {'key': 'FFmpegMetadata'}, {'key': 'EmbedThumbnail'}]
        opts['postprocessors'] = pps
        opts['writethumbnail'] = True

    final_path = ''
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if cancel_check():
            raise YtCancelled()
        if info:
            info_cb({
                'title': info.get('title', ''),
                'uploader': info.get('uploader') or info.get('channel') or info.get('artist') or '',
                'extractor': info.get('extractor_key') or info.get('extractor') or '',
            })
        ydl.download([url])
        if info:
            try:
                final_path = ydl.prepare_filename(info)
                if not video_max_height:
                    final_path = str(Path(final_path).with_suffix('.' + (audio_format or 'mp3')))
            except Exception:
                final_path = ''
    progress_cb({'status': 'finished'})
    return final_path
